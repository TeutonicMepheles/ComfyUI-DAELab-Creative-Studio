"""Offline synthetic loaded modules; no old package, host, model or network launch."""
import asyncio
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

from tools.migration.legacy_probe import probe

NONCE = "a" * 32
GPU_MIDDLEWARE = """
@web.middleware
async def gpu_middleware(req, handler):
    if req.method != 'POST' or req.path not in ('/prompt', '/api/prompt'):
        return await handler(req)
    try:
        async with native_admission():
            return await handler(req)
    except ValueError as error:
        return web.json_response({'error': {'type': 'local_llm_busy', 'message': str(error)}, 'node_errors': {}}, status=409)
"""


class LegacyProbeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.folder_paths = types.ModuleType("folder_paths")
        self.folder_paths.base_path = str(self.base)
        self.native_queue = ([], [])
        self.server = types.SimpleNamespace(app=types.SimpleNamespace(middlewares=[]),
            prompt_queue=types.SimpleNamespace(get_current_queue_volatile=lambda: self.native_queue))
        bodies = {
            "__init__.py": "NODE_CLASS_MAPPINGS = {}\n",
            "nodes/prompt_optimization/canvas.py": "import asyncio\n_busy=asyncio.Lock()\n_results={}\nasync def polish(event):\n    await event.wait()\ndef synthetic_thread(event):\n    event.wait()\n",
            "nodes/prompt_optimization/local_qwen.py": "from pathlib import Path\nfrom aiohttp import web\nimport folder_paths\n_active=False\n_quarantined=False\n_server=None\ndef lock_path():\n    return Path(folder_paths.base_path)/'user/local-qwen35-9b/gpu-admission.lock'\nasync def _generate():\n    pass\nasync def generate():\n    pass\n" + GPU_MIDDLEWARE,
            "nodes/prompt_optimization/api.py": "_service=None\nasync def handle():\n    pass\n",
            "nodes/prompt_optimization/service.py": "class Service:\n    def __init__(self):\n        pass\n    async def _create(self):\n        pass\n    async def _poll(self):\n        pass\n",
            "nodes/libtv_bridge/table_generation_api.py": "import asyncio\n_tasks={}\n_local_runs={}\n_executions={}\n_submissions=asyncio.Lock()\nasync def submit():\n    pass\nasync def run_batch():\n    pass\nasync def handle():\n    pass\n",
        }
        sources, self.modules = [], {}
        self.system_modules = {"folder_paths": self.folder_paths}
        self.module_patch = patch.dict(sys.modules, self.system_modules)
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)
        for index, (repository, name, _sha, functions) in enumerate(probe.SOURCES):
            path = self.base / "custom_nodes" / probe.PACKAGES[repository] / name
            path.parent.mkdir(parents=True, exist_ok=True)
            raw = bodies[name].encode()
            path.write_bytes(raw)
            module = types.ModuleType("legacy_probe_test_" + str(index))
            module.__file__ = str(path)
            exec(compile(raw, str(path), "exec", dont_inherit=True), vars(module))
            self.modules[(repository, name)] = module
            sys.modules[module.__name__] = module
            self.addCleanup(sys.modules.pop, module.__name__, None)
            sources.append((repository, name, hashlib.sha256(raw).hexdigest(), functions))
        self.sources_patch = patch.object(probe, "SOURCES", tuple(sources))
        self.sources_patch.start()
        self.addCleanup(self.sources_patch.stop)
        self.module("prompt_optimization/local_qwen")._server = self.server
        self.profile_hash = "d" * 64
        self.real_profile_binding = probe.profile_binding
        self.synthetic_host_module = types.ModuleType("synthetic_host")
        self.synthetic_audit = {"hostCommit": probe.HOST_COMMIT, "testOnly": True}
        audit = patch.object(probe, "audit_host", return_value=(self.synthetic_audit, {}, self.synthetic_host_module))
        audit.start()
        self.addCleanup(audit.stop)
        binding = patch.object(probe, "profile_binding", return_value={"activeSequence": 1, "profileRole": "old"})
        self.binding_mock = binding.start()
        self.addCleanup(binding.stop)
        runtime_profile = patch.object(probe, "runtime_profile", return_value={"role": "old"})
        self.runtime_profile_mock = runtime_profile.start()
        self.addCleanup(runtime_profile.stop)
        self.runtime_profile_patch = runtime_profile
        self.fence = probe.IngressFence(self.server, self.folder_paths, 8298)
        self.fence.middleware = object()
        self.server.app.middlewares.append(self.fence.middleware)

    def module(self, name):
        return self.modules[("business", "nodes/" + name + ".py")]

    def collect(self):
        if self.fence.record is None:
            try:
                self.fence.activate(NONCE, self.profile_hash)
            except probe.Unobservable:
                pass  # The following GET must remain unknown, never claim clear.
        return probe.collect(NONCE, self.folder_paths, self.server, self.fence)

    async def test_clear_is_pinned_loaded_real_state_and_exports_only_counts(self):
        canvas = self.module("prompt_optimization/canvas")
        canvas._results["private-request"] = ("b" * 64, {"prompt": "private prompt", "result": "private result", "key": "private credential"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "clear")
        self.assertEqual(result["blockers"], [])
        self.assertEqual(result["observations"]["polish"]["registered"], 1)
        self.assertEqual(result["observations"]["localQwen"]["lockHeld"], None)
        self.assertEqual(result["runtime"]["pid"], __import__("os").getpid())
        self.assertGreater(result["runtime"]["processCreated"], 0)
        self.assertEqual(result["nonce"], NONCE)
        self.assertEqual(len(result["sources"]["files"]), 7)
        self.assertTrue(all(Path(item["moduleFile"]).is_file() for item in result["sources"]["files"]))
        payload = json.dumps(result)
        for private in ("private-request", "private prompt", "private result", "private credential"):
            self.assertNotIn(private, payload)

    async def test_polish_busy_and_abandoned_unknown_are_not_clear_and_state_is_unchanged(self):
        canvas = self.module("prompt_optimization/canvas")
        canvas._results["secret-id"] = ("c" * 64, None)
        await canvas._busy.acquire()
        try:
            result = self.collect()
            self.assertEqual(result["quiescence"], "busy")
            self.assertTrue(canvas._busy.locked())
            self.assertEqual(canvas._results["secret-id"], ("c" * 64, None))
        finally:
            canvas._busy.release()
        self.assertEqual(self.collect()["quiescence"], "unknown")

    async def test_legacy_native_queue_is_observed_even_without_legacy_worker_frames(self):
        self.native_queue[1].append({"prompt": "synthetic private pending native graph"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "busy")
        self.assertEqual(result["observations"]["nativeQueue"], {"running": 0, "pending": 1})
        self.assertNotIn("synthetic private", json.dumps(result))
        self.assertEqual(len(self.native_queue[1]), 1)
        self.native_queue[1].clear()
        self.assertEqual(self.collect()["quiescence"], "clear")

    async def test_quarantine_and_active_flags_are_read_from_actual_base_path_without_cleanup(self):
        qwen = self.module("prompt_optimization/local_qwen")
        qwen._active = True
        self.assertEqual(self.collect()["quiescence"], "busy")
        qwen._active = False
        path = qwen.lock_path().with_suffix(".quarantine")
        path.parent.mkdir(parents=True)
        path.write_bytes(b"synthetic marker must survive")
        before = path.stat()
        result = self.collect()
        self.assertEqual(result["quiescence"], "unknown")
        self.assertEqual(path.read_bytes(), b"synthetic marker must survive")
        self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertFalse(qwen.lock_path().exists())
        self.assertNotIn(str(path), json.dumps(result))

    async def test_module_file_hash_code_replacement_missing_or_duplicate_fail_closed(self):
        module = self.module("prompt_optimization/canvas")
        original = module.polish
        async def replacement(event):
            await event.wait()
        module.polish = replacement
        self.assertEqual(self.collect()["quiescence"], "unknown")
        module.polish = original
        duplicate = types.ModuleType("legacy_probe_duplicate")
        duplicate.__file__ = module.__file__
        with patch.dict(sys.modules, {duplicate.__name__: duplicate}):
            self.assertEqual(self.collect()["quiescence"], "unknown")
        with patch.dict(sys.modules, {module.__name__: None}):
            self.assertEqual(self.collect()["quiescence"], "unknown")
        Path(module.__file__).write_text("# unexpected source bytes\n", encoding="utf-8")
        self.assertIn("legacy-source-pin-mismatch", self.collect()["blockers"])

    async def test_unknown_shapes_unbound_server_and_missing_process_inspection_fail_closed(self):
        canvas = self.module("prompt_optimization/canvas")
        canvas._results["private"] = {"unsupported": "never export"}
        result = self.collect()
        self.assertEqual(result["quiescence"], "unknown")
        self.assertNotIn("never export", json.dumps(result))
        canvas._results.clear()
        self.module("prompt_optimization/local_qwen")._server = None
        self.assertIn("qwen-runtime-server-unbound", self.collect()["blockers"])
        self.module("prompt_optimization/local_qwen")._server = self.server
        with patch.dict(sys.modules, {"psutil": None}):
            self.assertEqual(self.collect()["quiescence"], "unknown")

    async def test_table_and_service_workers_and_submission_locks_cannot_report_clear(self):
        table = self.module("libtv_bridge/table_generation_api")
        event = asyncio.Event()
        worker = asyncio.create_task(event.wait())
        table._tasks["private-worker"] = worker
        try:
            self.assertEqual(self.collect()["quiescence"], "busy")
            table._tasks.clear()
            table._local_runs["opaque-control"] = object()
            self.assertEqual(self.collect()["quiescence"], "busy")
            table._local_runs.clear()
            service = self.module("prompt_optimization/service").Service()
            service.lock = asyncio.Lock()
            service.workers = {"private-worker": worker}
            self.module("prompt_optimization/api")._service = service
            self.assertEqual(self.collect()["quiescence"], "busy")
            service.workers = {}
            await table._submissions.acquire()
            self.assertEqual(self.collect()["quiescence"], "busy")
            table._submissions.release()
        finally:
            event.set()
            await worker

    async def test_active_legacy_coroutine_and_thread_stack_are_observed_without_wrapping(self):
        canvas = self.module("prompt_optimization/canvas")
        event = asyncio.Event()
        task = asyncio.create_task(canvas.polish(event))
        await asyncio.sleep(0)
        try:
            result = self.collect()
            self.assertEqual(result["quiescence"], "busy")
            self.assertGreaterEqual(result["observations"]["legacyStacks"]["asyncTasksInLegacyCode"], 1)
        finally:
            event.set()
            await task
        stop = threading.Event()
        thread = threading.Thread(target=canvas.synthetic_thread, args=(stop,))
        thread.start()
        try:
            result = self.collect()
            self.assertEqual(result["quiescence"], "busy")
            self.assertGreaterEqual(result["observations"]["legacyStacks"]["threadsInLegacyCode"], 1)
            with patch.object(sys, "_current_frames", return_value={}):
                result = self.collect()
                self.assertEqual(result["quiescence"], "busy")
                self.assertGreaterEqual(result["observations"]["legacyStacks"]["threadsWithOwnedTargets"], 1)
        finally:
            stop.set()
            thread.join(timeout=2)
        self.assertEqual(self.collect()["quiescence"], "clear")

    async def test_probe_manifest_is_exact_and_disallows_extra_files(self):
        digest = probe.manifest_identity()
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        root = self.base / "probe-copy"
        root.mkdir()
        for name in ("__init__.py", "probe.py", "probe-manifest.json"):
            shutil.copyfile(Path(probe.__file__).parent / name, root / name)
        self.assertEqual(probe.manifest_identity(root), digest)
        (root / "unexpected.txt").write_text("private", encoding="utf-8")
        with self.assertRaises(probe.Unobservable):
            probe.manifest_identity(root)

    async def test_request_boundary_nonce_loopback_port_origin_and_get_only(self):
        class Query(dict):
            def getall(self, key):
                return [self[key]]
        request = types.SimpleNamespace(method="GET", remote="127.0.0.1", host="127.0.0.1:8298", headers={}, query=Query(nonce=NONCE),
            transport=types.SimpleNamespace(get_extra_info=lambda _: ("127.0.0.1", 8298)))
        self.assertEqual(probe.local_get(request), NONCE)
        for key, value in (("method", "POST"), ("method", "HEAD"), ("remote", "192.0.2.4"), ("host", "127.0.0.1:8000"),
                           ("headers", {"Origin": "https://foreign.invalid"}), ("headers", {"Sec-Fetch-Site": "cross-site"}),
                           ("query", Query(nonce=NONCE, path="private")), ("query", Query(nonce="invalid"))):
            previous = getattr(request, key)
            setattr(request, key, value)
            with self.assertRaises(probe.Unobservable):
                probe.local_get(request)
            setattr(request, key, previous)

    async def test_register_is_get_only_explicit_and_refuses_production_without_model_calls(self):
        routes = {}
        class Routes:
            def get(self, path):
                def bind(handler):
                    routes[path] = handler
                    return handler
                return bind
            post = get
        from aiohttp import web
        server = types.SimpleNamespace(routes=Routes(), app=web.Application())
        with self.assertRaises(probe.Unobservable):
            probe.register(server, self.folder_paths, types.SimpleNamespace(port=8000, listen="127.0.0.1"))
        self.assertEqual(routes, {})
        probe.register(server, self.folder_paths, types.SimpleNamespace(port=8298, listen="127.0.0.1"))
        self.assertEqual(set(routes), {probe.ENDPOINT, probe.ENDPOINT + "/fence"})
        self.assertEqual(__import__("tools.migration.legacy_probe", fromlist=["NODE_CLASS_MAPPINGS"]).NODE_CLASS_MAPPINGS, {})
        with self.assertRaises(probe.Unobservable):
            probe.register(server, self.folder_paths, types.SimpleNamespace(port=8298, listen="127.0.0.1"))

    async def test_get_does_not_activate_fence_and_unknown_mutation_routes_are_monotonically_blocked(self):
        before = probe.collect(NONCE, self.folder_paths, self.server, self.fence)
        self.assertEqual(before["quiescence"], "unknown")
        self.assertIsNone(self.fence.record)
        self.fence.activate(NONCE, self.profile_hash)
        identity = self.fence.record["id"]
        calls = []
        async def handler(request):
            calls.append(request.path)
            return "allowed"
        for method in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            for path in ("/prompt", "/api/prompt", "/daelab/libtv/table/submit", "/unknown"):
                request = types.SimpleNamespace(method=method, path=path, match_info=types.SimpleNamespace(handler=handler))
                response = await self.fence.guard(request, handler)
                self.assertEqual(response.status, 409)
        self.assertEqual(calls, [])
        self.fence.activate("b" * 32, self.profile_hash)
        self.assertEqual(self.fence.record["id"], identity)
        self.assertEqual(self.collect()["fence"]["acceptedAfterFence"], 0)
        self.assertEqual(self.collect()["fence"]["rejectedAfterFence"], 28)
        with self.assertRaises(probe.Unobservable):
            self.fence.activate(NONCE, "e" * 64)

    async def test_existing_requests_drain_and_new_ws_is_blocked_without_closing_existing_native_ws(self):
        entered, finish = asyncio.Event(), asyncio.Event()
        async def mutation(request):
            entered.set()
            await finish.wait()
            return "done"
        request = types.SimpleNamespace(method="POST", path="/prompt", match_info=types.SimpleNamespace(handler=mutation))
        task = asyncio.create_task(self.fence.guard(request, mutation))
        await entered.wait()
        self.fence.activate(NONCE, self.profile_hash)
        self.assertEqual(self.collect()["quiescence"], "busy")
        self.assertEqual(self.collect()["fence"]["activePreFenceRequests"], 1)
        self.assertFalse(task.done())
        finish.set()
        self.assertEqual(await task, "done")
        self.assertEqual(self.collect()["quiescence"], "clear")
        # Separate synthetic controller: handler code is explicitly known, as the
        # real controller requires the pinned native websocket code before use.
        fresh = probe.IngressFence(self.server, self.folder_paths, 8298)
        fresh.middleware = self.fence.middleware
        exec("async def ws(request):\n    await request.finish.wait()\n    return 'ws-finished'\n", vars(self.synthetic_host_module))
        handler = self.synthetic_host_module.ws
        fresh.handlers["/ws"] = handler.__code__
        done = asyncio.Event()
        ws = types.SimpleNamespace(method="GET", path="/ws", match_info=types.SimpleNamespace(handler=handler), finish=done)
        existing = asyncio.create_task(fresh.guard(ws, handler))
        await asyncio.sleep(0)
        fresh.activate(NONCE, self.profile_hash)
        self.assertEqual(len(fresh.pending), 0)
        self.assertEqual((await fresh.guard(ws, handler)).status, 409)
        self.assertFalse(existing.done())
        done.set()
        self.assertEqual(await existing, "ws-finished")

    async def test_post_fence_memory_result_and_removed_middleware_are_explicit_unknown(self):
        self.fence.activate(NONCE, self.profile_hash)
        self.module("prompt_optimization/canvas")._results["new-result"] = ("f" * 64, {"result": "private late result"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "unknown")
        self.assertIn("post-fence-polish-result-needs-preservation", result["blockers"])
        self.assertNotIn("private late result", json.dumps(result))
        self.server.app.middlewares.clear()
        self.assertIn("ingress-middleware-changed", self.collect()["blockers"])

    async def test_studio_public_read_port_and_native_queue_both_block_common_fence_clear(self):
        root = self.base / "custom_nodes/ComfyUI-DAELab-Creative-Studio"
        sources = {
            "backend/jobs/ledger.py": "STATES=frozenset({'pending','submitting','submitted','running','fetching','succeeded','failed','needs_recovery','unknown','cancelled'})\nclass JobLedger:\n    def list_jobs(self,*,state=None,limit=100,offset=0):\n        return [row for row in self.rows if row['state']==state][offset:offset+limit]\n",
            "backend/integrations/comfyui/services.py": "class CoreServices:\n    def __init__(self):\n        pass\n",
            "backend/integrations/comfyui/diagnostics.py": "def product_metadata(root):\n    return {'compatible': True}\nclass Diagnostics:\n    async def health(self, request):\n        return product_metadata(self.root)\n",
        }
        loaded, entries = {}, []
        for index, (name, source) in enumerate(sources.items()):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(source.encode())
            module = types.ModuleType("synthetic_studio_" + str(index))
            module.__file__ = str(path)
            exec(compile(source, str(path), "exec", dont_inherit=True), vars(module))
            sys.modules[module.__name__] = module
            self.addCleanup(sys.modules.pop, module.__name__, None)
            loaded[name] = module
            entries.append({"path": name, "sha256": hashlib.sha256(source.encode()).hexdigest()})
        (root / "release-candidate.json").write_text(json.dumps({"revision": "c" * 40, "frontendBuildId": "b" * 64, "files": entries}))
        profile_user = self.base / "profiles/new/user"
        database = profile_user / "daelab/creative-studio/studio.sqlite3"
        database.parent.mkdir(parents=True)
        database.write_bytes(b"synthetic path binding; fake read port does not open this file")
        self.folder_paths.get_user_directory = lambda: str(profile_user)
        ledger = loaded["backend/jobs/ledger.py"].JobLedger()
        ledger.database = types.SimpleNamespace(path=database)
        ledger.rows = []
        core = loaded["backend/integrations/comfyui/services.py"].CoreServices()
        core.jobs = ledger
        self.server._creative_studio_services = core
        diagnostic = loaded["backend/integrations/comfyui/diagnostics.py"].Diagnostics()
        diagnostic.root, diagnostic.server = root, self.server
        self.server._creative_studio_diagnostics = diagnostic
        queue = ([], [])
        self.server.prompt_queue = types.SimpleNamespace(get_current_queue_volatile=lambda: queue)
        self.runtime_profile_mock.return_value = {"role": "new", "package": {"spec": {"kind": "studio", "root": str(root), "commit": "c" * 40}},
            "recoveryPlans": [{"requestId": "remote-original", "provider": "test-remote", "providerTaskId": "provider-original", "action": "query_original_only"}]}
        self.binding_mock.return_value = {"activeSequence": 1, "profileRole": "new"}
        self.assertEqual(self.collect()["quiescence"], "clear")
        self.assertEqual(self.collect()["profileRole"], "new")
        self.assertEqual(self.collect()["runtime"]["studioRoot"], str(root))
        health = types.SimpleNamespace(method="GET", path="/daelab/studio/health", match_info=types.SimpleNamespace(handler=diagnostic.health))
        self.assertEqual(await self.fence.guard(health, diagnostic.health), {"compatible": True})
        ledger.rows.append({"state": "pending", "prompt": "private fake prompt", "result": "private fake output"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "busy")
        self.assertEqual(result["observations"]["ledgerNonTerminalCounts"]["pending"], 1)
        self.assertNotIn("private fake", json.dumps(result))
        ledger.rows.clear()
        queue[1].append({"private": "native queued input"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "busy")
        self.assertEqual(result["observations"]["nativeQueue"]["pending"], 1)
        self.assertNotIn("native queued input", json.dumps(result))
        queue[1].clear()
        ledger.rows.append({"state": "submitted", "request_id": "remote-original", "provider": "test-remote", "provider_task_id": "provider-original", "execution_kind": "remote"})
        result = self.collect()
        self.assertEqual(result["quiescence"], "clear")
        self.assertEqual(result["observations"]["ledgerQueryOnlyRecoveryFacts"], 1)
        for field, invalid in (("provider", "libtv"), ("provider", "local-h3"), ("request_id", "invalid identity"), ("execution_kind", "mystery")):
            previous = ledger.rows[0][field]
            ledger.rows[0][field] = invalid
            self.assertEqual(self.collect()["quiescence"], "busy")
            ledger.rows[0][field] = previous
        # A complete approved page must not hide an unplanned job on the next page.
        approved = ledger.rows[0]
        ledger.rows = [dict(approved) for _ in range(1000)] + [{"state": "submitted", "execution_kind": "local"}]
        result = self.collect()
        self.assertEqual(result["quiescence"], "busy")
        self.assertEqual(result["observations"]["ledgerNonTerminalCounts"]["submitted"], 1001)
        ledger.rows = [dict(approved) for _ in range(20001)]
        result = self.collect()
        self.assertEqual(result["quiescence"], "unknown")
        self.assertIn("studio-ledger-inspection-capacity-exceeded", result["blockers"])
        ledger.rows = [approved]
        ledger.rows.append({"state": "submitted", "execution_kind": "local"})
        self.assertEqual(self.collect()["quiescence"], "busy")
        ledger.rows.clear()
        self.server._creative_studio_services = object()
        self.assertEqual(self.collect()["quiescence"], "unknown")
        self.server._creative_studio_services = core
        loaded["backend/integrations/comfyui/diagnostics.py"].product_metadata = lambda root: {"forged": True}
        self.assertEqual((await self.fence.guard(health, diagnostic.health)).status, 409)
        self.assertEqual(self.collect()["quiescence"], "unknown")

    async def test_real_profile_binding_derives_roots_and_utf8_hash_and_rejects_wrong_owner_or_selection(self):
        # Only synthetic filesystem ownership documents. No host is started.
        workspace = self.base / "owned"
        profile = workspace / "profiles/case-old"
        roots = {name: profile / name for name in ("user", "input", "output")}
        for name, path in roots.items():
            path.mkdir(parents=True)
            setattr(self.folder_paths, "get_" + name + "_directory", lambda path=path: str(path))
        observer = self.base / "custom_nodes/StudioMigration.LegacyProbe"
        observer.mkdir()
        owner = "daelab-creative-studio-offline-migration"
        def write(path, value):
            path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        write(self.base / "old-baseline-owner.json", {"owner": "creative-studio-old-baseline-v1", "environment_root": str(self.base), "port": 8298, "host_commit": probe.HOST_COMMIT})
        write(workspace / ".studio-migration-workspace.json", {"owner": owner, "schemaVersion": 1, "workspaceId": "synthetic", "path": str(workspace)})
        marker = {"schemaVersion": 1, "owner": owner, "workspaceId": "synthetic", "role": "old", "profileId": "case-old", "path": str(profile),
                  "roots": {name: str(path) for name, path in roots.items()}, "unicodeEvidence": "中文路径", "package": {"spec": {"kind": "legacy", "installationRoot": str(self.base),
                  "commits": probe.PINS, "roots": {name: str(self.base / "custom_nodes" / package) for name, package in probe.PACKAGES.items()}, "observer": {"root": str(observer)}}}}
        digest = hashlib.sha256(json.dumps(marker, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        write(profile / ".studio-data-profile.json", marker)
        write(profile / "READY.json", {"profileSha256": digest})
        activation = workspace / "activation"
        activation.mkdir()
        write(activation / "000001.json", {"schemaVersion": 1, "owner": owner, "workspaceId": "synthetic", "sequence": 1, "previousSha256": None,
                                           "profileId": "case-old", "profileSha256": digest})
        self.runtime_profile_patch.stop()
        with patch.object(probe, "__file__", str(observer / "probe.py")):
            result = self.real_profile_binding(self.folder_paths, digest, 8298)
            self.assertEqual(result["profileRole"], "old")
            self.assertEqual(result["activeSequence"], 1)
            with self.assertRaises(probe.Unobservable):
                self.real_profile_binding(self.folder_paths, digest, 8000)
            with self.assertRaises(probe.Unobservable):
                self.real_profile_binding(self.folder_paths, "0" * 64, 8298)
            write(activation / "000001.json", {"sequence": 1})
            with self.assertRaises(probe.Unobservable):
                self.real_profile_binding(self.folder_paths, digest, 8298)


if __name__ == "__main__":
    unittest.main()
