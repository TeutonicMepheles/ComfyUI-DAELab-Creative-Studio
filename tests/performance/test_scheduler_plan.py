"""Real Studio services and HTTP on a random loopback port; no Comfy host or model."""
import asyncio
import ast
import copy
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from aiohttp import web, ClientSession
from backend.integrations.comfyui.services import CoreServices
from backend.integrations.comfyui.diagnostics import Diagnostics
from backend.generation.admission import ResourceAdmission
from tools.performance import run_scheduler_plan as driver

HARNESS = driver.harness_module()
RAW = driver.PLAN.read_bytes()


class SchedulerPreparationTests(unittest.TestCase):
    def test_explicit_comfy_assembly_registers_only_http_and_never_submits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / '.local/isolation'
            for name in ('user', 'input', 'output', 'temp'): (environment / name).mkdir(parents=True)
            (environment / 'creative-studio-isolation.json').write_text(json.dumps({'owner': 'creative-studio-cpu-host-v1', 'port': 8236}))
            core = CoreServices(environment / 'user', environment / 'input', environment / 'output', temp_directory=environment / 'temp')
            package = environment / 'custom_nodes/creative_studio_test_fixture'
            with patch.object(driver, 'ROOT', root): driver.prepare_package(package)
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(), _creative_studio_services=core)
            spec = importlib.util.spec_from_file_location('perf_install_test', package / '__init__.py', submodule_search_locations=[str(package)])
            module = importlib.util.module_from_spec(spec)
            try:
                with patch.dict(sys.modules, {'server': SimpleNamespace(PromptServer=SimpleNamespace(instance=server)), 'perf_install_test': module}), \
                     patch.object(sys, 'argv', ['main.py', '--cpu', '--offline', '--base-directory', str(environment), '--port', '8236']):
                    spec.loader.exec_module(module)
                    self.assertEqual(module.NODE_CLASS_MAPPINGS, {})
                    self.assertEqual(len(server.routes), 6)
                    self.assertEqual(core.jobs.list_jobs(), [])
                    self.assertEqual(server._creative_studio_performance_fixture.service._workers, {})
                    (environment / 'creative-studio-isolation.json').write_text(json.dumps({'owner': 'creative-studio-cpu-host-v1', 'port': 8000}))
                    with self.assertRaises(RuntimeError): module.install(server)
            finally:
                for key in list(sys.modules):
                    if key.startswith('perf_install_test'): sys.modules.pop(key, None)

    def test_fixed_plan_rejects_duplicates_external_network_and_wrong_count(self):
        document, digest = HARNESS.validate_plan(RAW)
        self.assertEqual(len(document['jobs']), 100)
        self.assertEqual(digest, hashlib.sha256(RAW).hexdigest())
        for change in (lambda value: value['jobs'].pop(),
                       lambda value: value['jobs'][1].update(request_id=value['jobs'][0]['request_id']),
                       lambda value: value['jobs'][1].update(real_network=True)):
            data = copy.deepcopy(document); change(data)
            with self.assertRaises(ValueError): HARNESS.validate_plan(json.dumps(data).encode())

    def test_protected_or_external_hosts_are_rejected_before_http(self):
        for url in ('http://127.0.0.1:8000', 'http://localhost:8226', 'http://127.0.0.1:8227',
                    'https://127.0.0.1:9999', 'http://example.com:9999', 'http://user@127.0.0.1:9999',
                    'http://127.0.0.1:9999/other'):
            with self.subTest(url=url), self.assertRaises(ValueError): driver.endpoint(url)
        self.assertEqual(driver.endpoint('http://127.0.0.1:52900/'), 'http://127.0.0.1:52900')

    def test_prepared_package_has_zero_nodes_exact_plan_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(driver, 'ROOT', root):
                destination = root / '.local/fixture'
                result = driver.prepare_package(destination)
                self.assertEqual(result['status'], 'prepared-not-executed')
                self.assertEqual((destination / 'fake-job-plan.json').read_bytes(), RAW)
                tree = ast.parse((destination / '__init__.py').read_text())
                mapping = next(node for node in tree.body if isinstance(node, ast.Assign)
                               and any(isinstance(target, ast.Name) and target.id == 'NODE_CLASS_MAPPINGS' for target in node.targets))
                self.assertEqual(ast.literal_eval(mapping.value), {})
                with self.assertRaises(ValueError): driver.prepare_package(destination)
                with self.assertRaises(ValueError): driver.prepare_package(root / 'outside')
                evidence = root / '.local/existing.json'
                evidence.write_text('original evidence')
                with self.assertRaises(ValueError): driver.new_path(evidence, owned=True)
                self.assertEqual(evidence.read_text(), 'original evidence')


class SchedulerHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for name in ('user', 'input', 'output', 'temp'): (root / name).mkdir()
        self.core = CoreServices(root / 'user', root / 'input', root / 'output', temp_directory=root / 'temp')
        self.fixture = HARNESS.SchedulerFixture(self.core, RAW, enabled=True)
        app = web.Application(client_max_size=1024 * 1024)
        for method, route, handler in HARNESS.routes(self.fixture): app.router.add_route(method, route, handler)
        diagnostics = Diagnostics(driver.ROOT, SimpleNamespace())
        app.router.add_get('/daelab/studio/health', diagnostics.health)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.origin = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
        self.client = ClientSession()

    async def asyncTearDown(self):
        await self.fixture.close()
        await self.client.close()
        await self.runner.cleanup()

    async def test_boundaries_require_explicit_enable_same_origin_and_owned_ids(self):
        with self.assertRaises(ValueError): HARNESS.SchedulerFixture(self.core, RAW)
        async with self.client.post(self.origin + HARNESS.PREFIX + '/run', json={}) as response:
            self.assertEqual(response.status, 403)
        async with self.client.post(self.origin + HARNESS.PREFIX + '/control',
                                   headers={'Origin': self.origin}, json={'action': 'cancel', 'requestIds': ['foreign-job']}) as response:
            self.assertEqual(response.status, 409)
        self.assertEqual(self.core.jobs.list_jobs(), [])
        with self.assertRaises(ValueError):
            await driver.run_plan(self.origin, repeats=1, warmup_seconds=0, round_seconds=0)

    async def test_actual_100_jobs_http_resource_caps_queued_cancel_and_retained_recovery(self):
        report = await driver.run_plan(self.origin, run_prefix='perf-contract', repeats=1, warmup_seconds=0,
                                       round_seconds=0, timeout_seconds=40, health_interval=.02, regression=True)
        destination = os.environ.get('STUDIO_PERFORMANCE_TEST_EVIDENCE')
        if destination:
            with Path(destination).open('x', encoding='utf-8') as output: json.dump(report, output, indent=2)
        self.assertFalse(report['productAcceptance'])
        self.assertEqual(report['measurementKind'], 'loopback-regression')
        round_result = report['rounds'][0]
        self.assertNotIn('collectionError', round_result)
        self.assertFalse(round_result['timedOut'])
        checks = round_result['analysis']['checks']
        for key in ('exact100Identities', 'allTerminal', 'fixedOutcomes', 'noDuplicateCreate', 'everyUncancelledSubmittedOnce',
                    'queuedCancellationNoExecution', 'uncertainRecoveryObserved', 'localGpuMutualExclusion',
                    'allResourceClassesProgressed', 'noLeakedObservedResources', 'serviceReconstructionNoCreate',
                    'cloudWithin3', 'transcodeWithin2', 'allClassesQueuedCancellationObserved',
                    'uncertainCapacityRetainedUntilRecovery', 'transcodeInputsActuallyFrozen'):
            with self.subTest(check=key): self.assertTrue(checks[key], round_result['analysis'])
        # Timing remains actual evidence, not a machine-dependent unit-test claim.
        self.assertEqual(report['status'], 'failed' if round_result['analysis']['failedChecks'] else 'insufficient_evidence')
        self.assertEqual(len(round_result['evidence']['jobs']), 100)
        self.assertTrue(round_result['health'])
        self.assertFalse(report['fixture']['nativeQueueAdapterInstalled'])
        self.assertTrue(round_result['analysis']['phaseDurationMs'])
        with self.assertRaises(self.fixture.p.errors.Conflict):
            await self.fixture.start('perf-contract-1', self.fixture.plan_hash)
        tampered = copy.deepcopy(round_result['evidence'])
        tampered['jobs'].pop()
        analyzed = driver.analyze_run(tampered, self.fixture.plan, [])
        self.assertFalse(analyzed['checks']['exact100Identities'])
        self.assertIsNone(analyzed['healthMs']['p95'])
        self.assertFalse(analyzed['productAcceptance'])


class ResourceObservationTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_release_precedes_async_scope_exit_without_false_quota_peak(self):
        events = []
        def record(event, request_id=None, **values):
            events.append({'sequence': len(events), 'elapsedMs': len(events), 'event': event,
                           'requestId': request_id, **values})
        gate = ResourceAdmission()
        observer = HARNESS.ObservedAdmission(gate, SimpleNamespace(record=record, resource_waiting={}))
        contexts, permits = [], []
        try:
            for key in ('one', 'two', 'three'):
                context = observer.lease('cloud', request_id=key)
                contexts.append(context)
                permits.append(await context.__aenter__())
            # Actual product release wakes the successor before the old async
            # scope has returned. Four open scopes still mean only three permits.
            await asyncio.to_thread(permits[0].release)
            successor = observer.lease('cloud', request_id='four')
            contexts.append(successor)
            await successor.__aenter__()
            self.assertEqual(gate.snapshot()['resources']['cloud']['active'], 3)
            self.assertEqual(sum(e['event'] == 'lease_acquired' for e in events), 4)
            self.assertFalse(any(e['event'] == 'lease_released' for e in events))
        finally:
            for context in contexts: await context.__aexit__(None, None, None)
        evidence = {'runId': 'perf-observer', 'jobs': [], 'observations': events,
                    'workers': 0, 'resourceSnapshot': gate.snapshot()}
        analysis = driver.analyze_run(evidence, HARNESS.validate_plan(RAW)[0], [])
        self.assertEqual(analysis['observedResourcePeaks']['cloud'], 3)
        self.assertTrue(analysis['checks']['cloudWithin3'])
        self.assertEqual(analysis['atomicResourceSnapshotCount'], 8)
        self.assertEqual(sum(e['event'] == 'lease_released' for e in events), 4)


if __name__ == '__main__':
    unittest.main()
