"""Synthetic protocol tests; every socket is a new temporary loopback fake host.

No real ComfyUI/Ollama port, model, GPU, provider or downloader is accessed.
Synthetic trace/metric values below test rejection logic, not Eval results.
"""
import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from tools.evals import run_local_evaluation as runner


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Never import tests.host_fixture: its __init__ intentionally belongs to ComfyUI.
trace = load_file('isolated_eval_trace_test', runner.ROOT / 'tests/host_fixture/local_eval_trace.py')
gpu_tests = load_file('isolated_gpu_test_helpers', runner.ROOT / 'tests/host/test_gpu_evaluation_preparation.py')


def store(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def slot(sample='LOCAL-IMAGE-001', variant='studio'):
    return {'slot': 1, 'sampleId': sample, 'variant': variant, 'repetition': 1, 'smoke': True,
            **{k: str(uuid.uuid4()) for k in ('requestId', 'batchId', 'clientId', 'attemptId')}}


def case_at(root, driver='native-image'):
    model = runner.MODELS[driver]
    weight = root / 'weight-fixture.bin'
    if not weight.exists():
        weight.write_bytes(b'NOT A MODEL: one synthetic identity')
    weights = [{'path': str(weight), 'sha256': runner.file_hash(weight), 'bytes': weight.stat().st_size}]
    native = driver.startswith('native-')
    sample_id = 'LOCAL-IMAGE-001' if native else 'LOCAL-TEXT-001'
    effective = {'model': model, 'weightSha256': [weights[0]['sha256']], 'width': 2, 'height': 2,
                 'referenceOrder': [], 'preprocessedImageSha256': [], 'systemInstruction': '',
                 'expandedText': 'Synthetic fixed prompt.', 'seed': 1, 'lora': []}
    final = {'sample': {'class_type': 'KSampler', 'inputs': {'seed': 1, 'steps': 8}},
             'save': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'fixture'}}} if native else {
             'model': model, 'system': 'Synthetic fixed instruction.', 'prompt': 'Synthetic fixed prompt.',
             'options': {'temperature': .4, 'num_ctx': 8192, 'num_predict': 768}}
    return {'driver': driver, 'weights': weights,
            'payload': {'config': {'model': model, 'kind': 'image', 'mode': 'text2image', 'settings': {}},
                        'segments': [{'type': 'text', 'text': 'Synthetic fixed prompt.'}], 'assets': []} if native else {
                        'model': 'qwen', 'mode': 'polish', 'source': 'Synthetic fixed prompt.', 'instruction': ''},
            'expected': {'sampleId': sample_id, 'finalRequest': final, 'effective': effective},
            'samplerNodes': ['sample'] if native else []}


def metrics():
    return {'segmentsMs': {'load': 1, 'execute': 2, 'write': 1}, 'durationMs': 4,
            'coldWarmState': 'cold', 'coldWarmEvidence': 'synthetic-test-only',
            'peakMemoryBytes': 100, 'memorySource': 'synthetic-test-only'}


class PureRunnerTests(unittest.TestCase):
    def test_schedule_is_exactly_44_unique_slots_with_smoke_first(self):
        plan = runner.read(runner.ROOT / 'docs/validation/catalog/local-eval-plan.json')
        rows = runner.schedule(plan)
        self.assertEqual(len(rows), 44)
        self.assertTrue(all(r['smoke'] for r in rows[:20]))
        self.assertTrue(all(not r['smoke'] for r in rows[20:]))
        for field in ('requestId', 'batchId', 'clientId', 'attemptId'):
            self.assertEqual(len({r[field] for r in rows}), 44)
        for sample in plan['samples']:
            for variant in plan['variants']:
                self.assertEqual(len([r for r in rows if r['sampleId'] == sample['id'] and r['variant'] == variant]), sample['repetitionsPerVariant'])

    def test_endpoint_rejects_production_external_credentials_and_redirect_style(self):
        for value in ['http://127.0.0.1:8000', 'http://localhost:9000', 'https://127.0.0.1:9000',
                      'http://example.invalid:9000', 'http://user:secret@127.0.0.1:9000',
                      'http://127.0.0.1:9000/path', 'http://127.0.0.1:9000?x=1', 'http://127.0.0.1:80']:
            with self.subTest(value=value), self.assertRaises(runner.Blocked):
                runner.endpoint(value)

    def test_paths_reject_traversal_absolute_and_device_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            for path in ['../outside.png', 'a/../../b', '/absolute', 'C:/absolute', 'a\\b', '//host/share', './x']:
                with self.subTest(path=path), self.assertRaises(runner.Blocked):
                    runner.rooted(temporary, path)

    def test_hash_missing_or_changed_blocks_before_connection(self):
        with tempfile.TemporaryDirectory() as temporary:
            case = case_at(Path(temporary))
            weights = case['weights']
            self.assertEqual(len(runner.verify_weights(weights, [weights[0]['sha256']])), 1)
            Path(weights[0]['path']).write_bytes(b'changed')
            with self.assertRaisesRegex(runner.Blocked, 'weight-bytes-changed'):
                runner.verify_weights(weights, [weights[0]['sha256']])

    def test_gate_defaults_unavailable_and_never_installs_on_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            gate = trace.BoundaryGate(Path(temporary) / 'trace', {'variant': 'studio', 'port': 29001})
            self.assertFalse(gate.capabilities()['ready'])
            with self.assertRaisesRegex(runner.Blocked, 'hook-missing'):
                gate.arm({'slot': slot(), 'case': case_at(Path(temporary))})
            self.assertEqual(gate.records, {})

    def test_gate_consumes_once_and_wrong_final_seed_never_dispatches(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = case_at(root)
            hooks = {'dispatch-gate': lambda: True, 'native-event-stream': lambda: True,
                     'live-host-identity': lambda: {},
                     'network-deny-audit': lambda: {'complete': True, 'externalAttempts': 0},
                     'resolved-weight-rehash': lambda *_: case['weights']}
            gate = trace.BoundaryGate(root / 'trace', {'variant': 'studio', 'port': 29001}, hooks=hooks)
            s = slot()
            gate.arm({'slot': s, 'case': case})
            altered = deepcopy(case['expected'])
            altered['finalRequest']['sample']['inputs']['seed'] = 2
            with self.assertRaisesRegex(runner.Blocked, 'final-request-differs'):
                gate.before_dispatch(s['requestId'], 'native-task', altered)
            self.assertEqual(gate.observe(s['requestId'])['dispatches'], 0)
            self.assertFalse((root / 'trace' / s['requestId'] / 'dispatch-consumed.json').exists())
            with self.assertRaises(runner.Blocked):
                gate.before_dispatch(s['requestId'], 'native-task', case['expected'])
            with self.assertRaises(runner.Blocked):
                gate.arm({'slot': s, 'case': case})

    def test_trace_restart_can_read_original_completion_but_cannot_rearm_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, s = case_at(root), slot()
            identity = {'variant': 'studio', 'port': 29001, 'hostCommit': 'a' * 40, 'studioCommit': 'b' * 40,
                        'preparedSha256': 'c' * 64, 'root': str(root / 'environment')}
            hooks = {'dispatch-gate': lambda: True, 'native-event-stream': lambda: True, 'live-host-identity': lambda: {},
                     'network-deny-audit': lambda: {'complete': True, 'externalAttempts': 0},
                     'resolved-weight-rehash': lambda *_: case['weights']}
            original = trace.BoundaryGate(root / 'first', identity, hooks=hooks)
            original.arm({'slot': s, 'case': case})
            original.before_dispatch(s['requestId'], 'original-native-id', case['expected'])
            original.finish(s['requestId'], state='complete', outputs=[], metrics=None)
            resumed = trace.BoundaryGate(root / 'second', identity, hooks=hooks, read_roots=[root / 'first'])
            self.assertEqual(resumed.observe(s['requestId'])['providerTaskId'], 'original-native-id')
            with self.assertRaisesRegex(runner.Blocked, 'conflict'):
                resumed.arm({'slot': s, 'case': case})
            with self.assertRaisesRegex(runner.Blocked, 'unarmed'):
                resumed.before_dispatch(s['requestId'], 'another-id', case['expected'])

    def test_h3_tensor_hook_refuses_reference_order_drift_before_model_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case, s = case_at(root, 'native-video'), slot('LOCAL-H3-003')
            case['expected']['sampleId'] = s['sampleId']
            case['expectedPreprocessingSha256'] = ['a' * 64, 'b' * 64]
            hooks = {'dispatch-gate': lambda: True, 'native-event-stream': lambda: True, 'live-host-identity': lambda: {},
                     'network-deny-audit': lambda: {'complete': True, 'externalAttempts': 0},
                     'resolved-weight-rehash': lambda *_: case['weights']}
            gate = trace.BoundaryGate(root / 'trace', {'variant': 'studio', 'port': 29001}, hooks=hooks)
            gate.arm({'slot': s, 'case': case})
            gate.before_dispatch(s['requestId'], 'original-native-id', case['expected'])
            with self.assertRaisesRegex(runner.Blocked, 'preprocessing-differs'):
                gate.h3_tensor_boundary(s['requestId'], 'tokenize', ['b' * 64, 'a' * 64])
            self.assertEqual(gate.observe(s['requestId'])['state'], 'blocked')
            with self.assertRaises(runner.Blocked):
                gate.h3_tensor_boundary(s['requestId'], 'tokenize', ['a' * 64, 'b' * 64])

    def test_missing_metrics_stays_null_and_cached_sampler_blocks(self):
        with tempfile.TemporaryDirectory() as temporary:
            case, s = case_at(Path(temporary)), slot()
            observed = {'requestId': s['requestId'], 'providerTaskId': 'task', 'dispatches': 1,
                        'comparison': {'passed': True}, 'finalRequest': case['expected'], 'weightRehashVerified': True,
                        'state': 'complete', 'network': {'complete': True, 'externalAttempts': 0}, 'ledgerReuse': False,
                        'metrics': None}
            events = [{'source': 'PromptServer.send_sync', 'type': kind, 'data': {'prompt_id': 'task', **data}}
                      for kind, data in [('execution_start', {}), ('executing', {'node': 'sample'}),
                                         ('execution_cached', {'nodes': ['sample']}), ('execution_success', {})]]
            reasons = runner.assess_observation(observed, events, case, s)
            self.assertIn('native-cache-hit', reasons)
            self.assertIn('cold-warm-unmeasured', reasons)
            self.assertIn('peak-memory-unmeasured', reasons)
            self.assertIn('performance-segments-unmeasured', reasons)
            self.assertIsNone(observed['metrics'])

    def test_no_sampler_or_duplicate_sampler_is_not_independent_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            case, s = case_at(Path(temporary)), slot()
            observed = {'requestId': s['requestId'], 'providerTaskId': 'task', 'dispatches': 1,
                        'comparison': {'passed': True}, 'finalRequest': case['expected'], 'weightRehashVerified': True,
                        'state': 'complete', 'network': {'complete': True, 'externalAttempts': 0}, 'ledgerReuse': False,
                        'metrics': metrics()}
            for count in (0, 2):
                events = [{'source': 'PromptServer.send_sync', 'type': 'executing', 'data': {'prompt_id': 'task', 'node': 'sample'}}] * count
                self.assertIn('sampler-execution-not-exactly-once', runner.assess_observation(observed, events, case, s))

    def test_decode_rejects_receipt_bytes_and_dimensions_and_traversal(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, evidence = root / 'output', root / 'evidence'
            output.mkdir(); evidence.mkdir()
            Image.new('RGB', (3, 3), 'red').save(output / 'wrong.png')
            case = case_at(root)
            item = {'relativePath': 'wrong.png', 'sha256': runner.file_hash(output / 'wrong.png')}
            with self.assertRaisesRegex(runner.Blocked, 'dimensions'):
                runner.decode_outputs(output, {'outputs': [item]}, case, evidence)
            item['sha256'] = '0' * 64
            with self.assertRaisesRegex(runner.Blocked, 'changed'):
                runner.decode_outputs(output, {'outputs': [item]}, case, evidence)
            item['relativePath'] = '../weight-fixture.bin'
            with self.assertRaisesRegex(runner.Blocked, 'path'):
                runner.decode_outputs(output, {'outputs': [item]}, case, evidence)

    def test_full_video_decode_checks_all_39_frames_and_not_15_seconds(self):
        import av
        import numpy as np
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, evidence = root / 'output', root / 'evidence'
            output.mkdir(); evidence.mkdir()
            path = output / 'synthetic.mp4'
            with av.open(str(path), 'w') as container:
                stream = container.add_stream('libx264', rate=24)
                stream.width, stream.height, stream.pix_fmt = 512, 288, 'yuv420p'
                stream.options = {'preset': 'ultrafast'}
                for _ in range(39):
                    frame = av.VideoFrame.from_ndarray(np.zeros((288, 512, 3), dtype=np.uint8), format='rgb24')
                    for packet in stream.encode(frame):
                        container.mux(packet)
                for packet in stream.encode():
                    container.mux(packet)
            case = case_at(root, 'native-video')
            case['expected']['effective'].update(width=512, height=288, frames=39, fps=24)
            result = runner.decode_outputs(output, {'outputs': [{'relativePath': path.name, 'sha256': runner.file_hash(path)}]}, case, evidence)
            self.assertEqual(result[0]['frames'], 39)
            self.assertEqual(result[0]['durationSeconds'], 1.625)
            self.assertTrue(result[0]['decodable'])

    def test_capture_is_bound_to_original_bytes_and_cannot_be_historical_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = case_at(root)
            capture = {**case['expected'], 'captureKind': 'offline-studio-source-construction',
                       'transportSubmitted': False, 'inferenceExecuted': False}
            path = root / 'capture.json'
            store(path, capture)
            case['sourceCapture'] = {'path': str(path), 'sha256': runner.file_hash(path)}
            runner.verify_capture(case)
            capture['inferenceExecuted'] = True
            store(path, capture)
            with self.assertRaisesRegex(runner.Blocked, 'source-capture-changed'):
                runner.verify_capture(case)
            case['sourceCapture']['sha256'] = runner.file_hash(path)
            with self.assertRaisesRegex(runner.Blocked, 'offline-builder'):
                runner.verify_capture(case)


class PreparedArchiveTests(unittest.TestCase):
    def setUp(self):
        self.fixture = gpu_tests.GPUPreparationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.config = self.fixture.plan()
        self.environments = gpu_tests.gpu.prepare(self.config)
        self.prepared = {'configuration': self.config, 'environments': self.environments}
        self.approval = {'schemaVersion': 1, 'reviewer': 'Codex test fixture', 'studioCommit': self.config['sources'][-1]['commit'],
                         'hostCommit': self.config['hostCommit']}
        self.patch = patch.object(runner, 'PINNED_SOURCES', self.fixture.pinned)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_real_git_archives_pass_then_source_cache_port_or_host_drift_blocks(self):
        runner.verify_prepared(self.prepared, self.approval)
        for mutate in ('port', 'cache', 'commit'):
            changed = deepcopy(self.prepared)
            if mutate == 'port':
                changed['configuration']['ports']['studio'] = 8000
            elif mutate == 'cache':
                changed['environments']['studio']['command'].remove('--cache-none')
            else:
                changed['configuration']['sources'][-1]['commit'] = '0' * 40
            with self.subTest(mutate=mutate), self.assertRaises(runner.Blocked):
                runner.verify_prepared(changed, self.approval)
        host = self.fixture.root / 'host'
        (host / 'main.py').write_text('Different but clean host commit')
        gpu_tests.git(host, 'add', 'main.py')
        gpu_tests.git(host, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Drift')
        with self.assertRaisesRegex(runner.Blocked, 'host-head-drift'):
            runner.verify_prepared(self.prepared, self.approval)

    def test_snapshot_change_and_unreviewed_extra_package_block(self):
        root = Path(self.environments['studio']['root'])
        (root / 'custom_nodes' / 'extra').mkdir()
        with self.assertRaisesRegex(runner.Blocked, 'unreviewed-installed-package'):
            runner.verify_prepared(self.prepared, self.approval)

    def test_offline_prepare_binds_20_captures_review_and_traceability_without_sockets(self):
        import shutil
        root = self.fixture.studio
        catalog = root / 'docs/validation/catalog'
        catalog.mkdir(parents=True)
        for name in ('local-eval-plan.json', 'traceability.json'):
            shutil.copyfile(runner.ROOT / 'docs/validation/catalog' / name, catalog / name)
        plan = runner.read(catalog / 'local-eval-plan.json')
        cases = {'baseline': {}, 'studio': {}}
        for variant in cases:
            for sample in plan['samples']:
                identifier = sample['id']
                driver = 'native-image' if identifier.startswith('LOCAL-IMAGE') else 'native-video' if identifier.startswith('LOCAL-H3') else 'table' if sample['mode'].startswith('table-row') else 'polish'
                case = case_at(self.fixture.root, driver)
                effective = case['expected']['effective']
                effective.update(model=sample['model'])
                if driver == 'native-image':
                    effective.update(width=1024, height=1024, steps=8, cfg=1, scheduler='simple', sampler='euler', seed=20261013 if identifier.endswith('001') else 20261014)
                elif driver == 'native-video':
                    effective.update(width=512, height=288, steps=20, seed=20261023, inputDurationSeconds=1.5, frames=39, fps=24, turbo=False)
                else:
                    effective.update(temperature=.4, seed='omitted', contextTokens=16384 if driver == 'table' else 8192, maxOutputTokens=1024 if driver == 'table' else 768)
                if driver == 'table':
                    case['payload'] = {'model': sample['model'], 'target': {'documentId': 'd'}, 'snapshotDigest': 'f' * 64}
                case['expected']['sampleId'] = identifier
                case['expected']['inputSha256'] = 'f' * 64
                if identifier in ('LOCAL-H3-002', 'LOCAL-H3-003'):
                    case['expectedPreprocessingSha256'] = ['a' * 64] * (1 if identifier.endswith('002') else 2)
                capture = self.fixture.root / (variant + '-' + identifier + '.json')
                store(capture, {**case['expected'], 'captureKind': 'offline-studio-source-construction' if variant == 'studio' else 'offline-pinned-source-construction',
                                'transportSubmitted': False, 'inferenceExecuted': False})
                case['sourceCapture'] = {'path': str(capture), 'sha256': runner.file_hash(capture)}
                cases[variant][identifier] = case
        paths = {key: self.fixture.root / (key + '.json') for key in ('prepared', 'approval', 'cases')}
        store(paths['prepared'], self.prepared)
        store(paths['cases'], cases)
        approval = {**self.approval, 'executionApproved': False, 'runnerSha256': runner.file_hash(runner.__file__),
                    'preparedSha256': runner.file_hash(paths['prepared']), 'casesSha256': runner.file_hash(paths['cases']),
                    'planSha256': runner.file_hash(catalog / 'local-eval-plan.json')}
        store(paths['approval'], approval)
        destination = root / '.local/new-run'
        with patch.object(runner, 'ROOT', root), patch('socket.socket.connect', side_effect=AssertionError('Offline prepare may not connect')):
            result = runner.prepare_run(paths['prepared'], paths['approval'], paths['cases'], destination)
            self.assertEqual(len(result['slots']), 44)
            self.assertEqual(len(result['captureInputs']), 20)
            self.assertEqual(result['traceability']['test'], 'TC-SYS-036')
            self.assertFalse(result['productAcceptance'])
            with self.assertRaisesRegex(runner.Blocked, 'new-local-evidence'):
                runner.prepare_run(paths['prepared'], paths['approval'], paths['cases'], destination)
            altered = deepcopy(cases)
            altered['studio']['LOCAL-IMAGE-001']['expected']['effective']['seed'] = 9
            store(paths['cases'], altered)
            with self.assertRaisesRegex(runner.Blocked, 'fingerprint-changed'):
                runner.prepare_run(paths['prepared'], paths['approval'], paths['cases'], root / '.local/another-run')


class LoopbackRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from aiohttp import web
        self.temp = tempfile.TemporaryDirectory(prefix='studio-eval-runner-test-')
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.case = case_at(self.root)
        self.s = slot()
        self.calls, self.create_count, self.query_count = [], 0, 0
        self.loss, self.cached, self.missing_metrics = False, False, False
        self.app = web.Application()
        self.app.router.add_post('/daelab/studio/generation/submit', self.submit)
        self.app.router.add_post('/daelab/libtv/table/submit', self.submit)
        self.app.router.add_post('/daelab/studio/generation/status', self.query)
        self.app.router.add_post('/daelab/libtv/table/status', self.query)
        self.app.router.add_post('/daelab/prompt-optimization/polish', self.submit)
        self.app.router.add_post('/daelab/prompt-optimization/{action}', self.table_action)
        async def redirect(_request):
            raise web.HTTPFound('http://example.invalid/never')
        self.app.router.add_get('/redirect', redirect)
        # Reserve a fresh loopback port without ever touching an existing host.
        import socket
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0)); sock.listen(16); sock.setblocking(False)
        self.port = sock.getsockname()[1]
        self.assertNotIn(self.port, (8000, 8225, 8226, 11434))
        self.environment = self.root / 'environment'
        (self.environment / 'output').mkdir(parents=True)
        self.identity = {'variant': 'studio', 'port': self.port, 'hostCommit': 'a' * 40, 'studioCommit': 'b' * 40,
                         'preparedSha256': 'c' * 64, 'root': str(self.environment), 'cachePolicy': 'none',
                         'offline': True, 'exclusiveWindow': True, 'queueEmpty': True}
        hooks = {'dispatch-gate': lambda: True, 'native-event-stream': lambda: True, 'ollama-final-response': lambda: True,
                 'live-host-identity': lambda: deepcopy(self.gate.identity),
                 'network-deny-audit': lambda: {'complete': True, 'externalAttempts': 0, 'source': 'synthetic-loopback-fixture'},
                 'resolved-weight-rehash': lambda *_: self.case['weights']}
        self.gate = trace.BoundaryGate(self.root / 'trace', self.identity, hooks=hooks)
        trace.register_local_eval_trace(self.app, self.gate)
        self.web_runner = web.AppRunner(self.app)
        await self.web_runner.setup()
        self.site = web.SockSite(self.web_runner, sock)
        await self.site.start()
        self.addAsyncCleanup(self.web_runner.cleanup)

    async def submit(self, request):
        from aiohttp import web
        body = await request.json()
        self.calls.append((request.path, body))
        request_id = body.get('requestId') or body['jobs'][0]['requestId']
        task_id = 'native-' + request_id
        self.gate.before_dispatch(request_id, task_id, self.case['expected'])
        self.create_count += 1
        # Synthetic service receipt/load proof, never a product Eval result.
        self.gate.records[request_id]['report'].update(serviceReceipt={'complete': True, 'requestId': request_id,
            'readOnly': True, 'value': {'state': 'succeeded', 'fixture': True}},
            actualLoadedWeightSha256=self.case['expected']['effective']['weightSha256'])
        if self.case['driver'].startswith('native-'):
            from PIL import Image
            self.gate.native_event('execution_start', {'prompt_id': task_id})
            self.gate.native_event('execution_cached', {'prompt_id': task_id, 'nodes': ['sample'] if self.cached else []})
            self.gate.native_event('executing', {'prompt_id': task_id, 'node': 'sample'})
            self.gate.native_event('execution_success', {'prompt_id': task_id})
            output = self.environment / 'output' / (request_id + '.png')
            Image.new('RGB', (2, 2), 'red').save(output)
            self.gate.finish(request_id, state='complete', outputs=[{'relativePath': output.name, 'sha256': runner.file_hash(output)}],
                             metrics=None if self.missing_metrics else metrics())
        else:
            self.gate.finish(request_id, state='complete', text='Synthetic fixed reply.',
                             ollama={'done': True, 'done_reason': 'stop', 'eval_count': 3, 'eval_duration': 10}, metrics=metrics())
        if self.loss:
            return web.json_response({'response': 'deliberately lost after dispatch'}, status=503)
        return web.json_response({'jobs': [{'requestId': request_id, 'phase': 'complete'}]})

    async def query(self, request):
        from aiohttp import web
        body = await request.json()
        self.calls.append((request.path, body))
        self.query_count += 1
        return web.json_response({'jobs': [{'requestId': body['requestIds'][0], 'phase': 'complete'}]})

    async def table_action(self, request):
        from aiohttp import web
        action = request.match_info['action']
        if action == 'advance':
            return await self.submit(request)
        body = await request.json()
        self.calls.append((request.path, body))
        if action == 'estimate':
            value = {'quoteId': 'synthetic-quote', 'provider': 'qwen', 'budgetUpperCredits': 0, 'unknownRequests': []}
        elif action == 'lease':
            value = {'leaseId': 'synthetic-lease'}
        elif action == 'permit':
            value = {'permitId': 'synthetic-permit'}
        elif action == 'query':
            self.query_count += 1
            value = {'batchId': body['batchId'], 'rows': [{'requestId': self.s['requestId'], 'status': 'succeeded'}]}
        else:
            value = {'batchId': body['batchId'], 'rows': [{'requestId': self.s['requestId'], 'status': 'queued'}]}
        return web.json_response(value)

    def make_run(self):
        definition = self.root / 'run'
        definition.mkdir()
        paths = {k: self.root / (k + '.json') for k in ('prepared', 'approval', 'cases')}
        store(paths['prepared'], {'configuration': {'ports': {self.s['variant']: self.port}},
                                 'environments': {self.s['variant']: {'root': str(self.environment)}}})
        # Synthetic fixture verification is separately tested with real Git archives.
        approval = {'executionApproved': True, 'hostCommit': 'a' * 40, 'studioCommit': 'b' * 40,
                    'preparedSha256': 'c' * 64, 'traceModuleSha256': runner.file_hash(trace.__file__)}
        store(paths['approval'], approval)
        store(paths['cases'], {self.s['variant']: {self.s['sampleId']: self.case}})
        store(definition / 'run.json', {'owner': runner.OWNER, 'runnerSha256': runner.file_hash(runner.__file__),
                                      'slots': [self.s], 'inputs': {k: {'path': str(p), 'sha256': runner.file_hash(p)} for k, p in paths.items()}})
        return definition

    async def execute(self, definition, **kwargs):
        with patch.object(runner, 'verify_prepared', side_effect=lambda prepared, _approval: prepared['configuration']):
            return await runner.execute_slot(definition, 1, execute_reviewed=True, timeout=2, poll_seconds=.01, **kwargs)

    async def test_real_http_routes_and_ws_are_used_but_no_native_prompt_replay(self):
        definition = self.make_run()
        result = await self.execute(definition)
        self.assertEqual(result['status'], 'captured', result)
        self.assertFalse(result['productAcceptance'])
        self.assertEqual(self.create_count, 1)
        self.assertTrue(result['outputs'][0]['decodable'])
        self.assertEqual(self.calls[0][0], '/daelab/studio/generation/submit')
        self.assertEqual(self.calls[0][1]['jobs'][0]['requestId'], self.s['requestId'])
        self.assertFalse(any(path in ('/prompt', '/api/prompt') for path, _ in self.calls))
        with self.assertRaisesRegex(runner.Blocked, 'query-only'):
            await self.execute(definition)
        self.assertEqual(self.create_count, 1)

    async def test_response_loss_query_resumes_same_identity_without_new_dispatch(self):
        self.loss = True
        definition = self.make_run()
        original = await self.execute(definition)
        self.assertEqual(original['status'], 'blocked')
        self.assertIn('entry-response-unknown-query-original-only', original['blocks'])
        recovered = await self.execute(definition, resume=True)
        self.assertEqual(recovered['status'], 'captured', recovered)
        self.assertTrue(recovered['queryOnly'])
        self.assertFalse(recovered['submittedThisInvocation'])
        self.assertEqual(self.create_count, 1)
        self.assertEqual(self.query_count, 1)
        self.assertEqual(original['requestId'], recovered['requestId'])
        self.assertEqual(runner.read(definition / 'slot-01/result.json'), original)

    async def test_cache_hit_and_missing_measurements_are_blocked_not_green(self):
        self.cached, self.missing_metrics = True, True
        result = await self.execute(self.make_run())
        self.assertEqual(result['status'], 'blocked')
        self.assertIsNone(result['metrics'])
        for code in ('native-cache-hit', 'peak-memory-unmeasured', 'cold-warm-unmeasured'):
            self.assertIn(code, result['blocks'])

    async def test_missing_live_hook_prevents_any_entry_submission(self):
        del self.gate.hooks['dispatch-gate']
        result = await self.execute(self.make_run())
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('required-live-boundary-hook-missing', result['blocks'])
        self.assertEqual(self.create_count, 0)
        self.assertEqual(self.calls, [])

    async def test_wrong_live_commit_prevents_any_entry_submission(self):
        self.gate.identity['studioCommit'] = 'e' * 40
        result = await self.execute(self.make_run())
        self.assertIn('live-host-identity-not-reviewed', result['blocks'])
        self.assertEqual(self.create_count, 0)

    async def test_old_native_entry_force_new_and_status_only_recovery(self):
        self.s['variant'] = 'baseline'
        self.gate.identity['variant'] = 'baseline'
        definition = self.make_run()
        result = await self.execute(definition)
        self.assertEqual(result['status'], 'captured', result)
        self.assertEqual(self.calls[0][0], '/daelab/libtv/table/submit')
        self.assertTrue(self.calls[0][1]['jobs'][0]['forceNew'])
        await self.execute(definition, resume=True)
        self.assertEqual(self.calls[-1][0], '/daelab/libtv/table/status')
        self.assertEqual(self.create_count, 1)

    async def test_polish_uses_real_service_route_and_actual_response_evidence(self):
        self.case = case_at(self.root, 'polish')
        self.s = slot('LOCAL-TEXT-001')
        result = await self.execute(self.make_run())
        self.assertEqual(result['status'], 'captured', result)
        self.assertEqual(self.calls[0][0], '/daelab/prompt-optimization/polish')
        self.assertEqual(self.calls[0][1]['requestId'], self.s['requestId'])
        self.assertEqual(self.calls[0][1]['model'], 'qwen')

    async def test_no_redirect_or_environment_proxy_is_followed(self):
        with patch.dict('os.environ', {'HTTP_PROXY': 'http://example.invalid:9999', 'ALL_PROXY': 'http://example.invalid:9999'}):
            async with runner.LocalHTTP('http://127.0.0.1:' + str(self.port)) as client:
                with self.assertRaisesRegex(runner.Blocked, 'http-rejected'):
                    await client.json('GET', '/redirect')
                identity = await client.json('GET', runner.PREFIX + '/identity')
                self.assertTrue(identity['ready'])
        self.assertEqual(self.create_count, 0)

    async def test_table_uses_estimate_lease_submit_permit_advance_and_query_only_resume(self):
        self.case = case_at(self.root, 'table')
        self.s = slot('LOCAL-TEXT-002')
        self.case['expected']['sampleId'] = self.s['sampleId']
        self.case['payload'] = {'model': runner.MODELS['table'],
            'target': {'documentId': 'synthetic-document', 'tableId': 'synthetic-table', 'recordId': 'row-1', 'fieldId': 'prompt'},
            'snapshotDigest': 'f' * 64, 'revision': 0, 'requestSeq': 0}
        definition = self.make_run()
        result = await self.execute(definition)
        self.assertEqual(result['status'], 'captured', result)
        self.assertEqual([p.rsplit('/', 1)[-1] for p, _ in self.calls], ['estimate', 'lease', 'submit', 'permit', 'advance'])
        self.assertEqual(self.calls[2][1]['rows'][0]['requestId'], self.s['requestId'])
        self.assertEqual(self.calls[2][1]['rows'][0]['snapshot'], self.case['payload'])
        self.assertEqual(self.calls[4][1]['provider'], 'qwen')
        recovered = await self.execute(definition, resume=True)
        self.assertEqual(recovered['status'], 'captured', recovered)
        self.assertEqual(self.calls[-1][0], '/daelab/prompt-optimization/query')
        self.assertEqual(self.calls[-1][1]['batchId'], self.s['batchId'])
        self.assertEqual(self.create_count, 1)


if __name__ == '__main__':
    unittest.main()
