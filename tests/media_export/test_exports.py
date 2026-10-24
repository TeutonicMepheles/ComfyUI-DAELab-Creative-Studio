"""CPU synthetic media + durable SQLite + inert native queue, never a live host."""
import asyncio
import copy
import json
from pathlib import Path
import tempfile
import threading
import types
import unittest
import subprocess
import sys
from unittest.mock import patch

import av
from PIL import Image

from backend.contracts.errors import Conflict, InvalidInput, InvalidTransition
from backend.integrations.comfyui.services import CoreServices
from backend.media.export_service import ExportService, ExportCancelled, MARKER
from backend.providers.contracts import Observation, SubmissionRejected, SubmissionUncertain


class Queue:
    def __init__(self):
        self.calls, self.queries, self.cancels = [], [], []
        self.state, self.error, self.remove = 'submitted', None, True

    async def validate(self, task, graph):
        return (True, None, ['save'], {})

    async def enqueue(self, task, graph, *, owner):
        self.calls.append((task, graph, owner))
        if self.error:
            raise self.error

    async def query(self, task, *, owner, kind):
        self.queries.append((task, owner))
        return Observation(self.state, task)

    async def cancel(self, task, *, owner):
        self.cancels.append((task, owner))
        return self.remove


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ('input', 'output', 'temp'):
            (self.root / directory).mkdir()
        self.core = CoreServices(self.root / 'user', self.root / 'input', self.root / 'output', temp_directory=self.root / 'temp')
        self.queue = Queue()
        self.service = ExportService(self.core.jobs, self.core.assets, native_queue=self.queue)
        Image.new('RGB', (32, 24), 'red').save(self.root / 'input/red.png')
        Image.new('RGB', (32, 24), 'blue').save(self.root / 'temp/blue.png')
        self.edit = {'version': 1, 'fit': 'contain', 'unknown': {'preserved': True}, 'resolution': {'width': 32, 'height': 24},
                     'clips': [{'source': {'asset': {'filename': 'red.png', 'type': 'input'}}, 'duration': .25},
                               {'source': {'asset': {'filename': 'blue.png', 'type': 'temp'}}, 'duration': .25}]}

    def submit(self, request='export-1'):
        return asyncio.run(self.service.submit(request, self.edit))

    def execute(self, index=-1, **kwargs):
        task, graph, owner = self.queue.calls[index]
        context = types.SimpleNamespace(prompt_id=task, node_id='save', list_index=0)
        return self.service.execute(graph['save']['inputs']['edit_data'], context=context, **kwargs)

    def test_real_two_still_export_freezes_inputs_and_registers_verified_asset(self):
        before = copy.deepcopy(self.edit)
        job = self.submit()
        Image.new('RGB', (32, 24), 'green').save(self.root / 'input/red.png')
        result = self.execute()
        self.assertEqual(result['job']['state'], 'succeeded')
        self.assertEqual(result['job']['attempt'], 1)
        with av.open(result['path']) as container:
            frames = list(container.decode(video=0))
            self.assertEqual(len(frames), 12)
            self.assertEqual((frames[0].width, frames[0].height), (32, 24))
            self.assertGreater(int(frames[0].to_ndarray(format='rgb24')[0, 0, 0]), 240)
            self.assertGreater(int(frames[-1].to_ndarray(format='rgb24')[0, 0, 2]), 240)
        self.assertEqual(self.edit, before)
        self.assertEqual(self.core.jobs.get(job['request_id'])['snapshot']['edit'], before)
        item = result['job']['result']['items'][0]
        self.assertTrue(self.core.assets.validate_reference(item['reference_id'])['usable'])
        self.assertEqual(self.core.assets.get(item['asset_id'])['provenance'][0]['detail']['request_id'], 'export-1')
        modified = Path(result['path']).stat().st_mtime_ns
        self.assertEqual(self.execute()['path'], result['path'])
        self.assertEqual(Path(result['path']).stat().st_mtime_ns, modified)
        self.assertEqual(self.submit()['state'], 'succeeded')
        self.assertEqual(len(self.queue.calls), 1)

    def test_concurrent_submission_claim_enqueues_only_once_and_identity_conflicts(self):
        async def run():
            return await asyncio.gather(*(self.service.submit('same', self.edit) for _ in range(8)))
        asyncio.run(run())
        self.assertEqual(len(self.queue.calls), 1)
        self.edit['clips'][0]['duration'] = .5
        with self.assertRaises(Conflict):
            self.submit('same')

    def test_uncertain_submission_and_restart_recover_never_enqueue_or_render(self):
        self.queue.error = RuntimeError('synthetic uncertain enqueue')
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'unknown')
        self.service = ExportService(self.core.jobs, self.core.assets, native_queue=self.queue)
        self.queue.state = 'unknown'
        with patch('backend.media.export_service.render', side_effect=AssertionError('recovery must not render')):
            self.assertEqual(asyncio.run(self.service.recover('export-1'))['state'], 'unknown')
            self.assertEqual(self.submit()['state'], 'unknown')
        self.assertEqual(len(self.queue.calls), 1)
        self.assertEqual(len(self.queue.queries), 1)

    def test_original_queued_execution_can_complete_after_uncertain_ack(self):
        self.queue.error = RuntimeError('accepted then ack lost')
        with self.assertRaises(RuntimeError):
            self.submit()
        self.assertEqual(self.execute()['job']['state'], 'succeeded')
        self.assertEqual(len(self.queue.calls), 1)

    def test_cancel_pending_and_queued_are_owned_and_remote_confirmation_is_rejected(self):
        job = self.service.prepare('pending', self.edit)
        self.assertEqual(asyncio.run(self.service.cancel('pending', expected_version=job['version']))['state'], 'cancelled')
        self.assertEqual(self.queue.cancels, [])
        job = self.submit()
        self.assertEqual(asyncio.run(self.service.cancel('export-1', expected_version=job['version']))['state'], 'cancelled')
        self.assertEqual(self.queue.cancels, [(job['snapshot']['native']['promptId'], 'export-1')])
        foreign, _ = self.core.jobs.create_or_get('foreign', provider='cloud', execution_kind='remote', snapshot={})
        with self.assertRaises(Conflict):
            asyncio.run(self.service.cancel('foreign', expected_version=foreign['version']))
        self.assertFalse(self.core.jobs.get('foreign')['cancel_requested'])
        foreign = self.core.jobs.begin_submission('foreign', expected_version=0)
        foreign = self.core.jobs.mark_submitted('foreign', 'remote-task', expected_version=foreign['version'], event_id='submitted')
        foreign = self.core.jobs.request_cancel('foreign', expected_version=foreign['version'])['job']
        with self.assertRaises(InvalidTransition):
            self.core.jobs.confirm_cancelled('foreign', expected_version=foreign['version'], provider_task_id='remote-task', confirmation='owned_native_execution_stopped')

    def test_running_cancel_stops_only_this_renderer_and_removes_partial_file(self):
        self.submit()
        self.queue.remove = False
        cancelled = []
        def progress(*_):
            if not cancelled:
                job = self.core.jobs.get('export-1')
                cancelled.append(asyncio.run(self.service.cancel('export-1', expected_version=job['version'])))
        with self.assertRaises(ExportCancelled):
            self.execute(progress=progress)
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'cancelled')
        self.assertEqual(list((self.root / 'output').rglob('*.mp4')), [])

    def test_failure_is_terminal_and_existing_unrelated_output_is_preserved(self):
        job = self.submit()
        target = self.root / 'output' / job['snapshot']['output']
        target.parent.mkdir(parents=True)
        target.write_bytes(b'pre-existing retained evidence')
        with self.assertRaises(Conflict):
            self.execute()
        self.assertEqual(target.read_bytes(), b'pre-existing retained evidence')
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'failed')
        self.assertEqual(self.submit()['state'], 'failed')
        self.assertEqual(len(self.queue.calls), 1)

    def test_fetching_receipt_survives_commit_failure_and_recovery_decodes_without_render(self):
        self.submit()
        original = self.core.jobs.transition
        def fail_commit(request, state, **kwargs):
            if state == 'succeeded':
                raise OSError('synthetic commit failure')
            return original(request, state, **kwargs)
        with patch.object(self.core.jobs, 'transition', side_effect=fail_commit), self.assertRaises(OSError):
            self.execute()
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'fetching')
        replacement = CoreServices(self.root / 'user', self.root / 'input', self.root / 'output', temp_directory=self.root / 'temp')
        self.service = ExportService(replacement.jobs, replacement.assets, native_queue=self.queue)
        with patch('backend.media.export_service.render', side_effect=AssertionError('must not rerender')):
            self.assertEqual(asyncio.run(self.service.recover('export-1'))['state'], 'succeeded')
        self.assertEqual(len(self.queue.calls), 1)

    def test_direct_native_new_prompt_is_new_export_and_same_prompt_is_not_rerendered(self):
        def run(prompt):
            return self.service.execute(json.dumps(self.edit), context=types.SimpleNamespace(prompt_id=prompt, node_id='12:3', list_index=0))
        first = run('native-one')
        again = run('native-one')
        second = run('native-two')
        self.assertEqual(first['path'], again['path'])
        self.assertNotEqual(first['job']['requestId'], second['job']['requestId'])
        self.assertNotEqual(first['path'], second['path'])
        self.assertEqual(self.queue.calls, [])

    def test_forged_context_changed_marker_and_changed_frozen_input_fail_closed(self):
        job = self.submit()
        task, graph, _ = self.queue.calls[0]
        raw = graph['save']['inputs']['edit_data']
        with self.assertRaises(Conflict):
            self.service.execute(raw, context=types.SimpleNamespace(prompt_id='foreign', node_id='save', list_index=0))
        edit = json.loads(raw)
        edit['clips'][0]['duration'] = 99
        with self.assertRaises(Conflict):
            self.service.execute(json.dumps(edit), context=types.SimpleNamespace(prompt_id=task, node_id='save', list_index=0))
        frozen = job['snapshot']['clips'][0]['frozen']
        (self.core.assets.frozen_root / frozen['filename']).write_bytes(b'changed')
        with self.assertRaises(Conflict):
            self.execute()
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'failed')

    def test_credentials_and_outside_paths_are_rejected_without_job_creation(self):
        for value in ({**self.edit, 'api_key': 'synthetic-secret'},
                      {**self.edit, 'clips': [{'source': {'asset': {'filename': '../output/foreign.mp4'}}, 'duration': 1}]}):
            with self.assertRaises(InvalidInput):
                self.service.prepare('invalid', value)
        self.assertEqual(self.core.jobs.list_jobs(), [])

    def test_frozen_mkv_and_m4v_keep_legacy_supported_extension(self):
        self.submit()
        result = self.execute()
        for ext in ('mkv', 'm4v'):
            file = self.root / 'input' / ('legacy.' + ext)
            file.write_bytes(Path(result['path']).read_bytes())
            edit = {'version': 1, 'clips': [{'source': {'asset': {'filename': file.name}}, 'duration': .25}]}
            job = self.service.prepare(ext, edit)
            self.assertTrue(job['snapshot']['clips'][0]['frozen']['filename'].endswith('.' + ext))

    def test_two_native_execution_deliveries_have_one_renderer_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        from backend.media.video_edit_media import render as real_render
        self.submit()
        entered, release = threading.Event(), threading.Event()
        def gated(*args, **kwargs):
            entered.set()
            if not release.wait(3):
                raise AssertionError('test failed to release native renderer')
            return real_render(*args, **kwargs)
        with patch('backend.media.export_service.render', side_effect=gated) as renderer, ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.execute)
            self.assertTrue(entered.wait(3))
            try:
                with self.assertRaises(InvalidTransition):
                    self.execute()
            finally:
                release.set()
            self.assertEqual(first.result()['job']['state'], 'succeeded')
            self.assertEqual(renderer.call_count, 1)

    def test_cancelling_a_does_not_prevent_b_and_explicit_new_identity_can_retry(self):
        a = self.submit('a')
        self.submit('b')
        asyncio.run(self.service.cancel('a', expected_version=a['version']))
        self.assertEqual(self.execute(1)['job']['state'], 'succeeded')
        self.assertEqual(self.core.jobs.get('a')['state'], 'cancelled')
        self.submit('a-explicit-retry')
        self.assertEqual(self.execute(2)['job']['state'], 'succeeded')
        self.assertEqual(len(self.queue.calls), 3)

    def test_restart_without_native_history_marks_original_for_review_and_retains_files(self):
        self.submit()
        self.queue.state = 'unknown'
        first = asyncio.run(self.service.recover('export-1'))
        self.assertEqual(first['state'], 'needs_recovery')
        self.assertEqual(asyncio.run(self.service.recover('export-1'))['state'], 'needs_recovery')
        self.assertEqual(len(self.queue.calls), 1)
        self.assertTrue((self.root / 'input/red.png').is_file())

    def test_process_exit_after_fetching_receipt_recovers_existing_media_without_encoding(self):
        script = '''
import json, os, sys, types
from pathlib import Path
from backend.integrations.comfyui.services import CoreServices
from backend.media.export_service import ExportService
root = Path(sys.argv[1])
core = CoreServices(root/'user', root/'input', root/'output', temp_directory=root/'temp')
transition = core.jobs.transition
def stop_at_success(request, state, **kwargs):
    if state == 'succeeded':
        os._exit(73)
    return transition(request, state, **kwargs)
core.jobs.transition = stop_at_success
ExportService(core.jobs, core.assets).execute(sys.argv[2], context=types.SimpleNamespace(prompt_id='crash-proof', node_id='save', list_index=0))
'''
        completed = subprocess.run([sys.executable, '-c', script, str(self.root), json.dumps(self.edit)],
                                   cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30)
        self.assertEqual(completed.returncode, 73, completed.stderr.decode(errors='replace'))
        job, = self.core.jobs.list_jobs()
        self.assertEqual(job['state'], 'fetching')
        path = self.root / 'output' / job['snapshot']['output']
        original = path.read_bytes()
        # The child has exited: only now is a host-wide restart reconciliation safe.
        reconciled, = self.core.jobs.reconcile_restart()
        self.assertEqual(reconciled['state'], 'needs_recovery')
        with patch('backend.media.export_service.render', side_effect=AssertionError('cannot rerender on recovery')):
            recovered = asyncio.run(self.service.recover(job['request_id']))
        self.assertEqual(recovered['state'], 'succeeded')
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(recovered['attempt'], 1)

    def test_unknown_recovery_attempts_are_bounded_without_resubmission(self):
        self.queue.error = RuntimeError('uncertain')
        with self.assertRaises(RuntimeError):
            self.submit()
        self.queue.state = 'unknown'
        for _ in range(3):
            self.assertEqual(asyncio.run(self.service.recover('export-1'))['state'], 'unknown')
        with self.assertRaises(InvalidTransition):
            asyncio.run(self.service.recover('export-1'))
        self.assertEqual((len(self.queue.calls), len(self.queue.queries)), (1, 3))

    def test_client_digest_is_immutable_correlation_not_a_replacement_for_frozen_hash(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        job = self.service.prepare('correlated', self.edit, source=source)
        self.assertEqual(self.service.get('correlated')['source']['inputDigest'], 'c' * 64)
        self.assertNotEqual(job['fingerprint'], source['inputDigest'])
        with self.assertRaises(Conflict):
            self.service.prepare('correlated', self.edit, source={**source, 'inputDigest': 'd' * 64})
        for value in ('C' * 64, 'abc', float('nan'), None):
            with self.assertRaises(InvalidInput):
                self.service.prepare('invalid-digest', self.edit, source={**source, 'inputDigest': value})

    def test_native_preflight_rejection_never_enqueues_or_cancels_existing_prepared_identity(self):
        invalid = {**self.edit, 'clips': []}
        with self.assertRaises(InvalidInput):
            asyncio.run(self.service.submit('invalid', invalid))
        self.assertEqual(self.core.jobs.list_jobs(), [])
        async def reject(*_):
            raise SubmissionRejected('synthetic native schema rejection')
        self.queue.validate = reject
        with self.assertRaises(SubmissionUncertain):
            self.submit('preflight')
        self.assertEqual(self.queue.calls, [])
        self.assertEqual(self.core.jobs.get('preflight')['state'], 'pending')

    def test_rejection_label_cannot_open_retry_after_native_execution_already_advanced(self):
        async def advanced_then_bad_rejection(task, graph, *, owner):
            current = self.core.jobs.get(owner)
            current = self.core.jobs.mark_submitted(owner, task, expected_version=current['version'], event_id='original-accepted')
            self.core.jobs.transition(owner, 'running', expected_version=current['version'], event_id='original-running')
            raise SubmissionRejected('synthetic late mislabelled rejection')
        self.queue.enqueue = advanced_then_bad_rejection
        with self.assertRaises(SubmissionUncertain):
            self.submit('already-running')
        self.assertEqual(self.core.jobs.get('already-running')['state'], 'running')

    def test_prepare_rejection_is_durable_non_executable_and_lost_response_recovers_only_original(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        invalid = {**self.edit, 'clips': []}
        job = asyncio.run(self.service.submit('rejected', invalid, source=source))
        self.assertEqual((job['state'], job['snapshot']['preparation']), ('cancelled', 'rejected'))
        self.assertEqual(set(job['snapshot']), {'schemaVersion', 'preparation', 'requestFingerprint', 'clientInputDigest', 'rejectionCode', 'native', 'dispatch'})
        self.assertIsNone(job['provider_task_id'])
        self.assertEqual(job['attempt'], 0)
        # Deliberately discard the POST response, reopen the service, then only query/recover.
        self.service = ExportService(self.core.jobs, self.core.assets, native_queue=self.queue)
        self.assertEqual(self.service.get('rejected')['errorCode'], 'export_input_rejected')
        self.assertEqual(asyncio.run(self.service.recover('rejected'))['state'], 'cancelled')
        self.assertEqual(asyncio.run(self.service.submit('rejected', invalid, source=source))['state'], 'cancelled')
        self.assertEqual(self.queue.calls, [])
        with self.assertRaises(Conflict):
            asyncio.run(self.service.submit('rejected', self.edit, source=source))
        self.assertEqual(asyncio.run(self.service.submit('new-explicit', self.edit, source=source))['state'], 'submitted')

    def test_rejected_owner_and_credentials_are_validated_before_any_fact_is_written(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        for scope, edit in [({**source, 'nodeId': ''}, self.edit), ({**source, 'inputDigest': 'bad'}, self.edit),
                            (source, {**self.edit, 'credentials': {'secret': 'synthetic'}})]:
            with self.assertRaises(InvalidInput):
                asyncio.run(self.service.submit('invalid-owner', edit, source=scope))
        self.assertEqual(self.core.jobs.list_jobs(), [])

    def test_existing_normal_snapshot_wins_over_later_prepare_failure_without_cancellation(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        original = self.service.prepare
        entered, release = asyncio.Event(), asyncio.Event()
        async def validate(*_):
            entered.set()
            await release.wait()
        self.queue.validate = validate
        async def run():
            normal = asyncio.create_task(self.service.submit('race', self.edit, source=source))
            await entered.wait()  # Ready snapshot committed, but native enqueue not reached.
            with patch.object(self.service, 'prepare', side_effect=InvalidInput('synthetic local failure')):
                observed = await self.service.submit('race', self.edit, source=source)
            self.assertEqual((observed['state'], observed['snapshot']['preparation']), ('pending', 'ready'))
            self.assertFalse(observed['cancel_requested'])
            release.set()
            return await normal
        self.assertEqual(asyncio.run(run())['state'], 'submitted')
        self.assertEqual(len(self.queue.calls), 1)

    def test_rejection_wins_before_competing_ready_snapshot_commit_and_blocks_enqueue(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        entered, release = threading.Event(), threading.Event()
        create = self.core.jobs.create_or_get
        def gated_create(*args, **kwargs):
            if kwargs['snapshot'].get('preparation') == 'ready':
                entered.set()
                if not release.wait(3):
                    raise AssertionError('test did not release prepared snapshot')
            return create(*args, **kwargs)
        async def run():
            normal = asyncio.create_task(self.service.submit('race-reject', self.edit, source=source))
            await asyncio.to_thread(entered.wait, 3)
            self.assertTrue(entered.is_set())
            with patch.object(self.service, 'prepare', side_effect=InvalidInput('synthetic local failure')):
                rejected = await self.service.submit('race-reject', self.edit, source=source)
            release.set()
            self.assertEqual(rejected['state'], 'cancelled')
            return await normal
        with patch.object(self.core.jobs, 'create_or_get', side_effect=gated_create):
            self.assertEqual(asyncio.run(run())['state'], 'cancelled')
        self.assertEqual(self.queue.calls, [])

    def test_interruption_before_rejection_cancel_leaves_non_executable_original_for_owned_cancel(self):
        source = {'documentId': 'document', 'nodeId': 'node', 'inputDigest': 'c' * 64}
        invalid = {**self.edit, 'clips': []}
        with patch.object(self.core.jobs, 'request_cancel', side_effect=OSError('synthetic interruption')), self.assertRaises(OSError):
            asyncio.run(self.service.submit('interrupted-rejection', invalid, source=source))
        original = self.core.jobs.get('interrupted-rejection')
        self.assertEqual((original['state'], original['snapshot']['preparation']), ('pending', 'rejected'))
        self.assertEqual(asyncio.run(self.service.submit('interrupted-rejection', invalid, source=source))['state'], 'pending')
        self.assertEqual(asyncio.run(self.service.recover('interrupted-rejection'))['state'], 'pending')
        self.assertEqual(self.queue.calls, [])
        self.assertEqual(asyncio.run(self.service.cancel('interrupted-rejection', expected_version=original['version']))['state'], 'cancelled')

    def test_native_export_waits_for_same_transcode_permit_as_http_preview_and_cancels_without_render(self):
        from backend.generation.admission import ResourceAdmission
        self.core.resources = ResourceAdmission(jobs=self.core.jobs, limits={'gpu': 1, 'cloud': 3, 'transcode': 1})
        self.service.resources = self.core.resources
        self.submit()
        self.queue.remove = False  # It is already on the native execution thread.
        async def run():
            async with self.core.resources.lease('transcode', request_id='preview'):
                task = asyncio.create_task(asyncio.to_thread(self.execute))
                async with asyncio.timeout(5):
                    while self.core.resources.snapshot()['resources']['transcode']['queued'] != 1:
                        await asyncio.sleep(.001)
                job = await asyncio.to_thread(self.core.jobs.get, 'export-1')
                await self.service.cancel('export-1', expected_version=job['version'])
                with self.assertRaises(ExportCancelled): await task
                self.assertEqual(self.core.resources.snapshot()['resources']['transcode']['queued'], 0)
        with patch('backend.media.export_service.render', side_effect=AssertionError('Cancelled before render')):
            asyncio.run(run())
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'cancelled')
        self.assertEqual(self.core.resources.snapshot()['resources']['transcode']['active'], 0)

    def test_original_native_execution_adopts_its_conservative_restart_reservation(self):
        self.queue.error = RuntimeError('accepted but acknowledgement lost')
        with self.assertRaises(RuntimeError): self.submit()
        asyncio.run(self.service.resources._ready())
        self.assertEqual(self.service.resources.snapshot()['resources']['transcode']['retained'], 1)
        # Exact native context/fingerprint validation still happens before adoption.
        result = self.execute()
        self.assertEqual(result['job']['state'], 'succeeded')
        self.assertEqual(self.service.resources.snapshot()['resources']['transcode']['active'], 0)
        self.assertEqual(len(self.queue.calls), 1)

    def test_cancelled_export_recovery_waits_for_durable_finish_before_releasing_restart_capacity(self):
        self.submit()
        transition = self.core.jobs.transition
        def fail_success(request, state, **kwargs):
            if state == 'succeeded': raise OSError('interrupted first commit')
            return transition(request, state, **kwargs)
        with patch.object(self.core.jobs, 'transition', side_effect=fail_success), self.assertRaises(OSError):
            self.execute()
        from backend.generation.admission import ResourceAdmission
        self.service.resources = ResourceAdmission(jobs=self.core.jobs)
        entered, resume = threading.Event(), threading.Event()
        finish = self.service._finish
        def held(*args):
            entered.set(); resume.wait(5)
            return finish(*args)
        async def run():
            await self.service.resources._ready()
            self.assertEqual(self.service.resources.snapshot()['resources']['transcode']['retained'], 1)
            task = asyncio.create_task(self.service.recover('export-1'))
            try:
                async with asyncio.timeout(5):
                    while not entered.is_set(): await asyncio.sleep(.001)
                task.cancel(); await asyncio.sleep(.01)
                task.cancel(); await asyncio.sleep(.01)
                self.assertFalse(task.done())
                self.assertEqual(self.service.resources.snapshot()['resources']['transcode']['retained'], 1)
            finally:
                resume.set()
                try: await task
                except asyncio.CancelledError: pass
            self.assertEqual(self.service.resources.snapshot()['resources']['transcode']['active'], 0)
        with patch.object(self.service, '_finish', side_effect=held), patch('backend.media.export_service.render', side_effect=AssertionError('Recovery cannot render')):
            asyncio.run(run())
        self.assertEqual(self.core.jobs.get('export-1')['state'], 'succeeded')


if __name__ == '__main__':
    unittest.main()
