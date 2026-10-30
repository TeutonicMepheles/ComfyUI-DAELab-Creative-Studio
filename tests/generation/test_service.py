"""Deterministic fault injection, temporary SQLite and actual synthetic image decode."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

from backend.contracts.errors import Conflict, InvalidInput, InvalidTransition
from backend.integrations.comfyui.services import CoreServices
from backend.generation.service import GenerationService
from backend.providers.contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from backend.providers.parameters import IMAGE_MODEL


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b'')


class Admission:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.active = self.peak = 0

    @asynccontextmanager
    async def lease(self, resource):
        async with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
            try:
                yield
            finally:
                self.active -= 1


class FakeProvider:
    id, execution_kind, resource = 'local-qwen-image', 'local', 'native'
    supports_query = supports_lookup = supports_cancel = True

    def __init__(self):
        self.creates, self.queries, self.lookups, self.cancels = [], [], [], []
        self.error = None
        self.query_error = False
        self.preflight_bad = False
        self.gate = None
        self.file = 'result.png'

    def build(self, data, media, request_id):
        if not data.get('segments'):
            raise InvalidInput('synthetic malformed row')
        return {'kind': 'image', 'frozen_ids': [m['reference_id'] for m in media], 'seed': 42}

    async def capabilities(self, model):
        await self.preflight({})
        return {'model': model, 'available': True, 'local': True, 'fixture': True}

    async def preflight(self, snapshot):
        if self.preflight_bad:
            raise ProviderUnavailable('synthetic missing model')

    async def create(self, request_id, snapshot):
        self.creates.append(request_id)
        if self.gate is not None:
            await self.gate.wait()
        if self.error:
            raise self.error
        return Observation('submitted', 'native-' + request_id)

    async def query(self, task_id, snapshot):
        self.queries.append(task_id)
        if self.query_error:
            raise OSError('synthetic query outage')
        return Observation('succeeded', task_id, files=({'root': 'output', 'path': self.file, 'kind': 'image'},))

    async def lookup(self, request_id, snapshot):
        self.lookups.append(request_id)
        return await self.query('native-' + request_id, snapshot)

    async def cancel(self, task_id, snapshot):
        self.cancels.append(task_id)
        return False


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-generation-')
        self.root = Path(self.temp.name)
        for name in ('input', 'output'):
            (self.root / name).mkdir()
        (self.root / 'output/result.png').write_bytes(png())
        self.core = CoreServices(self.root / 'user', self.root / 'input', self.root / 'output')
        self.fake, self.admission = FakeProvider(), Admission()
        self.service = GenerationService(self.core.jobs, self.core.assets, providers={self.fake.id: self.fake}, admission=self.admission, poll_interval=0, poll_limit=3)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def item(request_id='request-one', **changes):
        data = {'config': {'kind': 'image', 'model': IMAGE_MODEL, 'mode': 'text2image'}, 'segments': [{'type': 'text', 'text': 'public synthetic'}], 'recordId': 'row-a', 'fieldId': 'field-a'}
        data.update(changes)
        return {'requestId': request_id, 'input': data}

    async def test_table_and_standalone_share_identity_and_only_one_submission(self):
        await self.service.submit([self.item()])
        await self.service.wait_idle()
        first = self.service.public('request-one')
        await self.service.submit([self.item()])
        await self.service.wait_idle()
        self.assertEqual(self.fake.creates, ['request-one'])
        self.assertEqual(first['phase'], 'complete')
        self.assertEqual(self.service.public('request-one')['receipt'], first['receipt'])
        self.assertEqual(len(self.core.jobs.attempts('request-one')), 1)
        with self.assertRaises(Conflict):
            await self.service.prepare_batch([self.item(recordId='other-row')])

    async def test_three_injected_jobs_queue_and_all_complete_without_another_click(self):
        self.fake.gate = asyncio.Event()
        ids = ['injected-first', 'injected-second', 'injected-third']
        await self.service.submit([self.item(request_id, recordId='row-' + str(index)) for index, request_id in enumerate(ids)])
        for _ in range(200):
            if self.fake.creates:
                break
            await asyncio.sleep(.005)
        self.assertEqual(self.fake.creates, ids[:1])
        self.assertEqual([self.core.jobs.get(request_id)['state'] for request_id in ids[1:]], ['pending', 'pending'])
        self.fake.gate.set()
        await self.service.wait_idle()
        self.assertEqual(self.fake.creates, ids)
        self.assertEqual([self.service.public(request_id)['phase'] for request_id in ids], ['complete'] * 3)
        self.assertEqual(self.admission.peak, 1)

    async def test_all_selected_preflight_precedes_any_ledger_or_provider_submission(self):
        with self.assertRaises(InvalidInput):
            await self.service.submit([self.item(), self.item('bad', segments=[])])
        self.assertEqual(self.core.jobs.list_jobs(), [])
        self.assertEqual(self.fake.creates, [])

    async def test_request_rejection_and_uncertain_delivery_are_distinct_persistent_facts(self):
        for suffix, error, state in [('reject', SubmissionRejected('refused'), 'failed'), ('lost', SubmissionUncertain(), 'unknown')]:
            self.fake.error = error
            await self.service.submit([self.item(suffix)])
            await self.service.wait_idle()
            self.assertEqual(self.core.jobs.get(suffix)['state'], state)
            await self.service.submit([self.item(suffix)])
            self.assertEqual(self.fake.creates.count(suffix), 1)

    async def test_restart_lookup_and_query_reuse_original_identity_without_create(self):
        self.fake.error = SubmissionUncertain()
        await self.service.submit([self.item()]); await self.service.wait_idle()
        restarted = GenerationService(self.core.jobs, self.core.assets, providers={self.fake.id: self.fake}, admission=self.admission)
        result = await restarted.recover('request-one')
        self.assertEqual(result['state'], 'succeeded')
        self.assertEqual(self.fake.lookups, ['request-one'])
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_submission_acknowledged_then_query_outage_recovers_same_task(self):
        self.fake.query_error = True
        await self.service.submit([self.item()]); await self.service.wait_idle()
        self.assertEqual(self.core.jobs.get('request-one')['state'], 'needs_recovery')
        self.fake.query_error = False
        await self.service.recover('request-one')
        self.assertEqual(self.service.public('request-one')['phase'], 'complete')
        self.assertEqual(set(self.fake.queries), {'native-request-one'})
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_result_receipt_uses_rooted_canonical_path(self):
        folder = self.root / 'output/DAELAB/creative-studio'
        folder.mkdir(parents=True)
        (folder / 'result.png').write_bytes(png())
        paths = [r'DAELAB\creative-studio/result.png', 'DAELAB/./creative-studio/result.png']
        if os.name == 'nt':
            paths.append(r'daelab\creative-studio/result.png')
        for index, path in enumerate(paths):
            with self.subTest(path=path):
                request_id = f'canonical-{index}'
                self.fake.file = path
                await self.service.submit([self.item(request_id)])
                await self.service.wait_idle()
                result = self.service.public(request_id)
                self.assertEqual(result['phase'], 'complete')
                ref = self.core.assets.validate_reference(result['receipt']['items'][0]['reference_id'])
                self.assertEqual(ref['relative_path'], 'DAELAB/creative-studio/result.png')
                self.assertEqual(self.fake.creates.count(request_id), 1)

    async def test_canonical_result_recovery_reuses_original_execution(self):
        folder = self.root / 'output/DAELAB/creative-studio'
        folder.mkdir(parents=True)
        self.fake.file = r'daelab\creative-studio/result.png' if os.name == 'nt' else r'DAELAB\creative-studio/result.png'
        await self.service.submit([self.item()]); await self.service.wait_idle()
        before = self.core.jobs.get('request-one')
        self.assertEqual(before['state'], 'needs_recovery')
        (folder / 'result.png').write_bytes(png())
        await self.service.recover('request-one')
        after = self.core.jobs.get('request-one')
        self.assertEqual(after['state'], 'succeeded')
        self.assertEqual(after['provider_task_id'], before['provider_task_id'])
        self.assertEqual(after['attempt'], 1)
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_result_path_normalization_does_not_admit_root_escape(self):
        for index, path in enumerate((r'..\input\outside.png', str(self.root / 'input/outside.png'))):
            with self.subTest(path=path):
                (self.root / 'input/outside.png').write_bytes(png())
                self.fake.file = path
                request_id = f'escape-{index}'
                await self.service.submit([self.item(request_id)]); await self.service.wait_idle()
                self.assertEqual(self.service.public(request_id)['phase'], 'needs_recovery')
                self.assertIsNone(self.core.jobs.get(request_id)['result'])

    async def test_invalid_media_never_success_and_recovery_is_bounded_without_resubmission(self):
        (self.root / 'output/result.png').write_bytes(b'broken')
        await self.service.submit([self.item()]); await self.service.wait_idle()
        self.assertEqual(self.service.public('request-one')['phase'], 'needs_recovery')
        for _ in range(3):
            await self.service.recover('request-one')
        with self.assertRaises(InvalidTransition):
            await self.service.recover('request-one')
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_missing_completed_file_degrades_display_without_rewriting_success_or_resubmitting(self):
        await self.service.submit([self.item()]); await self.service.wait_idle()
        committed = self.core.jobs.get('request-one')
        (self.root / 'output/result.png').unlink()
        self.assertEqual(self.service.public('request-one')['phase'], 'needs_recovery')
        await self.service.recover('request-one')
        self.assertEqual(self.core.jobs.get('request-one'), committed)
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_pending_cancel_during_serial_queue_never_dispatches_and_other_task_finishes(self):
        self.fake.gate = asyncio.Event()
        await self.service.submit([self.item('first')])
        while not self.fake.creates:
            await asyncio.sleep(0)
        # The DB read runs off-loop and concurrent completion order is not an
        # admission order. Hold a proven first owner before testing its queue.
        await self.service.submit([self.item('second')])
        while self.service.resources.snapshot()['resources']['gpu']['queued'] != 1:
            await asyncio.sleep(0)
        await self.service.cancel('second')
        self.fake.gate.set(); await self.service.wait_idle()
        self.assertEqual(self.fake.creates, ['first'])
        self.assertEqual(self.core.jobs.get('second')['state'], 'cancelled')
        self.assertEqual(self.core.jobs.get('first')['state'], 'succeeded')
        self.assertEqual(self.admission.peak, 1)

    async def test_frozen_input_survives_original_replacement_and_changed_frozen_input_blocks_create(self):
        file = self.root / 'input/source.png'; file.write_bytes(png())
        item = self.item(assets=[{'url': '/view?filename=source.png&type=input', 'kind': 'image'}])
        job = (await self.service.prepare_batch([item]))[0]
        frozen = job['snapshot']['media'][0]
        file.write_bytes(b'changed original')
        self.assertTrue(self.core.assets.validate_reference(frozen['reference_id'])['usable'])
        path, _ = self.core.assets.resolve_reference('frozen', frozen['filename'])
        path.write_bytes(b'changed frozen')
        await self.service.dispatch('request-one')
        self.assertEqual(self.fake.creates, [])
        self.assertEqual(self.core.jobs.get('request-one')['state'], 'failed')

    async def test_missing_provider_and_credentials_fail_closed(self):
        empty = GenerationService(self.core.jobs, self.core.assets)
        with self.assertRaises(ProviderUnavailable):
            await empty.submit([self.item()])
        with self.assertRaises(InvalidInput):
            await self.service.submit([self.item(api_key='not-a-real-key')])
        self.assertEqual(self.core.jobs.list_jobs(), [])

    async def test_unqueryable_unknown_remains_unknown(self):
        self.fake.error = SubmissionUncertain()
        self.fake.supports_lookup = self.fake.supports_query = False
        await self.service.submit([self.item()]); await self.service.wait_idle()
        await self.service.recover('request-one')
        self.assertEqual(self.core.jobs.get('request-one')['state'], 'unknown')
        self.assertEqual(self.fake.creates, ['request-one'])

    async def test_concurrent_explicit_dispatchers_share_atomic_ledger_claim(self):
        await self.service.prepare_batch([self.item()])
        await asyncio.gather(self.service.dispatch('request-one'), self.service.dispatch('request-one'))
        self.assertEqual(self.fake.creates, ['request-one'])
        self.assertEqual(self.service.public('request-one')['phase'], 'complete')

    async def test_provider_mismatch_and_traversal_results_are_rejected(self):
        for name in ['../escape.png', '/absolute.png']:
            self.fake.file = name
            identity = 'request-' + str(len(self.fake.creates))
            await self.service.submit([self.item(identity)]); await self.service.wait_idle()
            self.assertEqual(self.core.jobs.get(identity)['state'], 'needs_recovery')

    async def test_local_continue_is_an_explicit_new_identity_and_preserves_old_cancel_fact(self):
        await self.service.prepare_batch([self.item()])
        await self.service.cancel('request-one')
        previous = self.core.jobs.get('request-one')
        with self.assertRaises(Conflict): await self.service.retry_local('request-one', 'request-one')
        await self.service.retry_local('request-one', 'request-rerun')
        await self.service.wait_idle()
        self.assertEqual(self.core.jobs.get('request-one'), previous)
        self.assertEqual(self.core.jobs.get('request-rerun')['source']['previous_request_id'], 'request-one')
        self.assertEqual(self.fake.creates, ['request-rerun'])
        with self.assertRaises(InvalidTransition): await self.service.retry_local('request-rerun', 'another')

    async def test_malformed_provider_acknowledgement_remains_unknown_and_never_replays(self):
        async def bad(request_id,snapshot):
            self.fake.creates.append(request_id)
            return {'status':'maybe accepted'}
        self.fake.create=bad
        self.fake.supports_lookup=self.fake.supports_query=False
        await self.service.submit([self.item()]);await self.service.wait_idle()
        self.assertEqual(self.core.jobs.get('request-one')['state'],'unknown')
        await self.service.recover('request-one')
        self.assertEqual(self.fake.creates,['request-one'])

    async def test_completed_fact_still_reads_when_provider_configuration_is_removed(self):
        await self.service.submit([self.item()]);await self.service.wait_idle()
        self.service.providers.clear()
        self.assertEqual((await self.service.recover('request-one'))['state'],'succeeded')
        self.assertEqual((await self.service.cancel('request-one'))['state'],'succeeded')
        self.assertEqual((await self.service.submit([self.item()]))[0]['phase'],'complete')


if __name__ == '__main__':
    unittest.main()
