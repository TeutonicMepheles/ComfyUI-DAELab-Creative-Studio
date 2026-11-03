import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.contracts.errors import InvalidTransition
from backend.generation.service import GenerationService
from backend.integrations.comfyui.generation_nodes.native_host import ComfyNativeQueue
from backend.jobs.host_lock import HostExecutionLock, reconcile_owned_restart
from backend.providers.native import NativeProvider
from backend.jobs.ledger import JobLedger
from backend.providers.parameters import IMAGE_MODEL, QWEN_MODEL


class NativeProgressProvider:
    id = 'local-qwen-image'
    execution_kind = 'local'
    resource = 'native'
    supports_query = supports_lookup = supports_cancel = True
    supports_progress = True

    async def capabilities(self, model):
        return {'model': model, 'provider': 'local', 'available': True}

    async def cancel(self, _task_id, _snapshot):
        return False


class RemoteNoCancelProvider:
    id = 'remote-no-cancel'
    execution_kind = 'remote'
    resource = 'cloud'
    supports_query = True
    supports_lookup = supports_cancel = False
    supports_progress = False

    async def capabilities(self, model):
        return {'model': model, 'provider': 'remote', 'available': True}


class Admission:
    def check_available(self, _resource):
        return None


class TaskControlLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-controls-')
        self.jobs = JobLedger(Path(self.temp.name) / 'studio.db')
        self.job, _ = self.jobs.create_or_get(
            'original-control',
            provider='local-qwen-image',
            execution_kind='local',
            snapshot={'input': {'model': IMAGE_MODEL}},
            source={'documentId': 'doc', 'tableId': 'table', 'recordId': 'row', 'fieldId': 'field'},
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_pause_blocks_claim_and_resume_preserves_original_identity(self):
        paused = self.jobs.record_control('original-control', 'pause', expected_version=self.job['version'], scope='row')
        self.assertEqual((paused['state'], paused['control_intent']), ('pending', 'pause'))
        reopened = JobLedger(Path(self.temp.name) / 'studio.db')
        self.assertEqual(reopened.get('original-control')['control_intent'], 'pause')
        with self.assertRaises(InvalidTransition):
            reopened.begin_submission('original-control', expected_version=paused['version'])
        resumed = reopened.record_control('original-control', 'resume', expected_version=paused['version'])
        self.assertIsNone(resumed['control_intent'])
        claimed = reopened.begin_submission('original-control', expected_version=resumed['version'])
        self.assertEqual((claimed['request_id'], claimed['attempt']), ('original-control', 1))

    def test_second_host_cannot_reconcile_or_change_the_first_hosts_active_task(self):
        claimed = self.jobs.begin_submission('original-control', expected_version=self.job['version'], owner_session='first')
        self.jobs.mark_submitted('original-control', 'native-control', expected_version=claimed['version'], event_id='control-submitted')
        lock_directory = Path(self.temp.name) / 'studio.hosts'
        first = HostExecutionLock(lock_directory / 'host-first.lock')
        self.assertTrue(first.acquire())
        before = self.jobs.get('original-control')
        report = reconcile_owned_restart(self.jobs, lock_directory, current_session='second')
        self.assertEqual(report['liveSessions'], ['first'])
        self.assertEqual(self.jobs.get('original-control'), before)
        fresh, _ = self.jobs.create_or_get('second-host-new', provider='local-qwen-image', execution_kind='local', snapshot={'input': {}})
        claimed_fresh = self.jobs.begin_submission(fresh['request_id'], expected_version=fresh['version'], owner_session='second')
        self.assertEqual(claimed_fresh['state'], 'submitting')
        legacy, _ = self.jobs.create_or_get('legacy-unattributed', provider='local-qwen-image', execution_kind='local', snapshot={'input': {}})
        self.jobs.begin_submission(legacy['request_id'], expected_version=legacy['version'])
        first.release()
        report = reconcile_owned_restart(self.jobs, lock_directory, current_session='second')
        self.assertEqual(self.jobs.get('original-control')['state'], 'needs_recovery')
        self.assertEqual(self.jobs.get('second-host-new')['state'], 'submitting')
        self.assertEqual(self.jobs.get('legacy-unattributed')['state'], 'submitting')
        self.assertEqual(report['reconciled'], ['original-control'])
        self.assertEqual(report['legacyUnattributed'], 1)

    def test_interrupt_before_dispatch_is_terminal_and_keeps_old_facts(self):
        interrupted = self.jobs.record_control('original-control', 'interrupt', expected_version=self.job['version'])
        self.assertEqual((interrupted['state'], interrupted['control_intent']), ('cancelled', 'interrupt'))
        self.assertEqual(interrupted['error_code'], 'interrupted_before_submit')
        self.assertEqual(self.jobs.attempts('original-control'), [])

    def test_stop_is_a_distinct_durable_pending_control_without_resume(self):
        stopped = self.jobs.record_control('original-control', 'stop', expected_version=self.job['version'])
        self.assertEqual((stopped['state'], stopped['control_intent']), ('pending', 'stop'))
        reopened = JobLedger(Path(self.temp.name) / 'studio.db')
        self.assertEqual(reopened.get('original-control')['control_intent'], 'stop')
        with self.assertRaises(InvalidTransition):
            reopened.begin_submission('original-control', expected_version=stopped['version'])
        resumed = reopened.record_control('original-control', 'resume', expected_version=stopped['version'])
        self.assertEqual((resumed['state'], resumed['control_intent']), ('pending', None))

    def test_pause_after_running_can_continue_as_next_attempt_of_the_same_request(self):
        claimed = self.jobs.begin_submission('original-control', expected_version=self.job['version'])
        submitted = self.jobs.mark_submitted('original-control', 'native-pause', expected_version=claimed['version'], event_id='pause-submitted')
        running = self.jobs.transition('original-control', 'running', expected_version=submitted['version'], event_id='pause-running')
        paused = self.jobs.record_control('original-control', 'pause', expected_version=running['version'])
        intent = self.jobs.request_cancel('original-control', expected_version=paused['version'])
        cancelled = self.jobs.confirm_cancelled('original-control', expected_version=intent['job']['version'],
                                                provider_task_id='native-pause', confirmation='owned_native_execution_stopped')
        resumed = self.jobs.resume_paused('original-control', expected_version=cancelled['version'])
        self.assertEqual((resumed['state'], resumed['attempt'], resumed['control_intent'], resumed['provider_task_id']),
                         ('pending', 1, None, None))
        next_attempt = self.jobs.begin_submission('original-control', expected_version=resumed['version'])
        self.assertEqual(next_attempt['attempt'], 2)
        submitted_again = self.jobs.mark_submitted('original-control', 'native-pause-next', expected_version=next_attempt['version'],
                                                   event_id='pause-reattempt-submitted')
        self.assertEqual((submitted_again['attempt'], submitted_again['provider_task_id']), (2, 'native-pause-next'))

class TaskControlServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_queries_preserve_interruption_fact_and_exhaust_budget_without_resubmission(self):
        from backend.providers.contracts import Observation
        with tempfile.TemporaryDirectory(prefix='studio-query-budget-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            queries = []
            async def query(task_id, snapshot):
                queries.append(task_id)
                return Observation('unknown', task_id)  # memory history gone after host restart
            provider.query = query
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('query-only', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            await service._observe(claimed, Observation('submitted', 'native-query-only'))
            await service._observe(jobs.get(job['request_id']), Observation('unknown', 'native-query-only', error_code='remote_execution_interrupted_unknown'))
            await service._observe(jobs.get(job['request_id']), Observation('unknown', 'native-query-only'))
            for _ in range(3):
                await service.recover('query-only')
            before = jobs.get('query-only')
            self.assertEqual((before['state'], before['error_code'], before['recovery_count']), ('unknown', 'remote_execution_interrupted_unknown', 3))
            for _ in range(5):
                self.assertFalse(service.public('query-only')['recovery']['available'])
            with self.assertRaises(InvalidTransition):
                await service.recover('query-only')
            self.assertEqual(jobs.get('query-only'), before)
            self.assertEqual(queries, ['native-query-only'] * 3)
            self.assertEqual(service.public('query-only')['recovery']['reason'], 'recovery_limit_reached')

    async def test_temporary_query_failure_keeps_proven_interruption_separate_from_availability(self):
        from backend.providers.contracts import Observation, ProviderUnavailable
        with tempfile.TemporaryDirectory(prefix='studio-query-error-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            async def query(task_id, snapshot):
                raise OSError('synthetic transport failure')
            provider.query = query
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('query-error', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            await service._observe(claimed, Observation('submitted', 'native-query-error'))
            await service._observe(jobs.get(job['request_id']), Observation('unknown', 'native-query-error', error_code='remote_execution_interrupted_unknown'))
            with self.assertRaises(ProviderUnavailable):
                await service.recover('query-error')
            self.assertEqual(jobs.get('query-error')['error_code'], 'remote_execution_interrupted_unknown')
            self.assertEqual(jobs.get('query-error')['recovery_count'], 1)
            self.assertTrue(service.public('query-error')['recovery']['available'])

    async def test_interrupt_unknown_preserves_reason_and_does_not_mask_recovery(self):
        from backend.providers.contracts import Observation
        with tempfile.TemporaryDirectory(prefix='studio-interrupt-unknown-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('unknown-row', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            await service._observe(claimed, Observation('submitted', 'native-unknown'))
            await service.interrupt(job['request_id'])
            await service._observe(jobs.get(job['request_id']), Observation('unknown', 'native-unknown', error_code='remote_execution_interrupted_unknown'))
            report = service.public(job['request_id'])
            self.assertEqual((report['phase'], report['error'], report['controlIntent']), ('needs_recovery', 'remote_execution_interrupted_unknown', 'interrupt'))
            self.assertEqual(jobs.get(job['request_id'])['attempt'], 1)
            before = jobs.get(job['request_id'])
            jobs.record_control(job['request_id'], 'pause', expected_version=before['version'])
            self.assertEqual(service.public(job['request_id'])['phase'], 'needs_recovery')

    async def test_repeated_stop_does_not_abort_remaining_pending_sequence_or_touch_other_node(self):
        with tempfile.TemporaryDirectory(prefix='studio-stop-sequence-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            for request_id in ('first', 'second', 'other-node'):
                jobs.create_or_get(request_id, provider=provider.id, execution_kind='local', snapshot={'input': {}})
            original = jobs.get('other-node')
            await service.interrupt('first')
            for request_id in ('first', 'second'):
                await service.interrupt(request_id)
            self.assertEqual([jobs.get(request_id)['state'] for request_id in ('first', 'second')], ['cancelled', 'cancelled'])
            self.assertEqual(jobs.get('other-node'), original)

    async def test_capability_publishes_control_and_progress_boundaries(self):
        provider = NativeProgressProvider()
        service = GenerationService({}, None, providers={provider.id: provider}, admission=Admission())
        caps = await service.capabilities(IMAGE_MODEL)
        self.assertEqual(caps['control'], {
            'query': True, 'lookup': True, 'cancel': True,
            'interrupt': True, 'restart': True,
        })
        self.assertEqual(caps['progress'], {'numeric': True})
        image = next(item for item in service.model_catalog()['models'] if item['id'] == IMAGE_MODEL)
        self.assertEqual((image['family'], image['kind'], image['provider']), ('generation', 'image', 'local'))
        qwen = next(item for item in service.model_catalog()['models'] if item['id'] == QWEN_MODEL)
        self.assertEqual((qwen['label'], qwen['provider']), ('Qwen3.5-9B（本地）', 'qwen'))
        empty = GenerationService({}, None, providers={})
        image_without_provider = next(item for item in empty.model_catalog()['models'] if item['id'] == IMAGE_MODEL)
        self.assertEqual(image_without_provider['provider'], 'local')

    async def test_active_remote_without_cancel_exposes_no_false_pause_interrupt_or_restart(self):
        with tempfile.TemporaryDirectory(prefix='studio-remote-controls-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = RemoteNoCancelProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('remote-row', provider=provider.id, execution_kind='remote', snapshot={'input': {}, 'media': []})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            jobs.mark_submitted(job['request_id'], 'provider-task', expected_version=claimed['version'], event_id='remote-submitted')
            report = service.public(job['request_id'])
            self.assertEqual(report['controls'], {'pause': False, 'resume': False, 'interrupt': False, 'restart': False})
            with self.assertRaises(InvalidTransition):
                await service.pause(job['request_id'])
            queued, _ = jobs.create_or_get('remote-queued', provider=provider.id, execution_kind='remote', snapshot={'input': {}})
            paused = await service.pause(queued['request_id'])
            self.assertEqual(paused['control_intent'], 'pause')
            resumed = jobs.record_control(queued['request_id'], 'resume', expected_version=paused['version'])
            self.assertEqual((resumed['state'], resumed['control_intent']), ('pending', None))

    async def test_progress_is_transient_monotonic_and_attempt_scoped(self):
        from backend.providers.contracts import Observation
        with tempfile.TemporaryDirectory(prefix='studio-progress-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('progress-row', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            await service._observe(claimed, Observation('submitted', 'native-progress'))
            await service._observe(jobs.get(job['request_id']), Observation('running', 'native-progress', metadata={'stage': 'generating', 'progress': 20}))
            first = service.public(job['request_id'])
            self.assertEqual((first['progress'], first['stage']), (20.0, 'generating'))
            await service._observe(jobs.get(job['request_id']), Observation('running', 'native-progress', metadata={'stage': 'generating', 'progress': 10}))
            self.assertEqual(service.public(job['request_id'])['progress'], 20.0)
            await service._observe(jobs.get(job['request_id']), Observation('failed', 'native-progress'))
            self.assertNotIn('progress', service.public(job['request_id']))

    async def test_legacy_unattributed_task_gets_explicit_recovery_phase_without_rewriting(self):
        with tempfile.TemporaryDirectory(prefix='studio-legacy-owner-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission(), owner_session='current')
            job, _ = jobs.create_or_get('legacy-active', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            jobs.mark_submitted(job['request_id'], 'native-legacy', expected_version=claimed['version'], event_id='legacy-submitted')
            report = service.public(job['request_id'])
            self.assertEqual((report['state'], report['phase'], report['legacyUnattributed']), ('submitted', 'needs_recovery', True))
            self.assertEqual(report['controls'], {'pause': False, 'resume': False, 'interrupt': False, 'restart': False})
            self.assertEqual(jobs.get(job['request_id'])['state'], 'submitted')

    async def test_interrupt_pending_confirmation_has_distinct_transition_phase(self):
        from backend.providers.contracts import Observation
        with tempfile.TemporaryDirectory(prefix='studio-interrupting-') as folder:
            jobs = JobLedger(Path(folder) / 'studio.db')
            provider = NativeProgressProvider()
            service = GenerationService(jobs, None, providers={provider.id: provider}, admission=Admission())
            job, _ = jobs.create_or_get('interrupt-row', provider=provider.id, execution_kind='local', snapshot={'input': {}})
            claimed = jobs.begin_submission(job['request_id'], expected_version=job['version'])
            await service._observe(claimed, Observation('submitted', 'native-interrupt'))
            await service.interrupt(job['request_id'])
            report = service.public(job['request_id'])
            self.assertEqual((report['controlIntent'], report['phase']), ('interrupt', 'interrupting'))

    def test_native_queue_derives_numeric_progress_from_comfy_execution_units(self):
        self.assertTrue(NativeProvider.supports_progress)
        def phase(value):
            return SimpleNamespace(value=value)
        registry = SimpleNamespace(prompt_id='native-progress', nodes={
            'a': {'state': phase('finished'), 'value': 10, 'max': 10},
            'b': {'state': phase('running'), 'value': 5, 'max': 10},
            'c': {'state': phase('pending'), 'value': 0, 'max': 10},
        })
        module = SimpleNamespace(get_progress_state=lambda: registry)
        with patch.dict(sys.modules, {'comfy_execution.progress': module}):
            progress = ComfyNativeQueue._progress('native-progress')
        self.assertEqual(progress['stage'], 'generating')
        self.assertAlmostEqual(progress['progress'], 50.0)
