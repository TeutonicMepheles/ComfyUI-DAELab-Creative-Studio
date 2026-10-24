"""Optional reviewed local Eval launcher. Importing this module never starts IO.

Only ``launch`` with a matching reviewed manifest can run the isolated host. The
code archive is not edited; hooks are scoped to that new process and verify exact
source bytes and signatures before replacing methods. No model or Ollama starts.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import base64
from contextvars import ContextVar
from copy import deepcopy
import functools
import hashlib
import importlib.machinery
import importlib.util
import inspect
import json
import os
from pathlib import Path
import runpy
import socket
import sys
import threading
import time
from urllib.parse import urlsplit

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.evals.run_local_evaluation import (
    Blocked, PREFIX, ROOT, canonical, endpoint, file_hash, read, require, rooted,
    utc, validate_payload, verify_prepared, verify_weights, write_new,
)
from tools.host.prepare_baseline import _git, _plain_ancestors

CONTEXT = ContextVar('creative_eval_original_request', default=None)
OWNER = 'creative-studio-local-runtime-hooks-v1'
QWEN = 'qwen3.5:9b-q4_K_M'

# Names and parameter order come from the pinned host/old archive and current
# reviewed Studio implementation. Any source or signature change needs review.
TARGETS = {
    'torch_files': ('host', 'comfy/utils.py', {'load_torch_file': ['ckpt', 'safe_load', 'device', 'return_metadata']}),
    'gguf_files': ('ggufPlugin', 'loader.py', {'gguf_sd_loader': ['path', 'handle_prefix', 'is_text_model'],
        'gguf_mmproj_loader': ['path'], 'strip_quant_suffix': ['name']}),
    'server': ('host', 'server.py', {'PromptServer.__init__': ['self', 'loop', 'asset_manager'],
        'PromptServer.send_sync': ['self', 'event', 'data', 'sid'], 'PromptServer.add_routes': ['self']}),
    'queue': ('host', 'execution.py', {'PromptQueue.put': ['self', 'item'],
        'PromptQueue.task_done': ['self', 'item_id', 'history_result', 'status', 'process_item']}),
    'h3': ('host', 'comfy_extras/nodes_minimax_h3.py', {'MiniMaxH3ImageToVideo.execute':
        ['cls', 'clip', 'vae', 'prompt', 'width', 'height', 'length', 'first_frame', 'last_frame']}),
    'old_native': ('business', 'nodes/libtv_bridge/table_local_execution.py', {'LocalExecution.generate':
        ['self', 'project', 'request_id', 'model', 'mode', 'prompt', 'settings', 'media'],
        'LocalExecution.enqueue': ['self', 'graph', 'record', 'path']}),
    'old_qwen': ('business', 'nodes/prompt_optimization/local_qwen.py', {'request': ['path', 'payload', 'timeout']}),
    'old_polish': ('business', 'nodes/prompt_optimization/canvas.py', {'polish': ['p']}),
    'old_table': ('business', 'nodes/prompt_optimization/qwen.py', {'QwenTransport.create': ['self', 'snapshot', 'instructions', 'auth']}),
    'old_receipt': ('business', 'nodes/libtv_bridge/table_generation_api.py', {'receipt_path': ['request_id'], 'public': ['state']}),
    'old_optimization_api': ('business', 'nodes/prompt_optimization/api.py', {'handle': ['request']}),
    'new_native': ('studio', 'backend/integrations/comfyui/generation_nodes/native_host.py',
        {'ComfyNativeQueue.enqueue': ['self', 'task_id', 'graph', 'owner']}),
    'new_qwen': ('studio', 'backend/providers/qwen.py', {'QwenProvider.create': ['self', 'request_id', 'snapshot'],
        'LoopbackOllama.request': ['self', 'action', 'body']}),
}


def source_contract(path, symbols):
    text = Path(path).read_text('utf-8-sig')
    tree = ast.parse(text)
    result = {}
    for symbol, expected_names in symbols.items():
        body = tree.body
        for part in symbol.split('.'):
            found = next((node for node in body if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == part), None)
            require(found is not None, 'hook-symbol-missing')
            body = getattr(found, 'body', [])
        require(isinstance(found, (ast.FunctionDef, ast.AsyncFunctionDef)), 'hook-symbol-not-callable')
        args = found.args
        names = [a.arg for a in (*args.posonlyargs, *args.args, *args.kwonlyargs)]
        require(names == expected_names and args.vararg is None and args.kwarg is None, 'hook-signature-changed')
        result[symbol] = {'parameters': names, 'async': isinstance(found, ast.AsyncFunctionDef),
                          'argumentsAstSha256': hashlib.sha256(ast.dump(args, include_attributes=False).encode()).hexdigest()}
    return {'path': str(Path(path).resolve()), 'sha256': file_hash(path), 'symbols': result}


def checked_method(module, symbol, contract):
    owner = module
    parts = symbol.split('.')
    for name in parts[:-1]:
        owner = getattr(owner, name)
    descriptor = inspect.getattr_static(owner, parts[-1])
    function = descriptor.__func__ if isinstance(descriptor, (classmethod, staticmethod)) else descriptor
    require(list(inspect.signature(function).parameters) == contract['parameters']
            and inspect.iscoroutinefunction(function) == contract['async'], 'loaded-hook-signature-changed')
    return owner, parts[-1], function, isinstance(descriptor, classmethod)


def http_client_contract():
    import aiohttp
    function = aiohttp.ClientSession._request
    return {'signature': str(inspect.signature(function)), 'sha256': file_hash(inspect.getsourcefile(function))}


def local_configuration(configuration, environment, ollama):
    result = {'schemaVersion': 1, 'enabled': True, 'modelBindings': configuration['bindings'],
              'resourceLock': str(Path(environment['root']) / 'user/eval-resource.lock')}
    if ollama:
        registry = Path(configuration['ollama']['manifest']).resolve()
        installed = Path(ollama['modelsRoot']) / 'manifests/registry.ollama.ai/library/qwen3.5/9b-q4_K_M'
        require(file_hash(registry) == ollama['manifestSha256'] == file_hash(installed), 'owned-ollama-registry-differs')
        result['qwenBinding'] = {'manifestPath': str(registry), 'installedManifestPath': str(installed),
            'blobsRoot': str(Path(ollama['modelsRoot']) / 'blobs'), 'manifestSha256': ollama['manifestSha256'],
            'blobs': configuration['ollama']['blobsVerifiedByRehash']}
    return result


def verify_ollama_registry(runtime, ownership):
    """Both registry copies must identify exactly the six approved blob roles."""
    original = Path(runtime['ollama']['manifest'])
    installed = Path(ownership['modelsRoot']) / 'manifests/registry.ollama.ai/library/qwen3.5/9b-q4_K_M'
    require(file_hash(original) == ownership['manifestSha256'] == file_hash(installed), 'owned-ollama-registry-differs')
    manifest = read(installed)
    expected = {v['role']: v for v in runtime['ollama']['blobsVerifiedByRehash']}
    require(set(expected) == {'model', 'projector', 'config', 'template', 'license', 'params'}, 'incomplete-owned-ollama-blobs')
    entries = [('config', manifest['config'])] + [(v['mediaType'].removeprefix('application/vnd.ollama.image.'), v) for v in manifest['layers']]
    require(manifest.get('schemaVersion') == 2 and len(entries) == 6 and {r for r, _ in entries} == set(expected), 'ollama-manifest-membership-changed')
    for role, entry in entries:
        require(entry.get('digest') == 'sha256:' + expected[role]['sha256'] and entry.get('size') == expected[role]['bytes'], 'ollama-manifest-blob-changed')
    return True


def build_launch_manifest(prepared_path, run_directory, variant, fixture_root, destination, *, ollama=None, previous_trace_roots=()):
    """Read and create a review artifact only; no sockets, process or model starts."""
    prepared_path, run_directory, fixture_root, destination = map(lambda p: Path(p).resolve(),
        (prepared_path, run_directory, fixture_root, destination))
    run = read(run_directory / 'run.json')
    approval = read(run['inputs']['approval']['path'])
    prepared = read(prepared_path)
    require(file_hash(prepared_path) == approval['preparedSha256'], 'prepared-review-changed')
    configuration = verify_prepared(prepared, approval)
    require(variant in ('baseline', 'studio') and configuration.get('instrumentation', {}).get('enabled'), 'reviewed-instrumentation-archive-required')
    environment = prepared['environments'][variant]
    package_root = Path(environment['root']) / 'custom_nodes'
    sources = {s['key']: s for s in configuration['sources']}
    roots = {'host': Path(configuration['host']), **{k: package_root / v['name'] for k, v in sources.items()}}
    contracts = {}
    for key, (origin, relative, symbols) in TARGETS.items():
        if origin not in ('host', 'ggufPlugin', 'business' if variant == 'baseline' else 'studio'):
            continue
        path = roots[origin] / relative
        if origin == 'host':
            git_bytes = _git(str(roots['host']), 'show', configuration['hostCommit'] + ':' + relative)
            require(path.read_bytes().replace(b'\r\n', b'\n') == git_bytes, 'host-source-not-fixed-commit')
        contracts[key] = source_contract(path, symbols)
    fixtures = read(fixture_root / 'manifest.json')
    for item in fixtures['media']:
        require(file_hash(rooted(fixture_root, item['path'])) == item['sha256'], 'fixture-bytes-changed')
    _plain_ancestors(destination)
    require(destination.is_relative_to(Path(configuration['destination'])) and not destination.exists(), 'new-prepared-launch-file-required')
    runtime = read(configuration['runtimeFile'])
    require(file_hash(configuration['runtimeFile']) == configuration['runtimeFileSha256'], 'runtime-inventory-changed')
    instrument_root = Path(configuration['destination']) / 'instrumentation'
    if ollama:
        verify_ollama_registry(runtime, ollama)
    config = local_configuration(configuration, environment, ollama) if variant == 'studio' else None
    if config:
        config_path = Path(environment['root']) / 'user/daelab/creative-studio/local-generation.json'
        _plain_ancestors(config_path)
        require(not config_path.exists(), 'existing-local-generation-config-preserved')
        config_path.parent.mkdir(parents=True, exist_ok=True)
        write_new(config_path, config)
    result = {'schemaVersion': 1, 'owner': OWNER, 'variant': variant, 'createdAt': utc(),
        'prepared': {'path': str(prepared_path), 'sha256': file_hash(prepared_path)},
        'run': {'path': str(run_directory / 'run.json'), 'sha256': file_hash(run_directory / 'run.json')},
        'fixtureRoot': str(fixture_root), 'fixtureManifestSha256': file_hash(fixture_root / 'manifest.json'),
        'sourceContracts': contracts, 'instrumentationRoot': str(instrument_root),
        'httpClientContract': http_client_contract(), 'previousTraceRoots': [str(Path(p).resolve()) for p in previous_trace_roots],
        'localConfiguration': {'path': str(config_path), 'sha256': file_hash(config_path)} if config else None,
        'runtimeHooksSha256': file_hash(instrument_root / 'tools/evals/local_runtime_hooks.py'),
        'traceModuleSha256': file_hash(instrument_root / 'tests/host_fixture/local_eval_trace.py'),
        'hostCommit': configuration['hostCommit'], 'studioCommit': sources['studio']['commit'],
        'environment': environment, 'runtime': runtime, 'bindings': configuration['bindings'], 'ollama': ollama,
        'port': configuration['ports'][variant], 'approvedReadOnlyProductionQueue': True,
        'activationAllowed': False, 'noCloudScope': 'host Python/provider HTTP + owned local Ollama model; no blanket native-DLL assertion',
        'limitations': ['This manifest never starts ComfyUI or Ollama.', 'Missing real measurements remain null.',
                       'An owned separate Ollama process must already exist for Qwen cases; no model download or process startup is performed.']}
    write_new(destination, result)
    return result


class NetworkAudit:
    """Audited known egress surface; no firewall or shared interpreter changes."""
    def __init__(self, host_port, ollama_port=None, *, log=None, read_only_roots=()):
        self.allowed_ports = {host_port, 8000} | ({ollama_port} if ollama_port else set())
        self.ollama_port, self.log, self.enabled = ollama_port, log, False
        self.events, self.original_request = [], None
        self._socketpair = ContextVar('eval_socketpair', default=False)
        self.read_only_roots = tuple(Path(p).resolve() for p in read_only_roots)

    def record(self, operation, allowed, *, destination=None):
        event = {'at': utc(), 'operation': operation, 'allowed': bool(allowed), 'destination': destination}
        self.events.append(event)
        if self.log:
            with self.log.open('a', encoding='utf-8') as stream:
                stream.write(canonical(event) + '\n')

    def audit(self, event, args):
        if not self.enabled:
            return
        if event in ('socket.connect', 'socket.sendto'):
            target = args[1] if event == 'socket.connect' else args[-1]
            allowed = self._socketpair.get() or (isinstance(target, tuple) and target[0] in ('127.0.0.1', '::1') and target[1] in self.allowed_ports)
            # Never record bodies, authorization, arbitrary hostname text or command lines.
            self.record(event, allowed, destination=list(target[:2]) if isinstance(target, tuple) and target[0] in ('127.0.0.1', '::1') else 'nonlocal-or-unknown')
            require(allowed, 'outbound-network-denied')
        elif event == 'socket.getaddrinfo':
            allowed = args[0] in ('127.0.0.1', '::1', None)
            self.record(event, allowed, destination='loopback' if allowed else 'external-name')
            require(allowed, 'external-dns-denied')
        elif event in ('subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.posix_spawnp'):
            self.record('child-process', False)
            raise Blocked('unreviewed-child-process-denied')
        elif event == 'open':
            path, mode, flags = args
            writing = (isinstance(mode, str) and any(c in mode for c in 'wax+')) or isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            if writing:
                self.check_write(path)
        elif event in ('os.remove', 'os.rmdir', 'os.mkdir', 'os.chmod', 'os.utime'):
            self.check_write(args[0])
        elif event in ('os.rename', 'os.link', 'os.symlink'):
            self.check_write(args[0]); self.check_write(args[1])

    def check_write(self, path):
        if isinstance(path, (str, bytes, os.PathLike)):
            resolved = Path(os.fsdecode(path)).resolve()
            require(not any(resolved == root or resolved.is_relative_to(root) for root in self.read_only_roots), 'immutable-source-or-weight-write-refused')

    def permit_http(self, method, url):
        parsed = urlsplit(str(url))
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.username is None
                and parsed.password is None and not parsed.fragment, 'provider-http-destination-denied')
        allowed = parsed.port == 8000 and method.upper() == 'GET' and parsed.path == '/queue' and not parsed.query
        allowed = allowed or (parsed.port == self.ollama_port and not parsed.query and
            (method.upper() == 'GET' and parsed.path in ('/api/tags', '/api/ps') or method.upper() == 'POST' and parsed.path == '/api/generate'))
        self.record('provider-http', allowed, destination=[parsed.port, parsed.path if allowed else 'denied'])
        require(allowed, 'provider-http-action-denied')

    def install(self):
        require(not self.enabled, 'network-audit-already-installed')
        sys.addaudithook(self.audit)
        original_pair = socket.socketpair
        @functools.wraps(original_pair)
        def pair(*args, **kwargs):
            token = self._socketpair.set(True)
            try:
                return original_pair(*args, **kwargs)
            finally:
                self._socketpair.reset(token)
        socket.socketpair = pair
        self.enabled = True
        def close():
            self.enabled = False
            socket.socketpair = original_pair
        return close

    def report(self):
        return {'complete': self.enabled and self.original_request is not None,
                'externalAttempts': sum(not e['allowed'] for e in self.events), 'events': deepcopy(self.events),
                'scope': 'Known host Python socket/DNS/subprocess and provider HTTP paths; owned local Ollama',
                'nativeLibraryNetworkInspection': None, 'firewallRulesChanged': False}


class ResourceProbe:
    """Read-only psutil/NVML sampling, initialized only by an explicit launcher."""
    def __init__(self, pids, *, device_index=0):
        import psutil
        self.psutil, self.pids, self.device_index = psutil, tuple(pids), device_index
        self.nvml, self.device = None, None
        try:
            import pynvml
            pynvml.nvmlInit()
            self.nvml, self.device = pynvml, pynvml.nvmlDeviceGetHandleByIndex(device_index)
        except Exception:
            pass

    def sample(self):
        result = {'atNs': time.perf_counter_ns(), 'processRssBytes': None, 'gpuDeviceUsedBytes': None,
                  'gpuProcessBytes': None, 'gpuProcessIds': None}
        processes = {}
        try:
            processes = {p.pid: p for pid in self.pids for p in [self.psutil.Process(pid), *self.psutil.Process(pid).children(recursive=True)]}
            result['processRssBytes'] = {str(pid): p.memory_info().rss for pid, p in processes.items()}
        except Exception:
            pass
        if self.nvml is not None:
            try:
                result['gpuDeviceUsedBytes'] = int(self.nvml.nvmlDeviceGetMemoryInfo(self.device).used)
                gpu_processes = self.nvml.nvmlDeviceGetComputeRunningProcesses(self.device)
                result['gpuProcessIds'] = [p.pid for p in gpu_processes]
                values = {str(p.pid): p.usedGpuMemory for p in gpu_processes if p.pid in processes}
                result['gpuProcessBytes'] = values if all(type(v) is int and 0 <= v < 2 ** 63 for v in values.values()) else None
            except Exception:
                pass
        return result


class SegmentedMetrics:
    def __init__(self, probe, cold_warm, *, interval=.1, clock=time.perf_counter_ns, started_ns=None):
        self.probe, self.cold_warm, self.interval, self.clock = probe, cold_warm, interval, clock
        self.samples, self.segments = [], {}
        self.lock, self.stopped = threading.RLock(), threading.Event()
        self.started = self.last = clock() if started_ns is None else started_ns
        self.phase = 'queue' if started_ns is None else 'admission'
        self.sample()
        self.thread = threading.Thread(target=self._poll, daemon=True, name='eval-resource-sampling')
        self.thread.start()

    def sample(self):
        try:
            value = self.probe.sample()
        except Exception:
            value = {'atNs': self.clock(), 'processRssBytes': None, 'gpuDeviceUsedBytes': None, 'gpuProcessBytes': None, 'gpuProcessIds': None}
        with self.lock:
            self.samples.append({**value, 'phase': self.phase})

    def _poll(self):
        while not self.stopped.wait(self.interval):
            self.sample()

    def phase_change(self, phase):
        with self.lock:
            now = self.clock()
            self.segments[self.phase] = self.segments.get(self.phase, 0) + (now - self.last) / 1e6
            self.last, self.phase = now, phase
        self.sample()

    def finish(self):
        self.stopped.set()
        self.thread.join(timeout=2)
        self.phase_change('finished')
        valid = all(s['processRssBytes'] is not None and s['gpuDeviceUsedBytes'] is not None for s in self.samples)
        rss = max((sum(s['processRssBytes'].values()) for s in self.samples if s['processRssBytes'] is not None), default=None)
        gpu = max((s['gpuDeviceUsedBytes'] for s in self.samples if s['gpuDeviceUsedBytes'] is not None), default=None)
        combined = max((sum(s['processRssBytes'].values()) + s['gpuDeviceUsedBytes'] for s in self.samples), default=None) if valid else None
        return {'durationMs': sum(self.segments.values()), 'segmentsMs': dict(self.segments),
                'coldWarmState': self.cold_warm.get('state'), 'coldWarmEvidence': self.cold_warm.get('evidence'),
                'peakMemoryBytes': combined, 'peakProcessRssBytes': rss, 'peakGpuDeviceUsedBytes': gpu,
                'memorySource': 'psutil process-tree RSS + NVML device-used bytes, sampled' if valid else None,
                'samplingIntervalMs': self.interval * 1000, 'samples': deepcopy(self.samples),
                'peakIsSampledLowerBound': True, 'segmentation': 'actual native node events / provider durations; no fabricated zero samples'}


def validate_owned_ollama(configuration, *, process_factory=None, connections=None):
    require(isinstance(configuration, dict), 'owned-isolated-ollama-required')
    parsed = urlsplit(endpoint(configuration['url']))
    require(parsed.port not in (8000, 8225, 8226, 8227, 11434), 'independent-ollama-port-required')
    if process_factory is None or connections is None:
        import psutil
        if process_factory is None:
            process_factory = psutil.Process
        if connections is None:
            connections = lambda: psutil.net_connections(kind='tcp')
    process = process_factory(configuration['pid'])
    require(Path(process.exe()).resolve() == Path(configuration['exe']).resolve()
            and file_hash(configuration['exe']) == configuration['exeSha256']
            and process.create_time() == configuration['createTime'], 'ollama-process-ownership-changed')
    environment = process.environ()
    expected = {'OLLAMA_HOST': f'127.0.0.1:{parsed.port}', 'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NUM_PARALLEL': '1',
                'OLLAMA_MAX_LOADED_MODELS': '1', 'OLLAMA_KEEP_ALIVE': '0'}
    require(all(environment.get(k) == v for k, v in expected.items()) and
            Path(environment.get('OLLAMA_MODELS', '')).resolve() == Path(configuration['modelsRoot']).resolve(), 'ollama-owned-environment-differs')
    listeners = connections()
    require(any(c.pid == process.pid and c.status == 'LISTEN' and tuple(c.laddr) == ('127.0.0.1', parsed.port) for c in listeners),
            'ollama-owned-listener-unproven')
    return process.pid


def load_trace_module(root):
    path = Path(root) / 'tests/host_fixture/local_eval_trace.py'
    spec = importlib.util.spec_from_file_location('_creative_eval_optional_trace', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # never imports tests/host_fixture/__init__.py
    return module


class RuntimeHooks:
    def __init__(self, manifest, *, trace_root, probe=None, validate_ollama=True):
        self.manifest, self.variant = manifest, manifest['variant']
        self.environment = Path(manifest['environment']['root']).resolve()
        self.runtime, self.bindings = manifest['runtime'], manifest['bindings']
        self.fixtures = read(Path(manifest['fixtureRoot']) / 'manifest.json')
        self.by_image_hash = {m['sha256']: m['path'] for m in self.fixtures['media']}
        require(len(self.by_image_hash) == len(self.fixtures['media']), 'ambiguous-fixture-byte-identity')
        self.run = read(manifest['run']['path'])
        self.slots = {s['requestId']: s for s in self.run['slots'] if s['variant'] == self.variant}
        cases = read(self.run['inputs']['cases']['path'])
        self.cases = {s['requestId']: cases[self.variant][s['sampleId']] for s in self.slots.values()}
        self.server, self.modules, self.installed, self.restores = None, {}, set(), []
        self.native_owners, self.actual_weights, self.loaded_weights, self.metrics = {}, {}, {}, {}
        self.responses, self.ollama_ps, self.ollama_tags, self.unload_owner = {}, None, None, None
        self.last_native_weights, self.last_native_models = None, None
        self.completion_tasks = []
        self.entry_started = {}
        self.ollama = manifest.get('ollama')
        pids = [os.getpid()]
        if self.ollama:
            if validate_ollama:
                pids.append(validate_owned_ollama(self.ollama))
            else:
                pids.append(self.ollama['pid'])  # Explicit unit fixture only.
        self.probe = probe or ResourceProbe(pids)
        protected = [Path(manifest['environment']['root']) / 'custom_nodes', manifest['instrumentationRoot'],
                     manifest['runtime']['host']['root'], manifest['runtime']['weightRoot']]
        if self.ollama:
            protected.append(self.ollama['modelsRoot'])
        self.audit = NetworkAudit(manifest['port'], urlsplit(self.ollama['url']).port if self.ollama else None, read_only_roots=protected)
        trace_module = load_trace_module(manifest['instrumentationRoot'])
        identity = {'variant': self.variant, 'port': manifest['port'], 'hostCommit': manifest['hostCommit'],
                    'studioCommit': manifest['studioCommit'], 'preparedSha256': manifest['prepared']['sha256'],
                    'root': str(self.environment), 'cachePolicy': 'none', 'offline': True}
        hooks = {'dispatch-gate': self.dispatch_ready, 'native-event-stream': lambda: 'server' in self.installed,
            'resolved-weight-rehash': lambda rid, _capture: self.actual_weights[rid],
            'network-deny-audit': self.audit.report, 'live-host-identity': self.live_identity,
            'h3-tensor-admission': lambda: 'h3' in self.installed}
        if self.ollama:
            hooks['ollama-final-response'] = lambda: ('old_qwen' if self.variant == 'baseline' else 'new_qwen') in self.installed
        self.gate = trace_module.BoundaryGate(trace_root, identity, hooks=hooks,
                                            read_roots=manifest.get('previousTraceRoots', []))
        self.trace_module = trace_module
        self.audit.log = Path(trace_root) / 'network.jsonl'

    def dispatch_ready(self):
        required = {'server', 'queue', 'h3', 'torch_files', 'gguf_files', 'old_native' if self.variant == 'baseline' else 'new_native'}
        if self.ollama:
            required |= {'old_qwen', 'old_polish', 'old_table'} if self.variant == 'baseline' else {'new_qwen'}
        if self.variant == 'baseline':
            required |= {'old_receipt', 'old_optimization_api'}
        return required <= self.installed

    def live_identity(self):
        queue = self.server.prompt_queue if self.server else None
        running, pending = queue.get_current_queue() if queue is not None else (None, None)
        folders = sys.modules.get('folder_paths')
        actual_roots = {} if folders is None else {key: str(Path(getattr(folders, 'get_' + key + '_directory')()).resolve()) for key in ('user', 'input', 'output', 'temp')}
        roots_valid = actual_roots == {key: str(self.environment / key) for key in ('user', 'input', 'output', 'temp')}
        argv = sys.argv
        port = int(argv[argv.index('--port') + 1]) if '--port' in argv else None
        return {'pid': os.getpid(), 'port': port, 'actualRoots': actual_roots,
                'root': str(self.environment) if roots_valid else None, 'cachePolicy': 'none' if '--cache-none' in argv else None,
                'offline': '--offline' in argv, 'bytecodeDisabled': bool(sys.dont_write_bytecode),
                'exclusiveWindow': getattr(self, 'exclusive_window', False), 'queueEmpty': running == [] and pending == [],
                'loadedSourceContracts': sorted(self.installed), 'ollamaOwned': bool(self.ollama)}

    def owner(self, request_id=None):
        request_id = request_id or CONTEXT.get()
        require(request_id in self.slots and self.gate.active == request_id, 'unowned-evaluation-dispatch')
        return request_id

    def _fixture_label(self, raw):
        digest = hashlib.sha256(raw).hexdigest()
        require(digest in self.by_image_hash, 'undeclared-reference-bytes')
        label = self.by_image_hash[digest]
        require(file_hash(rooted(self.manifest['fixtureRoot'], label)) == digest, 'public-reference-changed')
        return label, digest

    def native_capture(self, request_id, graph):
        """Independent projection of the final queue tuple; never reads expected."""
        validate_payload(graph)
        source = self.cases[request_id]['payload']
        image = graph.get('sample', {}).get('class_type') == 'KSampler'
        kind = 'image' if image else 'video'
        condition = graph['condition']['inputs']
        model = 'Qwen-Image-2.1 Turbo（本地）' if image else 'MiniMax H3 FL（本地）'
        require(source['config']['model'] == model, 'native-model-kind-differs')
        folder_paths = sys.modules['folder_paths']
        selected, file_records = {}, []
        wire_roles = {'model': ('diffusion_models', 'unet_name'), 'clip': ('text_encoders', 'clip_name')}
        wire_roles.update({'vae': ('vae', 'vae_name')} if image else {'video_vae': ('video_vae', 'vae_name'), 'audio_vae': ('audio_vae', 'vae_name')})
        for node_id, (role, wire_key) in wire_roles.items():
            name = graph[node_id]['inputs'][wire_key]
            binding = self.bindings[kind][role]
            category = 'vae' if role.endswith('_vae') else role
            actual = folder_paths.get_full_path(category, name)
            require(actual and name == binding['name'] and Path(actual).resolve() == Path(binding['path']).resolve(), 'actual-model-resolver-differs')
            selected[Path(actual).name] = binding
        if image:
            clip = self.bindings['image']['text_encoders']
            gguf = self.modules['gguf_files']
            stem = gguf.strip_quant_suffix(Path(clip['path']).stem.lower())
            candidates = [p for p in Path(clip['path']).parent.iterdir() if p.suffix.lower() == '.gguf' and 'mmproj' in p.stem.lower() and stem in p.stem.lower()]
            expected = self.bindings['image']['mmproj']
            require(len(candidates) == 1 and candidates[0].resolve() == Path(expected['path']).resolve(), 'actual-mmproj-selection-ambiguous-or-different')
            selected[candidates[0].name] = expected
        names = {node['inputs'][key] for node in graph.values() for key in ('unet_name', 'clip_name', 'vae_name', 'lora_name') if key in node.get('inputs', {})}
        require(names == set(selected) - ({self.bindings['image']['mmproj']['name']} if image else set()), 'hidden-or-wrong-graph-model')
        for item in self.runtime['weights']:
            if Path(item['path']).name in selected:
                actual = selected[Path(item['path']).name]
                require(actual['sha256'] == item['sha256'], 'runtime-weight-binding-drift')
                file_records.append({'path': actual['path'], 'bytes': item['bytes'], 'sha256': item['sha256']})
        require(len(file_records) == len(selected), 'weight-inventory-incomplete')
        refs, source_hashes = [], []
        for role in ('first_frame', 'last_frame'):
            if role in condition:
                node_id, index = condition[role]
                require(index == 0 and graph[node_id]['class_type'] == 'LoadImage', 'reference-loader-changed')
                path = rooted(self.environment / 'input', graph[node_id]['inputs']['image'])
                label, digest = self._fixture_label(path.read_bytes())
                refs.append(label); source_hashes.append(digest)
        dimensions = graph['latent']['inputs'] if image else condition
        effective = {'model': model, 'systemInstruction': '', 'expandedText': condition['prompt'], 'referenceOrder': refs,
            'sourceImageSha256': source_hashes, 'preprocessedImageSha256': [],
            'preprocessingStatus': 'runtime-boundary-capture-required' if refs else 'no-references',
            'weightSha256': [r['sha256'] for r in file_records], 'width': dimensions['width'], 'height': dimensions['height'],
            'seed': graph['sample']['inputs']['seed'] if image else graph['noise']['inputs']['noise_seed'], 'lora': []}
        if image:
            effective.update({k: graph['sample']['inputs'][wire] for k, wire in [('steps', 'steps'), ('cfg', 'cfg'), ('sampler', 'sampler_name'), ('scheduler', 'scheduler')]})
        else:
            effective.update(steps=graph['schedule']['inputs']['steps'], sampler=graph['sampler']['inputs']['sampler_name'],
                scheduler=graph['schedule']['inputs']['scheduler'], frames=condition['length'], fps=graph['video']['inputs']['fps'],
                inputDurationSeconds=source['config']['settings']['duration'], turbo='turbo' in graph)
        self.actual_weights[request_id] = file_records
        return {'sampleId': self.slots[request_id]['sampleId'], 'finalRequest': deepcopy(graph), 'effective': effective}

    def qwen_capture(self, request_id, body):
        validate_payload(body)
        require(self.ollama and body.get('model') == QWEN and body.get('keep_alive') == 0 and body.get('stream') is False, 'nonlocal-or-unsafe-qwen-body')
        verify_ollama_registry(self.runtime, self.ollama)
        source = self.cases[request_id]['payload']
        refs = []
        if source.get('mode') == 'reverse':
            raw = base64.b64decode(source['imageDataUrl'].split(',', 1)[1], validate=True)
            refs = [self._fixture_label(raw)[0]]
        records = []
        for item in self.runtime['ollama']['blobsVerifiedByRehash']:
            path = Path(self.ollama['modelsRoot']) / 'blobs' / ('sha256-' + item['sha256'])
            records.append({'path': str(path), 'bytes': item['bytes'], 'sha256': item['sha256']})
        self.actual_weights[request_id] = records
        options = body['options']
        effective = {'model': body['model'], 'systemInstruction': body['system'], 'expandedText': body['prompt'],
            'referenceOrder': refs, 'preprocessedImageSha256': [hashlib.sha256(base64.b64decode(s, validate=True)).hexdigest() for s in body.get('images', [])],
            'weightSha256': [r['sha256'] for r in records], 'temperature': options['temperature'], 'seed': options.get('seed', 'omitted'),
            'contextTokens': options['num_ctx'], 'maxOutputTokens': options['num_predict'], 'lora': []}
        return {'sampleId': self.slots[request_id]['sampleId'], 'finalRequest': deepcopy(body), 'effective': effective}

    def cold_warm(self, request_id, resource):
        if resource == 'ollama':
            models = (self.ollama_ps or {}).get('models')
            return {'state': 'cold' if models == [] else 'warm' if isinstance(models, list) and len(models) == 1 and models[0].get('name') == QWEN else None,
                    'evidence': {'apiPs': deepcopy(self.ollama_ps), 'ownedPid': self.ollama['pid']} if self.ollama_ps is not None else None}
        management = sys.modules.get('comfy.model_management')
        loaded = getattr(management, 'current_loaded_models', None)
        current = [id(value) for value in loaded] if isinstance(loaded, list) else None
        hashes = [r['sha256'] for r in self.actual_weights[request_id]]
        state = 'cold' if current == [] else 'warm' if current and current == self.last_native_models and hashes == self.last_native_weights else None
        return {'state': state, 'evidence': {'modelObjectIds': current, 'sameRetainedModelObjects': state == 'warm'} if current is not None else None}

    def begin(self, request_id, task_id, capture, resource):
        require(request_id in self.metrics, 'real-business-entry-timing-missing')
        self.gate.before_dispatch(request_id, task_id, capture)
        self.loaded_weights[request_id] = set()
        self.metrics[request_id].cold_warm = self.cold_warm(request_id, resource)
        self.metrics[request_id].phase_change('queue')

    def check_loaded_file(self, path):
        request_id = self.gate.active
        require(request_id and self.gate.observe(request_id)['state'] == 'dispatching', 'model-load-outside-owned-task')
        resolved = Path(path).resolve()
        records = self.actual_weights[request_id]
        match = next((r for r in records if Path(r['path']).resolve() == resolved), None)
        require(match is not None, 'unexpected-actual-model-load')
        verify_weights([match], [match['sha256']])
        self.loaded_weights[request_id].add(match['sha256'])

    def service_receipt(self, request_id):
        """Read original durable business state; never recover, poll or create."""
        if self.variant == 'studio':
            service = getattr(self.server, '_creative_studio_generation', None)
            require(service is not None, 'studio-generation-service-unavailable')
            value = service.public(request_id)
            return value, value.get('phase') == 'complete' and value.get('state') == 'succeeded' and bool(value.get('receipt'))
        if self.cases[request_id]['driver'].startswith('native-'):
            path = self.modules['old_receipt'].receipt_path(request_id)
            value = read(path)
            require(value.get('requestId') == request_id, 'old-receipt-identity-changed')
            return value, value.get('phase') == 'complete' and bool(value.get('resultHash'))
        if self.cases[request_id]['driver'] == 'table':
            service = self.modules['old_optimization_api']._service
            require(service is not None, 'old-optimization-service-unavailable')
            batch = service.ledger.get('batch', self.slots[request_id]['batchId'])
            value = service.row(batch, request_id) if batch else None
            return value or {}, bool(value and value.get('status') == 'succeeded' and value.get('remoteResponseId') and value.get('suggestion'))
        raise Blocked('polish-response-must-be-captured-at-original-return')

    async def complete_after_receipt(self, request_id, fields, *, timeout=60):
        end = time.monotonic() + timeout
        receipt, complete = {}, False
        while time.monotonic() < end:
            try:
                receipt, complete = self.service_receipt(request_id)
            except (KeyError, FileNotFoundError):
                receipt = {}
            if complete or receipt.get('state', receipt.get('status', receipt.get('phase'))) in ('failed', 'unknown', 'needs_recovery', 'cancelled', 'paused', 'stopped'):
                break
            await asyncio.sleep(.05)
        validate_payload(receipt)
        report = self.gate.records[request_id]['report']
        report['serviceReceipt'] = {'complete': complete, 'requestId': request_id, 'readOnly': True,
            'sha256': hashlib.sha256(canonical(receipt).encode()).hexdigest(), 'value': receipt}
        fields['state'] = fields['state'] if complete else 'failed' if receipt else 'unknown'
        fields['metrics'] = self.metrics.pop(request_id).finish()
        if fields.get('ollama'):
            fields['metrics']['ollamaSegmentsNs'] = {k: fields['ollama'].get(k) for k in ('load_duration', 'prompt_eval_duration', 'eval_duration', 'total_duration')}
        self.gate.finish(request_id, **fields)

    def defer_receipt(self, request_id, fields):
        self.metrics[request_id].phase_change('business-receipt')
        future = asyncio.run_coroutine_threadsafe(self.complete_after_receipt(request_id, fields), self.server.loop)
        self.completion_tasks.append(future)

    def finish_native(self, task_id, history):
        request_id = self.native_owners.get(task_id)
        if request_id is None:
            return
        report = self.gate.observe(request_id)
        if report['state'] != 'dispatching':
            return
        valid = history.get('status', {}).get('status_str') == 'success' and history.get('status', {}).get('completed') is True
        expected = {r['sha256'] for r in self.actual_weights[request_id]}
        valid = valid and self.loaded_weights[request_id] == expected
        outputs = []
        for group in history.get('outputs', {}).values():
            for item in group.get('images', []) + group.get('videos', []):
                require(item.get('type') == 'output', 'native-output-root-changed')
                relative = '/'.join(p for p in (item.get('subfolder'), item['filename']) if p)
                path = rooted(self.environment / 'output', relative)
                outputs.append({'relativePath': relative, 'sha256': file_hash(path)})
        self.gate.records[request_id]['report']['actualLoadedWeightSha256'] = sorted(self.loaded_weights[request_id])
        self.defer_receipt(request_id, dict(state='complete' if valid and outputs else 'failed', outputs=outputs))
        management = sys.modules.get('comfy.model_management')
        loaded = getattr(management, 'current_loaded_models', None)
        self.last_native_models = [id(value) for value in loaded] if isinstance(loaded, list) else None
        self.last_native_weights = [r['sha256'] for r in self.actual_weights[request_id]]

    def finish_qwen(self, request_id, succeeded, business_result=None):
        response = self.responses.get(request_id)
        if self.gate.active != request_id or self.gate.observe(request_id)['state'] != 'dispatching':
            return
        result = deepcopy(response or {})
        valid = succeeded and result.get('done') is True and result.get('done_reason') == 'stop' and bool(result.get('response', '').strip())
        fields = dict(state='complete' if valid else 'unknown' if not response else 'failed', text=result.get('response'), ollama=result or None)
        if self.variant == 'baseline' and self.cases[request_id]['driver'] == 'polish':
            validate_payload(business_result)
            self.gate.records[request_id]['report']['serviceReceipt'] = {'complete': bool(valid and business_result),
                'requestId': request_id, 'readOnly': True, 'value': business_result,
                'source': 'original-business-polish-return', 'sha256': hashlib.sha256(canonical(business_result).encode()).hexdigest()}
            fields['metrics'] = self.metrics.pop(request_id).finish()
            fields['metrics']['ollamaSegmentsNs'] = {k: result.get(k) for k in ('load_duration', 'prompt_eval_duration', 'eval_duration', 'total_duration')}
            self.gate.finish(request_id, **fields)
        else:
            self.defer_receipt(request_id, fields)

    def _replace(self, module, key, symbol, replacement):
        owner, name, original, class_method = checked_method(module, symbol, self.manifest['sourceContracts'][key]['symbols'][symbol])
        wrapped = replacement(original)
        descriptor = inspect.getattr_static(owner, name)
        setattr(owner, name, classmethod(wrapped) if class_method else wrapped)
        self.restores.append(lambda: setattr(owner, name, descriptor))

    def module_loaded(self, module):
        file = getattr(module, '__file__', None)
        if not file:
            return
        key = next((k for k, record in self.manifest['sourceContracts'].items() if Path(file).resolve() == Path(record['path'])), None)
        if key is None or key in self.installed:
            return
        contract = self.manifest['sourceContracts'][key]
        require(file_hash(file) == contract['sha256'], 'loaded-hook-source-hash-changed')
        self.modules[key] = module
        for symbol in contract['symbols']:
            checked_method(module, symbol, contract['symbols'][symbol])
        getattr(self, 'install_' + key)(module)
        self.installed.add(key)

    def install_server(self, module):
        hooks = self
        def constructor(original):
            @functools.wraps(original)
            def wrapped(server, *args, **kwargs):
                original(server, *args, **kwargs)
                hooks.server = server
                hooks.trace_module.register_local_eval_trace(server, hooks.gate)
                from aiohttp import web
                @web.middleware
                async def owned_entry(request, handler):
                    require(not any(request.headers.get(key) for key in ('Authorization', 'Cookie', 'X-API-Key', 'X-DAELab-DeepSeek-Key')),
                            'credentials-refused-in-local-eval')
                    if request.method != 'POST' or request.path.startswith(PREFIX):
                        return await handler(request)
                    allowed = {'/daelab/libtv/table/submit', '/daelab/libtv/table/status', '/daelab/studio/generation/submit',
                               '/daelab/studio/generation/status', *['/daelab/prompt-optimization/' + a for a in
                               ('polish', 'estimate', 'lease', 'submit', 'permit', 'advance', 'query')]}
                    require(request.path in allowed, 'unreviewed-host-write-refused')
                    data = await request.json()
                    validate_payload(data)
                    action = request.path.rsplit('/', 1)[-1]
                    if action in ('status', 'query'):
                        return await handler(request)
                    rid = data.get('requestId')
                    if '/generation/submit' in request.path or '/libtv/table/submit' in request.path:
                        require(len(data.get('jobs', [])) == 1, 'exactly-one-eval-job-required')
                        rid = data['jobs'][0]['requestId']
                        source = data['jobs'][0]['input']
                        require(canonical(source) == canonical(hooks.cases.get(rid, {}).get('payload')), 'entry-payload-not-reviewed')
                    elif action == 'polish':
                        source = {k: v for k, v in data.items() if k not in ('contractVersion', 'requestId', 'sourceScope')}
                        require(canonical(source) == canonical(hooks.cases.get(rid, {}).get('payload')), 'entry-payload-not-reviewed')
                    else:
                        rid = rid or hooks.gate.active
                        if action in ('estimate', 'submit'):
                            rows = data['rows']
                            require(len(rows) == 1, 'exactly-one-eval-row-required')
                            snapshot = rows[0]['snapshot'] if action == 'submit' else rows[0]
                            require(canonical(snapshot) == canonical(hooks.cases.get(rid, {}).get('payload')), 'table-snapshot-not-reviewed')
                    hooks.owner(rid)
                    hooks.entry_started.setdefault(rid, time.perf_counter_ns())
                    if rid not in hooks.metrics:
                        hooks.metrics[rid] = SegmentedMetrics(hooks.probe, {'state': None, 'evidence': None}, started_ns=hooks.entry_started[rid])
                    token = CONTEXT.set(rid)
                    try:
                        return await handler(request)
                    finally:
                        CONTEXT.reset(token)
                server.app.middlewares.append(owned_entry)
                async def response(request):
                    rid = request.match_info['request_id']
                    report = hooks.gate.observe(rid)
                    require(report.get('state') == 'complete' and report.get('ollama', {}).get('done') is True,
                            'original-ollama-response-unavailable-no-retry')
                    return web.json_response({'requestId': rid, 'state': 'complete', 'text': report['text'],
                                              'responseSource': 'persisted-original-generate-response', 'resubmitted': False})
                server.routes.get(PREFIX + '/responses/{request_id}')(response)
            return wrapped
        self._replace(module, 'server', 'PromptServer.__init__', constructor)
        def events(original):
            @functools.wraps(original)
            def wrapped(server, event, data, sid=None):
                # Binary image previews are native transport objects, not JSON
                # sampler events. Leave their forwarding unchanged.
                if isinstance(event, str) and event in {'execution_start', 'execution_cached', 'executing', 'executed', 'execution_success', 'execution_error', 'execution_interrupted', 'progress'} and isinstance(data, dict):
                    hooks.gate.native_event(event, data)
                rid = hooks.native_owners.get(data.get('prompt_id')) if isinstance(data, dict) else None
                if rid in hooks.metrics and event == 'executing' and data.get('node') is not None:
                    graph = hooks.gate.observe(rid)['finalRequest']['finalRequest']
                    node = graph.get(str(data['node']), {}).get('class_type', '')
                    phase = 'sample' if node in ('KSampler', 'SamplerCustomAdvanced') else 'load' if 'Loader' in node else 'decode' if 'Decode' in node else 'output' if node.startswith(('Save', 'CreateVideo')) else 'condition'
                    hooks.metrics[rid].phase_change(phase)
                return original(server, event, data, sid)
            return wrapped
        self._replace(module, 'server', 'PromptServer.send_sync', events)
        # Registration occurs in __init__, before normal add_routes freezes the router.

    def install_queue(self, module):
        hooks = self
        def put(original):
            @functools.wraps(original)
            def wrapped(queue, item):
                require(isinstance(item, tuple) and len(item) >= 5, 'native-queue-tuple-changed')
                task_id, graph = item[1:3]
                require(task_id in hooks.native_owners, 'native-queue-owner-not-registered')
                rid = hooks.owner(hooks.native_owners.get(task_id))
                capture = hooks.native_capture(rid, graph)
                hooks.begin(rid, task_id, capture, 'native')
                # The pinned host suppresses actual execution_start/executing WS
                # messages without client_id. Only runtime metadata is augmented.
                extra = dict(item[3])
                require(not extra.get('client_id') or extra['client_id'] == hooks.slots[rid]['clientId'], 'foreign-native-client')
                extra['client_id'] = hooks.slots[rid]['clientId']
                return original(queue, (*item[:3], extra, *item[4:]))
            return wrapped
        self._replace(module, 'queue', 'PromptQueue.put', put)
        def done(original):
            @functools.wraps(original)
            def wrapped(queue, item_id, history_result, status, process_item=None):
                with queue.mutex:
                    task_id = queue.currently_running[item_id][1]
                result = original(queue, item_id, history_result, status, process_item)
                hooks.finish_native(task_id, queue.get_history(task_id)[task_id])
                return result
            return wrapped
        self._replace(module, 'queue', 'PromptQueue.task_done', done)

    def install_old_native(self, module):
        hooks = self
        def generate(original):
            @functools.wraps(original)
            def wrapped(adapter, project, request_id, model, mode, prompt, settings, media):
                rid = hooks.owner(request_id)
                require(model == hooks.cases[rid]['payload']['config']['model'], 'old-native-model-changed')
                adapter._creative_eval_request_id = rid
                return original(adapter, project, request_id, model, mode, prompt, settings, media)
            return wrapped
        self._replace(module, 'old_native', 'LocalExecution.generate', generate)
        def enqueue(original):
            @functools.wraps(original)
            async def wrapped(adapter, graph, record, path):
                rid = hooks.owner(getattr(adapter, '_creative_eval_request_id', None))
                require(record['promptId'] not in hooks.native_owners, 'duplicate-native-identity')
                hooks.native_owners[record['promptId']] = rid
                return await original(adapter, graph, record, path)
            return wrapped
        self._replace(module, 'old_native', 'LocalExecution.enqueue', enqueue)

    def install_new_native(self, module):
        hooks = self
        def enqueue(original):
            @functools.wraps(original)
            async def wrapped(adapter, task_id, graph, *, owner):
                rid = hooks.owner(owner)
                require(task_id not in hooks.native_owners, 'duplicate-native-identity')
                hooks.native_owners[task_id] = rid
                return await original(adapter, task_id, graph, owner=owner)
            return wrapped
        self._replace(module, 'new_native', 'ComfyNativeQueue.enqueue', enqueue)

    def install_old_qwen(self, module):
        if self.ollama:
            require(module.BASE == 'http://127.0.0.1:11434', 'old-ollama-base-changed')
            module.BASE = self.ollama['url']
            self.restores.append(lambda: setattr(module, 'BASE', 'http://127.0.0.1:11434'))

    def install_old_receipt(self, module):
        pass  # Source/signature verified; this adapter only reads the original receipt.

    def install_old_optimization_api(self, module):
        pass  # No public query/recover invoked; ledger.get is read-only.

    def _qwen_outer(self, original, request_position=None):
        @functools.wraps(original)
        async def wrapped(*args, **kwargs):
            rid = self.owner(args[request_position] if request_position is not None else None)
            token = CONTEXT.set(rid)
            success = False
            result = None
            try:
                result = await original(*args, **kwargs)
                success = getattr(result, 'state', None) == 'succeeded' if self.variant == 'studio' else True
                return result
            finally:
                self.finish_qwen(rid, success, result if self.variant == 'baseline' and self.cases[rid]['driver'] == 'polish' else None)
                self.unload_owner = None
                CONTEXT.reset(token)
        return wrapped

    def install_old_polish(self, module):
        self._replace(module, 'old_polish', 'polish', lambda original: self._qwen_outer(original))

    def install_old_table(self, module):
        self._replace(module, 'old_table', 'QwenTransport.create', lambda original: self._qwen_outer(original))

    def install_new_qwen(self, module):
        self._replace(module, 'new_qwen', 'QwenProvider.create', lambda original: self._qwen_outer(original, 1))

    def install_torch_files(self, module):
        hooks = self
        def load(original):
            @functools.wraps(original)
            def wrapped(ckpt, safe_load=False, device=None, return_metadata=False):
                hooks.check_loaded_file(ckpt)
                return original(ckpt, safe_load=safe_load, device=device, return_metadata=return_metadata)
            return wrapped
        self._replace(module, 'torch_files', 'load_torch_file', load)

    def install_gguf_files(self, module):
        hooks = self
        def load(original):
            @functools.wraps(original)
            def wrapped(path, handle_prefix='model.diffusion_model.', is_text_model=False):
                hooks.check_loaded_file(path)
                return original(path, handle_prefix=handle_prefix, is_text_model=is_text_model)
            return wrapped
        self._replace(module, 'gguf_files', 'gguf_sd_loader', load)

    @staticmethod
    def tensor_hash(tensor):
        import torch
        value = tensor.detach().to(device='cpu', dtype=torch.float32).contiguous().numpy().astype('<f4', copy=False)
        return hashlib.sha256(value.tobytes(order='C')).hexdigest()

    def install_h3(self, module):
        hooks = self
        def execute(original):
            @functools.wraps(original)
            def wrapped(cls, clip, vae, prompt, width, height, length, first_frame=None, last_frame=None):
                rid = hooks.owner(hooks.gate.active)
                hashes, vae_hashes = [], []
                class ClipProxy:
                    def __getattr__(self, name):
                        return getattr(clip, name)
                    def tokenize(self, text, **kwargs):
                        images = kwargs.get('images', [])
                        hashes.extend(hooks.tensor_hash(image) for image in images)
                        if images:
                            hooks.gate.h3_tensor_boundary(rid, 'tokenize', hashes)
                        return clip.tokenize(text, **kwargs)
                class VaeProxy:
                    def __getattr__(self, name):
                        return getattr(vae, name)
                    def encode(self, image, *args, **kwargs):
                        digest = hooks.tensor_hash(image)
                        require(len(vae_hashes) < len(hashes) and digest == hashes[len(vae_hashes)], 'h3-vae-input-order-or-bytes-differ')
                        vae_hashes.append(digest)
                        if len(vae_hashes) == len(hashes):
                            hooks.gate.h3_tensor_boundary(rid, 'vae', vae_hashes)
                        return vae.encode(image, *args, **kwargs)
                return original(cls, ClipProxy(), VaeProxy(), prompt, width, height, length, first_frame, last_frame)
            return wrapped
        self._replace(module, 'h3', 'MiniMaxH3ImageToVideo.execute', execute)

    def install_http(self):
        import aiohttp
        original = aiohttp.ClientSession._request
        contract = self.manifest.get('httpClientContract')
        require(contract and str(inspect.signature(original)) == contract['signature']
                and file_hash(inspect.getsourcefile(original)) == contract['sha256'], 'http-client-contract-changed')
        hooks = self
        async def inspected(session, method, str_or_url, **kwargs):
            url = str(str_or_url)
            # Explicit endpoint-only relocation for the reviewed Studio adapter's
            # fixed local URL. The actual JSON body is left untouched.
            if url.startswith('http://127.0.0.1:11434/api/'):
                require(hooks.ollama is not None, 'owned-isolated-ollama-required')
                url = hooks.ollama['url'].rstrip('/') + url[len('http://127.0.0.1:11434'):]
            hooks.audit.permit_http(method, url)
            require(kwargs.get('proxy') is None and kwargs.get('auth') is None and not getattr(session, 'trust_env', False)
                    and not getattr(session, '_default_proxy', None) and not getattr(session, '_default_auth', None), 'provider-proxy-or-auth-refused')
            require(not kwargs.get('headers') or not any(str(k).lower() in ('authorization', 'x-api-key', 'cookie') for k in kwargs['headers']), 'credentials-refused-in-local-eval')
            kwargs['allow_redirects'] = False
            path = urlsplit(url).path
            body = kwargs.get('json')
            rid, inference = CONTEXT.get(), path == '/api/generate' and isinstance(body, dict) and 'prompt' in body
            if path.startswith('/api/'):
                validate_owned_ollama(hooks.ollama)
            async def inspect_state(action):
                target = hooks.ollama['url'] + '/api/' + action
                hooks.audit.permit_http('GET', target)
                response = await original(session, 'GET', target, allow_redirects=False)
                require(response.status == 200, 'owned-ollama-inspection-failed')
                return await response.json()
            if inference:
                rid = hooks.owner(rid)
                hooks.ollama_tags = await inspect_state('tags')
                hooks.ollama_ps = await inspect_state('ps')
                resident = hooks.ollama_ps.get('models')
                require(resident == [], 'ollama-residency-not-empty')
                require(any(m.get('name') == QWEN and m.get('digest', '').removeprefix('sha256:') == hooks.ollama['manifestSha256'] for m in hooks.ollama_tags.get('models', [])), 'owned-ollama-model-digest-differs')
                capture = hooks.qwen_capture(rid, body)
                hooks.begin(rid, 'qwen-' + rid, capture, 'ollama')
                hooks.metrics[rid].phase_change('ollama-request')
            elif path == '/api/generate':
                require(isinstance(body, dict) and set(body) == {'model', 'keep_alive'} and body['model'] == QWEN and body['keep_alive'] == 0
                        and rid == hooks.unload_owner and rid in hooks.responses, 'foreign-or-unknown-ollama-unload-refused')
                state = await inspect_state('ps')
                require(isinstance(state.get('models'), list) and all(m.get('name') == QWEN for m in state['models']), 'foreign-resident-model-unload-refused')
            response = await original(session, method, url, **kwargs)
            require(response.status < 300, 'local-http-response-rejected-or-unknown')
            if path in ('/api/tags', '/api/ps', '/api/generate'):
                data = await response.json()
                if path == '/api/ps':
                    hooks.ollama_ps = data
                elif path == '/api/tags':
                    hooks.ollama_tags = data
                elif inference:
                    selected = {k: data.get(k) for k in ('model', 'response', 'done', 'done_reason', 'load_duration', 'prompt_eval_duration', 'eval_duration', 'total_duration', 'eval_count', 'prompt_eval_count')}
                    validate_payload(selected)
                    write_new(hooks.gate.root / rid / 'original-ollama-response.json', selected)
                    hooks.responses[rid] = selected
                    if selected.get('done') is True and selected.get('done_reason') == 'stop':
                        hooks.unload_owner = rid
                    hooks.metrics[rid].phase_change('provider-validation-release')
            return response
        aiohttp.ClientSession._request = inspected
        self.audit.original_request = original
        self.restores.append(lambda: setattr(aiohttp.ClientSession, '_request', original))

    def install_loader(self):
        original = importlib.machinery.SourceFileLoader.exec_module
        hooks = self
        def execute(loader, module):
            file = getattr(module, '__file__', None)
            record = next((r for r in hooks.manifest['sourceContracts'].values() if file and Path(file).resolve() == Path(r['path'])), None)
            if record:
                require(file_hash(file) == record['sha256'], 'hook-source-changed-before-import')
            result = original(loader, module)
            hooks.module_loaded(module)
            return result
        importlib.machinery.SourceFileLoader.exec_module = execute
        self.restores.append(lambda: setattr(importlib.machinery.SourceFileLoader, 'exec_module', original))

    def close(self):
        for future in self.completion_tasks:
            if not future.done():
                future.cancel()
        for metric in self.metrics.values():
            metric.finish()
        for restore in reversed(self.restores):
            restore()
        self.restores.clear()


class ExclusiveWindow:
    """Serializes this prepared old/new pair; never kills a foreign process."""
    def __init__(self, root):
        self.path = Path(root) / 'evaluation-window.lock'
        self.record = {'owner': OWNER, 'pid': os.getpid(), 'openedAt': utc()}

    def __enter__(self):
        _plain_ancestors(self.path)
        require(not self.path.exists(), 'evaluation-window-already-owned-or-needs-review')
        write_new(self.path, self.record)
        return self

    def __exit__(self, *_):
        if self.path.is_file() and read(self.path) == self.record:
            self.path.unlink()


def verify_launch(manifest_path, approval_path, *, execute_reviewed=False):
    # This is intentionally the first check: import or CLI invocation cannot start
    # an inference service without the explicit separate activation decision.
    require(execute_reviewed, 'explicit-reviewed-launch-required')
    manifest, authorization = read(manifest_path), read(approval_path)
    require(manifest.get('owner') == OWNER and manifest.get('schemaVersion') == 1, 'foreign-launch-manifest')
    require(authorization.get('schemaVersion') == 1 and authorization.get('launchApproved') is True
            and authorization.get('exclusiveWindowReviewed') is True
            and isinstance(authorization.get('reviewer'), str) and authorization['reviewer'].strip()
            and authorization.get('manifestSha256') == file_hash(manifest_path), 'exact-launch-review-required')
    require(manifest['port'] not in (8000, 8224, 8225, 8226, 8227), 'active-or-production-host-port-refused')
    require(file_hash(manifest['prepared']['path']) == manifest['prepared']['sha256']
            and file_hash(manifest['run']['path']) == manifest['run']['sha256'], 'reviewed-launch-input-changed')
    run = read(manifest['run']['path'])
    for record in run['inputs'].values():
        require(file_hash(record['path']) == record['sha256'], 'run-review-input-changed')
    approval = read(run['inputs']['approval']['path'])
    require(approval.get('executionApproved') is True, 'request-execution-not-reviewed')
    config = verify_prepared(read(manifest['prepared']['path']), approval)
    require(config['instrumentation']['enabled'] and Path(__file__).resolve() == Path(manifest['instrumentationRoot']) / 'tools/evals/local_runtime_hooks.py', 'launch-from-reviewed-instrumentation-only')
    require(file_hash(__file__) == manifest['runtimeHooksSha256'] and http_client_contract() == manifest['httpClientContract'], 'runtime-instrumentation-or-dependency-drift')
    require(file_hash(Path(manifest['instrumentationRoot']) / 'tests/host_fixture/local_eval_trace.py') == manifest['traceModuleSha256'], 'trace-module-drift')
    require(manifest['environment'] == read(manifest['prepared']['path'])['environments'][manifest['variant']]
            and manifest['port'] == config['ports'][manifest['variant']] and manifest['bindings'] == config['bindings']
            and manifest['runtime'] == read(config['runtimeFile']), 'launch-environment-drift')
    for key, record in manifest['sourceContracts'].items():
        require(source_contract(record['path'], TARGETS[key][2]) == record, 'hook-source-or-signature-drift')
    expected = {k for k, (origin, _, _) in TARGETS.items() if origin in ('host', 'ggufPlugin', 'business' if manifest['variant'] == 'baseline' else 'studio')}
    require(set(manifest['sourceContracts']) == expected, 'hook-coverage-incomplete')
    require(file_hash(Path(manifest['fixtureRoot']) / 'manifest.json') == manifest['fixtureManifestSha256'], 'fixture-manifest-drift')
    for item in read(Path(manifest['fixtureRoot']) / 'manifest.json')['media']:
        require(file_hash(rooted(manifest['fixtureRoot'], item['path'])) == item['sha256'], 'fixture-bytes-drift')
    if manifest.get('localConfiguration'):
        record = manifest['localConfiguration']
        require(file_hash(record['path']) == record['sha256'] and read(record['path']) == local_configuration(config, manifest['environment'], manifest.get('ollama')), 'local-generation-configuration-drift')
    trace_root = Path(authorization['traceRoot']).resolve()
    _plain_ancestors(trace_root)
    require(trace_root.is_relative_to(Path(manifest['environment']['root']) / 'evidence') and not trace_root.exists(), 'new-isolated-trace-root-required')
    return manifest, config, trace_root


def launch(manifest_path, approval_path, *, execute_reviewed=False):
    manifest, config, trace_root = verify_launch(manifest_path, approval_path, execute_reviewed=execute_reviewed)
    require(sys.dont_write_bytecode and '-B' in manifest['environment']['command'], 'launch-python-with-B-required')
    require(Path(sys.executable).resolve() == Path(config['python']).resolve(), 'reviewed-python-required')
    host, environment = Path(config['host']), Path(manifest['environment']['root'])
    previous_argv, previous_path, previous_cwd = sys.argv[:], sys.path[:], Path.cwd()
    changed_environment = {'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1',
        'DO_NOT_TRACK': '1', 'HF_HOME': str(environment / 'temp/huggingface'), 'TORCH_HOME': str(environment / 'temp/torch')}
    previous_environment = {k: os.environ.get(k) for k in changed_environment}
    with ExclusiveWindow(config['destination']):
        hooks = RuntimeHooks(manifest, trace_root=trace_root)
        try:
            os.environ.update(changed_environment)
            sys.argv = manifest['environment']['command'][3:]  # strips Python, -B, -s only
            require(Path(sys.argv[0]).resolve() == host / 'main.py', 'host-entry-changed')
            sys.path.insert(0, str(host)); os.chdir(environment)
            hooks.exclusive_window = True
            hooks.install_loader(); hooks.install_http()
            hooks.restores.append(hooks.audit.install())
            write_new(trace_root / 'launch.json', {'manifestSha256': file_hash(manifest_path), 'pid': os.getpid(),
                'python': sys.executable, 'argv': sys.argv, 'bytecodeDisabled': True, 'cloudScope': manifest['noCloudScope'], 'at': utc()})
            # Same native host main/queue. No subprocess, custom node or second executor.
            return runpy.run_path(str(host / 'main.py'), run_name='__main__')
        finally:
            hooks.close()
            sys.argv, sys.path = previous_argv, previous_path
            os.chdir(previous_cwd)
            for key, value in previous_environment.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    build = sub.add_parser('manifest')
    for name in ('prepared', 'run-directory', 'variant', 'fixture-root', 'destination'):
        build.add_argument('--' + name, required=True)
    build.add_argument('--ollama-ownership')
    build.add_argument('--previous-trace-root', action='append', default=[])
    start = sub.add_parser('launch')
    start.add_argument('--manifest', required=True); start.add_argument('--approval', required=True)
    start.add_argument('--execute-reviewed', action='store_true')
    args = parser.parse_args()
    if args.action == 'manifest':
        build_launch_manifest(args.prepared, args.run_directory, args.variant, args.fixture_root, args.destination,
            ollama=read(args.ollama_ownership) if args.ollama_ownership else None, previous_trace_roots=args.previous_trace_root)
        print(canonical({'status': 'prepared-not-started', 'generationRequests': 0, 'activationAllowed': False}))
    else:
        launch(args.manifest, args.approval, execute_reviewed=args.execute_reviewed)


if __name__ == '__main__':
    main()
