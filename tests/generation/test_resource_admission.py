"""Product capacity gates: no fake semaphore, no model or host startup."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend.contracts.errors import InvalidInput, InvalidTransition
from backend.generation.admission import ResourceAdmission
from backend.generation.service import GenerationService
from backend.integrations.comfyui.services import CoreServices
from backend.providers.contracts import Observation, SubmissionUncertain
from test_service import FakeProvider, png
import test_service as fixtures


async def until(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(.001)


class CapacityTests(unittest.IsolatedAsyncioTestCase):
    async def test_fifo_independent_resources_and_cancelled_waiter(self):
        gate = ResourceAdmission(limits={'gpu': 1, 'cloud': 1, 'transcode': 1})
        entered = []
        held = asyncio.Event()
        async def owner(name, resource):
            async with gate.lease(resource, request_id=name):
                entered.append(name)
                if name == 'first': await held.wait()
        first = asyncio.create_task(owner('first', 'native'))
        await until(lambda: entered == ['first'])
        second = asyncio.create_task(owner('second', 'ollama'))
        await until(lambda: gate.snapshot()['resources']['gpu']['queued'] == 1)
        third = asyncio.create_task(owner('third', 'native'))
        await until(lambda: gate.snapshot()['resources']['gpu']['queued'] == 2)
        await owner('cloud', 'cloud')
        gate.release('second')  # Service has already committed its terminal fact.
        with self.assertRaises(InvalidTransition): await second
        held.set()
        await asyncio.gather(first, third)
        self.assertEqual(entered, ['first', 'cloud', 'third'])
        self.assertTrue(all(v['active'] == v['queued'] == 0 for v in gate.snapshot()['resources'].values()))

    async def test_async_and_existing_native_thread_share_transcode_capacity(self):
        gate = ResourceAdmission(limits={'gpu': 1, 'cloud': 3, 'transcode': 1})
        native_entered = threading.Event()
        def native():
            with gate.lease_sync('transcode', request_id='native-export'):
                native_entered.set()
        async with gate.lease('transcode', request_id='async-preview'):
            task = asyncio.create_task(asyncio.to_thread(native))
            await until(lambda: gate.snapshot()['resources']['transcode']['queued'] == 1)
            self.assertFalse(native_entered.is_set())
            # A synchronous wait must never be callable by an HTTP handler.
            with self.assertRaises(RuntimeError):
                with gate.lease_sync('transcode'): pass
        await task
        self.assertTrue(native_entered.is_set())
        self.assertEqual(gate.snapshot()['resources']['transcode']['active'], 0)

    async def test_task_cancel_withdraws_queue_and_exception_releases_owner(self):
        gate = ResourceAdmission(limits={'gpu': 1, 'cloud': 1, 'transcode': 2})
        async def waiting():
            async with gate.lease('cloud', request_id='waiting'): self.fail('Cancelled waiter entered')
        with self.assertRaisesRegex(ValueError, 'synthetic'):
            async with gate.lease('cloud', request_id='owner'):
                task = asyncio.create_task(waiting())
                await until(lambda: gate.snapshot()['resources']['cloud']['queued'] == 1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError): await task
                self.assertEqual(gate.snapshot()['resources']['cloud']['queued'], 0)
                raise ValueError('synthetic')
        self.assertEqual(gate.snapshot()['resources']['cloud']['active'], 0)

    async def test_invalid_resource_limits_fail_closed(self):
        for limits in ({'gpu': 2, 'cloud': 3, 'transcode': 2}, {'gpu': 1, 'cloud': 0, 'transcode': 2}):
            with self.assertRaises(InvalidInput): ResourceAdmission(limits=limits)


class LedgerCapacityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for part in ('input', 'output'): (self.root / part).mkdir()
        (self.root / 'output/result.png').write_bytes(png())
        self.core = CoreServices(self.root/'user', self.root/'input', self.root/'output',
                                 resource_limits={'gpu': 1, 'cloud': 1, 'transcode': 1})
        self.fake = FakeProvider()
        self.fake.execution_kind, self.fake.resource, self.fake.protocol_only = 'remote', 'cloud', True
        self.service = GenerationService(self.core.jobs, self.core.assets, providers={self.fake.id: self.fake},
                                         resources=self.core.resources, poll_interval=0)

    async def asyncTearDown(self):
        if self.fake.gate: self.fake.gate.set()
        await self.service.wait_idle()
        self.temp.cleanup()

    async def test_unknown_retains_restart_capacity_until_confirmed_terminal_recovery(self):
        self.fake.error = SubmissionUncertain()
        await self.service.submit([fixtures.GenerationTests.item('unknown')]); await self.service.wait_idle()
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['retained'], 1)
        restarted_gate = ResourceAdmission(limits=self.core.resources.limits, jobs=self.core.jobs)
        restarted = GenerationService(self.core.jobs, self.core.assets, providers={self.fake.id: self.fake},
                                      resources=restarted_gate, poll_interval=0)
        self.fake.error = None
        await restarted.submit([fixtures.GenerationTests.item('next')])
        await until(lambda: restarted_gate.snapshot()['resources']['cloud']['queued'] == 1)
        self.assertEqual(self.fake.creates, ['unknown'])
        self.fake.query_error = True
        with self.assertRaises(OSError): await restarted.recover('unknown')
        self.assertEqual(restarted_gate.snapshot()['resources']['cloud']['retained'], 1)
        self.fake.query_error = False
        await restarted.recover('unknown'); await restarted.wait_idle()
        self.assertEqual(self.fake.creates, ['unknown', 'next'])
        self.assertEqual(restarted_gate.snapshot()['resources']['cloud']['active'], 0)
        self.assertEqual(self.core.jobs.get('unknown')['attempt'], 1)

    async def test_unconfirmed_remote_cancel_cannot_release_capacity(self):
        self.fake.error = SubmissionUncertain(task_id='native-unknown')
        await self.service.submit([fixtures.GenerationTests.item('unknown')]); await self.service.wait_idle()
        await self.service.cancel('unknown')
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['retained'], 1)
        self.assertEqual(self.fake.cancels, ['native-unknown'])

    async def test_dispatch_database_calls_are_off_loop_and_slow_read_does_not_stop_heartbeat(self):
        await self.service.prepare_batch([fixtures.GenerationTests.item('slow')])
        original = self.core.jobs.get
        entered, release = threading.Event(), threading.Event()
        loop_thread = threading.get_ident()
        first = True
        def guarded(request_id):
            nonlocal first
            self.assertNotEqual(threading.get_ident(), loop_thread)
            if first:
                first = False
                entered.set()
                release.wait(5)
            return original(request_id)
        with patch.object(self.core.jobs, 'get', guarded):
            task = asyncio.create_task(self.service.dispatch('slow'))
            try:
                await until(entered.is_set)
                # The real DB adapter is paused in its worker while this HTTP-loop
                # coroutine still advances. No elapsed-time performance assertion.
                heartbeat = asyncio.Event(); asyncio.get_running_loop().call_soon(heartbeat.set)
                await asyncio.wait_for(heartbeat.wait(), 1)
            finally: release.set()
            await task
        self.assertEqual(original('slow')['state'], 'succeeded')

    async def test_media_provider_submitted_fact_is_restored_as_busy(self):
        job, _ = self.core.jobs.create_or_get('media', provider='protocol-transcode', execution_kind='media', snapshot={'resource': 'transcode'})
        job = self.core.jobs.begin_submission('media', expected_version=job['version'])
        self.core.jobs.mark_submitted('media', 'task', expected_version=job['version'], event_id='ack')
        gate = ResourceAdmission(jobs=self.core.jobs)
        await gate._ready()
        self.assertEqual(gate.snapshot()['resources']['transcode']['retained'], 1)

    async def test_stop_during_off_loop_submission_claim_is_rechecked_before_provider_call(self):
        await self.service.prepare_batch([fixtures.GenerationTests.item('stopped')])
        original = self.core.jobs.begin_submission
        entered, release = threading.Event(), threading.Event()
        allowed = True
        def held(*args, **kwargs):
            job = original(*args, **kwargs)
            entered.set(); release.wait(5)
            return job
        with patch.object(self.core.jobs, 'begin_submission', held):
            task = asyncio.create_task(self.service.dispatch('stopped', before_submit=lambda: allowed))
            try:
                await until(entered.is_set)
                allowed = False
            finally: release.set()
            job = await task
        self.assertEqual(self.fake.creates, [])
        self.assertEqual(job['state'], 'failed')
        self.assertEqual(job['error_code'], 'stopped_before_provider_create')
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['active'], 0)

    async def test_terminal_recovery_during_restart_scan_cannot_restore_stale_capacity(self):
        self.fake.error = SubmissionUncertain()
        await self.service.submit([fixtures.GenerationTests.item('old')]); await self.service.wait_idle()
        gate = ResourceAdmission(limits=self.core.resources.limits, jobs=self.core.jobs)
        restarted = GenerationService(self.core.jobs, self.core.assets, providers={self.fake.id: self.fake},
                                      resources=gate, poll_interval=0)
        scanned, continue_scan = threading.Event(), threading.Event()
        original = self.core.jobs.list_jobs
        def held_page(*args, **kwargs):
            page = original(*args, **kwargs)
            if kwargs.get('state') == 'unknown':
                scanned.set(); continue_scan.wait(5)
            return page
        with patch.object(self.core.jobs, 'list_jobs', held_page):
            loading = asyncio.create_task(gate._ready())
            try:
                await until(scanned.is_set)
                self.fake.error = None
                terminal = await restarted.recover('old')
                self.assertEqual(terminal['state'], 'succeeded')
                self.assertFalse(gate.snapshot()['loaded'])
            finally:
                continue_scan.set()
            await loading
        self.assertEqual(gate.snapshot()['resources']['cloud']['retained'], 0)
        self.assertEqual(gate.snapshot()['resources']['cloud']['active'], 0)
        await restarted.submit([fixtures.GenerationTests.item('after-restore')])
        await asyncio.wait_for(restarted.wait_idle(), 5)
        self.assertEqual(self.fake.creates, ['old', 'after-restore'])
        self.assertEqual(self.core.jobs.get('old')['attempt'], 1)

    async def test_cancelled_recovery_waits_for_real_receipt_commit_before_releasing_capacity(self):
        self.fake.error = SubmissionUncertain()
        await self.service.submit([fixtures.GenerationTests.item('receipt')]); await self.service.wait_idle()
        self.fake.error = None
        entered, resume, finished = threading.Event(), threading.Event(), threading.Event()
        original = self.core.assets.register_file
        def held(*args, **kwargs):
            entered.set(); resume.wait(5)
            try: return original(*args, **kwargs)
            finally: finished.set()
        with patch.object(self.core.assets, 'register_file', held):
            task = asyncio.create_task(self.service.recover('receipt'))
            try:
                await until(entered.is_set)
                task.cancel(); await asyncio.sleep(.02)
                task.cancel(); await asyncio.sleep(.02)
                self.assertFalse(task.done(), 'HTTP cancellation must wait for its non-cancellable receipt writer')
                self.assertFalse(finished.is_set())
                self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['retained'], 1)
            finally:
                resume.set()
                try: await task
                except asyncio.CancelledError: pass
                await until(finished.is_set)
                async with asyncio.timeout(5):
                    while (await asyncio.to_thread(self.core.jobs.get, 'receipt'))['state'] != 'succeeded':
                        await asyncio.sleep(.001)
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['active'], 0)
        self.assertEqual(self.fake.creates, ['receipt'])

    async def test_cancelled_remote_cancel_waits_for_its_durable_confirmation_and_releases(self):
        self.fake.error = SubmissionUncertain(task_id='native-confirm')
        await self.service.submit([fixtures.GenerationTests.item('confirm')]); await self.service.wait_idle()
        async def confirmed(*args): return True
        self.fake.cancel = confirmed
        entered, resume = threading.Event(), threading.Event()
        original = self.core.jobs.confirm_cancelled
        def held(*args, **kwargs):
            entered.set(); resume.wait(5)
            return original(*args, **kwargs)
        with patch.object(self.core.jobs, 'confirm_cancelled', held):
            task = asyncio.create_task(self.service.cancel('confirm'))
            try:
                await until(entered.is_set)
                task.cancel(); await asyncio.sleep(.01)
                task.cancel(); await asyncio.sleep(.01)
                self.assertFalse(task.done())
                self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['retained'], 1)
            finally:
                resume.set()
                try: await task
                except asyncio.CancelledError: pass
        self.assertEqual(self.core.jobs.get('confirm')['state'], 'cancelled')
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['active'], 0)
