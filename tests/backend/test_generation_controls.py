import asyncio
import tempfile
import unittest
from pathlib import Path

from backend.contracts.errors import InvalidTransition
from backend.generation.service import GenerationService
from backend.jobs.ledger import JobLedger
from backend.providers.parameters import IMAGE_MODEL


class NativeProgressProvider:
    id = 'local-qwen-image'
    execution_kind = 'local'
    resource = 'native'
    supports_query = supports_lookup = supports_cancel = True
    supports_progress = True

    async def capabilities(self, model):
        return {'model': model, 'provider': 'local', 'available': True}


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

    def test_interrupt_before_dispatch_is_terminal_and_keeps_old_facts(self):
        interrupted = self.jobs.record_control('original-control', 'interrupt', expected_version=self.job['version'])
        self.assertEqual((interrupted['state'], interrupted['control_intent']), ('cancelled', 'interrupt'))
        self.assertEqual(interrupted['error_code'], 'interrupted_before_submit')
        self.assertEqual(self.jobs.attempts('original-control'), [])

class TaskControlServiceTests(unittest.IsolatedAsyncioTestCase):
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
