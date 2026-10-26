"""Owned isolated profile observations and explicit monotonic ingress fencing.

File bytes and loaded function code must match inspected commits before private
state is read. Source/body/credential/request/result content is never exported.
Memory observations are point-in-time; an explicitly activated fence closes HTTP
admission until restart. Stopping the process and preserving data are external.
"""
import ast
import asyncio
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import sys
import threading
import time
import types
import uuid
from urllib.parse import urlsplit

COVERAGE_VERSION = "legacy-memory-v1"
FENCE_COVERAGE_VERSION = "legacy-ingress-v1"
ENDPOINT = "/daelab/migration/legacy-runtime"
_IMPORTED_PROBE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
PINS = {"canvas": "3176b5a67dbcd0b66f795976e5a81bcdfe346093", "business": "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"}
HOST_COMMIT = "3c1b7a17fdf239d35ce98cc777756f572d089795"
HOST_SOURCES = {"server.py": "7dc4ca3bd801a64da1fe7c2d1af81da61999f6b96dd96637d456e0562e8ce40b",
                "main.py": "c3eb9175ad667127d61c8bb68d07a5e6542f0490851dc73176f73bd6d0320cb1",
                "execution.py": "65f0a4ec361649cbd50869ef20c0f590b6931206cb07e3066b646e81a1a1a201"}
PACKAGES = {"canvas": "ComfyUI-DAELab-Creative-Canvas", "business": "ComfyUI-DAELab-Custom-Nodes-Library"}
# SHA-256 of git-show bytes from the exact commits above (not CRLF conversions).
SOURCES = (
    ("canvas", "__init__.py", "6ec74e57c1ce24606a7a6234136a6f253575931a2de5c8c8c0387bae8414fab4", ()),
    ("business", "__init__.py", "ce10f353a8767916e3128dfcc7fea5326a58fa341305e364d5fb50b16749b656", ()),
    ("business", "nodes/prompt_optimization/canvas.py", "dab18cc14060d8b3df3956a22fa04f188ac653e99951fdf5f3c302d3b34dec9d", ("polish",)),
    ("business", "nodes/prompt_optimization/local_qwen.py", "8f764358a3a1e2a88c1514bd3f1ee5919fb3249b7a9f5512ee22ba3c02d3a343", ("lock_path", "_generate", "generate", "gpu_middleware")),
    ("business", "nodes/prompt_optimization/api.py", "b986b63a971eebd5f029db1a207bc8a376079c19ab150d5ac88aee22ee03dfd3", ("handle",)),
    ("business", "nodes/prompt_optimization/service.py", "71f434b4f883eaa6224b6345141d252959b5414800899c6dfdbe34c08de5aec9", ("Service.__init__", "Service._create", "Service._poll")),
    ("business", "nodes/libtv_bridge/table_generation_api.py", "08b43dd69762c2e86063bfa33968013555d3888715f58a6cc4def334b39351af", ("submit", "run_batch", "handle")),
)


class Unobservable(ValueError):
    """Only constant codes reach the response; no exception text from dependencies."""


def require(condition, code):
    if not condition:
        raise Unobservable(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def ordinary(path, *, must_exist=True):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "nonabsolute-source-path")
    for part in (*reversed(path.parents), path):
        require(not part.is_symlink() and not getattr(part, "is_junction", lambda: False)(), "linked-source-path")
    resolved = path.resolve(strict=must_exist)
    if must_exist and resolved.is_file():
        require(resolved.stat().st_nlink == 1, "linked-source-file")
    return resolved


def source_bytes(path):
    path = ordinary(path)
    require(path.is_file() and path.stat().st_size <= 1024 * 1024, "unbounded-source-file")
    return path.read_bytes()


def manifest_identity(package_root=None):
    root = ordinary(package_root or Path(__file__).parent)
    record = json.loads(source_bytes(root / "probe-manifest.json"))
    require(set(record) == {"schemaVersion", "kind", "coverageVersion", "files", "probeSourceSha256"} and
            record["schemaVersion"] == 1 and record["kind"] == "legacy-runtime-probe-package" and
            record["coverageVersion"] == COVERAGE_VERSION, "unsupported-probe-manifest")
    expected = []
    for name in ("__init__.py", "probe.py", "README.md", "AGENTS.md"):
        raw = source_bytes(root / name)
        expected.append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
    require(record["files"] == expected and record["probeSourceSha256"] == hashlib.sha256(canonical(expected)).hexdigest(), "probe-source-changed")
    require(expected[1]["sha256"] == _IMPORTED_PROBE_SHA256, "loaded-probe-source-changed")
    require({p.name for p in root.iterdir()} <= {entry["path"] for entry in expected} | {"probe-manifest.json", "__pycache__"}, "unexpected-probe-file")
    return record["probeSourceSha256"]


def code_objects(code):
    yield code
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            yield from code_objects(value)


def loaded_sources(base):
    roots = {key: ordinary(base / "custom_nodes" / name) for key, name in PACKAGES.items()}
    modules, records, identities = {}, [], []
    loaded = tuple({id(module): module for module in tuple(sys.modules.values()) if type(module) is types.ModuleType}.values())
    for repository, relative, digest, functions in SOURCES:
        path = ordinary(roots[repository] / relative)
        raw = source_bytes(path)
        require(hashlib.sha256(raw).hexdigest() == digest, "legacy-source-pin-mismatch")
        matches = []
        for module in loaded:
            value = vars(module).get("__file__")
            if isinstance(value, str) and Path(value).absolute() == path:
                matches.append(module)
        require(len(matches) == 1, "loaded-module-missing-or-ambiguous")
        module = matches[0]
        for name in functions:
            actual = vars(module).get(name.split(".")[0])
            if "." in name:
                require(isinstance(actual, type), "loaded-class-unavailable")
                actual = vars(actual).get(name.split(".")[1])
            require(type(actual) is types.FunctionType and actual.__globals__ is vars(module), "loaded-function-replaced")
            require(ordinary(actual.__code__.co_filename) == path, "loaded-code-origin-mismatch")
            compiled = compile(raw, actual.__code__.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
            expected = [code for code in code_objects(compiled) if code.co_qualname == name]
            require(len(expected) == 1 and actual.__code__ == expected[0], "loaded-code-pin-mismatch")
            identities.append((module, name, actual))
        modules[(repository, relative)] = module
        records.append({"repository": repository, "path": relative, "sha256": digest, "moduleFile": str(path)})
    return roots, modules, records, identities


def lock_state(value):
    require(type(value) is asyncio.Lock, "unknown-lock-type")
    return asyncio.Lock.locked(value)


def task_counts(value):
    require(type(value) is dict and len(value) <= 20000, "unknown-worker-registry")
    tasks = tuple(value.values())
    require(all(isinstance(task, asyncio.Task) for task in tasks), "unknown-worker-type")
    return {"registered": len(tasks), "active": sum(not asyncio.Task.done(task) for task in tasks),
            "cancelled": sum(asyncio.Task.cancelled(task) for task in tasks)}


def stat_marker(path):
    path = ordinary(path, must_exist=False)
    if not path.exists():
        return {"exists": False, "bytes": None, "mtimeNs": None}
    require(path.is_file() and path.stat().st_nlink == 1, "unknown-qwen-marker")
    stat = path.stat()
    return {"exists": True, "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns}


def owned_stack_counts(roots, passthrough=None):
    def owned(filename):
        if not isinstance(filename, str) or not Path(filename).is_absolute():
            return False
        return any(Path(filename).is_relative_to(root) for root in roots.values())
    def owned_frame(frame, task):
        if frame is None or not owned(frame.f_code.co_filename):
            return False
        # Only one pinned return-await frame is transparent for a request whose
        # exact method/path/handler was recorded by our outer ingress guard.
        # Never read frame locals, drop a whole task/thread, or exempt workers.
        return not (passthrough is not None and task in passthrough[2] and
                    frame.f_code is passthrough[0] and frame.f_lineno == passthrough[1])
    async_count = 0
    for task in asyncio.all_tasks():
        current, seen, found = task.get_coro(), set(), False
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            if isinstance(current, types.CoroutineType):
                frame, current = current.cr_frame, current.cr_await
            elif isinstance(current, types.GeneratorType):
                frame, current = current.gi_frame, current.gi_yieldfrom
            else:
                break  # Future iterators have no Python source frame; their Task is separately enumerated.
            found = found or owned_frame(frame, task)
        async_count += found
    thread_count = 0
    current_thread, current_task = threading.get_ident(), asyncio.current_task()
    for thread_id, frame in sys._current_frames().items():
        found = False
        while frame is not None:
            found = found or owned_frame(frame, current_task if thread_id == current_thread else None)
            frame = frame.f_back
        thread_count += found
    # Thread.start may acknowledge before its target reaches a Python frame.
    # Inspect only callable code origin, never the thread's arguments or locals.
    targets = 0
    for thread in threading.enumerate():
        target = vars(thread).get("_target")
        function = target.__func__ if type(target) is types.MethodType else target
        targets += type(function) is types.FunctionType and owned(function.__code__.co_filename)
    return {"asyncTasksInLegacyCode": async_count, "threadsInLegacyCode": thread_count, "threadsWithOwnedTargets": targets}


def native_queue_counts(server):
    queue = server.prompt_queue.get_current_queue_volatile()
    require(type(queue) is tuple and len(queue) == 2 and all(type(value) is list for value in queue), "native-queue-shape-unknown")
    return {"running": len(queue[0]), "pending": len(queue[1])}


def observe_memory(base, modules, roots, server, fence=None):
    module = lambda name: modules[("business", "nodes/" + name + ".py")]
    canvas, qwen = module("prompt_optimization/canvas"), module("prompt_optimization/local_qwen")
    api, service, table = module("prompt_optimization/api"), module("prompt_optimization/service"), module("libtv_bridge/table_generation_api")
    values = vars(canvas)
    require(type(values.get("_results")) is dict and len(values["_results"]) <= 256, "unknown-polish-results")
    results = tuple(values["_results"].values())
    require(all(type(v) is tuple and len(v) == 2 and isinstance(v[0], str) and re.fullmatch(r"[0-9a-f]{64}", v[0]) and
                (v[1] is None or type(v[1]) is dict) for v in results), "unknown-polish-result-shape")
    polish = {"busy": lock_state(values.get("_busy")), "registered": len(results), "unresolved": sum(v[1] is None for v in results)}
    q = vars(qwen)
    require(type(q.get("_active")) is bool and type(q.get("_quarantined")) is bool, "unknown-qwen-state")
    require(server is not None and q.get("_server") is server, "qwen-runtime-server-unbound")
    # lock_path was verified against the fixed loaded code above. It only reads
    # folder_paths.base_path; never call admission/ensure_unloaded/request.
    path = ordinary(q["lock_path"](), must_exist=False)
    require(path == base / "user/local-qwen35-9b/gpu-admission.lock", "qwen-runtime-path-mismatch")
    quarantine = path.with_suffix(".quarantine")
    markers = (stat_marker(path), stat_marker(quarantine))
    qwen_state = {"active": q["_active"], "quarantined": q["_quarantined"],
                  "lockPathSha256": hashlib.sha256(str(path).encode()).hexdigest(),
                  "quarantinePathSha256": hashlib.sha256(str(quarantine).encode()).hexdigest(),
                  "lockFile": markers[0], "quarantineFile": markers[1], "lockHeld": None}
    workers = {"initialized": False, "lockBusy": False, "registered": 0, "active": 0, "cancelled": 0}
    require("_service" in vars(api), "optimization-service-state-missing")
    instance = vars(api)["_service"]
    if instance is not None:
        require(type(instance) is vars(service).get("Service"), "unknown-optimization-service")
        workers = {"initialized": True, "lockBusy": lock_state(vars(instance).get("lock")), **task_counts(vars(instance).get("workers"))}
    t = vars(table)
    require(type(t.get("_local_runs")) is dict and type(t.get("_executions")) is dict, "unknown-table-controls")
    executions = tuple(t["_executions"].values())
    require(all(type(v) is list and len(v) == 2 and type(v[1]) is int and v[1] >= 0 for v in executions), "unknown-table-executions")
    table_state = {**task_counts(t.get("_tasks")), "submissionBusy": lock_state(t.get("_submissions")),
                   "localControls": len(t["_local_runs"]), "executionGroups": len(executions),
                   "executionReferences": sum(v[1] for v in executions), "executionLocksBusy": sum(lock_state(v[0]) for v in executions)}
    passthrough = fence.stack_passthrough(modules) if fence is not None else None
    stacks, native = owned_stack_counts(roots, passthrough), native_queue_counts(server)
    require(markers == (stat_marker(path), stat_marker(quarantine)), "qwen-marker-changed-during-observation")
    busy = (polish["busy"] or qwen_state["active"] or workers["active"] or workers["lockBusy"] or table_state["active"] or
            table_state["submissionBusy"] or table_state["localControls"] or table_state["executionReferences"] or table_state["executionLocksBusy"] or any(stacks.values()) or any(native.values()))
    unknown = (polish["unresolved"] and not polish["busy"] or qwen_state["quarantined"] or markers[1]["exists"] and not qwen_state["active"] or
               workers["cancelled"] or table_state["cancelled"] or table_state["executionGroups"] and not table_state["executionReferences"])
    return {"polish": polish, "localQwen": qwen_state, "optimizationWorkers": workers, "tableWorkers": table_state, "legacyStacks": stacks, "nativeQueue": native}, bool(busy), bool(unknown)


def collect(nonce, folder_paths, server, fence=None):
    require(isinstance(nonce, str) and re.fullmatch(r"[0-9a-f]{32}", nonce), "invalid-nonce")
    result = {"schemaVersion": 1, "kind": "legacy-runtime-quiescence", "coverageVersion": COVERAGE_VERSION, "nonce": nonce,
              "observedAt": time.time(), "profileRole": None, "quiescence": "unknown", "probeSourceSha256": None, "runtime": None,
              "sources": {"canvasCommit": PINS["canvas"], "businessCommit": PINS["business"], "files": []},
              "observations": None, "blockers": [], "scope": "same-process owned profile; persistent data and process exit also require operator-tool verification",
              "limitations": ["Memory is a point-in-time observation; ingress closure is proven separately by the fence. No provider state or full host exit is inferred.",
                              "OS lock ownership is not probed by acquiring a lock. File presence alone is not treated as a held lock."]}
    try:
        result["probeSourceSha256"] = manifest_identity()
        import psutil
        process = psutil.Process(os.getpid())
        birth = process.create_time()
        require(type(birth) in (int, float) and math.isfinite(birth) and birth > 0, "process-birth-unavailable")
        base = ordinary(folder_paths.base_path)
        marker = runtime_profile(folder_paths)
        result["profileRole"] = marker["role"]
        if marker["role"] == "old":
            roots, modules, files, identities = loaded_sources(base)
            result["runtime"] = {"pid": os.getpid(), "processCreated": birth, "installationRoot": str(base),
                                 "canvasRoot": str(roots["canvas"]), "businessRoot": str(roots["business"])}
            result["sources"]["files"] = files
            result["observations"], busy, unknown = observe_memory(base, modules, roots, server, fence)
            for module, name, original in identities:
                actual = vars(module)[name.split(".")[0]]
                actual = vars(actual)[name.split(".")[1]] if "." in name else actual
                require(actual is original, "loaded-function-changed-during-observation")
        else:
            observed, source, root, busy = observe_studio(base, marker, folder_paths, server)
            result["runtime"] = {"pid": os.getpid(), "processCreated": birth, "installationRoot": str(base), "studioRoot": str(root)}
            result["sources"] = source
            result["observations"], unknown = observed, False
        require(process.create_time() == birth, "process-identity-changed")
        result["quiescence"] = "unknown" if unknown else "busy" if busy else "clear"
        if unknown:
            result["blockers"].append("unresolved-or-quarantined-legacy-state")
        if busy:
            result["blockers"].append("legacy-work-active")
    except Unobservable as error:
        result["blockers"].append(str(error))
    except Exception:
        result["blockers"].append("legacy-runtime-observation-unavailable")
    if fence is not None:
        fence.enrich(result)
    else:
        result["fence"] = {"active": False}
        result["quiescence"] = "unknown"
        result["blockers"].append("ingress-observer-unbound")
    return result


def local_request(request, method):
    try:
        require(request.method == method, "method-not-allowed")
        require(ipaddress.ip_address(request.remote).is_loopback, "loopback-required")
        host = urlsplit("http://" + request.host)
        socket = request.transport.get_extra_info("sockname")
        require(socket and ipaddress.ip_address(socket[0]).is_loopback and host.hostname in {"127.0.0.1", "localhost", "::1"} and
                host.port == socket[1] and host.port != 8000, "isolated-loopback-listener-required")
        origin = request.headers.get("Origin")
        require((not origin or urlsplit(origin).netloc == request.host) and request.headers.get("Sec-Fetch-Site") != "cross-site", "cross-site-observation-refused")
    except (ValueError, TypeError, AttributeError):
        raise Unobservable("request-not-authorized") from None


def local_get(request):
    local_request(request, "GET")
    require(list(request.query.keys()) == ["nonce"] and len(request.query.getall("nonce")) == 1, "invalid-query")
    nonce = request.query["nonce"]
    require(re.fullmatch(r"[0-9a-f]{32}", nonce), "invalid-nonce")
    return nonce


def document(path):
    raw = ordinary(path).read_bytes()
    require(len(raw) <= 16 * 1024 * 1024, "ownership-document-too-large")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate-ownership-key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(Unobservable("nonfinite-ownership-value")))


def runtime_profile(folder_paths):
    roots = {name: ordinary(getattr(folder_paths, "get_" + name + "_directory")()) for name in ("user", "input", "output")}
    profile = roots["user"].parent
    require(roots == {name: profile / name for name in roots}, "runtime-profile-roots-differ")
    marker = document(profile / ".studio-data-profile.json")
    require(marker.get("owner") == "daelab-creative-studio-offline-migration" and marker.get("schemaVersion") == 1 and
            marker.get("role") in {"old", "new"} and marker.get("roots") == {name: str(path) for name, path in roots.items()}, "unknown-runtime-profile")
    return marker


def observe_studio(base, marker, folder_paths, server):
    """Use the existing JobLedger read port only; never construct a ledger or reconcile."""
    spec = marker["package"]["spec"]
    root = ordinary(spec["root"])
    require(spec.get("kind") == "studio" and root.parent == base / "custom_nodes", "studio-package-root-mismatch")
    release = document(root / "release-candidate.json")
    require(release.get("revision") == spec.get("commit") and re.fullmatch(r"[0-9a-f]{40}", spec["commit"]), "studio-candidate-mismatch")
    digests = {item["path"]: item["sha256"] for item in release["files"]}
    loaded = {}
    for relative, function in (("backend/jobs/ledger.py", "JobLedger.list_jobs"),
                               ("backend/integrations/comfyui/services.py", "CoreServices.__init__")):
        path = ordinary(root / relative)
        raw = source_bytes(path)
        require(hashlib.sha256(raw).hexdigest() == digests.get(relative), "studio-runtime-source-mismatch")
        matches = {id(module): module for module in tuple(sys.modules.values()) if type(module) is types.ModuleType and vars(module).get("__file__") and Path(vars(module)["__file__"]).absolute() == path}
        require(len(matches) == 1, "studio-loaded-module-unavailable")
        module = next(iter(matches.values()))
        cls = vars(module).get(function.split(".")[0])
        require(isinstance(cls, type), "studio-runtime-class-unavailable")
        method = vars(cls).get(function.split(".")[1])
        require(type(method) is types.FunctionType and method.__globals__ is vars(module) and ordinary(method.__code__.co_filename) == path, "studio-runtime-method-replaced")
        compiled = compile(raw, method.__code__.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
        require(any(code.co_qualname == function and code == method.__code__ for code in code_objects(compiled)), "studio-runtime-code-mismatch")
        loaded[relative] = module
    core = getattr(server, "_creative_studio_services", None)
    require(core is not None and type(core) is loaded["backend/integrations/comfyui/services.py"].CoreServices, "studio-core-unavailable")
    ledger = vars(core).get("jobs")
    require(type(ledger) is loaded["backend/jobs/ledger.py"].JobLedger and "list_jobs" not in vars(ledger), "studio-ledger-unavailable")
    require(ordinary(ledger.database.path) == ordinary(Path(folder_paths.get_user_directory()) / "daelab/creative-studio/studio.sqlite3"), "studio-ledger-root-mismatch")
    states = {"pending", "submitting", "submitted", "running", "fetching", "succeeded", "failed", "needs_recovery", "unknown", "cancelled"}
    require(loaded["backend/jobs/ledger.py"].STATES == states, "studio-ledger-states-unsupported")
    counts, scanned, recovery_facts, blocking_facts = {}, 0, 0, 0
    plans = marker.get("recoveryPlans", [])
    require(type(plans) is list, "studio-recovery-plans-unsupported")
    for state in sorted(states - {"succeeded", "failed", "cancelled"}):
        counts[state], offset = 0, 0
        while True:
            page = ledger.list_jobs(state=state, limit=1000, offset=offset)
            require(type(page) is list and len(page) <= 1000 and all(type(row) is dict and row.get("state") == state for row in page), "studio-ledger-read-unsupported")
            scanned += len(page)
            require(scanned <= 20000, "studio-ledger-inspection-capacity-exceeded")
            counts[state] += len(page)
            for row in page:
                identity = {"requestId": row.get("request_id"), "provider": row.get("provider"), "providerTaskId": row.get("provider_task_id")}
                exact = (row.get("execution_kind") == "remote" and "node_key" not in row and
                         all(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:@/\-]{1,256}", value) for value in identity.values()) and
                         identity["provider"] not in {"libtv", "gpt", "gpt-image", "legacy-gpt", "local-qwen-image", "local-h3", "local-qwen-text"} and
                         any(type(plan) is dict and plan.get("action") == "query_original_only" and
                             all(plan.get(key) == value for key, value in identity.items()) for plan in plans))
                recovery_facts += bool(exact)
                blocking_facts += not exact
            if len(page) < 1000:
                break
            offset += len(page)
    stacks = owned_stack_counts({"studio": root})
    queue = native_queue_counts(server)
    observed = {"ledgerNonTerminalCounts": counts, "ledgerQueryOnlyRecoveryFacts": recovery_facts, "ledgerBlockingFacts": blocking_facts,
                "nativeQueue": queue, "studioStacks": stacks}
    busy = blocking_facts or any(stacks.values()) or any(queue.values())
    return observed, {"candidateCommit": spec["commit"], "frontendBuildId": release.get("frontendBuildId"), "files": []}, root, bool(busy)


def studio_health_handler(folder_paths, server):
    """Only the reviewed Diagnostics.health -> product_metadata pure read path."""
    marker = runtime_profile(folder_paths)
    require(marker["role"] == "new", "studio-health-role-mismatch")
    root = ordinary(marker["package"]["spec"]["root"])
    release = document(root / "release-candidate.json")
    require(release.get("revision") == marker["package"]["spec"]["commit"], "studio-health-candidate-mismatch")
    path = ordinary(root / "backend/integrations/comfyui/diagnostics.py")
    raw = source_bytes(path)
    entries = [item for item in release["files"] if item["path"] == "backend/integrations/comfyui/diagnostics.py"]
    require(len(entries) == 1 and hashlib.sha256(raw).hexdigest() == entries[0]["sha256"], "studio-health-source-mismatch")
    matches = {id(module): module for module in tuple(sys.modules.values()) if type(module) is types.ModuleType and
               vars(module).get("__file__") and Path(vars(module)["__file__"]).absolute() == path}
    require(len(matches) == 1, "studio-health-module-unavailable")
    module = next(iter(matches.values()))
    cls, instance = vars(module).get("Diagnostics"), getattr(server, "_creative_studio_diagnostics", None)
    require(isinstance(cls, type) and type(instance) is cls and ordinary(vars(instance).get("root")) == root and
            vars(instance).get("server") is server and "health" not in vars(instance), "studio-health-instance-unavailable")
    for name in ("Diagnostics.health", "product_metadata"):
        method = vars(cls).get("health") if name == "Diagnostics.health" else vars(module).get(name)
        require(type(method) is types.FunctionType and method.__globals__ is vars(module) and ordinary(method.__code__.co_filename) == path, "studio-health-method-replaced")
        compiled = compile(raw, method.__code__.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
        require(any(code.co_qualname == name and code == method.__code__ for code in code_objects(compiled)), "studio-health-code-mismatch")
    return instance.health


def profile_binding(folder_paths, profile_sha, port):
    """Derive paths ONLY from the running host. Body never supplies a filesystem path."""
    require(isinstance(profile_sha, str) and re.fullmatch(r"[0-9a-f]{64}", profile_sha), "invalid-profile-fingerprint")
    base = ordinary(folder_paths.base_path)
    require(Path(__file__).parent == base / "custom_nodes/StudioMigration.LegacyProbe", "probe-not-installed-in-owned-baseline")
    runtime_marker = runtime_profile(folder_paths)
    old = runtime_marker["role"] == "old"
    owner = document(base / ("old-baseline-owner.json" if old else "creative-studio-isolation.json"))
    require(owner.get("owner") == ("creative-studio-old-baseline-v1" if old else "creative-studio-cpu-host-v1") and owner.get("environment_root") == str(base) and
            owner.get("port") == port and port != 8000 and (not old or owner.get("host_commit") == HOST_COMMIT), "unowned-isolated-runtime")
    allowed = set(PACKAGES.values()) if old else {"ComfyUI-DAELab-Creative-Studio"}
    require({item.name for item in (base / "custom_nodes").iterdir()} <= {*allowed, "StudioMigration.LegacyProbe", "__pycache__"}, "unreviewed-enabled-package")
    roots = {name: ordinary(getattr(folder_paths, "get_" + name + "_directory")()) for name in ("user", "input", "output")}
    profile = roots["user"].parent
    require(roots == {name: profile / name for name in roots} and profile.parent.name == "profiles", "runtime-profile-roots-differ")
    workspace = profile.parent.parent
    marker = document(profile / ".studio-data-profile.json")
    workspace_marker = document(workspace / ".studio-migration-workspace.json")
    require(workspace_marker.get("owner") == "daelab-creative-studio-offline-migration" and workspace_marker.get("path") == str(workspace), "unknown-workspace-owner")
    marker_sha = hashlib.sha256(json.dumps(marker, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    require(marker_sha == profile_sha and marker.get("schemaVersion") == 1 and marker.get("role") in {"old", "new"} and
            marker.get("owner") == workspace_marker["owner"] and marker.get("workspaceId") == workspace_marker.get("workspaceId") and
            marker.get("path") == str(profile) and marker.get("profileId") == profile.name and
            marker.get("roots") == {name: str(path) for name, path in roots.items()}, "profile-ownership-mismatch")
    # Migration canonical JSON retains Unicode; source bundle canonical JSON is ASCII.
    require(document(profile / "READY.json").get("profileSha256") == profile_sha, "profile-not-ready")
    spec = marker["package"]["spec"]
    require(spec.get("installationRoot") == str(base) and spec.get("observer", {}).get("root") == str(Path(__file__).parent), "profile-package-binding-mismatch")
    if old:
        require(spec.get("kind") == "legacy" and spec.get("commits") == PINS and spec.get("roots") ==
                {name: str(base / "custom_nodes" / package) for name, package in PACKAGES.items()}, "legacy-package-binding-mismatch")
    else:
        require(spec.get("kind") == "studio" and spec.get("root") == str(base / "custom_nodes/ComfyUI-DAELab-Creative-Studio"), "studio-package-binding-mismatch")
    previous, active = None, None
    for number, path in enumerate(sorted((workspace / "activation").glob("*.json")), 1):
        require(path.name == f"{number:06}.json", "activation-journal-incomplete")
        record = document(path)
        require(record.get("sequence") == number and record.get("previousSha256") == previous and
                record.get("workspaceId") == marker["workspaceId"] and record.get("owner") == marker["owner"] and
                record.get("schemaVersion") == 1, "activation-journal-mismatch")
        previous = hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        active = record
    require(active and active.get("profileId") == profile.name and active.get("profileSha256") == profile_sha, "profile-not-selected")
    return {"profileSha256": profile_sha, "profileRole": marker["role"], "activeSequence": active["sequence"], "roots": {name: str(path) for name, path in roots.items()}}


def audit_host(server):
    """Fixed native WS only receives feature flags, never prompt submission.

    All NEW websocket handshakes are still denied after fencing. Existing unknown
    long-lived handlers remain counted as in-flight requests until they return.
    """
    module = sys.modules.get("server")
    require(type(module) is types.ModuleType and type(server) is vars(module).get("PromptServer"), "unknown-host-server-type")
    root = ordinary(vars(module)["__file__"]).parent
    files = []
    for name, digest in HOST_SOURCES.items():
        raw = source_bytes(root / name)
        require(hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest() == digest, "host-source-pin-mismatch")
        files.append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "gitBlobSha256": digest})
    init = vars(type(server)).get("__init__")
    require(type(init) is types.FunctionType and init.__globals__ is vars(module), "host-constructor-replaced")
    code = compile(source_bytes(root / "server.py"), init.__code__.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
    expected = {item.co_qualname: item for item in code_objects(code)}
    require(init.__code__ == expected.get("PromptServer.__init__"), "host-loaded-code-mismatch")
    execution = sys.modules.get("execution")
    require(type(execution) is types.ModuleType and ordinary(vars(execution)["__file__"]) == root / "execution.py" and
            type(server.prompt_queue) is vars(execution).get("PromptQueue"), "native-queue-runtime-unproven")
    queue_method = vars(type(server.prompt_queue)).get("get_current_queue_volatile")
    require(type(queue_method) is types.FunctionType and queue_method.__globals__ is vars(execution), "native-queue-reader-replaced")
    require("get_current_queue_volatile" not in vars(server.prompt_queue), "native-queue-instance-reader-replaced")
    execution_code = compile(source_bytes(root / "execution.py"), queue_method.__code__.co_filename, "exec", dont_inherit=True, optimize=sys.flags.optimize)
    require(any(item.co_qualname == "PromptQueue.get_current_queue_volatile" and item == queue_method.__code__ for item in code_objects(execution_code)), "native-queue-reader-code-mismatch")
    names = {"/queue": "get_queue", "/system_stats": "system_stats", "/ws": "websocket_handler", "/api/ws": "websocket_handler"}
    handlers = {path: expected["PromptServer.__init__.<locals>." + name] for path, name in names.items()}
    return {"hostCommit": HOST_COMMIT, "sourceRoot": str(root), "files": files, "sourceHashBasis": "actual file bytes plus pinned git LF blob; CRLF-only conversion accepted"}, handlers, module


class IngressFence:
    """One-way admission closure. No cancellation, model call, queue or task write."""
    def __init__(self, server, folder_paths, port):
        self.server, self.folder_paths, self.port = server, folder_paths, port
        self.audit, self.handlers, self.host_module = audit_host(server)
        self.pending = set()
        self.stack_requests = {}
        self.mutation_admissions = 0
        self.record = None
        self.initial_completed_polish = None
        self.studio_health = None
        self.rejected = 0
        self.probe_handler = self.fence_handler = self.middleware = None

    def classified(self, request):
        return self.classify(request.method, request.path, request.match_info.handler)

    def classify(self, method, path, actual):
        if (method == "GET" and path == ENDPOINT and actual is self.probe_handler or
                method == "POST" and path == ENDPOINT + "/fence" and actual is self.fence_handler):
            return "control"
        if method == "GET" and type(actual) is types.FunctionType and actual.__globals__ is vars(self.host_module) and actual.__code__ == self.handlers.get(path):
            return "existing-native-ws" if path in {"/ws", "/api/ws"} else "readonly"
        if self.studio_health is not None and method == "GET" and path == "/daelab/studio/health":
            try:
                if actual == self.studio_health == studio_health_handler(self.folder_paths, self.server):
                    return "readonly"
            except Exception:
                pass  # An unproven handler is denied after the fence, never invoked.
        return "mutation-or-unknown"

    def stack_passthrough(self, modules):
        if not self.stack_requests:
            return None
        require(self.server.app.middlewares and self.server.app.middlewares[0] is self.middleware, "ingress-middleware-changed")
        audit, handlers, module = audit_host(self.server)
        require(audit == self.audit and handlers == self.handlers and module is self.host_module, "ingress-coverage-changed")
        qwen = modules[("business", "nodes/prompt_optimization/local_qwen.py")]
        middleware = vars(qwen)["gpu_middleware"]  # loaded_sources verified the pinned CodeType and globals.
        require(sum(item is middleware for item in self.server.app.middlewares) == 1, "legacy-gpu-middleware-unbound")
        tree = ast.parse(source_bytes(ordinary(vars(qwen)["__file__"])))
        definition = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "gpu_middleware")
        statement = definition.body[0].body[0]
        expected = ast.parse("return await handler(req)").body[0]
        require(ast.dump(statement) == ast.dump(expected), "legacy-passthrough-shape-unproven")
        allowed = frozenset(task for task, (kind, method, path, actual) in tuple(self.stack_requests.items())
                            if kind in {"control", "readonly", "existing-native-ws"} and self.classify(method, path, actual) == kind)
        return middleware.__code__, statement.lineno, allowed

    async def guard(self, request, handler):
        from aiohttp import web
        kind = self.classified(request)
        if self.record is not None and kind not in {"control", "readonly"}:
            self.rejected += 1
            return web.json_response({"error": "legacy migration ingress is fenced until process restart"}, status=409, headers={"Cache-Control": "no-store"})
        token = None
        if kind == "mutation-or-unknown":
            token = object()
            self.pending.add(token)
            self.mutation_admissions += 1
        task, context, previous = asyncio.current_task(), None, None
        if kind in {"control", "readonly", "existing-native-ws"} and task is not None:
            # No request object/body/headers are retained. Finally removes the
            # per-request entry, including cancellation and long-lived WS exit.
            context = (kind, request.method, request.path, request.match_info.handler)
            previous = self.stack_requests.get(task)
            self.stack_requests[task] = context
        try:
            return await handler(request)
        finally:
            if token is not None:
                self.pending.discard(token)
            if context is not None and self.stack_requests.get(task) is context:
                if previous is None:
                    self.stack_requests.pop(task, None)
                else:
                    self.stack_requests[task] = previous

    def activate(self, nonce, profile_sha):
        require(re.fullmatch(r"[0-9a-f]{32}", nonce), "invalid-fence-nonce")
        binding = profile_binding(self.folder_paths, profile_sha, self.port)
        require(self.server.app.middlewares and self.server.app.middlewares[0] is self.middleware, "ingress-middleware-not-outermost")
        audit, handlers, module = audit_host(self.server)
        require(audit == self.audit and module is self.host_module and handlers == self.handlers, "ingress-coverage-changed")
        base = ordinary(self.folder_paths.base_path)
        old = binding["profileRole"] == "old"
        modules = loaded_sources(base)[1] if old else None
        if not old:
            observe_studio(base, runtime_profile(self.folder_paths), self.folder_paths, self.server)
            self.studio_health = studio_health_handler(self.folder_paths, self.server)
        import psutil
        pid, birth = os.getpid(), psutil.Process(os.getpid()).create_time()
        if self.record is not None:
            require(self.record["profileSha256"] == profile_sha and self.record["pid"] == pid and self.record["processCreated"] == birth, "fence-binding-changed")
            return  # Idempotent acknowledgment, never an unlock or a new epoch.
        if old:
            canvas = modules[("business", "nodes/prompt_optimization/canvas.py")]
            results = vars(canvas).get("_results")
            if type(results) is dict and all(type(value) is tuple and len(value) == 2 for value in results.values()):
                self.initial_completed_polish = sum(value[1] is not None for value in results.values())
        self.record = {"id": uuid.uuid4().hex, "active": True, "profileSha256": profile_sha, "activationNonce": nonce,
                       "activatedAt": time.time(), "coverageVersion": FENCE_COVERAGE_VERSION, "pid": pid, "processCreated": birth,
                       "profileRole": binding["profileRole"], "activeSequence": binding["activeSequence"], "admissionsAtFence": self.mutation_admissions}

    def enrich(self, result):
        if self.record is None:
            result["fence"] = {"active": False, "coverageVersion": FENCE_COVERAGE_VERSION}
            result["quiescence"] = "unknown"
            result["blockers"].append("ingress-not-fenced")
            return
        result["fence"] = {key: value for key, value in self.record.items() if key != "admissionsAtFence"}
        result["fence"].update(acceptedAfterFence=self.mutation_admissions - self.record["admissionsAtFence"],
                               rejectedAfterFence=self.rejected, activePreFenceRequests=len(self.pending), unreviewedEntrypoints=[])
        try:
            binding = profile_binding(self.folder_paths, self.record["profileSha256"], self.port)
            require(binding["activeSequence"] == self.record["activeSequence"], "active-profile-changed-after-fence")
            require(self.server.app.middlewares and self.server.app.middlewares[0] is self.middleware, "ingress-middleware-changed")
            audit, _, _ = audit_host(self.server)
            require(audit == self.audit, "ingress-source-changed")
            runtime = result["runtime"]
            require(runtime and runtime["pid"] == self.record["pid"] and runtime["processCreated"] == self.record["processCreated"], "fence-runtime-identity-changed")
            result["fence"]["hostCoverage"] = self.audit
            require(result["fence"]["acceptedAfterFence"] == 0, "post-fence-admission-detected")
            require(result["observations"] is not None, "fence-memory-coverage-unavailable")
            if self.record["profileRole"] == "old":
                require(self.initial_completed_polish is not None, "fence-memory-coverage-unavailable")
                polish = result["observations"]["polish"]
                require(polish["registered"] - polish["unresolved"] == self.initial_completed_polish, "post-fence-polish-result-needs-preservation")
            else:
                require(self.studio_health == studio_health_handler(self.folder_paths, self.server), "studio-health-handler-changed")
            if self.pending:
                result["quiescence"] = "busy" if result["quiescence"] == "clear" else result["quiescence"]
                result["blockers"].append("pre-fence-http-request-active")
        except Unobservable as error:
            result["quiescence"] = "unknown"
            result["blockers"].append(str(error))
            result["fence"]["unreviewedEntrypoints"].append(str(error))
        except Exception:
            result["quiescence"] = "unknown"
            result["blockers"].append("fence-coverage-unavailable")
            result["fence"]["unreviewedEntrypoints"].append("fence-coverage-unavailable")


def register(server, folder_paths, args):
    from aiohttp import web
    require(type(args.port) is int and 1024 <= args.port <= 65535 and args.port != 8000, "production-port-refused")
    require(args.listen in {"127.0.0.1", "::1", "localhost"}, "loopback-listen-required")
    manifest_identity()
    require(not getattr(server, "_studio_legacy_probe_registered", False), "probe-already-registered")
    fence = IngressFence(server, folder_paths, args.port)
    async def handle(request):
        try:
            nonce = local_get(request)
            require(request.transport.get_extra_info("sockname")[1] == args.port, "listener-port-changed")
        except Unobservable:
            return web.json_response({"error": "read-only isolated loopback observation required"}, status=403, headers={"Cache-Control": "no-store"})
        return web.json_response(collect(nonce, folder_paths, server, fence), headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
    async def activate(request):
        try:
            local_request(request, "POST")
            require(request.transport.get_extra_info("sockname")[1] == args.port, "listener-port-changed")
            require(not request.query and request.content_length is not None and 0 < request.content_length <= 4096, "invalid-fence-body")
            body = await request.json()
            require(type(body) is dict and set(body) == {"nonce", "profileSha256"}, "invalid-fence-schema")
            fence.activate(body["nonce"], body["profileSha256"])
            return web.json_response(collect(body["nonce"], folder_paths, server, fence), headers={"Cache-Control": "no-store"})
        except Exception:
            return web.json_response({"error": "explicit owned-profile fence refused; no tasks were cancelled"}, status=409, headers={"Cache-Control": "no-store"})
    fence.probe_handler, fence.fence_handler = handle, activate
    @web.middleware
    async def ingress(request, handler):
        return await fence.guard(request, handler)
    fence.middleware = ingress
    require(not server.app.middlewares.frozen, "ingress-installation-too-late")
    server.app.middlewares.insert(0, ingress)
    server.routes.get(ENDPOINT)(handle)
    server.routes.post(ENDPOINT + "/fence")(activate)
    server._studio_legacy_probe_registered = True
