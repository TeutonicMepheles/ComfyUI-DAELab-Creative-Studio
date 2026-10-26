"""Explicit isolated-host deterministic providers; never imported by product code.

Only the product's existing JobLedger/AssetCatalog persist task facts. Provider
receipts are deterministic functions of the frozen fixture plan and original ID.
No host queue, subprocess, model library or remote transport is accessed.
"""
import asyncio
from collections import Counter
import hashlib
import importlib
import ipaddress
import json
from pathlib import Path
import struct
from types import SimpleNamespace
from urllib.parse import urlsplit
import zlib

VERSION = 'studio-generation-fixture-v1'
SCENARIOS = ('success', 'fail-429', 'uncertain-500', 'uncertain-no-id', 'delayed', 'overlapping')
HTTP_FAULTS = ('none', 'preflight-429', 'before-submit-500', 'after-submit-500', 'input-error', 'version-mismatch')
PREFIX = '/studio-test/generation-fixture'


def load_product(core):
    suffix = '.integrations.comfyui.services'
    module = type(core).__module__
    if not module.endswith(suffix):
        raise ValueError('Pass the installed product CoreServices instance explicitly.')
    package = module[:-len(suffix)]
    names = {'service': 'generation.service', 'http': 'generation.http', 'errors': 'contracts.errors',
             'contracts': 'providers.contracts', 'parameters': 'providers.parameters', 'qwen': 'providers.qwen', 'media': 'generation.media', 'admission': 'generation.admission'}
    modules = {name: importlib.import_module(package + '.' + path) for name, path in names.items()}
    modules['fingerprint'] = hashlib.sha256(b''.join(Path(modules[name].__file__).read_bytes() for name in sorted(modules))).hexdigest()
    return SimpleNamespace(**modules)


def synthetic_png(request_id):
    color = hashlib.sha256(request_id.encode()).digest()[:3]
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    pixels = b''.join(b'\0' + color * 8 for _ in range(8))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


class FixtureProvider:
    execution_kind = 'remote'
    protocol_only = True
    resource = 'cloud'  # Protocol-only fake; no network/model transport is present.
    supports_query = supports_lookup = supports_cancel = True

    def __init__(self, controller, kind):
        self.controller, self.kind = controller, kind
        self.id = 'local-qwen-image' if kind == 'image' else 'local-qwen-text'

    def build(self, data, media, request_id):
        c, p = self.controller, self.controller.product
        if c.plan is None:
            raise p.contracts.ProviderUnavailable('Explicitly arm an isolated fixture scenario first.')
        prepared = {'fixture': VERSION, 'fixturePlan': dict(c.plan), 'kind': self.kind, 'originalRequestId': request_id}
        if self.kind == 'image':
            config = data.get('config', {})
            if config.get('model') != p.parameters.IMAGE_MODEL or config.get('kind') != 'image':
                raise p.errors.InvalidInput('This fixture supplies images only for the local Qwen image UI contract.')
            p.parameters.compile_segments(data.get('segments', []), media)
            prepared['settings'] = p.parameters.settings_for('image', config.get('mode'), config.get('settings', {}), media)
        else:
            if len(media) > 1:
                raise p.errors.InvalidInput('The text fixture accepts at most one frozen reference image.')
            image = p.media.read_frozen(c.core.assets, media[0]) if media else None
            prepared['request'] = p.qwen.qwen_request(data, image)
        return prepared

    async def capabilities(self, model):
        c, p = self.controller, self.controller.product
        if c.plan is None:
            raise p.contracts.ProviderUnavailable('Fixture is installed but unarmed; no real model health was checked.')
        base = {'available': True, 'fixture': VERSION, 'realProviderHealth': 'not_checked', 'local': True, 'model': model}
        if self.kind == 'text':
            return {**base, 'provider': 'qwen', 'maxOutputTokens': 1024}
        props = {'width': {'type': 'integer', 'displayName': '宽度', 'default': 1024, 'min': 256, 'max': 2048, 'step': 32},
                 'height': {'type': 'integer', 'displayName': '高度', 'default': 1024, 'min': 256, 'max': 2048, 'step': 32},
                 'seed': {'type': 'integer', 'displayName': '种子（-1 为随机）', 'default': -1, 'min': -1, 'max': 9007199254740991},
                 'modeType': {'items': {'text2image': [0, 0]}}}
        return {**base, 'kind': 'image', 'schema': {'properties': props, 'config': {'strictModes': True, 'settings': ['width', 'height'], 'advancedSettings': ['seed']}}}

    async def preflight(self, snapshot):
        prepared = snapshot.get('prepared', {})
        if prepared.get('fixture') != VERSION or prepared.get('fixturePlan', {}).get('scenario') not in SCENARIOS:
            raise self.controller.product.contracts.ProviderUnavailable('Frozen task does not belong to this fixture version.')

    def _task(self, request_id):
        return 'fixture-' + hashlib.sha256(request_id.encode()).hexdigest()[:32]

    async def create(self, request_id, snapshot):
        c, p = self.controller, self.controller.product
        await self.preflight(snapshot)
        c.record('create', request_id)
        scenario = snapshot['prepared']['fixturePlan']['scenario']
        if scenario == 'fail-429':
            raise p.contracts.SubmissionRejected('Fixture 429: definitely rejected before provider acceptance.')
        if scenario == 'uncertain-no-id':
            raise p.contracts.SubmissionUncertain('Fixture delivery is unknown without a provider receipt.')
        task_id = self._task(request_id)
        if scenario == 'uncertain-500':
            raise p.contracts.SubmissionUncertain('Fixture 500 after acceptance; query the original identity.', task_id=task_id)
        return p.contracts.Observation('submitted', task_id)

    async def query(self, task_id, snapshot):
        c, p = self.controller, self.controller.product
        await self.preflight(snapshot)
        request_id = snapshot['request_id']
        if task_id != self._task(request_id):
            raise p.errors.Conflict('Fixture observation identity differs from the frozen request.')
        c.record('query', request_id)
        if request_id in c.cancelled:
            return p.contracts.Observation('cancelled', task_id)
        scenario = snapshot['prepared']['fixturePlan']['scenario']
        if scenario in ('delayed', 'overlapping') and request_id not in c.released:
            return p.contracts.Observation('running', task_id)
        if self.kind == 'text':
            data = snapshot['input']
            original = data['optimization']['input']['prompt_text'] if data.get('entry') == 'table' else data.get('source') or 'Synthetic image description'
            return p.contracts.Observation('succeeded', task_id, text=original + ' [isolated fixture suggestion]', metadata={'fixture': VERSION, 'modelInference': False})
        relative = 'studio-test/generation-fixture/' + hashlib.sha256(request_id.encode()).hexdigest() + '.png'
        path, _ = c.core.assets.resolve_reference('output', relative, must_exist=False)
        expected = synthetic_png(request_id)
        if path.exists():
            if path.read_bytes() != expected:
                raise p.errors.Conflict('Synthetic receipt file changed; fixture will not overwrite it.')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                with path.open('xb') as stream:
                    stream.write(expected)
            except FileExistsError:
                if path.read_bytes() != expected:
                    raise p.errors.Conflict('Synthetic receipt collision.') from None
        return p.contracts.Observation('succeeded', task_id, files=({'root': 'output', 'path': relative, 'kind': 'image'},), metadata={'fixture': VERSION})

    async def lookup(self, request_id, snapshot):
        self.controller.record('lookup', request_id)
        # A snapshot alone is not proof of acceptance. With no durable receipt,
        # this fixture leaves uncertainty intact instead of fabricating success.
        job = self.controller.core.jobs.get(request_id)
        return await self.query(job['provider_task_id'], snapshot) if job['provider_task_id'] else None

    async def cancel(self, task_id, snapshot):
        await self.preflight(snapshot)
        request_id = snapshot['request_id']
        if task_id != self._task(request_id):
            raise self.controller.product.errors.Conflict('Cannot cancel another fixture task.')
        self.controller.record('cancel', request_id)
        self.controller.cancelled.add(request_id)
        return True


class FixtureResourceLedger:
    """Read-only restoration view for this fixture's retired resource label.

    The shared gate and the original JobLedger stay in place. No persisted
    snapshot/fingerprint is edited, and foreign records never receive the alias.
    This class exists only in the explicitly installed test package.
    """
    _studio_fixture_resource_projection = VERSION

    def __init__(self, ledger):
        self.ledger = ledger

    def __getattr__(self, name):
        return getattr(self.ledger, name)

    def list_jobs(self, *args, **kwargs):
        return self._project(self.ledger.list_jobs(*args, **kwargs))

    def list_resource_reservations(self):
        return self._project(self.ledger.list_resource_reservations())

    @staticmethod
    def _project(jobs):
        result = []
        for job in jobs:
            snapshot = job['snapshot']
            if (job['execution_kind'] == 'remote' and job['provider'] in {'local-qwen-image', 'local-qwen-text'}
                    and snapshot.get('prepared', {}).get('fixture') == VERSION
                    and snapshot.get('resource') == 'fixture-no-gpu'):
                job = {**job, 'snapshot': {**snapshot, 'resource': 'cloud'}}
            result.append(job)
        return result


class GenerationFixture:
    def __init__(self, core, *, enabled=False, poll_interval=.05):
        if enabled is not True:
            raise ValueError('Deterministic providers require explicit isolated-test enablement.')
        self.core, self.product = core, load_product(core)
        # Keep the exact production gate; only its read-only restoration input
        # adapts the private fixture's old label. Never install a product alias.
        if getattr(core.resources.jobs, '_studio_fixture_resource_projection', None) != VERSION:
            core.resources.jobs = FixtureResourceLedger(core.resources.jobs)
        self.poll_interval = poll_interval
        self.plan = None
        self.released, self.cancelled = set(), set()
        self.counts, self.events = Counter(), []
        self.restart_count, self.fault_pending = 0, 'none'
        self.control_lock = asyncio.Lock()
        self._compose()

    def _compose(self):
        providers = [FixtureProvider(self, kind) for kind in ('image', 'text')]
        self.service = self.product.service.GenerationService(self.core.jobs, self.core.assets, providers={p.id: p for p in providers}, poll_interval=self.poll_interval, poll_limit=864000, barrier_namespace=VERSION, resources=self.core.resources)
        self.handlers = {(method, path): handler for method, path, handler in self.product.http.routes(self.service)}

    def record(self, action, request_id):
        self.counts[action] += 1
        self.events.append({'sequence': sum(self.counts.values()), 'action': action, 'requestId': request_id})
        if len(self.events) > 1000:
            del self.events[:-1000]

    def arm(self, payload):
        scenario, fault = payload.get('scenario'), payload.get('httpFault', 'none')
        if scenario not in SCENARIOS or fault not in HTTP_FAULTS:
            raise self.product.errors.InvalidInput('Choose a declared fixture scenario and HTTP fault.')
        self.plan = {'scenario': scenario}
        self.fault_pending = fault
        return self.info()

    def jobs(self):
        jobs, offset = [], 0
        while True:
            page = self.core.jobs.list_jobs(limit=500, offset=offset)
            jobs.extend(j for j in page if self.owns(j))
            if len(page) < 500:
                return jobs
            offset += len(page)

    def info(self):
        jobs = self.jobs()
        return {'fixture': VERSION, 'fixtureFingerprint': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'backendFingerprint': self.product.fingerprint, 'armed': self.plan, 'httpFaultPending': self.fault_pending,
                'realProviderHealth': 'not_checked', 'modelInference': False, 'nativeQueueSubmissions': 0,
                'restartCount': self.restart_count, 'counts': dict(self.counts), 'events': list(self.events),
                'jobs': [{**self.service.public(j['request_id']), 'attempts': len(self.core.jobs.attempts(j['request_id']))} for j in jobs]}

    def release(self, request_id):
        job = self.core.jobs.get(request_id)
        if job['snapshot'].get('prepared', {}).get('fixture') != VERSION:
            raise self.product.errors.Conflict('Only an owned fixture task can be released.')
        self.released.add(request_id)
        return self.info()

    @staticmethod
    def owns(job):
        return job['snapshot'].get('prepared', {}).get('fixture') == VERSION or job['snapshot'].get('barrierNamespace') == VERSION

    def require_owned(self, request_id, *, allow_missing=False):
        try:
            job = self.core.jobs.get(request_id)
        except self.product.errors.MissingRecord:
            if allow_missing: return
            raise
        if not self.owns(job):
            raise self.product.errors.Conflict('Fixture cannot inspect or control another provider task.')

    async def restart(self):
        async with self.control_lock:
            # Shared reconciliation is permitted only when no foreign job/worker
            # can be affected. The fixture never infers control over other tasks.
            offset = 0
            while True:
                jobs = self.core.jobs.list_jobs(limit=500, offset=offset)
                if any(j['state'] in {'submitting', 'submitted', 'running', 'fetching'} and j['snapshot'].get('prepared', {}).get('fixture') != VERSION for j in jobs):
                    raise self.product.errors.Conflict('Foreign active task exists; fixture restart was refused.')
                if len(jobs) < 500: break
                offset += len(jobs)
            workers = list(self.service._workers.values())
            for worker in workers:
                worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            await self.service.wait_idle()
            self.core.jobs.reconcile_restart()
            self._compose()
            self.restart_count += 1
            return self.info()

    async def close(self):
        workers = list(self.service._workers.values())
        for worker in workers: worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        await self.service.wait_idle()


def assemble_generation_fixture(core, *, enabled=False, poll_interval=.05):
    return GenerationFixture(core, enabled=enabled, poll_interval=poll_interval)


def fixture_routes(controller):
    from aiohttp import web
    p = controller.product

    def local_request(request):
        try:
            remote = ipaddress.ip_address(request.remote)
            host = urlsplit('http://' + request.host).hostname
            origin = request.headers.get('Origin')
            return remote.is_loopback and host in ('localhost', '127.0.0.1', '::1') and (not origin or urlsplit(origin).netloc == request.host) and request.headers.get('Sec-Fetch-Site') != 'cross-site'
        except (TypeError, ValueError):
            return False

    def guarded(handler):
        async def handle(request):
            if not local_request(request):
                return web.json_response({'error': 'Fixture routes require the explicitly installed loopback test host.'}, status=403)
            try:
                value = await handler(request)
                return value if isinstance(value, web.StreamResponse) else web.json_response(value)
            except p.errors.ContractError as error:
                return web.json_response({'error': str(error), 'code': error.code, 'fixture': VERSION},
                    status=404 if isinstance(error, p.errors.MissingRecord) else 409)
            except (ValueError, KeyError, TypeError):
                return web.json_response({'error': 'Invalid fixture control request.', 'fixture': VERSION}, status=400)
        return handle

    async def info(_request):return controller.info()
    async def control(request):
        payload = await request.json()
        action = payload.get('action')
        if action == 'arm':return controller.arm(payload)
        if action == 'release':return controller.release(payload['requestId'])
        if action == 'restart':return await controller.restart()
        if action == 'recover':
            job=controller.core.jobs.get(payload['requestId'])
            if not controller.owns(job):raise p.errors.Conflict('Only owned fixture jobs can recover.')
            await controller.service.recover(payload['requestId'])
            return controller.info()
        raise p.errors.InvalidInput('Unknown fixture control action.')

    definitions = [('GET', PREFIX + '/state', guarded(info)), ('POST', PREFIX + '/control', guarded(control))]
    for method, path in controller.handlers:
        alias = PREFIX + '/api' + path
        def forward(method=method, path=path):
            async def run(request):
                if method == 'POST':
                    payload = await request.json()
                    if not isinstance(payload, dict): raise p.errors.InvalidInput('Expected a task JSON object.')
                    for request_id in payload.get('requestIds', []): controller.require_owned(request_id)
                    for item in payload.get('jobs', []): controller.require_owned(item.get('requestId'), allow_missing=True)
                    for item in [*payload.get('rows', []), *payload.get('references', [])]:
                        if item.get('requestId'): controller.require_owned(item['requestId'], allow_missing=True)
                    if payload.get('requestId'): controller.require_owned(payload['requestId'], allow_missing=True)
                    filters = {'batchId': payload['batchId']} if payload.get('batchId') else payload.get('target')
                    if 'source' in payload and path.endswith('/generation/status'):
                        source = payload['source']
                        if not isinstance(source, dict) or set(source) != {'documentId', 'tableId', 'nodeId'}:
                            raise p.errors.InvalidInput('Fixture discovery requires an exact source scope.')
                        filters = {key: source[key] for key in ('documentId', 'tableId')}
                    if filters:
                        offset=0
                        while True:
                            jobs=controller.core.jobs.list_jobs(source_filter=filters,limit=500,offset=offset)
                            for job in jobs:controller.require_owned(job['request_id'])
                            if len(jobs)<500:break
                            offset+=len(jobs)
                is_submission = path.endswith('/generation/submit') or path.endswith('/prompt-optimization/advance') or path.endswith('/prompt-optimization/polish')
                fault = controller.fault_pending if is_submission else 'none'
                if is_submission: controller.fault_pending = 'none'
                if fault in ('preflight-429','before-submit-500','input-error','version-mismatch'):
                    status = {'preflight-429':429,'before-submit-500':500,'input-error':400,'version-mismatch':409}[fault]
                    return web.json_response({'fixture':VERSION,'error':'Explicit fixture HTTP fault: '+fault,'code':fault,'submitted':False,
                        'expectedContractVersion':1,'action':'reload_and_compare_build_fingerprints' if fault=='version-mismatch' else 'repair_input' if fault=='input-error' else 'query_original_identity'},status=status)
                response = await controller.handlers[method,path](request)
                if fault == 'after-submit-500' and response.status < 400:
                    return web.json_response({'fixture':VERSION,'error':'Response lost after fixture service accepted the request; query its original ID.','code':'response_lost_after_acceptance'},status=500)
                return response
            return guarded(run)
        definitions.append((method, alias, forward()))
    return definitions


def register_generation_fixture_routes(server, controller):
    owned = getattr(server, '_studio_generation_fixture_routes', None)
    if owned is not None:
        if owned is not controller:raise RuntimeError('Another deterministic fixture already owns these routes.')
        return ()
    definitions = fixture_routes(controller)
    existing = {(r.method,r.path) for r in server.routes if hasattr(r,'path')}
    if any((method,path) in existing for method,path,_handler in definitions):
        raise RuntimeError('Fixture route collision; no handler was replaced.')
    for method,path,handler in definitions:server.routes.route(method,path)(handler)
    server._studio_generation_fixture_routes = controller
    return tuple(path for _method,path,_handler in definitions)
