"""Ledger-backed CPU exports executed exclusively by the native Comfy queue.

This service owns no worker, scheduler, in-memory task registry or recovery retry.
The native node calls execute(); HTTP only prepares, queues and observes identities.
"""
import asyncio
import copy
import json
import os
import re
import time
import uuid
from pathlib import Path

from av.error import FFmpegError

from ..contracts.errors import Conflict, InvalidInput, InvalidTransition, MissingRecord
from ..contracts.validation import clean_json, digest, identity
from ..jobs.ledger import TERMINAL_STATES
from ..generation.admission import ResourceAdmission, complete_blocking
from ..providers.contracts import ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from .video_edit_media import edit_clips, media_info, render

PROVIDER = 'native-video-edit'
MARKER = '__creativeStudioExport'


class ExportCancelled(InterruptedError):
    pass


class ExportService:
    def __init__(self, jobs, assets, *, native_queue=None, resources=None):
        self.jobs, self.assets, self.native_queue = jobs, assets, native_queue
        self.resources = resources if resources is not None else ResourceAdmission(jobs=jobs)

    @staticmethod
    def _native_id(request_id):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:export:' + request_id))

    def _owned(self, request_id):
        job = self.jobs.get(request_id)
        if job['provider'] != PROVIDER or job['execution_kind'] != 'media' or job['source'].get('operation') != 'video_export':
            raise Conflict('The request belongs to a different operation; it cannot be exported or cancelled here.')
        return job

    @staticmethod
    def _request(request_id, edit_data, connections=None, source=None, native=None):
        identity(request_id, 'export request ID')
        try:
            edit = json.loads(edit_data) if isinstance(edit_data, str) else copy.deepcopy(edit_data)
        except (ValueError, TypeError):
            raise InvalidInput('Export requires valid edit_data JSON.') from None
        if not isinstance(edit, dict) or MARKER in edit:
            raise InvalidInput('The export marker is reserved for the native queue adapter.')
        connections, source = copy.deepcopy(connections or {}), copy.deepcopy(source or {})
        if not isinstance(connections, dict) or set(connections) - {'assets', 'videos', 'images', 'groups'}:
            raise InvalidInput('Only the existing VideoEdit connections are accepted.')
        if not isinstance(source, dict) or set(source) - {'documentId', 'nodeId', 'tableId', 'inputDigest'}:
            raise InvalidInput('Export source accepts documentId, nodeId, tableId and inputDigest only.')
        if 'inputDigest' in source and (not isinstance(source['inputDigest'], str) or not re.fullmatch(r'[a-f0-9]{64}', source['inputDigest'])):
            raise InvalidInput('Client input digest must be a lowercase SHA-256 correlation value.')
        for field in ('documentId', 'nodeId', 'tableId'):
            if field in source:
                identity(source[field], 'export source identity')
        clean_json({'edit': edit, 'connections': connections, 'source': source})
        request_fingerprint = digest({'edit': edit, 'connections': connections, 'source': source, 'native': native})
        return edit, connections, source, request_fingerprint

    def prepare(self, request_id, edit_data, *, connections=None, source=None, native=None):
        edit, connections, source, request_fingerprint = self._request(request_id, edit_data, connections, source, native)
        # Repeat requests retain the frozen bytes even if a live file subsequently changes.
        try:
            prior = self._owned(request_id)
        except MissingRecord:
            prior = None
        if prior:
            if prior['snapshot']['requestFingerprint'] != request_fingerprint:
                raise Conflict('Export request ID already identifies different editing data.')
            return prior
        try:
            clips, fit = edit_clips(edit, roots=self.assets.roots, **connections)
        except (ValueError, TypeError, KeyError, OSError, FFmpegError):
            raise InvalidInput('Export clips or rooted media references are invalid.') from None
        frozen_clips = []
        for index, clip in enumerate(clips):
            ref = clip['asset']
            relative = '/'.join(p for p in (ref.get('subfolder', ''), ref['filename']) if p and p != '.')
            asset = self.assets.register_file(ref['type'], relative, kind=ref['kind'],
                provenance={'operation': 'video_export_input', 'request_id': request_id, 'clipIndex': index})
            reference = next(r for r in asset['references'] if r['root_key'] == ref['type'] and r['relative_path'] == relative)
            frozen = self.assets.freeze(reference['reference_id'])
            info = media_info({'filename': frozen['filename'], 'type': 'frozen'}, roots=self.assets.roots)
            # Detect replacement between metadata inspection and freezing, not just during copy.
            if any(info[key] != ref[key] for key in ('kind', 'width', 'height', 'fps', 'duration', 'has_audio')):
                raise Conflict('Media changed while the export snapshot was being prepared.')
            frozen_clips.append({**clip, 'asset': info, 'frozen': frozen})
        native_info = native or {'promptId': self._native_id(request_id), 'nodeId': 'save', 'listIndex': 0}
        snapshot = {'schemaVersion': 1, 'preparation': 'ready', 'resource': 'transcode', 'requestFingerprint': request_fingerprint, 'edit': edit,
                    'connections': connections, 'clips': frozen_clips, 'fit': fit,
                    'native': native_info, 'dispatch': 'native' if native else 'http',
                    'output': f'DAELAB/edits/{self._native_id(request_id)}.mp4'}
        try:
            job, _ = self.jobs.create_or_get(request_id, provider=PROVIDER, execution_kind='media', snapshot=snapshot,
                                            source={**source, 'operation': 'video_export'})
        except Conflict:
            prior = self._owned(request_id)
            if prior['snapshot'].get('preparation') != 'rejected' or prior['snapshot']['requestFingerprint'] != request_fingerprint:
                raise
            return prior  # A concurrent rejection won identity reservation: never queue it.
        return job

    def _reject_preparation(self, request_id, source, request_fingerprint):
        """Reserve a non-executable identity before reporting a proven rejection.

        No media/prompt/exception text is copied into this discriminated snapshot.
        Only this call's newly-created pending rejection may be cancelled here.
        A crash between commits leaves a non-executable pending record for explicit
        owned cancellation, never an implicit retry permission.
        """
        snapshot = {'schemaVersion': 1, 'preparation': 'rejected', 'requestFingerprint': request_fingerprint,
                    'clientInputDigest': source['inputDigest'], 'rejectionCode': 'export_input_rejected',
                    'native': {'promptId': self._native_id(request_id), 'nodeId': 'save', 'listIndex': 0}, 'dispatch': 'http'}
        try:
            job, created = self.jobs.create_or_get(request_id, provider=PROVIDER, execution_kind='media', snapshot=snapshot,
                                                  source={**source, 'operation': 'video_export'})
        except Conflict:
            prior = self._owned(request_id)
            if prior['snapshot']['requestFingerprint'] != request_fingerprint or prior['source'] != {**source, 'operation': 'video_export'}:
                raise
            return prior  # Prepared/active original facts always win; do not cancel them.
        if created:
            try:
                return self.jobs.request_cancel(request_id, expected_version=job['version'])['job']
            except (Conflict, InvalidTransition):
                return self._owned(request_id)
        return job

    def _transition(self, job, state, **kwargs):
        return self.jobs.transition(job['request_id'], state, expected_version=job['version'],
                                    event_id=f'export:{state}:{job["version"] + 1}', **kwargs)

    def _submitted(self, job):
        return self.jobs.mark_submitted(job['request_id'], self._native_id(job['request_id']),
                expected_version=job['version'], event_id=f'export:submitted:{job["version"] + 1}')

    async def submit(self, request_id, edit_data, *, connections=None, source=None):
        if self.native_queue is None:
            raise ProviderUnavailable('The native export queue has not been injected.')
        # Validate credentials/scope/JSON BEFORE any rejected identity may be stored.
        _edit, _connections, safe_source, request_fingerprint = await complete_blocking(self._request, request_id, edit_data, connections, source)
        try:
            job = await complete_blocking(self.prepare, request_id, edit_data, connections=connections, source=source)
        except InvalidInput:
            if not {'documentId', 'nodeId', 'inputDigest'} <= set(safe_source):
                raise  # Older callers without verified owner/digest receive no rejection record.
            return await complete_blocking(self._reject_preparation, request_id, safe_source, request_fingerprint)
        if job['snapshot'].get('preparation') == 'rejected':
            return job  # Includes interrupted pending rejection: never reaches native queue.
        if job['state'] != 'pending':
            return job  # Never replay submitted, uncertain or terminal requests.
        graph = {'save': {'class_type': 'DAELAB.VideoEdit', 'inputs': {'edit_data': clean_json({
            **job['snapshot']['edit'], MARKER: {'requestId': request_id, 'fingerprint': job['fingerprint']}})}}}
        # Validation is read-only and occurs before the durable submission claim.
        try:
            await self.native_queue.validate(self._native_id(request_id), graph)
        except SubmissionRejected:
            # This is already a normal prepared identity. Another caller may own
            # it; preflight must not cancel or replace its durable facts.
            raise SubmissionUncertain('Native validation rejected this attempt; inspect or explicitly cancel the original prepared identity.') from None
        try:
            job = await complete_blocking(self.jobs.begin_submission, request_id, expected_version=job['version'])
        except (Conflict, InvalidTransition):
            return await complete_blocking(self._owned, request_id)
        try:
            await self.native_queue.enqueue(self._native_id(request_id), graph, owner=request_id)
        except BaseException as exc:
            current = await complete_blocking(self._owned, request_id)
            if current['state'] == 'submitting':
                try:
                    await complete_blocking(self._transition, current,
                        'failed' if isinstance(exc, SubmissionRejected) else 'unknown',
                        provider_task_id=self._native_id(request_id),
                        error_code='native_queue_rejected' if isinstance(exc, SubmissionRejected) else 'native_submission_unknown')
                except Conflict:
                    pass  # Native execution may already have advanced the same identity.
            if isinstance(exc, SubmissionRejected):
                current = await complete_blocking(self._owned, request_id)
                if current['state'] != 'failed':
                    raise SubmissionUncertain('The original native task may already be executing; inspect its durable identity.') from None
            raise
        current = await complete_blocking(self._owned, request_id)
        if current['state'] == 'submitting':
            try:
                current = await complete_blocking(self._submitted, current)
            except Conflict:
                current = await complete_blocking(self._owned, request_id)
        return current

    def execute(self, edit_data, *, context, connections=None, check=lambda: None, progress=lambda *_: None):
        """Called on the host's native execution thread, never on the HTTP loop."""
        if context is None or not getattr(context, 'prompt_id', None) or not getattr(context, 'node_id', None):
            raise ProviderUnavailable('Native execution context is required for an owned export.')
        native = {'promptId': str(context.prompt_id), 'nodeId': str(context.node_id),
                  'listIndex': getattr(context, 'list_index', None)}
        edit = json.loads(edit_data)
        marker = edit.get(MARKER) if isinstance(edit, dict) else None
        if marker is not None:
            if not isinstance(marker, dict) or set(marker) != {'requestId', 'fingerprint'}:
                raise InvalidInput('Invalid native export reference.')
            job = self._owned(marker['requestId'])
            if job['snapshot'].get('preparation') == 'rejected':
                raise InvalidTransition('A rejected preparation is not an executable export snapshot.')
            expected_edit = {**job['snapshot']['edit'], MARKER: marker}
            if (job['snapshot']['dispatch'] != 'http' or job['snapshot']['native'] != native
                    or marker['fingerprint'] != job['fingerprint'] or edit != expected_edit
                    or any(value for value in (connections or {}).values())):
                raise Conflict('Native export execution does not match its frozen request and owner.')
        else:
            request_id = 'native-export:' + digest(native)
            job = self.prepare(request_id, edit, connections=connections, native=native)
        request_id = job['request_id']
        if job['state'] == 'succeeded':
            return self.output(job)
        if job['state'] == 'pending' and job['snapshot']['dispatch'] == 'native':
            job = self.jobs.begin_submission(request_id, expected_version=job['version'])
        if job['state'] == 'submitting' or marker is not None and job['state'] == 'unknown':
            job = self._submitted(job)
        if job['state'] != 'submitted':
            raise InvalidTransition('This export has already executed or requires reconciliation; it cannot render again.')
        def queued_check():
            check()
            current = self._owned(request_id)
            if current['cancel_requested'] or current['state'] == 'cancelled':
                raise ExportCancelled('The queued export was cancelled before rendering.')
            if current['state'] != 'submitted':
                raise InvalidTransition('Export ownership changed before rendering.')
        try:
            with self.resources.lease_sync('transcode', request_id=request_id, check=queued_check, resume_retained=True):
                return self._render_owned(self._owned(request_id), check=check, progress=progress)
        except ExportCancelled:
            current = self._owned(request_id)
            if current['state'] not in TERMINAL_STATES:
                self._confirm_cancel(current)
            raise

    def _render_owned(self, job, *, check, progress):
        request_id = job['request_id']
        job = self._transition(job, 'running')  # Single optimistic winner may enter the renderer.
        output, _ = self.assets.resolve_reference('output', job['snapshot']['output'], must_exist=False)
        staging = output.with_name('.' + uuid.uuid4().hex + '.part.mp4')
        last_check = [0.0]
        def owned_check(force=False):
            check()
            now = time.monotonic()
            if force or now - last_check[0] >= .1:
                last_check[0] = now
                current = self._owned(request_id)
                if current['cancel_requested']:
                    raise ExportCancelled('The owned export was cancelled.')
                if current['state'] != 'running':
                    raise InvalidTransition('Export execution ownership changed; rendering stopped.')
        try:
            owned_check(True)
            for clip in job['snapshot']['clips']:
                frozen = clip['frozen']
                checked = self.assets.validate_reference(frozen['reference_id'])
                if not checked['usable'] or checked['content_sha256'] != frozen['sha256']:
                    raise Conflict('Frozen export input was changed or removed.')
            if output.exists():
                raise Conflict('An output already exists for this request; it will not be overwritten or treated as a new render.')
            output.parent.mkdir(parents=True, exist_ok=True)
            render(job['snapshot']['clips'], staging, roots=self.assets.roots, fit=job['snapshot']['fit'],
                   resolution=job['snapshot']['edit'].get('resolution'), check=owned_check, progress=progress)
            owned_check(True)
            # Publish only a completed render, never replacing a pre-existing output.
            os.link(staging, output)
            staging.unlink()
            return self.output(self._finish(request_id))
        except BaseException as exc:
            staging.unlink(missing_ok=True)
            current = self._owned(request_id)
            if current['state'] not in TERMINAL_STATES:
                if isinstance(exc, ExportCancelled) or current['cancel_requested']:
                    self._confirm_cancel(current)
                elif current['state'] == 'running':
                    self._transition(current, 'failed', error_code='media_export_failed')
                # A fetching receipt is durable recovery evidence; preserve it after failure.
            raise

    def _finish(self, request_id):
        job = self._owned(request_id)
        if job['state'] in TERMINAL_STATES:
            return job
        receipt = job['result']
        if not receipt:
            _file, relative = self.assets.resolve_reference('output', job['snapshot']['output'])
            asset = self.assets.register_file('output', relative, kind='video',
                provenance={'operation': 'video_export', 'request_id': request_id,
                            'fingerprint': job['fingerprint'], 'native': job['snapshot']['native']})
            ref = next(r for r in asset['references'] if r['root_key'] == 'output' and r['relative_path'] == relative)
            receipt = self.assets.result_receipt([ref['reference_id']])
            job = self._transition(job, 'fetching', result=receipt)
        elif job['state'] != 'fetching':
            job = self._transition(job, 'fetching', result=receipt)
        return self._transition(job, 'succeeded', result=receipt)

    def output(self, job):
        if job['state'] != 'succeeded':
            raise InvalidTransition('The export has no verified completed output.')
        self.assets.validate_result_receipt(job['result'])
        path, relative = self.assets.resolve_reference('output', job['snapshot']['output'])
        return {'path': str(path), 'ref': {'filename': path.name, 'subfolder': str(Path(relative).parent).replace('\\', '/'), 'type': 'output'},
                'job': self.view(job)}

    def view(self, job):
        recovery = ('read_result' if job['state'] == 'succeeded' else 'none' if job['state'] in TERMINAL_STATES
                    else 'await_explicit_dispatch' if job['state'] == 'pending'
                    else 'query_original' if job['snapshot']['dispatch'] == 'http' and job['provider_task_id']
                    else 'manual_reconciliation')
        relative = Path(job['snapshot']['output']) if job['state'] == 'succeeded' else None
        return {'schemaVersion': 1, 'requestId': job['request_id'], 'state': job['state'], 'version': job['version'],
                'fingerprint': job['fingerprint'], 'editFingerprint': job['snapshot']['requestFingerprint'],
                'native': job['snapshot']['native'], 'providerTaskId': job['provider_task_id'],
                'cancelRequested': job['cancel_requested'], 'result': job['result'], 'errorCode': job['error_code'] or job['snapshot'].get('rejectionCode'),
                'source': job['source'], 'attempt': job['attempt'],
                'output': {'filename': relative.name, 'subfolder': relative.parent.as_posix(), 'type': 'output'} if relative is not None else None,
                'recoveryAction': recovery}

    def get(self, request_id):
        return self.view(self._owned(request_id))

    def _confirm_cancel(self, job):
        return self.jobs.confirm_cancelled(job['request_id'], expected_version=job['version'],
            provider_task_id=job['provider_task_id'], confirmation='owned_native_execution_stopped')

    def _release_terminal_capacity(self, request_id):
        job = self._owned(request_id)
        if job['state'] in TERMINAL_STATES:
            self.resources.release(request_id)

    async def cancel(self, request_id, *, expected_version):
        try:
            return await self._cancel(request_id, expected_version=expected_version)
        finally:
            await complete_blocking(self._release_terminal_capacity, request_id)

    async def _cancel(self, request_id, *, expected_version):
        job = await complete_blocking(self._owned, request_id)
        response = await complete_blocking(self.jobs.request_cancel, request_id, expected_version=expected_version)
        job = response['job']
        if (job['state'] not in TERMINAL_STATES and job['provider_task_id'] and
                job['snapshot']['dispatch'] == 'http' and self.native_queue is not None):
            # Adapter confirms only removal from this owner's pending native queue.
            removed = await self.native_queue.cancel(job['snapshot']['native']['promptId'], owner=request_id)
            if removed:
                current = await complete_blocking(self._owned, request_id)
                if current['state'] not in TERMINAL_STATES:
                    job = await complete_blocking(self._confirm_cancel, current)
        return await complete_blocking(self._owned, request_id)

    async def recover(self, request_id):
        try:
            return await self._recover(request_id)
        finally:
            await complete_blocking(self._release_terminal_capacity, request_id)

    async def _recover(self, request_id):
        job = await complete_blocking(self._owned, request_id)
        if job['state'] in TERMINAL_STATES or job['state'] == 'pending':
            return job
        if job['state'] in {'needs_recovery', 'unknown', 'fetching'}:
            job = await complete_blocking(self.jobs.claim_recovery, request_id, expected_version=job['version'])
        if job['state'] in {'fetching', 'needs_recovery'} and job['result']:
            return await complete_blocking(self._finish, request_id)
        if job['snapshot']['dispatch'] != 'http' or self.native_queue is None:
            return job  # Direct native tasks require host inspection; no inferred resubmission.
        observation = await self.native_queue.query(job['snapshot']['native']['promptId'], owner=request_id, kind='video')
        current = await complete_blocking(self._owned, request_id)
        if current['state'] in TERMINAL_STATES:
            return current
        if observation.task_id != job['snapshot']['native']['promptId']:
            raise Conflict('Recovery returned a foreign native task identity.')
        if observation.state == 'cancelled':
            if not current['cancel_requested']:
                current = (await complete_blocking(self.jobs.request_cancel, request_id, expected_version=current['version']))['job']
            return await complete_blocking(self._confirm_cancel, current)
        if observation.state == 'failed':
            return await complete_blocking(self._transition, current, 'failed', error_code='native_execution_failed')
        if observation.state in {'submitted', 'running', 'succeeded'} and current['state'] in {'submitting', 'unknown'}:
            current = await complete_blocking(self._submitted, current)
        if observation.state == 'succeeded':
            expected = ({'root': 'output', 'path': current['snapshot']['output'], 'kind': 'video'},)
            if tuple(observation.files) != expected:
                raise Conflict('Native history does not contain this export\'s exact owned output.')
            return await complete_blocking(self._finish, request_id)
        if observation.state == 'unknown' and current['state'] in {'submitting', 'submitted', 'running', 'fetching'}:
            current = await complete_blocking(self._transition, current,
                'unknown' if current['state'] == 'submitting' else 'needs_recovery',
                provider_task_id=self._native_id(request_id), error_code='native_history_unavailable')
        return current
