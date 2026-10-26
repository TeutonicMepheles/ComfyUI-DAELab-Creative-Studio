"""Offline hooks only: synthetic files and random loopback servers, no real host/GPU."""
import asyncio
import os
import subprocess
from copy import deepcopy
import importlib.util
import inspect
import json
from pathlib import Path
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

from tools.evals import local_runtime_hooks as hooks
from tools.evals import run_local_evaluation as runner


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')


class Probe:
    def __init__(self, missing=False):
        self.missing = missing

    def sample(self):
        return {'atNs': 1, 'processRssBytes': {'123': 100}, 'gpuDeviceUsedBytes': None if self.missing else 200,
                'gpuProcessBytes': None, 'gpuProcessIds': None}


class OptionalRocmProbeTests(unittest.TestCase):
    """Exercise the optional caller's real exception handling without importing Triton."""
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.application, self.base, self.cwd, self.windows, self.bin = [self.root / name for name in ('application', 'base', 'cwd', 'windows', 'bin')]
        for directory in (self.application, self.base, self.cwd, self.windows / 'System32', self.windows / 'System', self.bin):
            directory.mkdir(parents=True)
        self.driver = self.root / 'driver.py'
        self.driver.write_text('def _get_rocm_sdk_root():\n'
            '    try:\n'
            '        return subprocess.check_output(["rocm-sdk", "path", "--root"], stderr=subprocess.DEVNULL)\n'
            '    except (subprocess.CalledProcessError, FileNotFoundError):\n'
            '        return None\n', encoding='utf-8')
        namespace = {'__name__': 'triton.backends.amd.driver', 'subprocess': subprocess}
        exec(compile(self.driver.read_text('utf-8'), str(self.driver), 'exec'), namespace)
        self.probe = namespace['_get_rocm_sdk_root']
        self.enterContext(patch.object(hooks, '_OPTIONAL_ROCM_DRIVER', self.driver, create=True))
        self.enterContext(patch.object(hooks, '_OPTIONAL_ROCM_DRIVER_SHA256', runner.file_hash(self.driver), create=True))
        self.enterContext(patch.object(sys, 'platform', 'win32'))
        self.enterContext(patch.object(sys, 'executable', str(self.application / 'python.exe')))
        self.enterContext(patch.object(sys, '_base_executable', str(self.base / 'python.exe'), create=True))
        self.enterContext(patch.object(sys, 'base_prefix', str(self.base)))
        self.enterContext(patch.object(Path, 'cwd', return_value=self.cwd))
        self.enterContext(patch.dict(os.environ, {'SystemRoot': str(self.windows), 'WINDIR': str(self.windows),
            'PATH': str(self.bin), 'PATHEXT': '.COM;.EXE;.BAT;.CMD'}, clear=True))
        self.audit = hooks.NetworkAudit(29501)
        self.audit.enabled = True
        self.event = (None, 'rocm-sdk path --root', None, None)

    def invoke(self, event=None):
        with patch.object(subprocess, 'check_output', side_effect=lambda *_a, **_k: self.audit.audit('subprocess.Popen', self.event if event is None else event)):
            return self.probe()

    def test_absence_reaches_upstream_fallback_without_external_attempt(self):
        self.assertIsNone(self.invoke())
        self.assertEqual(self.audit.report()['externalAttempts'], 0)
        self.assertEqual([row['operation'] for row in self.audit.events], ['optional-rocm-probe-absent'])
        self.assertFalse(any(row['operation'] == 'child-process' and row['allowed'] for row in self.audit.events))

    def test_present_candidate_in_each_windows_search_directory_stays_blocked(self):
        for directory in (self.application, self.base, self.cwd, self.windows / 'System32', self.windows / 'System', self.windows, self.bin):
            candidate = directory / 'rocm-sdk.exe'
            with self.subTest(directory=directory):
                candidate.write_bytes(b'not executable; it must never be launched')
                try:
                    with self.assertRaisesRegex(runner.Blocked, 'unreviewed-child-process-denied'):
                        self.invoke()
                finally:
                    candidate.unlink()

    def test_bare_file_custom_extension_and_quoted_path_stay_blocked(self):
        for name in ('rocm-sdk', 'rocm-sdk.cmd', 'rocm-sdk.xyz'):
            candidate = self.bin / name
            with self.subTest(name=name), patch.dict(os.environ, {'PATHEXT': '.EXE;.XYZ', 'PATH': '"' + str(self.bin) + '"'}):
                candidate.touch()
                try:
                    with self.assertRaises(runner.Blocked): self.invoke()
                finally:
                    candidate.unlink()

    def test_unreadable_candidate_cannot_be_declared_absent(self):
        original = Path.stat
        def uncertain(path, *args, **kwargs):
            if path.name.lower().startswith('rocm-sdk'):
                raise PermissionError('unreadable test candidate')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'stat', uncertain), self.assertRaises(runner.Blocked):
            self.invoke()

    def test_exact_audit_signature_required(self):
        for event in ((None, 'rocm-sdk path --root --other', None, None),
                      (None, ['rocm-sdk', 'path', '--root'], None, None),
                      ('rocm-sdk', 'rocm-sdk path --root', None, None),
                      (None, 'rocm-sdk path --root', str(self.cwd), None),
                      (None, 'rocm-sdk path --root', None, {}),
                      (None, 'cmd /c rocm-sdk path --root', None, None)):
            with self.subTest(event=event), self.assertRaises(runner.Blocked):
                self.invoke(event)

    def test_foreign_caller_or_changed_source_stays_blocked(self):
        with self.assertRaises(runner.Blocked):
            self.audit.audit('subprocess.Popen', self.event)
        self.driver.write_text(self.driver.read_text('utf-8') + '# drift\n', encoding='utf-8')
        with self.assertRaises(runner.Blocked): self.invoke()
        with patch.object(hooks, '_OPTIONAL_ROCM_DRIVER_SHA256', runner.file_hash(self.driver)):
            with patch.object(hooks, '_OPTIONAL_ROCM_DRIVER', self.root / 'another.py'), self.assertRaises(runner.Blocked):
                self.invoke()

    def test_missing_system_root_or_non_windows_stays_blocked(self):
        with patch.dict(os.environ, {'SystemRoot': '', 'WINDIR': ''}), self.assertRaises(runner.Blocked):
            self.invoke()
        with patch.object(sys, 'platform', 'linux'), self.assertRaises(runner.Blocked):
            self.invoke()

    @unittest.skipUnless(os.name == 'nt', 'Native Windows subprocess audit payload')
    def test_real_windows_subprocess_never_reaches_create_process(self):
        # The installed audit callback receives CPython's string argv, not the list.
        self.audit.enabled = False
        close = self.audit.install()
        try:
            with patch.object(subprocess._winapi, 'CreateProcess', side_effect=AssertionError('must not spawn')) as create:
                self.assertIsNone(self.probe())
                create.assert_not_called()
            self.assertEqual(self.audit.report()['externalAttempts'], 0)
        finally:
            close()


class HostAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()

    def test_identity_matches_fixed_native_nested_temp_and_rejects_foreign_roots(self):
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        instance.environment = self.root / 'baseline'
        instance.server = SimpleNamespace(prompt_queue=SimpleNamespace(get_current_queue=lambda: ([], [])))
        instance.installed, instance.ollama, instance.exclusive_window = set(), None, True
        directories = {key: instance.environment / key for key in ('user', 'input', 'output', 'temp')}
        directories['temp'] /= 'temp'  # The fixed host appends this to --temp-directory.
        folders = SimpleNamespace(**{'get_' + key + '_directory': lambda key=key: directories[key] for key in directories})
        argv = ['main.py', '--port', '29501', '--temp-directory', str(instance.environment / 'temp'), '--offline', '--cache-none']
        with patch.dict(sys.modules, {'folder_paths': folders}), patch.object(sys, 'argv', argv):
            identity = instance.live_identity()
            self.assertEqual(identity['root'], str(instance.environment))
            self.assertEqual(identity['actualRoots']['temp'], str(instance.environment / 'temp/temp'))
            for key in directories:
                original = directories[key]
                for foreign in (self.root / 'foreign' / key, instance.environment / 'temp' if key == 'temp' else self.root / 'another' / key):
                    with self.subTest(key=key, path=foreign):
                        directories[key] = foreign
                        self.assertIsNone(instance.live_identity()['root'])
                directories[key] = original

    def lazy_package(self):
        name = 'creative_eval_lazy_' + uuid.uuid4().hex
        package = self.root / name
        package.mkdir()
        (package / '__init__.py').write_text('', encoding='utf-8')
        (package / 'service.py').write_text('class Service:\n'
            '    def __init__(self): raise AssertionError("must not instantiate service")\n'
            '    def local_transport(self):\n'
            '        from .qwen import QwenTransport\n'
            '        return QwenTransport()\n', encoding='utf-8')
        api, qwen = package / 'api.py', package / 'qwen.py'
        api.write_text('from .service import Service\n_service = None\n'
            'async def handle(request): raise AssertionError("must not invoke API")\n', encoding='utf-8')
        qwen.write_text('class QwenTransport:\n'
            '    def __init__(self): raise AssertionError("must not instantiate transport")\n'
            '    async def create(self, snapshot, instructions, auth): raise AssertionError("must not generate")\n', encoding='utf-8')
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        instance.manifest = {'sourceContracts': {'old_optimization_api': hooks.source_contract(api, {'handle': ['request']}),
            'old_table': hooks.source_contract(qwen, {'QwenTransport.create': ['self', 'snapshot', 'instructions', 'auth']})}}
        instance.variant, instance.ollama = 'baseline', {'url': 'http://127.0.0.1:29502'}
        instance.modules, instance.restores, instance.metrics, instance.completion_tasks = {}, [], {}, []
        instance.installed = {'server', 'queue', 'h3', 'torch_files', 'gguf_files', 'old_native', 'old_qwen', 'old_polish', 'old_receipt'}
        self.addCleanup(lambda: [sys.modules.pop(key, None) for key in list(sys.modules) if key == name or key.startswith(name + '.')])
        self.enterContext(patch.object(sys, 'path', [str(self.root), *sys.path]))
        instance.install_loader()
        self.addCleanup(instance.close)
        return instance, name, qwen

    def test_only_baseline_with_owned_ollama_imports_table_transport(self):
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        for variant, ollama in (('baseline', None), ('studio', None), ('studio', {'url': 'http://127.0.0.1:29502'})):
            with self.subTest(variant=variant, ollama=ollama):
                instance.variant, instance.ollama = variant, ollama
                with patch.object(importlib, 'import_module', side_effect=AssertionError('must not import optional transport')):
                    instance.install_old_optimization_api(SimpleNamespace())

    def test_api_import_admits_actual_lazy_qwen_module_without_instantiation(self):
        instance, package, _ = self.lazy_package()
        self.assertFalse(instance.dispatch_ready())
        self.assertNotIn(package + '.qwen', sys.modules)
        api = importlib.import_module(package + '.api')
        self.assertIn(package + '.qwen', sys.modules)
        self.assertIs(instance.modules['old_table'], sys.modules[package + '.qwen'])
        self.assertTrue(hasattr(instance.modules['old_table'].QwenTransport.create, '__wrapped__'))
        self.assertIsNone(api._service)
        self.assertTrue(instance.dispatch_ready())
        instance.installed.remove('old_table')
        self.assertFalse(instance.dispatch_ready())  # The required boundary is never dropped.

    def test_changed_lazy_qwen_source_blocks_before_import(self):
        instance, package, qwen = self.lazy_package()
        qwen.write_text(qwen.read_text('utf-8') + 'raise AssertionError("changed source must not execute")\n', encoding='utf-8')
        with self.assertRaisesRegex(runner.Blocked, 'hook-source-changed-before-import'):
            importlib.import_module(package + '.api')
        self.assertNotIn('old_table', instance.installed)
        self.assertFalse(instance.dispatch_ready())

    def test_cached_foreign_qwen_cannot_satisfy_required_hook(self):
        instance, package, _ = self.lazy_package()
        sys.modules[package + '.qwen'] = SimpleNamespace(__file__=str(self.root / 'foreign-qwen.py'))
        with self.assertRaisesRegex(runner.Blocked, 'old-table-hook-missing'):
            importlib.import_module(package + '.api')
        self.assertFalse(instance.dispatch_ready())


class HookContractTests(unittest.TestCase):
    def test_import_and_unapproved_launch_do_not_start_anything(self):
        with patch.object(hooks, 'RuntimeHooks', side_effect=AssertionError('must not initialize resources')), patch.object(hooks.runpy, 'run_path', side_effect=AssertionError('must not start')):
            with self.assertRaisesRegex(runner.Blocked, 'explicit-reviewed-launch'):
                hooks.launch('not-read', 'not-read')

    def test_hash_and_signature_contract_rejects_changed_parameter_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'module.py'
            file.write_text('def boundary(owner, payload):\n    return payload\n')
            contract = hooks.source_contract(file, {'boundary': ['owner', 'payload']})
            module = SimpleNamespace(boundary=lambda owner, payload: payload)
            self.assertEqual(hooks.checked_method(module, 'boundary', contract['symbols']['boundary'])[1], 'boundary')
            file.write_text('def boundary(payload, owner):\n    return payload\n')
            with self.assertRaisesRegex(runner.Blocked, 'signature-changed'):
                hooks.source_contract(file, {'boundary': ['owner', 'payload']})
            module.boundary = lambda owner, other: other
            with self.assertRaisesRegex(runner.Blocked, 'loaded-hook-signature'):
                hooks.checked_method(module, 'boundary', contract['symbols']['boundary'])

    def test_sourcefileloader_covers_spec_import_and_restores(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'dynamic.py'
            file.write_text('def boundary(owner, payload):\n    return payload\n')
            contract = hooks.source_contract(file, {'boundary': ['owner', 'payload']})
            instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
            instance.manifest = {'sourceContracts': {'test': contract}}
            instance.restores, instance.modules, instance.installed, instance.metrics, instance.completion_tasks = [], {}, set(), {}, []
            instance.install_test = lambda module: None
            instance.install_loader()
            try:
                spec = importlib.util.spec_from_file_location('test_dynamic_eval_source', file)
                spec.loader.exec_module(importlib.util.module_from_spec(spec))
                self.assertEqual(instance.installed, {'test'})
                file.write_text('raise AssertionError("changed source must not execute")')
                with self.assertRaisesRegex(runner.Blocked, 'source-changed-before-import'):
                    spec.loader.exec_module(importlib.util.module_from_spec(spec))
            finally:
                instance.close()

    def test_network_policy_allows_only_production_queue_read_and_owned_model_routes(self):
        audit = hooks.NetworkAudit(29501, 29502)
        audit.permit_http('GET', 'http://127.0.0.1:8000/queue')
        audit.permit_http('POST', 'http://127.0.0.1:29502/api/generate')
        for method, url in [('POST', 'http://127.0.0.1:8000/prompt'), ('POST', 'http://127.0.0.1:8000/interrupt'),
                            ('GET', 'http://127.0.0.1:8000/queue?x=1'), ('POST', 'http://127.0.0.1:29502/api/pull'),
                            ('GET', 'https://example.invalid/'), ('GET', 'http://127.0.0.1:11434/api/ps')]:
            with self.subTest(url=url), self.assertRaises(runner.Blocked):
                audit.permit_http(method, url)
        self.assertIsNone(audit.report()['nativeLibraryNetworkInspection'])
        self.assertFalse(audit.report()['firewallRulesChanged'])

    def test_binary_preview_forwarding_is_unchanged_and_never_claimed_as_sampler(self):
        seen, forwarded = [], []
        class PromptServer:
            def __init__(self, loop, asset_manager): pass
            def add_routes(self): pass
            def send_sync(self, event, data, sid=None):
                forwarded.append((event, data, sid))
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        instance.manifest = {'sourceContracts': {'server': {'symbols': {name: {'parameters': parameters, 'async': False} for name, parameters in hooks.TARGETS['server'][2].items()}}}}
        instance.restores, instance.native_owners, instance.metrics = [], {}, {}
        instance.gate = SimpleNamespace(native_event=lambda event, data: seen.append((event, data)))
        instance.install_server(SimpleNamespace(PromptServer=PromptServer))
        server = PromptServer.__new__(PromptServer)
        opaque = object()
        server.send_sync(2, ('PNG', opaque), 'client')
        server.send_sync('execution_start', {'prompt_id': 'id'})
        self.assertIs(forwarded[0][1][1], opaque)
        self.assertEqual(seen, [('execution_start', {'prompt_id': 'id'})])

    def test_socket_guard_real_random_loopback_and_external_denied_before_connect(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            audit = hooks.NetworkAudit(listener.getsockname()[1])
            close = audit.install()
            try:
                with socket.socket() as client:
                    client.connect(listener.getsockname())
                    accepted, _ = listener.accept(); accepted.close()
                with socket.socket() as client, self.assertRaisesRegex(runner.Blocked, 'outbound-network-denied'):
                    client.connect(('192.0.2.1', 443))
                with self.assertRaisesRegex(runner.Blocked, 'external-dns-denied'):
                    socket.getaddrinfo('example.invalid', 443)
                with self.assertRaisesRegex(runner.Blocked, 'child-process-denied'):
                    sys.audit('subprocess.Popen', 'not-executed', [], None, None)
            finally:
                close()

    def test_archive_and_weight_writes_refused_without_blocking_new_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); archive = root / 'code'; archive.mkdir()
            original = archive / 'source.py'; original.write_text('original')
            audit = hooks.NetworkAudit(29501, read_only_roots=[archive])
            close = audit.install()
            try:
                with self.assertRaisesRegex(runner.Blocked, 'immutable-source'):
                    original.write_text('changed')
                (root / 'evidence.json').write_text('{}')
                self.assertEqual(original.read_text(), 'original')
            finally:
                close()

    def test_exclusive_pair_lock_preserves_foreign_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            with hooks.ExclusiveWindow(tmp):
                with self.assertRaisesRegex(runner.Blocked, 'already-owned'):
                    with hooks.ExclusiveWindow(tmp):
                        self.fail('second owner entered')
            self.assertFalse((Path(tmp) / 'evaluation-window.lock').exists())
            write(Path(tmp) / 'evaluation-window.lock', {'owner': 'foreign'})
            with self.assertRaises(runner.Blocked):
                with hooks.ExclusiveWindow(tmp):
                    pass
            self.assertEqual(runner.read(Path(tmp) / 'evaluation-window.lock'), {'owner': 'foreign'})

    def test_missing_gpu_metrics_remain_null_and_segments_sum(self):
        for missing in (True, False):
            tick = iter(range(0, 100_000_000, 1_000_000))
            metric = hooks.SegmentedMetrics(Probe(missing), {'state': None, 'evidence': None}, interval=60, clock=lambda: next(tick))
            metric.phase_change('sample'); metric.phase_change('decode')
            result = metric.finish()
            self.assertEqual(sum(result['segmentsMs'].values()), result['durationMs'])
            self.assertIsNone(result['coldWarmState'])
            self.assertEqual(result['peakMemoryBytes'], None if missing else 300)
            self.assertEqual(result['peakProcessRssBytes'], 100)

    def test_owned_ollama_requires_exact_pid_exe_environment_and_listener(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, {'psutil': None}):
            exe = Path(tmp) / 'fake-ollama.exe'; exe.write_bytes(b'not executable')
            config = {'url': 'http://127.0.0.1:29502', 'pid': 234, 'exe': str(exe), 'exeSha256': runner.file_hash(exe), 'createTime': 123.0, 'modelsRoot': tmp}
            env = {'OLLAMA_HOST': '127.0.0.1:29502', 'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NUM_PARALLEL': '1', 'OLLAMA_MAX_LOADED_MODELS': '1', 'OLLAMA_KEEP_ALIVE': '0', 'OLLAMA_MODELS': tmp}
            process = SimpleNamespace(pid=234, exe=lambda: str(exe), create_time=lambda: 123.0, environ=lambda: env)
            connections = lambda: [SimpleNamespace(pid=234, status='LISTEN', laddr=('127.0.0.1', 29502))]
            self.assertEqual(hooks.validate_owned_ollama(config, process_factory=lambda _: process, connections=connections), 234)
            env['OLLAMA_NO_CLOUD'] = '0'
            with self.assertRaisesRegex(runner.Blocked, 'environment-differs'):
                hooks.validate_owned_ollama(config, process_factory=lambda _: process, connections=connections)
            config['url'] = 'http://127.0.0.1:11434'
            with self.assertRaisesRegex(runner.Blocked, 'independent-ollama'):
                hooks.validate_owned_ollama(config, process_factory=lambda _: process, connections=connections)

    def test_owned_ollama_loads_only_missing_inspectors_and_still_checks_ownership(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / 'fake-ollama.exe'; exe.write_bytes(b'not executable')
            config = {'url': 'http://127.0.0.1:29502', 'pid': 234, 'exe': str(exe), 'exeSha256': runner.file_hash(exe), 'createTime': 123.0, 'modelsRoot': tmp}
            env = {'OLLAMA_HOST': '127.0.0.1:29502', 'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NUM_PARALLEL': '1', 'OLLAMA_MAX_LOADED_MODELS': '1', 'OLLAMA_KEEP_ALIVE': '0', 'OLLAMA_MODELS': tmp}
            process = SimpleNamespace(pid=234, exe=lambda: str(exe), create_time=lambda: 123.0, environ=lambda: env)
            listeners = [SimpleNamespace(pid=234, status='LISTEN', laddr=('127.0.0.1', 29502))]
            calls = []
            def inspect_process(pid):
                calls.append(('process', pid))
                return process
            def inspect_connections(*, kind):
                calls.append(('connections', kind))
                return listeners
            fake = SimpleNamespace(Process=inspect_process, net_connections=inspect_connections)
            for supplied, expected_calls in [
                ({'process_factory': lambda _: process}, [('connections', 'tcp')]),
                ({'connections': lambda: listeners}, [('process', 234)]),
                ({}, [('process', 234), ('connections', 'tcp')]),
            ]:
                with self.subTest(supplied=tuple(supplied)), patch.dict(sys.modules, {'psutil': fake}):
                    calls.clear()
                    self.assertEqual(hooks.validate_owned_ollama(config, **supplied), 234)
                    self.assertEqual(calls, expected_calls)
                with self.subTest(missing_dependency=tuple(supplied)), patch.dict(sys.modules, {'psutil': None}):
                    with self.assertRaises(ModuleNotFoundError):
                        hooks.validate_owned_ollama(config, **supplied)
            with patch.dict(sys.modules, {'psutil': fake}):
                config['createTime'] = 124.0
                with self.assertRaisesRegex(runner.Blocked, 'process-ownership-changed'):
                    hooks.validate_owned_ollama(config)
                config['createTime'] = 123.0
                config['exeSha256'] = '0' * 64
                with self.assertRaisesRegex(runner.Blocked, 'process-ownership-changed'):
                    hooks.validate_owned_ollama(config)
                config['exeSha256'] = runner.file_hash(exe)
                listeners[0].pid = 235
                with self.assertRaisesRegex(runner.Blocked, 'listener-unproven'):
                    hooks.validate_owned_ollama(config)

    def test_h3_proxy_checks_real_order_before_encode_and_preserves_classmethod(self):
        calls = []
        class MiniMaxH3ImageToVideo:
            @classmethod
            def execute(cls, clip, vae, prompt, width, height, length, first_frame=None, last_frame=None):
                clip.tokenize(prompt, images=[first_frame, last_frame])
                return [vae.encode(first_frame), vae.encode(last_frame)]
        module = SimpleNamespace(MiniMaxH3ImageToVideo=MiniMaxH3ImageToVideo)
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        symbol = 'MiniMaxH3ImageToVideo.execute'
        instance.manifest = {'sourceContracts': {'h3': {'symbols': {symbol: {'parameters': hooks.TARGETS['h3'][2][symbol], 'async': False}}}}}
        instance.restores = []
        instance.owner = lambda rid: rid
        instance.tensor_hash = lambda value: str(value)
        instance.gate = SimpleNamespace(active='owned', h3_tensor_boundary=lambda rid, boundary, hashes: calls.append((boundary, list(hashes))))
        instance.install_h3(module)
        clip = SimpleNamespace(tokenize=lambda *a, **k: None)
        vae = SimpleNamespace(encode=lambda value: value)
        self.assertEqual(MiniMaxH3ImageToVideo.execute(clip, vae, 'prompt', 2, 2, 3, 'first', 'last'), ['first', 'last'])
        self.assertEqual(calls, [('tokenize', ['first', 'last']), ('vae', ['first', 'last'])])
        self.assertIsInstance(inspect.getattr_static(MiniMaxH3ImageToVideo, 'execute'), classmethod)

    def test_native_capture_projects_actual_seed_resolver_and_reference_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'input').mkdir()
            frame = root / 'input/first.png'; frame.write_bytes(b'synthetic immutable frame')
            digest = runner.file_hash(frame)
            instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
            names = {'diffusion_models': 'model.bin', 'text_encoders': 'encoder.bin', 'video_vae': 'video.bin', 'audio_vae': 'audio.bin'}
            bindings, weights = {}, []
            for role, name in names.items():
                path = root / name; path.write_bytes(name.encode())
                bindings[role] = {'name': name, 'path': str(path), 'sha256': runner.file_hash(path)}
                weights.append({'path': name, 'bytes': path.stat().st_size, 'sha256': runner.file_hash(path)})
            instance.environment, instance.bindings = root, {'video': bindings}
            instance.runtime = {'weights': weights}; instance.actual_weights = {}
            instance.slots = {'id': {'sampleId': 'LOCAL-H3-002'}}
            instance.cases = {'id': {'payload': {'config': {'model': 'MiniMax H3 FL（本地）', 'settings': {'duration': 1.5}}}, 'expected': {'poison': 'never read'}}}
            instance._fixture_label = lambda raw: ('first.png', digest) if raw == frame.read_bytes() else self.fail('wrong frame')
            graph = {
                'model': {'inputs': {'unet_name': names['diffusion_models']}}, 'clip': {'inputs': {'clip_name': names['text_encoders']}},
                'video_vae': {'inputs': {'vae_name': names['video_vae']}}, 'audio_vae': {'inputs': {'vae_name': names['audio_vae']}},
                'condition': {'inputs': {'prompt': 'actual wire prompt', 'width': 512, 'height': 288, 'length': 39, 'first_frame': ['first', 0]}},
                'first': {'class_type': 'LoadImage', 'inputs': {'image': 'first.png'}},
                'noise': {'inputs': {'noise_seed': 456}}, 'schedule': {'inputs': {'steps': 4, 'scheduler': 'simple'}},
                'sampler': {'inputs': {'sampler_name': 'euler'}}, 'video': {'inputs': {'fps': 24}},
            }
            folders = SimpleNamespace(get_full_path=lambda role, name: str(root / name))
            with patch.dict(sys.modules, {'folder_paths': folders}):
                capture = instance.native_capture('id', graph)
                self.assertEqual(capture['effective']['seed'], 456)
                self.assertEqual(capture['effective']['expandedText'], 'actual wire prompt')
                self.assertEqual(capture['effective']['sourceImageSha256'], [digest])
                self.assertNotIn('poison', capture)
                graph['noise']['inputs']['noise_seed'] = 789
                self.assertEqual(instance.native_capture('id', graph)['effective']['seed'], 789)
                folders.get_full_path = lambda role, name: str(root / 'wrong.bin')
                with self.assertRaisesRegex(runner.Blocked, 'actual-model-resolver'):
                    instance.native_capture('id', graph)

    def test_registry_requires_all_six_actual_manifest_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            members = [{'role': role, 'sha256': str(i) * 64, 'bytes': i + 1} for i, role in enumerate(('config', 'model', 'projector', 'template', 'license', 'params'))]
            manifest = {'schemaVersion': 2, 'config': {'digest': 'sha256:' + members[0]['sha256'], 'size': 1}, 'layers': [
                {'mediaType': 'application/vnd.ollama.image.' + item['role'], 'digest': 'sha256:' + item['sha256'], 'size': item['bytes']} for item in members[1:]]}
            original = root / 'registry.json'; installed = root / 'manifests/registry.ollama.ai/library/qwen3.5/9b-q4_K_M'
            write(original, manifest); write(installed, manifest)
            runtime = {'ollama': {'manifest': str(original), 'blobsVerifiedByRehash': members}}
            ownership = {'modelsRoot': str(root), 'manifestSha256': runner.file_hash(original)}
            self.assertTrue(hooks.verify_ollama_registry(runtime, ownership))
            manifest['layers'][0]['size'] += 1
            write(original, manifest); write(installed, manifest)
            ownership['manifestSha256'] = runner.file_hash(original)
            with self.assertRaisesRegex(runner.Blocked, 'manifest-blob-changed'):
                hooks.verify_ollama_registry(runtime, ownership)


class LaunchArchiveTests(unittest.TestCase):
    def test_launch_uses_same_native_main_and_restores_process_configuration(self):
        # Executes only a two-line temporary sentinel, never ComfyUI or RuntimeHooks.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); host = root / 'host'; host.mkdir(); environment = root / 'environment'; environment.mkdir()
            main = host / 'main.py'; main.write_text('import sys\nOBSERVED_NATIVE_ARGV = list(sys.argv)\n')
            config = {'host': str(host), 'python': sys.executable, 'destination': str(root)}
            manifest = {'environment': {'root': str(environment), 'command': [sys.executable, '-B', '-s', str(main), '--port', '29501', '--cache-none']}, 'noCloudScope': 'synthetic'}
            manifest_file = root / 'manifest.json'; write(manifest_file, manifest)
            trace = environment / 'evidence'; before_argv, before_path, before_cwd = sys.argv[:], sys.path[:], Path.cwd()
            class FakeHooks:
                def __init__(self, *args, trace_root):
                    trace_root.mkdir(); self.restores = []; self.audit = SimpleNamespace(install=lambda: lambda: None)
                def install_loader(self): pass
                def install_http(self): pass
                def close(self): pass
            with patch.object(hooks, 'verify_launch', return_value=(manifest, config, trace)), patch.object(hooks, 'RuntimeHooks', FakeHooks), patch.object(sys, 'dont_write_bytecode', True):
                result = hooks.launch(manifest_file, 'unused', execute_reviewed=True)
            self.assertEqual(result['OBSERVED_NATIVE_ARGV'], manifest['environment']['command'][3:])
            self.assertEqual((sys.argv, sys.path, Path.cwd()), (before_argv, before_path, before_cwd))
            self.assertFalse((host / '__pycache__').exists())

    def test_manifest_verify_exact_archive_and_never_start_or_overwrite(self):
        spec = importlib.util.spec_from_file_location('runtime_gpu_preparation_fixture', runner.ROOT / 'tests/host/test_gpu_evaluation_preparation.py')
        helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(helpers)
        fixture = helpers.GPUPreparationTests(); fixture.setUp()
        self.addCleanup(fixture.tearDown)
        gpu = helpers.gpu
        (fixture.studio / '.gitattributes').write_text('* text=auto eol=lf\n')
        for relative in gpu.INSTRUMENTATION_FILES:
            file = fixture.studio / relative; file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes((runner.ROOT / relative).read_bytes())
        helpers.git(fixture.studio, 'add', '.')
        helpers.git(fixture.studio, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixed instrumentation')
        commit = helpers.git(fixture.studio, 'rev-parse', 'HEAD')
        config = fixture.plan(studio_commit=commit, instrumentation=True); gpu.prepare(config)
        prepared = fixture.destination / 'prepared.json'
        instrument = fixture.destination / 'instrumentation'
        run_root = fixture.root / 'run'; run_root.mkdir()
        approval = {'schemaVersion': 1, 'reviewer': 'synthetic reviewer', 'executionApproved': True,
                    'studioCommit': commit, 'hostCommit': config['hostCommit'], 'preparedSha256': runner.file_hash(prepared)}
        write(run_root / 'approval.json', approval)
        write(run_root / 'cases.json', {})
        write(run_root / 'run.json', {'inputs': {name: {'path': str(run_root / (name + '.json')), 'sha256': runner.file_hash(run_root / (name + '.json'))} for name in ('approval', 'cases')}})
        fixture_root = fixture.root / 'fixtures'; fixture_root.mkdir(); write(fixture_root / 'manifest.json', {'media': []})
        destination = fixture.destination / 'studio-launch.json'
        # A synthetic fixed host has only main.py and no executing model code.
        with patch.object(runner, 'PINNED_SOURCES', fixture.pinned), patch.object(hooks, 'TARGETS', {'host_entry': ('host', 'main.py', {})}):
            result = hooks.build_launch_manifest(prepared, run_root, 'studio', fixture_root, destination)
            self.assertFalse(result['activationAllowed'])
            self.assertEqual(runner.read(result['localConfiguration']['path'])['modelBindings'], config['bindings'])
            authorization = fixture.destination / 'launch-approval.json'
            write(authorization, {'schemaVersion': 1, 'reviewer': 'synthetic reviewer', 'launchApproved': True,
                'exclusiveWindowReviewed': True, 'manifestSha256': runner.file_hash(destination),
                'traceRoot': str(Path(result['environment']['root']) / 'evidence/new-trace')})
            with patch.object(hooks, '__file__', str(instrument / 'tools/evals/local_runtime_hooks.py')):
                verified, _, trace_root = hooks.verify_launch(destination, authorization, execute_reviewed=True)
                self.assertEqual(verified['variant'], 'studio'); self.assertFalse(trace_root.exists())
                (instrument / 'tools/evals/request_contract.py').write_text('# changed after review')
                with self.assertRaisesRegex(runner.Blocked, 'instrumentation-source-changed'):
                    hooks.verify_launch(destination, authorization, execute_reviewed=True)
            before = destination.read_bytes()
            with self.assertRaises(runner.Blocked):
                hooks.build_launch_manifest(prepared, run_root, 'studio', fixture_root, destination)
            self.assertEqual(before, destination.read_bytes())


class RuntimeCompletionTests(unittest.IsolatedAsyncioTestCase):
    def instance(self):
        instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
        self.finished = []
        instance.gate = SimpleNamespace(records={'id': {'report': {}}}, finish=lambda request_id, **kwargs: self.finished.append((request_id, kwargs)))
        instance.metrics = {'id': hooks.SegmentedMetrics(Probe(), {'state': 'cold', 'evidence': {'fixture': True}}, interval=60)}
        return instance

    async def test_native_success_waits_for_original_service_receipt(self):
        instance = self.instance()
        values = iter([({'state': 'fetching'}, False), ({'state': 'succeeded', 'receipt': {'kind': 'assets'}}, True)])
        instance.service_receipt = lambda rid: next(values)
        task = asyncio.create_task(instance.complete_after_receipt('id', {'state': 'complete', 'outputs': []}, timeout=1))
        await asyncio.sleep(.01)
        self.assertEqual(self.finished, [])
        await task
        self.assertEqual(self.finished[0][1]['state'], 'complete')
        self.assertTrue(instance.gate.records['id']['report']['serviceReceipt']['readOnly'])

    async def test_failed_business_receipt_never_passes_successful_sampler(self):
        instance = self.instance()
        instance.service_receipt = lambda rid: ({'state': 'failed'}, False)
        await instance.complete_after_receipt('id', {'state': 'complete', 'outputs': []}, timeout=.1)
        self.assertEqual(self.finished[0][1]['state'], 'failed')
        self.assertFalse(instance.gate.records['id']['report']['serviceReceipt']['complete'])

    async def test_missing_business_receipt_stays_unknown(self):
        instance = self.instance()
        instance.service_receipt = lambda rid: ({}, False)
        await instance.complete_after_receipt('id', {'state': 'complete'}, timeout=0)
        self.assertEqual(self.finished[0][1]['state'], 'unknown')

    async def test_old_polish_complete_response_needs_no_nonexistent_query_api(self):
        instance = self.instance()
        instance.variant, instance.cases = 'baseline', {'id': {'driver': 'polish'}}
        instance.gate.active = 'id'
        instance.gate.observe = lambda rid: {'state': 'dispatching'}
        instance.responses = {'id': {'done': True, 'done_reason': 'stop', 'response': 'original text'}}
        instance.service_receipt = lambda rid: self.fail('standalone old polish has no query API')
        instance.finish_qwen('id', True, {'result': 'original business text'})
        self.assertEqual(self.finished[0][1]['state'], 'complete')
        self.assertEqual(instance.gate.records['id']['report']['serviceReceipt']['source'], 'original-business-polish-return')

    async def test_fake_ollama_actual_response_persisted_and_unload_owned_only(self):
        from aiohttp import web, ClientSession
        calls = []
        async def api(request):
            body = await request.json() if request.method == 'POST' else None
            calls.append((request.path, body))
            if request.path == '/api/tags': return web.json_response({'models': [{'name': hooks.QWEN, 'digest': 'a' * 64}]})
            if request.path == '/api/ps': return web.json_response({'models': []})
            return web.json_response({'model': hooks.QWEN, 'response': 'actual synthetic reply', 'done': True, 'done_reason': 'stop', 'eval_count': 2, 'eval_duration': 100})
        app = web.Application(); app.router.add_route('*', '/api/{action}', api)
        server = web.AppRunner(app); await server.setup()
        sock = socket.socket(); sock.bind(('127.0.0.1', 0)); sock.listen(); sock.setblocking(False)
        site = web.SockSite(server, sock); await site.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                instance = hooks.RuntimeHooks.__new__(hooks.RuntimeHooks)
                instance.manifest = {'httpClientContract': hooks.http_client_contract()}
                instance.ollama = {'url': 'http://127.0.0.1:' + str(sock.getsockname()[1]), 'manifestSha256': 'a' * 64}
                instance.audit = hooks.NetworkAudit(29501, sock.getsockname()[1])
                instance.restores, instance.responses, instance.unload_owner = [], {}, None
                (Path(tmp) / 'id').mkdir()
                instance.gate = SimpleNamespace(root=Path(tmp))
                instance.metrics = {'id': SimpleNamespace(phase_change=lambda phase: None)}
                instance.owner = lambda rid: rid if rid == 'id' else self.fail('foreign owner')
                captures = []
                instance.qwen_capture = lambda rid, body: captures.append(deepcopy(body)) or {'actual': body}
                instance.begin = lambda *args: None
                with patch.object(hooks, 'validate_owned_ollama', return_value=234):
                    instance.install_http()
                    token = hooks.CONTEXT.set('id')
                    try:
                        async with ClientSession() as session:
                            payload = {'model': hooks.QWEN, 'prompt': 'actual payload differs from expected', 'keep_alive': 0}
                            response = await session.post(instance.ollama['url'] + '/api/generate', json=payload)
                            self.assertEqual((await response.json())['response'], 'actual synthetic reply')
                            self.assertEqual(captures, [payload])
                            await session.post(instance.ollama['url'] + '/api/generate', json={'model': hooks.QWEN, 'keep_alive': 0})
                            with self.assertRaisesRegex(runner.Blocked, 'foreign-or-unknown'):
                                await session.post(instance.ollama['url'] + '/api/generate', json={'model': 'foreign', 'keep_alive': 0})
                        saved = runner.read(Path(tmp) / 'id/original-ollama-response.json')
                        self.assertEqual(saved['response'], 'actual synthetic reply')
                        self.assertEqual(sum(path == '/api/generate' and 'prompt' in body for path, body in calls if body), 1)
                    finally:
                        hooks.CONTEXT.reset(token)
                        for restore in reversed(instance.restores): restore()
        finally:
            await server.cleanup()


if __name__ == '__main__':
    unittest.main()
