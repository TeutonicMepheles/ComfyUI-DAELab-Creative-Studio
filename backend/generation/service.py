"""One generation application service for table rows, standalone nodes and text.

All durable facts live in JobLedger. Worker references are lifecycle handles only.
"""
import asyncio
from contextlib import asynccontextmanager
import json
import re
import uuid
import weakref
from datetime import datetime

from ..contracts.errors import Conflict, InvalidInput, InvalidTransition, MissingRecord
from ..contracts.validation import clean_json, digest, identity
from ..jobs.ledger import TERMINAL_STATES
from ..providers.contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from ..providers.parameters import IMAGE_MODEL, VIDEO_MODEL, REFERENCE_VIDEO_MODEL, QWEN_MODEL
from ..providers.comfy_video import SeedanceProvider, MinimaxProvider
from ..providers.comfy_image import ComfyImageProvider
from .media import freeze_reference
from .admission import ResourceAdmission, complete_blocking

MODELS = {IMAGE_MODEL: 'local-qwen-image', VIDEO_MODEL: 'local-h3', QWEN_MODEL: 'local-qwen-text', 'qwen': 'local-qwen-text'}
MODELS.update({'deepseek': 'deepseek-text', 'deepseek-flash': 'deepseek-text'})
MODELS[REFERENCE_VIDEO_MODEL] = 'local-h3-reference'
MODELS.update({model: provider.id for provider in (SeedanceProvider, MinimaxProvider, ComfyImageProvider) for model in provider.models})
_BARRIERS = {'rejected', 'fenced'}
_SCOPE_IDS = {'documentId', 'tableId', 'nodeId', 'recordId', 'fieldId', 'workflowSession', 'groupId'}
_SCOPE_KEYS = _SCOPE_IDS | {'epoch', 'inputVersion', 'inputDigest', 'model', 'createdAt', 'operation', 'groupIndex', 'groupCount'}


class GenerationService:
    def __init__(self, jobs, assets, *, providers=None, admission=None, poll_interval=1.0, poll_limit=3600, barrier_namespace=None, resources=None):
        self.jobs, self.assets = jobs, assets
        self.providers = dict(providers or {})
        self.enabled_remote_providers = set()
        self.admission = admission
        self.resources = resources if resources is not None else ResourceAdmission(jobs=jobs)
        self.poll_interval, self.poll_limit = poll_interval, poll_limit
        self._workers, self._locks = {}, weakref.WeakValueDictionary()
        self._cancel_locks = weakref.WeakValueDictionary()
        self.barrier_namespace = identity(barrier_namespace, 'barrier namespace') if barrier_namespace is not None else None

    def provider(self, provider_id):
        provider = self.providers.get(provider_id)
        if provider is None:
            raise ProviderUnavailable('Provider is not assembled: ' + provider_id)
        return provider

    async def capabilities(self, model):
        provider = self.provider(MODELS.get(model))
        (await complete_blocking(self.check_available, provider))
        capability = getattr(provider, 'capabilities', None)
        if not callable(capability):
            raise ProviderUnavailable('Provider capability inspection is not assembled.')
        return await capability(model)

    def _owner(self, job):
        return self.provider(job['provider'])

    def _lock(self, request_id):
        return self._locks.setdefault(request_id, asyncio.Lock())

    def check_available(self, provider):
        self.resources.check_available(provider.resource)
        if provider.execution_kind == 'local':
            if self.admission is None:
                raise ProviderUnavailable('Shared local GPU admission is not assembled.')
            inspect = getattr(self.admission, 'check_available', None)
            if inspect is not None:
                inspect(provider.resource)
        elif provider.id not in self.enabled_remote_providers and getattr(provider, 'protocol_only', False) is not True:
            raise ProviderUnavailable('Live cloud execution is disabled for this migration.')

    @staticmethod
    def _barrier(job):
        return job['snapshot'].get('preparation') in _BARRIERS

    @staticmethod
    def _correlation_scope(source, *, required=False):
        """Only bounded identity/correlation values may enter a rejection record."""
        required_keys = {'documentId', 'tableId', 'nodeId', 'recordId', 'fieldId', 'inputDigest', 'model'}
        if not isinstance(source, dict) or not required_keys <= set(source):
            if required:
                raise InvalidInput('Sealing requires the complete original generation scope and input digest.')
            return False
        if set(source) - _SCOPE_KEYS:
            if required:
                raise InvalidInput('Sealing source contains unsupported fields.')
            return False
        clean_json(source)
        for key in _SCOPE_IDS & set(source):
            identity(source[key], 'generation source identity')
        for key in {'epoch', 'inputVersion', 'createdAt', 'groupIndex', 'groupCount'} & set(source):
            if not isinstance(source[key], int) or isinstance(source[key], bool) or not 0 <= source[key] <= 2**53 - 1:
                raise InvalidInput('Generation scope counter is invalid.')
        if not isinstance(source['inputDigest'], str) or not re.fullmatch(r'[a-f0-9]{64}', source['inputDigest']):
            raise InvalidInput('Generation input digest must be lowercase SHA-256.')
        if source['model'] not in MODELS or source.get('operation') not in {None, 'standalone-optimization'}:
            raise InvalidInput('Generation scope model or operation is invalid.')
        return True

    def _matching(self, request_id, provider_id, source, request_fingerprint=None):
        job = self.jobs.get(request_id)
        if job['provider'] != provider_id or job['source'] != source:
            raise Conflict('Original request belongs to different provider inputs or source scope.')
        stored = job['snapshot'].get('requestFingerprint')
        if stored is None and not self._barrier(job) and 'input' in job['snapshot']:
            stored = digest({'provider': provider_id, 'input': job['snapshot']['input'], 'source': job['source']})
        if request_fingerprint and stored and stored != request_fingerprint:
            raise Conflict('Original request has different immutable inputs.')
        return job

    def _reserve_barrier(self, request_id, provider_id, source, *, preparation, request_fingerprint=None, optimization_meta=None):
        if optimization_meta is None:
            self._correlation_scope(source, required=True)
        else:
            # Only the optimization facade may supply this already-validated,
            # prompt-free target/digest projection; no transport DTO is persisted.
            if source.get('operation') != 'prompt_optimization':
                raise InvalidInput('Invalid optimization barrier owner.')
            clean_json({'source': source, 'optimizationMeta': optimization_meta})
        snapshot = {'version': 1, 'request_id': request_id, 'preparation': preparation,
                    'clientInputDigest': source['inputDigest'], 'rejectionCode': 'generation_' + preparation}
        if self.barrier_namespace is not None:
            snapshot['barrierNamespace'] = self.barrier_namespace
        if request_fingerprint:
            snapshot['requestFingerprint'] = request_fingerprint
        if optimization_meta is not None:
            snapshot['optimizationMeta'] = optimization_meta
        try:
            job, created = self.jobs.create_or_get(request_id, provider=provider_id, execution_kind='local', snapshot=snapshot, source=source)
        except Conflict:
            job, created = self._matching(request_id, provider_id, source, request_fingerprint), False
        # An automatic preparation rejection cannot cancel a prepared winner.
        # Explicit sealing may cancel an unclaimed pending record by version CAS.
        if job['state'] == 'pending' and (created or self._barrier(job) or preparation == 'fenced'):
            try:
                job = self.jobs.request_cancel(request_id, expected_version=job['version'])['job']
            except (Conflict, InvalidTransition):
                job = self._matching(request_id, provider_id, source, request_fingerprint)
        if job['state'] in TERMINAL_STATES:
            self.resources.release(request_id)
        return job

    async def fence_unsubmitted(self, payload):
        if not isinstance(payload, dict) or set(payload) - {'contractVersion', 'requestId', 'source', 'inputDigest', 'model'}:
            raise InvalidInput('Unsupported generation sealing request.')
        request_id = identity(payload.get('requestId'), 'request ID')
        source = payload.get('source')
        self._correlation_scope(source, required=True)
        model = payload.get('model')
        if model != source['model'] or payload.get('inputDigest') != source['inputDigest']:
            raise Conflict('Sealing must match the immutable original input digest and model.')
        await complete_blocking(self._reserve_barrier, request_id, MODELS[model], source, preparation='fenced')
        return await complete_blocking(self.public, request_id)

    async def prepare_batch(self, items):
        if not isinstance(items, list) or not items or len(items) > 500:
            raise InvalidInput('Submit between 1 and 500 explicitly selected tasks.')
        planned, seen = [], set()
        for item in items:
            request_id = identity(item.get('requestId'), 'request ID')
            if request_id in seen:
                raise InvalidInput('Duplicate request identity in the selected batch.')
            seen.add(request_id)
            data = json.loads(clean_json(item.get('input')))
            source = json.loads(clean_json(item.get('source') or {k: data[k] for k in ('documentId', 'tableId', 'recordId', 'fieldId') if k in data}))
            if not isinstance(data, dict):
                raise InvalidInput('Task input must be a JSON object.')
            provider_id = MODELS.get(data.get('config', {}).get('model', data.get('model')))
            if provider_id is None:
                raise ProviderUnavailable('Model is not an allowed local provider; no cloud or legacy fallback.')
            if self._correlation_scope(source) and MODELS[source['model']] != provider_id:
                raise InvalidInput('Generation source model does not match the selected input provider.')
            request_fingerprint = digest({'provider': provider_id, 'input': data, 'source': source})
            try:
                existing = (await complete_blocking(self.jobs.get, request_id))
            except MissingRecord:
                existing = None
            if existing:
                if (existing['provider'] != provider_id or existing['source'] != source or
                        (self._barrier(existing) and existing['snapshot'].get('requestFingerprint', request_fingerprint) != request_fingerprint) or
                        (not self._barrier(existing) and existing['snapshot']['input'] != data)):
                    raise Conflict('Request identity already belongs to different frozen inputs or source.')
                planned.append((existing, None, None))
                continue
            try:
                provider = self.provider(provider_id)
                (await complete_blocking(self.check_available, provider))
                media_items = data.get('assets', [])
                if not isinstance(media_items, list) or len(media_items) > 32:
                    raise InvalidInput('Task has too many or invalid reference assets.')
                media = [await complete_blocking(freeze_reference, self.assets, value) for value in media_items]
                prepared = await complete_blocking(provider.build, data, media, request_id)
                snapshot = {'version': 1, 'preparation': 'ready', 'requestFingerprint': request_fingerprint, 'resource': provider.resource,
                            'request_id': request_id, 'input': data, 'media': media, 'prepared': prepared}
                clean_json(snapshot)
                await provider.preflight(snapshot)
            except (InvalidInput, ProviderUnavailable, SubmissionRejected):
                if self._correlation_scope(source):
                    prior = (await complete_blocking(self._reserve_barrier, request_id, provider_id, source, preparation='rejected', request_fingerprint=request_fingerprint))
                    if not self._barrier(prior):
                        planned.append((prior, None, None))
                        continue
                raise
            planned.append((None, snapshot, source))
        # A malformed selected row cannot submit any of its valid neighbours.
        results = []
        for old, snapshot, source in planned:
            if old:
                results.append(old)
            else:
                provider_id = MODELS.get(snapshot['input'].get('config', {}).get('model', snapshot['input'].get('model')))
                provider = self.provider(provider_id)
                try:
                    job, _ = (await complete_blocking(self.jobs.create_or_get, snapshot['request_id'], provider=provider_id, execution_kind=provider.execution_kind, snapshot=snapshot, source=source))
                except Conflict:
                    job = await complete_blocking(self._matching, snapshot['request_id'], provider_id, source, snapshot['requestFingerprint'])
                    if not self._barrier(job):
                        raise
                results.append(job)
        return results

    async def submit(self, items):
        jobs = await self.prepare_batch(items)
        for job, item in zip(jobs, items):
            if item.get('recovery'):
                self._schedule(job['request_id'], self.recover(job['request_id']))
            elif job['state'] == 'pending' and not self._barrier(job):
                self._schedule(job['request_id'], self.dispatch(job['request_id']))
        return [await complete_blocking(self.public, job['request_id']) for job in jobs]

    def _schedule(self, request_id, coroutine):
        if request_id in self._workers and not self._workers[request_id].done():
            coroutine.close()
            return
        task = asyncio.create_task(coroutine)
        self._workers[request_id] = task
        def completed(worker):
            if self._workers.get(request_id) is worker:
                self._workers.pop(request_id, None)
            if not worker.cancelled():
                worker.exception()  # facts and error codes are already retained in the ledger
        task.add_done_callback(completed)

    async def wait_idle(self):
        while self._workers:
            current = list(self._workers.items())
            await asyncio.gather(*(task for _key, task in current), return_exceptions=True)
            # Already-done task callbacks may not run before an already-resolved
            # gather. Retire those handles here rather than starving callbacks.
            for key, task in current:
                if task.done() and self._workers.get(key) is task:
                    self._workers.pop(key, None)

    def _transition(self, job, state, *, result=None, error_code=None, task_id=None):
        return self.jobs.transition(job['request_id'], state, expected_version=job['version'], event_id='event:' + uuid.uuid4().hex,
                                    provider_task_id=task_id, result=result, error_code=error_code)

    @asynccontextmanager
    async def _lease(self, provider, request_id):
        async with self.resources.lease(provider.resource, request_id=request_id) as permit:
            try:
                if provider.execution_kind == 'local':
                    if self.admission is None:
                        raise ProviderUnavailable('Shared local GPU admission is not assembled.')
                    async with self.admission.lease(provider.resource):
                        yield
                else:
                    if provider.id not in self.enabled_remote_providers and getattr(provider, 'protocol_only', False) is not True:
                        raise ProviderUnavailable('Live cloud execution is disabled for this migration.')
                    yield
            finally:
                if provider.execution_kind != 'local':
                    # Lost acknowledgements and failed queries do not prove the
                    # remote execution stopped. Preserve capacity until recovery
                    # observes a terminal fact, including across service restart.
                    permit.retain()
                    await complete_blocking(self._settle_permit, permit, request_id)

    def _settle_permit(self, permit, request_id):
        job = self.jobs.get(request_id)
        if job['state'] in TERMINAL_STATES or job['attempt'] == 0:
            permit.release()

    async def _release_terminal_capacity(self, request_id):
        # Read and release in the same non-cancellable worker callback: another
        # caller cancellation cannot split this cleanup after the durable commit.
        def settle():
            job = self.jobs.get(request_id)
            if job['state'] in TERMINAL_STATES:
                self.resources.release(request_id)
        await complete_blocking(settle)

    async def dispatch(self, request_id, *, before_submit=None):
        async with self._lock(request_id):
            job = (await complete_blocking(self.jobs.get, request_id))
            if job['state'] != 'pending' or self._barrier(job):
                return job
            provider = self._owner(job)
            try:
                async with self._lease(provider, request_id):
                    job = (await complete_blocking(self.jobs.get, request_id))
                    if job['state'] != 'pending' or job['cancel_requested']:
                        return job
                    if before_submit is not None and not before_submit():
                        return job
                    await provider.preflight(job['snapshot'])
                    for media in job['snapshot']['media']:
                        checked = (await complete_blocking(self.assets.validate_reference, media['reference_id']))
                        if not checked['usable'] or checked['content_sha256'] != media['sha256']:
                            raise SubmissionRejected('Frozen input is unavailable.')
                    if before_submit is not None and not before_submit():
                        return (await complete_blocking(self.jobs.get, request_id))
                    job = (await complete_blocking(self.jobs.begin_submission, request_id, expected_version=job['version']))
                    # The durable claim may have waited on SQLite in a worker.
                    # Recheck loop-owned permission after that await, before any
                    # external call. A claim alone is not provider execution.
                    job = await complete_blocking(self.jobs.get, request_id)
                    if job['cancel_requested'] or before_submit is not None and not before_submit():
                        return await complete_blocking(self._transition, job, 'failed', error_code='stopped_before_provider_create')
                    try:
                        observation = await provider.create(request_id, job['snapshot'])
                    except (SubmissionRejected, ProviderUnavailable):
                        return (await complete_blocking(self._transition, (await complete_blocking(self.jobs.get, request_id)), 'failed', error_code='definitely_rejected'))
                    except BaseException as error:
                        return (await complete_blocking(self._transition, (await complete_blocking(self.jobs.get, request_id)), 'unknown', error_code='submission_unknown', task_id=getattr(error, 'task_id', None)))
                    job = await self._observe((await complete_blocking(self.jobs.get, request_id)), observation)
                    for _ in range(self.poll_limit):
                        if job['state'] in TERMINAL_STATES or job['state'] in {'unknown', 'needs_recovery'}:
                            return job
                        if not provider.supports_query:
                            return (await complete_blocking(self._transition, job, 'needs_recovery', error_code='query_unavailable'))
                        await asyncio.sleep(self.poll_interval)
                        job = await self._query((await complete_blocking(self.jobs.get, request_id)), provider)
                    return (await complete_blocking(self._transition, (await complete_blocking(self.jobs.get, request_id)), 'needs_recovery', error_code='tracking_limit'))
            except Exception:
                current = (await complete_blocking(self.jobs.get, request_id))
                if current['state'] == 'pending':
                    claimed = (await complete_blocking(self.jobs.begin_submission, request_id, expected_version=current['version']))
                    return (await complete_blocking(self._transition, claimed, 'failed', error_code='preflight_unavailable'))
                if current['state'] == 'submitting':
                    return (await complete_blocking(self._transition, current, 'unknown', error_code='submission_observation_invalid'))
                # Release failure quarantines admission; do not regress a validated terminal fact.
                if current['state'] not in TERMINAL_STATES and current['state'] not in {'unknown', 'needs_recovery'}:
                    return (await complete_blocking(self._transition, current, 'needs_recovery', error_code='tracking_unavailable'))
                return current

    async def _observe(self, job, observation):
        if not isinstance(observation, Observation) or observation.state not in {'submitted', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'}:
            raise InvalidInput('Provider returned an invalid observation.')
        if job['provider_task_id'] and observation.task_id != job['provider_task_id']:
            raise Conflict('Observation belongs to another native/provider execution.')
        if job['state'] in TERMINAL_STATES:
            return job
        if observation.state == 'unknown':
            if job['state'] in {'submitting', 'needs_recovery'}:
                return (await complete_blocking(self._transition, job, 'unknown', task_id=observation.task_id, error_code='original_execution_unknown'))
            return (await complete_blocking(self._transition, job, 'needs_recovery', error_code='original_execution_missing'))
        deferred_cancel = not job['provider_task_id'] and job['state'] in {'submitting', 'unknown'}
        if job['state'] in {'submitting', 'unknown'}:
            job = await complete_blocking(self._remember_submission, job, observation.task_id)
        if job['state'] in TERMINAL_STATES:
            return job
        # A cancel intent can commit while create/ACK persistence is in flight,
        # before any provider task ID is available to the cancelling caller.
        # Once that same receipt is durable, deliver the deferred intent once.
        # A completed observation wins without attempting to cancel its result.
        if deferred_cancel and job['cancel_requested'] and observation.state in {'submitted', 'running'}:
            job = await self._cancel(job['request_id'])
            if job['state'] in TERMINAL_STATES:
                return job
        if observation.state == 'cancelled':
            if not job['cancel_requested']:
                return (await complete_blocking(self._transition, job, 'failed', error_code='native_execution_stopped'))
            return await complete_blocking(self._confirm_cancelled, job['request_id'], provider_id=job['provider'], task_id=observation.task_id, confirmation='owned_native_execution_stopped' if job['execution_kind'] == 'local' else 'provider_cancelled')
        if observation.state == 'failed':
            return (await complete_blocking(self._transition, job, 'failed', error_code=observation.error_code or 'provider_failed'))
        if observation.state in {'submitted', 'running'}:
            if job['state'] in {'submitted', 'needs_recovery'} and observation.state == 'running':
                return (await complete_blocking(self._transition, job, 'running'))
            return job
        if job['state'] != 'fetching':
            job = (await complete_blocking(self._transition, job, 'fetching'))
        def finish():
            if observation.text is not None:
                receipt = {'kind': 'text', 'text': observation.text, 'metadata': observation.metadata}
            else:
                refs = []
                for file in observation.files:
                    if file.get('root') != 'output':
                        raise InvalidInput('Generated media must be inside the configured output root.')
                    # Native Windows receipts can use backslashes or a different
                    # directory case. Match the catalog's rooted canonical path,
                    # which also performs the existing traversal/containment checks.
                    _file, relative = self.assets.resolve_reference('output', file['path'])
                    asset = self.assets.register_file('output', relative, kind=file['kind'], provenance={'request_id': job['request_id'], 'provider_task_id': observation.task_id})
                    refs.append(next(r['reference_id'] for r in asset['references'] if r['root_key'] == 'output' and r['relative_path'] == relative))
                receipt = self.assets.result_receipt(refs)
            current = self.jobs.get(job['request_id'])
            if current['state'] in TERMINAL_STATES:
                return current
            return self._transition(current, 'succeeded', result=receipt)
        try:
            return await complete_blocking(finish)
        except Exception:
            return (await complete_blocking(self._transition, (await complete_blocking(self.jobs.get, job['request_id'])), 'needs_recovery', error_code='result_unverified'))

    def _remember_submission(self, original, task_id):
        """Persist the received ACK across cancel-intent CAS updates, no create."""
        event_id = 'submitted:' + uuid.uuid4().hex
        for _ in range(8):
            current = self.jobs.get(original['request_id'])
            if (current['provider'] != original['provider'] or current['fingerprint'] != original['fingerprint'] or
                    current['attempt'] != original['attempt'] or current['provider_task_id'] not in {None, task_id}):
                raise Conflict('Submission receipt belongs to a different original execution.')
            if current['state'] in TERMINAL_STATES or current['state'] not in {'submitting', 'unknown'}:
                return current
            try:
                return self.jobs.mark_submitted(current['request_id'], task_id,
                    expected_version=current['version'], event_id=event_id)
            except Conflict:
                continue
        raise Conflict('Original submission receipt is contended; reconcile the same request identity.')

    async def _query(self, job, provider):
        try:
            observation = await provider.query(job['provider_task_id'], job['snapshot'])
            return await self._observe((await complete_blocking(self.jobs.get, job['request_id'])), observation)
        except Exception:
            current = (await complete_blocking(self.jobs.get, job['request_id']))
            if current['state'] in {'submitted', 'running', 'fetching'}:
                return (await complete_blocking(self._transition, current, 'needs_recovery', error_code='query_unavailable'))
            return current

    async def recover(self, request_id):
        try:
            return await self._recover(request_id)
        finally:
            await self._release_terminal_capacity(request_id)

    async def _recover(self, request_id):
        async with self._lock(request_id):
            job = (await complete_blocking(self.jobs.get, request_id))
            if job['state'] in TERMINAL_STATES or job['state'] == 'pending':
                return job
            provider = self._owner(job)
            action = (await complete_blocking(self.jobs.recovery_action, request_id, supports_query=provider.supports_query, supports_idempotency_lookup=provider.supports_lookup))['action']
            if action == 'manual_reconciliation':
                return job
            if job['state'] in {'unknown', 'needs_recovery', 'fetching'}:
                job = (await complete_blocking(self.jobs.claim_recovery, request_id, expected_version=job['version']))
            if action == 'lookup_original_request':
                observation = await provider.lookup(request_id, job['snapshot'])
                return await self._observe(job, observation) if observation is not None else job
            return await self._query(job, provider)

    async def retry_local(self, request_id, new_request_id):
        """Explicit new execution after a confirmed stop; never recovery replay."""
        original = (await complete_blocking(self.jobs.get, request_id))
        if self._barrier(original):
            raise InvalidTransition('A sealed preparation has no executable input; explicitly submit fresh validated inputs under a new identity.')
        if original['execution_kind'] != 'local' or original['state'] not in {'failed', 'cancelled'}:
            raise InvalidTransition('Only a confirmed failed/stopped local task can explicitly run again.')
        identity(new_request_id, 'new request ID')
        if new_request_id == request_id:
            raise Conflict('An explicit local rerun requires a new request identity.')
        data = json.loads(clean_json(original['snapshot']['input']))
        data['assets'] = [{'reference_id': item['reference_id']} for item in original['snapshot']['media']]
        resolved = original['snapshot']['prepared'].get('settings')
        if resolved is not None:
            data['config']['settings'] = dict(resolved)
        item = {'requestId': new_request_id, 'input': data,
                'source': {**original['source'], 'previous_request_id': request_id}}
        return (await self.submit([item]))[0]

    async def cancel(self, request_id):
        try:
            return await self._cancel(request_id)
        finally:
            await self._release_terminal_capacity(request_id)

    async def _cancel(self, request_id):
        # Separate from the long-lived dispatch lock. An ACK's deferred intent
        # and an explicit cancel may meet; a confirmed first cancellation wins.
        lock = self._cancel_locks.setdefault(request_id, asyncio.Lock())
        async with lock:
            return await self._cancel_owned(request_id)

    async def _cancel_owned(self, request_id):
        # Does not wait for the long-running worker's lock: cancellation is intent.
        for attempt in range(3):
            job = (await complete_blocking(self.jobs.get, request_id))
            if job['state'] in TERMINAL_STATES:
                return job
            if self._barrier(job):
                return (await complete_blocking(self.jobs.request_cancel, request_id, expected_version=job['version']))['job']
            provider = self._owner(job)
            if job['cancel_requested']:
                outcome = {'job': job}
                break  # Repeated intent does not churn the ACK's optimistic version.
            try:
                outcome = (await complete_blocking(self.jobs.request_cancel, request_id, expected_version=job['version'], supports_remote_cancel=provider.supports_cancel))
                break
            except Conflict:
                if attempt == 2:
                    raise
        job = outcome['job']
        if job['state'] in TERMINAL_STATES or not job['provider_task_id'] or not provider.supports_cancel:
            return job
        confirmed = await provider.cancel(job['provider_task_id'], job['snapshot'])
        if confirmed is True:
            return await complete_blocking(self._confirm_cancelled, request_id, provider_id=job['provider'],
                task_id=job['provider_task_id'], confirmation='owned_native_execution_stopped' if job['execution_kind'] == 'local' else 'provider_cancelled')
        return (await complete_blocking(self.jobs.get, request_id))

    def _confirm_cancelled(self, request_id, *, provider_id, task_id, confirmation):
        """CAS against fresh facts without repeating the external cancellation.

        The normal observer can advance the same job while cancellation is in
        flight. Only its original provider/task may use this confirmation; an
        already-committed terminal result wins and must never be regressed.
        """
        def current_identity():
            current = self.jobs.get(request_id)
            if current['provider'] != provider_id or current['provider_task_id'] != task_id:
                raise Conflict('Cancellation confirmation belongs to a different provider task.')
            return current
        for _ in range(8):
            current = current_identity()
            if current['state'] in TERMINAL_STATES:
                return current
            if not current['cancel_requested']:
                raise InvalidTransition('The original task has no cancellation intent.')
            try:
                return self.jobs.confirm_cancelled(request_id, expected_version=current['version'],
                    provider_task_id=task_id, confirmation=confirmation)
            except Conflict:
                continue
        # Do not turn unbounded contention into a false cancellation or release.
        # Return the durable original fact; its observer/recovery can reconcile it.
        return current_identity()

    def completed_result(self, request_id):
        job = self.jobs.get(request_id)
        if job['state'] != 'succeeded':
            raise InvalidTransition('The original task has no verified completed result.')
        if job['result']['kind'] == 'assets':
            # Decode was required before committing success. Identical file bytes
            # prove that decode remains applicable, without decoding every poll.
            self.assets.validate_result_receipt(job['result'])
        return job['result']

    def public(self, request_id):
        job = self.jobs.get(request_id)
        phases = {'pending': 'waiting', 'submitting': 'running', 'submitted': 'running', 'running': 'running', 'fetching': 'running', 'succeeded': 'complete', 'cancelled': 'paused', 'unknown': 'needs_recovery'}
        result = {'requestId': request_id, 'phase': phases.get(job['state'], job['state']), 'state': job['state'], 'version': job['version'], 'taskId': job['provider_task_id'], 'error': job['error_code'] or '',
                  'updatedAt': int(datetime.fromisoformat(job['updated_at']).timestamp() * 1000), 'inputFingerprint': job['fingerprint'], 'source': job['source']}
        result['replacementAllowed'] = job['state'] == 'cancelled' and job['cancel_requested'] and job['attempt'] == 0
        if self._barrier(job):
            result.update(preparation=job['snapshot']['preparation'], error=job['snapshot']['rejectionCode'],
                          phase='needs_input' if result['replacementAllowed'] else 'needs_recovery')
        if job['cancel_requested'] and job['state'] not in TERMINAL_STATES:
            result['phase'] = 'pausing'
        if job['state'] == 'succeeded':
            try:
                receipt = self.completed_result(request_id)
                result['receipt'] = receipt
                if receipt['kind'] == 'text':
                    result['result'] = receipt['text']
                else:
                    from urllib.parse import urlencode
                    item = receipt['items'][0]
                    asset = self.assets.get(item['asset_id'])
                    ref = next(r for r in asset['references'] if r['reference_id'] == item['reference_id'])
                    from pathlib import PurePosixPath
                    path = PurePosixPath(ref['relative_path'])
                    result['result'] = {'url': '/view?' + urlencode({'filename': path.name, 'subfolder': str(path.parent) if str(path.parent) != '.' else '', 'type': ref['root_key']}), 'kind': asset['kind'], 'name': path.name, **item}
            except Exception:
                result.update(phase='needs_recovery', error='result_missing_or_changed')
        return result
