"""No-model races over the real shared SQLite ledger and an explicitly fake provider."""
import asyncio
import copy
import unittest
from unittest.mock import patch

import test_service as base
from test_service import FakeProvider
from backend.contracts.errors import Conflict, InvalidInput, InvalidTransition, MissingRecord
from backend.generation.service import GenerationService
from backend.providers.contracts import ProviderUnavailable
from backend.providers.parameters import IMAGE_MODEL


class FenceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.case = base.GenerationTests()
        self.case.setUp()
        self.service, self.jobs = self.case.service, self.case.core.jobs

    def tearDown(self):
        self.case.tearDown()

    def item(self, request_id='original-request'):
        return {**self.case.item(request_id), 'source': {'documentId': 'doc', 'tableId': 'table', 'nodeId': 'node',
                'recordId': 'row-a', 'fieldId': 'field-a', 'workflowSession': 'session', 'epoch': 0, 'inputVersion': 1,
                'inputDigest': 'a' * 64, 'model': IMAGE_MODEL, 'createdAt': 1}}

    def fence(self, item=None):
        item = item or self.item()
        return {'requestId': item['requestId'], 'source': item['source'], 'inputDigest': item['source']['inputDigest'], 'model': IMAGE_MODEL}

    def delayed(self, *, first_reject=False, second_reject=False):
        class Delayed(FakeProvider):
            def __init__(self):
                super().__init__()
                self.entered, self.release = asyncio.Event(), asyncio.Event()
                self.calls = 0

            async def preflight(self, snapshot):
                if snapshot.get('request_id') != 'original-request':
                    return
                self.calls += 1
                call = self.calls
                if call == 1:
                    self.entered.set()
                    await self.release.wait()
                if call == 1 and first_reject or call == 2 and second_reject:
                    raise ProviderUnavailable('synthetic preflight refusal')
        provider = Delayed()
        self.service.providers[provider.id] = provider
        return provider

    async def test_rejection_wins_before_delayed_original_and_only_explicit_new_identity_executes(self):
        provider = self.delayed(second_reject=True)
        original = asyncio.create_task(self.service.submit([self.item()]))
        await provider.entered.wait()
        with self.assertRaises(ProviderUnavailable):
            await self.service.submit([self.item()])
        report = self.service.public('original-request')
        self.assertTrue(report['replacementAllowed'])
        self.assertEqual(report['state'], 'cancelled')
        self.assertNotIn('input', self.jobs.get('original-request')['snapshot'])
        await self.service.submit([self.item('explicit-new-request')])
        provider.release.set()
        await original
        await self.service.wait_idle()
        self.assertEqual(provider.creates, ['explicit-new-request'])
        self.assertEqual(self.jobs.attempts('original-request'), [])

    async def test_normal_winner_is_not_overwritten_by_a_late_rejection(self):
        provider = self.delayed(first_reject=True)
        original = asyncio.create_task(self.service.submit([self.item()]))
        await provider.entered.wait()
        await self.service.submit([self.item()])
        await self.service.wait_idle()
        before = self.jobs.get('original-request')
        provider.release.set()
        await original
        await self.service.wait_idle()
        self.assertEqual(self.jobs.get('original-request'), before)
        self.assertEqual(provider.creates, ['original-request'])

    async def test_404_is_temporary_and_explicit_fence_blocks_the_late_prepare(self):
        provider = self.delayed()
        original = asyncio.create_task(self.service.submit([self.item()]))
        await provider.entered.wait()
        with self.assertRaises(MissingRecord):
            self.service.public('original-request')
        report = await self.service.fence_unsubmitted(self.fence())
        self.assertTrue(report['replacementAllowed'])
        provider.release.set()
        await original
        await self.service.wait_idle()
        self.assertEqual(provider.creates, [])
        self.assertEqual(self.jobs.attempts('original-request'), [])
        await self.service.submit([self.item()])
        await self.service.wait_idle()
        self.assertEqual(provider.creates, [])

    async def test_explicit_fence_cancels_pending_but_cannot_change_claimed_execution(self):
        await self.service.prepare_batch([self.item()])
        self.assertTrue((await self.service.fence_unsubmitted(self.fence()))['replacementAllowed'])
        await self.service.dispatch('original-request')
        self.assertEqual(self.case.fake.creates, [])
        item = self.item('claimed-request')
        await self.service.prepare_batch([item])
        self.jobs.begin_submission('claimed-request', expected_version=0)
        before = self.jobs.get('claimed-request')
        result = await self.service.fence_unsubmitted(self.fence(item))
        self.assertFalse(result['replacementAllowed'])
        self.assertEqual(self.jobs.get('claimed-request'), before)

    async def test_scope_digest_model_and_credentials_cannot_change_or_create_unverified_records(self):
        await self.service.prepare_batch([self.item()])
        before = self.jobs.get('original-request')
        for key, value in [('nodeId', 'other-node'), ('inputDigest', 'b' * 64), ('fieldId', 'other-field')]:
            payload = copy.deepcopy(self.fence());payload['source'][key] = value
            if key == 'inputDigest': payload['inputDigest'] = value
            with self.assertRaises(Conflict):
                await self.service.fence_unsubmitted(payload)
        with self.assertRaises(Conflict):
            await self.service.fence_unsubmitted({**self.fence(), 'inputDigest': 'b' * 64})
        self.assertEqual(self.jobs.get('original-request'), before)
        bad = self.item('secret-request');bad['input']['apiKey'] = 'synthetic-do-not-store'
        with self.assertRaises(InvalidInput): await self.service.prepare_batch([bad])
        with self.assertRaises(MissingRecord): self.jobs.get('secret-request')
        bad = self.fence(self.item('bad-scope'));bad['source']['credentials'] = {'token': 'synthetic-do-not-store'}
        with self.assertRaises(InvalidInput): await self.service.fence_unsubmitted(bad)
        with self.assertRaises(MissingRecord): self.jobs.get('bad-scope')

    async def test_interrupted_barrier_is_never_executable_and_only_confirmed_terminal_record_unlocks(self):
        with patch.object(self.jobs, 'request_cancel', side_effect=OSError('synthetic commit interruption')):
            with self.assertRaises(OSError): await self.service.fence_unsubmitted(self.fence())
        self.assertFalse(self.service.public('original-request')['replacementAllowed'])
        await self.service.dispatch('original-request')
        await self.service.recover('original-request')
        await self.service.submit([self.item()])
        await self.service.wait_idle()
        with self.assertRaises(InvalidTransition): await self.service.retry_local('original-request', 'new-request')
        self.assertEqual(self.case.fake.creates, [])
        self.assertTrue((await self.service.fence_unsubmitted(self.fence()))['replacementAllowed'])

    async def test_separate_service_instance_observes_same_fence(self):
        other = GenerationService(self.jobs, self.case.core.assets, providers=self.service.providers, admission=self.case.admission)
        await self.service.fence_unsubmitted(self.fence())
        await other.submit([self.item()])
        await other.wait_idle()
        self.assertEqual(self.case.fake.creates, [])


if __name__ == '__main__':
    unittest.main()
