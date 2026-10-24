"""Controlled ACK/cancel ordering using the real ledger; no host or provider IO."""
import asyncio
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cancel_receipt_fixtures', Path(__file__).with_name('test_service.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
from backend.providers.contracts import Observation


async def until(condition):
    for _ in range(500):
        if condition():
            return
        await asyncio.sleep(.001)
    raise AssertionError('Controlled cancellation boundary was not reached')


class CancelReceiptRaceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.context = fixtures.GenerationTests()
        self.context.setUp()
        self.service, self.fake, self.jobs = self.context.service, self.context.fake, self.context.core.jobs
        self.release_create = asyncio.Event()
        self.release_cancel = None
        self.fake.gate = self.release_create

    async def asyncTearDown(self):
        self.release_create.set()
        if self.release_cancel is not None:
            self.release_cancel.set()
        await self.service.wait_idle()
        self.context.tearDown()

    async def start_and_cancel_before_ack(self):
        await self.service.submit([fixtures.GenerationTests.item('original')])
        await until(lambda: self.fake.creates == ['original'])
        result = await self.service.cancel('original')
        self.assertEqual(result['state'], 'submitting')
        self.assertTrue(result['cancel_requested'])
        self.assertIsNone(result['provider_task_id'])
        return result

    async def test_cancel_before_ack_is_delivered_to_the_original_receipt_once(self):
        async def confirmed(task_id, snapshot):
            self.fake.cancels.append(task_id)
            return True
        self.fake.cancel = confirmed
        initial = await self.start_and_cancel_before_ack()
        for _ in range(3):
            repeated = await self.service.cancel('original')
            self.assertEqual(repeated['version'], initial['version'])
        self.release_create.set()
        await self.service.wait_idle()
        job = self.jobs.get('original')
        self.assertEqual(job['state'], 'cancelled')
        self.assertEqual(job['provider_task_id'], 'native-original')
        self.assertEqual(self.fake.creates, ['original'])
        self.assertEqual(self.fake.cancels, ['native-original'])
        self.assertEqual(self.fake.queries, [])
        self.assertEqual(len(self.jobs.attempts('original')), 1)
        self.assertEqual(sum(event['event_type'] == 'cancel_intent' for event in self.jobs.events('original')), 1)

    async def test_completed_ack_wins_without_false_cancel_or_second_create(self):
        async def completed(request_id, snapshot):
            self.fake.creates.append(request_id)
            await self.release_create.wait()
            return Observation('succeeded', 'native-' + request_id,
                files=({'root': 'output', 'path': 'result.png', 'kind': 'image'},))
        self.fake.create = completed
        await self.start_and_cancel_before_ack()
        self.release_create.set()
        await self.service.wait_idle()
        job = self.jobs.get('original')
        self.assertEqual(job['state'], 'succeeded')
        self.assertTrue(job['cancel_requested'])
        self.assertEqual(self.fake.creates, ['original'])
        self.assertEqual(self.fake.cancels, [])
        self.assertEqual(self.service.completed_result('original')['kind'], 'assets')

    async def test_explicit_cancel_meeting_deferred_cancel_shares_one_confirmation(self):
        entered, release = asyncio.Event(), asyncio.Event()
        self.release_cancel = release
        async def confirmed(task_id, snapshot):
            self.fake.cancels.append(task_id)
            entered.set()
            await release.wait()
            return True
        self.fake.cancel = confirmed
        await self.start_and_cancel_before_ack()
        self.release_create.set()
        await asyncio.wait_for(entered.wait(), 2)
        second = asyncio.create_task(self.service.cancel('original'))
        try:
            await asyncio.sleep(0)
            self.assertEqual(self.fake.cancels, ['native-original'])
        finally:
            release.set()
        self.assertEqual((await second)['state'], 'cancelled')
        await self.service.wait_idle()
        self.assertEqual(self.fake.cancels, ['native-original'])
        self.assertEqual(self.jobs.get('original')['state'], 'cancelled')

    async def test_unconfirmed_cancel_keeps_tracking_without_cancel_on_every_poll(self):
        original_query = self.fake.query
        async def delayed_result(task_id, snapshot):
            if len(self.fake.queries) < 2:
                self.fake.queries.append(task_id)
                return Observation('running', task_id)
            return await original_query(task_id, snapshot)
        self.fake.query = delayed_result
        await self.start_and_cancel_before_ack()
        self.release_create.set()
        await self.service.wait_idle()
        self.assertEqual(self.jobs.get('original')['state'], 'succeeded')
        self.assertEqual(self.fake.cancels, ['native-original'])
        self.assertEqual(self.fake.queries, ['native-original'] * 3)
        self.assertEqual(self.fake.creates, ['original'])


if __name__ == '__main__':
    unittest.main()
