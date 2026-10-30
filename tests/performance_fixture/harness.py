"""Test-only transport adapters over the installed Studio services; no scheduler copy."""
import asyncio
from collections import Counter
from contextlib import asynccontextmanager
from contextvars import ContextVar
import hashlib
import importlib
import ipaddress
import json
from pathlib import Path
import re
import struct
import threading
import time
from types import SimpleNamespace
from urllib.parse import urlsplit
import zlib

VERSION = 'studio-perf06-fixture-v1'
PREFIX = '/studio-test/performance-scheduler'
BUDGETS = {'gpu': 1, 'cloud': 3, 'transcode': 2}
KINDS = ('fake-local', 'fake-cloud', 'fake-transcode')
TASK = ContextVar('studio_performance_request', default=None)


def validate_plan(raw):
    value = json.loads(raw)
    jobs = value.get('jobs')
    if value.get('schemaVersion') != 1 or not isinstance(jobs, list) or len(jobs) != 100:
        raise ValueError('Use the fixed 100-job PERF-06 plan.')
    seen = set()
    for item in jobs:
        if (set(item) != {'request_id', 'kind', 'duration_ms', 'outcome', 'real_network'}
                or not re.fullmatch(r'perf-fake-\d{3}', item['request_id']) or item['request_id'] in seen
                or item['kind'] not in KINDS or type(item['duration_ms']) is not int
                or not 1 <= item['duration_ms'] <= 1000 or item['outcome'] not in ('succeeded', 'failed')
                or item['real_network'] is not False):
            raise ValueError('Invalid deterministic performance plan.')
        seen.add(item['request_id'])
    return value, hashlib.sha256(raw).hexdigest()


def product(core):
    suffix = '.integrations.comfyui.services'
    module = type(core).__module__
    if not module.endswith(suffix):
        raise ValueError('Pass the actual installed CoreServices instance.')
    package = module[:-len(suffix)]
    names = {'generation': 'generation.service', 'admission': 'generation.admission',
             'contracts': 'providers.contracts', 'parameters': 'providers.parameters', 'errors': 'contracts.errors'}
    modules = {key: importlib.import_module(package + '.' + name) for key, name in names.items()}
    paths = {key: Path(value.__file__) for key, value in modules.items()}
    for key, name in {'core': module, 'jobs': package + '.jobs.ledger', 'assets': package + '.assets.catalog'}.items():
        paths[key] = Path(importlib.import_module(name).__file__)
    hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()}
    return SimpleNamespace(**modules, hashes=hashes)


def png(seed):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    color = hashlib.sha256(seed.encode()).digest()[:3]
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\0' + color * 16) * 16)) + chunk(b'IEND', b''))


class ObservedAdmission:
    """Observation only: ordering, capacity and locking belong to the product."""
    def __init__(self, actual, controller):
        self.actual, self.controller = actual, controller
        self.permits, self.released = {}, set()
        self.observation_lock = threading.RLock()

    def __getattr__(self, name):
        return getattr(self.actual, name)

    def check_available(self, resource):
        return self.actual.check_available(resource)

    @asynccontextmanager
    async def lease(self, resource, *, request_id=None):
        request_id = request_id or TASK.get()
        self.controller.record('lease_requested', request_id, resource=resource)
        self.controller.resource_waiting[request_id] = resource
        try:
            async with self.actual.lease(resource, request_id=request_id) as permit:
                self.controller.resource_waiting.pop(request_id, None)
                with self.observation_lock:
                    self.permits[request_id] = permit
                    self.released.discard(request_id)
                self.controller.record('lease_acquired', request_id, resource=permit.resource)
                self._snapshot('acquired', request_id)
                try:
                    yield permit
                finally:
                    self.controller.record('lease_scope_exiting', request_id, resource=permit.resource,
                                           retained=permit.retained, released=permit.released)
        finally:
            self.controller.resource_waiting.pop(request_id, None)
            self._observe_release(request_id)

    def _observe_release(self, request_id):
        with self.observation_lock:
            permit = self.permits.get(request_id)
            if permit is not None and permit.released and request_id not in self.released:
                self.released.add(request_id)
                self.controller.record('lease_released', request_id, resource=permit.resource)
                self._snapshot('release-observed', request_id)

    def _snapshot(self, reason, request_id):
        # A permit can release on a worker and wake its successor before this
        # async scope exits. Lifecycle log order is not actual capacity usage.
        # snapshot() reads the product's counters under its own shared mutex.
        self.controller.record('resource_snapshot', request_id, reason=reason, snapshot=self.actual.snapshot())

    def release(self, request_id):
        result = self.actual.release(request_id)
        self._observe_release(request_id)
        return result


class ObservedPort:
    """Time actual public methods. The wrapped object remains the only authority."""
    def __init__(self, actual, controller, layer):
        self.actual, self.controller, self.layer = actual, controller, layer

    def __getattr__(self, name):
        value = getattr(self.actual, name)
        if not callable(value): return value
        def call(*args, **kwargs):
            start = time.perf_counter()
            request_id = args[0] if self.layer == 'ledger' and args and isinstance(args[0], str) else TASK.get()
            try:
                return value(*args, **kwargs)
            finally:
                self.controller.record('product_phase', request_id, phase=self.layer + '.' + name,
                                       durationMs=(time.perf_counter() - start) * 1000,
                                       thread='event-loop' if threading.get_ident() == self.controller.loop_thread else 'worker')
        return call


def timed_provider(method):
    async def call(self, *args, **kwargs):
        start = time.perf_counter()
        request_id = args[1].get('request_id') if len(args) > 1 and isinstance(args[1], dict) else None
        try:
            return await method(self, *args, **kwargs)
        finally:
            self.c.record('provider_phase', request_id, kind=self.kind, phase=method.__name__,
                          durationMs=(time.perf_counter() - start) * 1000)
    return call


class FakeProvider:
    protocol_only = True
    supports_query = supports_lookup = supports_cancel = True

    def __init__(self, controller, kind, provider_id):
        self.c, self.kind, self.id = controller, kind, provider_id
        self.execution_kind = {'fake-local': 'local', 'fake-cloud': 'remote', 'fake-transcode': 'media'}[kind]
        self.resource = {'fake-local': 'native', 'fake-cloud': 'cloud', 'fake-transcode': 'transcode'}[kind]

    def build(self, data, media, request_id):
        expected = self.c.items.get(request_id)
        if expected is None or data.get('performanceItem') != expected or expected['kind'] != self.kind:
            raise self.c.p.errors.InvalidInput('Only the explicitly armed fixed fixture items are allowed.')
        if self.kind == 'fake-transcode' and len(media) != 1:
            raise self.c.p.errors.InvalidInput('Fake transcode requires its actual frozen synthetic input.')
        return {'fixture': VERSION, 'planSha256': self.c.plan_hash, 'item': expected,
                'frozenInputHashes': [item['sha256'] for item in media]}

    async def preflight(self, snapshot):
        if snapshot.get('prepared', {}).get('fixture') != VERSION:
            raise self.c.p.contracts.ProviderUnavailable('This is not a performance fixture snapshot.')

    @staticmethod
    def task_id(request_id):
        return 'perf-transport-' + hashlib.sha256(request_id.encode()).hexdigest()

    @timed_provider
    async def create(self, request_id, snapshot):
        c = self.c
        c.record('provider_create', request_id, kind=self.kind)
        if request_id in c.accepted:
            raise c.p.errors.Conflict('Duplicate provider create observed; fixture refuses to hide it.')
        row = snapshot['prepared']['item']
        c.accepted[request_id] = {'readyAt': time.perf_counter() + row['duration_ms'] / 1000, 'finished': False}
        c.record('provider_active', request_id, kind=self.kind)
        if request_id in c.uncertain:
            raise c.p.contracts.SubmissionUncertain('Deterministic lost acceptance acknowledgement.', task_id=self.task_id(request_id))
        return c.p.contracts.Observation('submitted', self.task_id(request_id))

    @timed_provider
    async def query(self, task_id, snapshot):
        c, request_id = self.c, snapshot['request_id']
        if task_id != self.task_id(request_id) or request_id not in c.accepted:
            raise c.p.errors.Conflict('Fixture query cannot invent an accepted execution.')
        c.record('provider_query', request_id, kind=self.kind)
        item, accepted = snapshot['prepared']['item'], c.accepted[request_id]
        if request_id in c.cancelled:
            state = 'cancelled'
        elif time.perf_counter() < accepted['readyAt']:
            return c.p.contracts.Observation('running', task_id)
        else:
            state = item['outcome']
        def finish():
            if not accepted['finished']:
                accepted['finished'] = True
                c.record('provider_finished', request_id, kind=self.kind, state=state)
        if state != 'succeeded':
            finish()
            return c.p.contracts.Observation(state, task_id, error_code='synthetic_failure' if state == 'failed' else None)
        if self.kind != 'fake-transcode':
            finish()
            return c.p.contracts.Observation('succeeded', task_id, text='Synthetic performance receipt ' + request_id,
                                             metadata={'fixture': VERSION, 'modelInference': False})
        # A real, bounded file operation and real asset verification, not a fake video.
        relative = 'studio-performance/' + hashlib.sha256(request_id.encode()).hexdigest() + '.png'
        def materialize():
            start = time.perf_counter()
            path, _ = c.core.assets.resolve_reference('output', relative, must_exist=False)
            content = png(request_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                if path.read_bytes() != content:
                    raise c.p.errors.Conflict('Synthetic result bytes changed.')
            else:
                with path.open('xb') as stream:
                    stream.write(content)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            c.record('file_phase', request_id, phase='synthetic-png-write-read-hash', durationMs=(time.perf_counter() - start) * 1000)
            return digest
        digest = await asyncio.to_thread(materialize)
        c.record('file_verified', request_id, sha256=digest)
        finish()
        return c.p.contracts.Observation('succeeded', task_id, files=({'root': 'output', 'path': relative, 'kind': 'image'},),
                                         metadata={'fixture': VERSION, 'codecExecuted': False})

    @timed_provider
    async def lookup(self, request_id, snapshot):
        self.c.record('provider_lookup', request_id, kind=self.kind)
        return await self.query(self.task_id(request_id), snapshot) if request_id in self.c.accepted else None

    @timed_provider
    async def cancel(self, task_id, snapshot):
        request_id = snapshot['request_id']
        if task_id != self.task_id(request_id) or request_id not in self.c.accepted:
            raise self.c.p.errors.Conflict('Only an owned accepted fake task may be cancelled.')
        self.c.record('provider_cancel', request_id, kind=self.kind)
        self.c.cancelled.add(request_id)
        await self.query(task_id, snapshot)
        return True


class SchedulerFixture:
    def __init__(self, core, plan_bytes, *, enabled=False, host_kind='loopback-regression'):
        if enabled is not True or host_kind not in ('loopback-regression', 'isolated-comfyui'):
            raise ValueError('Explicit isolated fixture assembly is required.')
        self.core, self.p = core, product(core)
        self.plan, self.plan_hash = validate_plan(plan_bytes)
        self.host_kind = host_kind
        self.events, self.items, self.accepted = [], {}, {}
        self.event_lock, self.loop_thread = threading.Lock(), threading.get_ident()
        self.resource_waiting = {}
        self.cancelled, self.uncertain = set(), set()
        self.run_id = None
        self.control_lock = asyncio.Lock()
        self.service_reconstructions = 0
        self.origin = time.perf_counter()
        lock_path = Path(core.jobs.database.path).parent / 'performance-fixture-gpu.lock'
        self.admission = self.p.admission.LocalAdmission(lock_path, native_busy=lambda: False)
        self.resources = ObservedAdmission(core.resources, self)
        self.providers = {provider_id: FakeProvider(self, kind, provider_id) for kind, provider_id in zip(KINDS,
                          ('local-qwen-text', 'local-qwen-image', 'local-h3'))}
        self._compose()

    def _compose(self):
        controller, actual = self, self.p.generation.GenerationService
        class ObservedService(actual):
            async def dispatch(self, request_id, **kwargs):
                token = TASK.set(request_id)
                controller.record('dispatch_requested', request_id)
                try:
                    return await super().dispatch(request_id, **kwargs)
                finally:
                    controller.record('dispatch_returned', request_id)
                    TASK.reset(token)
        self.service = ObservedService(ObservedPort(self.core.jobs, self, 'ledger'), ObservedPort(self.core.assets, self, 'assets'), providers=self.providers,
                                      admission=self.admission, resources=self.resources, poll_interval=.02, poll_limit=3000)

    def record(self, event, request_id=None, **values):
        with self.event_lock:
            self.events.append({'sequence': len(self.events), 'elapsedMs': (time.perf_counter() - self.origin) * 1000,
                                'event': event, 'requestId': request_id, **values})

    def manifest(self):
        return {'fixture': VERSION, 'testOnly': True, 'hostKind': self.host_kind, 'planSha256': self.plan_hash,
                'jobCount': len(self.plan['jobs']), 'expectedBudgets': BUDGETS, 'healthBudgetMs': 200,
                'productFiles': self.p.hashes, 'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'resourceImplementation': 'actual CoreServices.resources ResourceAdmission; raw LocalAdmission physical GPU lease',
                'resourceLimits': dict(self.core.resources.limits),
                'resourceObservation': 'product atomic snapshots at lifecycle boundaries; scope logs may lag worker release',
                'nativeQueueAdapterInstalled': False, 'modelInference': False, 'cloudNetwork': False,
                'transcodeSubstitute': 'bounded synthetic PNG file I/O; no codec/model invocation'}

    async def start(self, run_id, plan_hash):
        async with self.control_lock:
            if not isinstance(run_id, str) or not re.fullmatch(r'perf-[A-Za-z0-9_-]{1,80}', run_id) or plan_hash != self.plan_hash:
                raise ValueError('Use a new explicit performance run identity and exact plan hash.')
            if self.run_id is not None:
                previous = await self.status()
                if any(j['state'] not in self.p.generation.TERMINAL_STATES for j in previous['jobs']):
                    raise self.p.errors.Conflict('Previous fixture run is not terminal.')
                await self.service.wait_idle()
            prior = await asyncio.to_thread(self.core.jobs.list_jobs, source_filter={'batchId': run_id}, limit=1)
            if prior:
                raise self.p.errors.Conflict('Run identity already exists; evidence and original jobs cannot be replaced.')
            self.run_id, self.origin, self.loop_thread = run_id, time.perf_counter(), threading.get_ident()
            self.events, self.accepted, self.cancelled, self.resource_waiting = [], {}, set(), {}
            self.items = {run_id + '.' + row['request_id']: row for row in self.plan['jobs']}
            self.uncertain = {next(key for key, row in self.items.items() if row['kind'] == kind and row['outcome'] == 'succeeded')
                              for kind in ('fake-cloud', 'fake-transcode')}
            def register_input():
                relative = 'studio-performance/' + run_id + '.png'
                path, _ = self.core.assets.resolve_reference('input', relative, must_exist=False)
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as output: output.write(png(run_id))
                asset = self.core.assets.register_file('input', relative, kind='image', provenance={'operation': 'performance_input'})
                return next(row['reference_id'] for row in asset['references'] if row['root_key'] == 'input' and row['relative_path'] == relative)
            input_reference = await asyncio.to_thread(register_input)
            models = dict(zip(KINDS, (self.p.parameters.QWEN_MODEL, self.p.parameters.IMAGE_MODEL, self.p.parameters.VIDEO_MODEL)))
            items = [{'requestId': key, 'input': {'model': models[row['kind']], 'performanceItem': row,
                                                'assets': [{'reference_id': input_reference}] if row['kind'] == 'fake-transcode' else []},
                      'source': {'batchId': run_id, 'documentId': 'performance-fixture', 'operation': 'performance_fixture'}}
                     for key, row in self.items.items()]
            self.record('run_started', plannedCount=len(items))
            # Independent submissions exercise shared resource contention;
            # one ordered batch intentionally waits for each preceding job.
            for item in items:
                await self.service.submit([item])
            return {'runId': run_id, 'requestIds': list(self.items), 'uncertainRequestIds': sorted(self.uncertain)}

    def require_owned(self, request_id):
        if request_id not in self.items:
            raise self.p.errors.Conflict('Only the current fixture run is owned.')
        job = self.core.jobs.get(request_id)
        if job['snapshot'].get('prepared', {}).get('fixture') != VERSION or job['source'].get('batchId') != self.run_id:
            raise self.p.errors.Conflict('Stored job does not belong to this performance fixture.')
        return job

    async def control(self, action, ids):
        if action not in ('cancel', 'recover') or not isinstance(ids, list) or len(ids) > 100 or len(set(ids)) != len(ids):
            raise ValueError('Invalid bounded control operation.')
        # Ownership probing is fixture bookkeeping, not product work under test.
        # Do not add a synchronous 100-record SQLite scan to the HTTP loop.
        await asyncio.to_thread(lambda: [self.require_owned(request_id) for request_id in ids])
        results = []
        for request_id in ids:
            before = await asyncio.to_thread(self.require_owned, request_id)
            self.record('control_' + action, request_id, beforeState=before['state'], waitingResource=self.resource_waiting.get(request_id))
            result = await getattr(self.service, action)(request_id)
            results.append({'requestId': request_id, 'state': result['state']})
        return results

    async def status(self, *, detail=False):
        run_id = self.run_id
        def read():
            jobs = self.core.jobs.list_jobs(source_filter={'batchId': run_id}, limit=1000) if run_id else []
            result = []
            for job in jobs:
                row = {k: job[k] for k in ('request_id', 'provider', 'state', 'version', 'attempt', 'provider_task_id', 'cancel_requested', 'fingerprint')}
                row['kind'] = job['snapshot']['prepared']['item']['kind']
                if detail:
                    row['attempts'] = self.core.jobs.attempts(job['request_id'])
                    row['events'] = self.core.jobs.events(job['request_id'])
                    row['frozenInputHashes'] = job['snapshot']['prepared']['frozenInputHashes']
                result.append(row)
            return result
        jobs = await asyncio.to_thread(read)
        return {'runId': run_id, 'jobs': jobs, 'workers': sum(not task.done() for task in self.service._workers.values()),
                'resourceWaiting': dict(self.resource_waiting),
                'resourceSnapshot': self.core.resources.snapshot(),
                'providerCreateCounts': dict(Counter(e['requestId'] for e in self.events if e['event'] == 'provider_create')),
                'serviceReconstructions': self.service_reconstructions,
                **({'observations': list(self.events)} if detail else {})}

    async def reconstruct(self):
        async with self.control_lock:
            status = await self.status()
            if len(status['jobs']) != 100 or any(j['state'] not in self.p.generation.TERMINAL_STATES for j in status['jobs']):
                raise self.p.errors.Conflict('Reconstruction requires observed terminal jobs, not a timeout assumption.')
            await self.service.wait_idle()
            self._compose()
            self.service_reconstructions += 1
            self.record('service_reconstructed', note='same actual ledger and external fake receipts; no process restart claimed')
            return await self.status()

    async def close(self):
        workers = list(self.service._workers.values())
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        await self.service.wait_idle()


def routes(controller):
    from aiohttp import web
    def guarded(handler, write=False):
        async def call(request):
            try:
                local = ipaddress.ip_address(request.remote).is_loopback
            except (TypeError, ValueError):
                local = False
            if (not local or urlsplit('http://' + request.host).hostname not in ('127.0.0.1', 'localhost', '::1')
                    or request.headers.get('Sec-Fetch-Site') == 'cross-site'
                    or write and request.headers.get('Origin') != f'{request.scheme}://{request.host}'):
                return web.json_response({'error': 'Explicit same-origin loopback fixture only.'}, status=403)
            try:
                result = await handler(request)
                return web.json_response(result)
            except controller.p.errors.ContractError as error:
                return web.json_response({'error': error.public()}, status=409)
            except (ValueError, KeyError, TypeError):
                return web.json_response({'error': 'Invalid performance fixture request.'}, status=400)
        return call
    async def manifest(_): return controller.manifest()
    async def status(_): return await controller.status()
    async def evidence(_): return await controller.status(detail=True)
    async def run(request):
        value = await request.json()
        if set(value) != {'runId', 'planSha256'}: raise ValueError()
        return await controller.start(value['runId'], value['planSha256'])
    async def control(request):
        value = await request.json()
        if set(value) != {'action', 'requestIds'}: raise ValueError()
        return await controller.control(value['action'], value['requestIds'])
    async def reconstruct(request):
        if await request.json() != {}: raise ValueError()
        return await controller.reconstruct()
    return [('GET', PREFIX + '/manifest', guarded(manifest)), ('GET', PREFIX + '/status', guarded(status)),
            ('GET', PREFIX + '/evidence', guarded(evidence)), ('POST', PREFIX + '/run', guarded(run, True)),
            ('POST', PREFIX + '/control', guarded(control, True)), ('POST', PREFIX + '/reconstruct', guarded(reconstruct, True))]
