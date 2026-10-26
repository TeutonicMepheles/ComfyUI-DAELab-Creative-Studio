"""Deterministic cancellation interleavings; no service/provider/host execution."""
import hashlib
import json
import unittest
from unittest.mock import patch

from tools.performance import run_scheduler_plan as driver


class CancellationContractTests(unittest.TestCase):
    def fixture(self):
        plan = json.loads(driver.PLAN.read_text('utf-8'))
        evidence = {'runId': 'perf-race', 'jobs': [], 'observations': [], 'workers': 0,
                    'resourceSnapshot': {'resources': {name: {'active': 0, 'queued': 0, 'retained': 0} for name in ('gpu', 'cloud', 'transcode')}}}
        # Three real queue cancellations and one candidate that starts between
        # the client snapshot and control execution (the actual 8236 failure).
        queued = {'perf-fake-093', 'perf-fake-094', 'perf-fake-095'}
        running = 'perf-fake-098'
        control = {'action': 'cancel', 'requestIds': [], 'responses': [], 'selectedFrom': []}
        def event(name, key, **extra):
            events = evidence['observations']
            events.append({'sequence': len(events), 'elapsedMs': len(events), 'event': name, 'requestId': key, **extra})
        for item in plan['jobs']:
            key = 'perf-race.' + item['request_id']
            resource = {'fake-local': 'native', 'fake-cloud': 'cloud', 'fake-transcode': 'transcode'}[item['kind']]
            task_id = 'transport-' + item['request_id']
            job = {'request_id': key, 'kind': item['kind'], 'state': item['outcome'], 'attempt': 1,
                   'provider_task_id': task_id, 'events': [], 'attempts': [{'provider_task_id': task_id}], 'frozenInputHashes': ['a' * 64]}
            evidence['jobs'].append(job)
            if item['request_id'] in queued or item['request_id'] == running:
                control['requestIds'].append(key)
                control['responses'].append({'requestId': key, 'state': 'cancelled'})
                control['selectedFrom'].append({'requestId': key, 'state': 'pending', 'waitingResource': resource})
                job['state'] = 'cancelled'
            if item['request_id'] in queued:
                event('control_cancel', key, beforeState='pending', waitingResource=resource)
                job.update(attempt=0, provider_task_id=None, attempts=[])
                job['events'] = [{'request_id': key, 'sequence': 1, 'event_type': 'cancel_intent', 'detail': {'queued': True}}]
                continue
            event('provider_create', key, kind=item['kind'])
            event('provider_active', key, kind=item['kind'])
            if item['request_id'] == running:
                event('control_cancel', key, beforeState='running', waitingResource=None)
                event('provider_cancel', key, kind=item['kind'])
                job['events'] = [
                    {'request_id': key, 'sequence': 2, 'event_type': 'cancel_intent', 'detail': {'queued': False}},
                    {'request_id': key, 'sequence': 3, 'event_type': 'cancel_confirmed',
                     'detail': {'provider_task_id': task_id, 'confirmation': 'provider_cancelled'}}]
            event('provider_finished', key, kind=item['kind'], state=job['state'])
        return evidence, plan, control

    def analyze(self, evidence, plan, control):
        return driver.analyze_run(evidence, plan, [{'status': 200, 'phase': 'busy', 'durationMs': 1}], cancellation_control=control)

    def test_candidate_starts_before_cancel_is_separate_from_real_queue_cancel(self):
        evidence, plan, control = self.fixture()
        result = self.analyze(evidence, plan, control)
        for name in ('fixedOutcomes', 'cancellationEvidenceValid', 'queuedCancellationNoExecution',
                     'runningCancellationConfirmed', 'everyUncancelledSubmittedOnce', 'allClassesQueuedCancellationObserved'):
            self.assertTrue(result['checks'][name], result)
        self.assertEqual(result['runningCancelledIds'], ['perf-race.perf-fake-098'])
        self.assertNotIn('perf-race.perf-fake-098', result['queuedCancelledIds'])
        self.assertEqual(len(result['queuedCancelledIds']), 3)

    def test_pending_observation_races_atomic_submission_without_becoming_queue_evidence(self):
        evidence, plan, control = self.fixture()
        event = next(row for row in evidence['observations'] if row['event'] == 'control_cancel' and row['requestId'].endswith('098'))
        event.update(beforeState='pending', waitingResource='transcode')
        result = self.analyze(evidence, plan, control)
        self.assertTrue(result['checks']['cancellationEvidenceValid'])
        self.assertEqual(result['runningCancelledIds'], ['perf-race.perf-fake-098'])
        self.assertEqual(len(result['queuedCancelledIds']), 3)

    def test_expected_outcome_does_not_follow_final_job_state(self):
        evidence, plan, control = self.fixture()
        next(row for row in evidence['jobs'] if row['request_id'].endswith('098'))['state'] = 'succeeded'
        result = self.analyze(evidence, plan, control)
        self.assertTrue(result['checks']['cancellationEvidenceValid'])
        self.assertFalse(result['checks']['fixedOutcomes'])
        self.assertFalse(result['checks']['runningCancellationConfirmed'])

    def test_missing_control_ack_or_confirmation_never_becomes_inferred_success(self):
        for change in ('no-response', 'unknown-response', 'no-confirm', 'foreign-task', 'no-provider-cancel', 'unregistered'):
            evidence, plan, control = self.fixture()
            job = next(row for row in evidence['jobs'] if row['request_id'].endswith('098'))
            if change == 'no-response': control['responses'].pop()
            if change == 'unknown-response': control['responses'][-1]['state'] = 'unknown'
            if change == 'no-confirm': job['events'].pop()
            if change == 'foreign-task': job['events'][-1]['detail']['provider_task_id'] = 'foreign-task'
            if change == 'no-provider-cancel': evidence['observations'] = [row for row in evidence['observations'] if row['event'] != 'provider_cancel']
            if change == 'unregistered': control['selectedFrom'][-1]['state'] = 'running'
            with self.subTest(change=change):
                self.assertFalse(self.analyze(evidence, plan, control)['checks']['cancellationEvidenceValid'])

    def test_atomic_queue_claim_still_requires_zero_create_and_zero_attempt(self):
        evidence, plan, control = self.fixture()
        key = 'perf-race.perf-fake-095'
        job = next(row for row in evidence['jobs'] if row['request_id'] == key)
        job['attempt'] = 1
        result = self.analyze(evidence, plan, control)
        self.assertIn(key, result['queuedCancelledIds'])
        self.assertFalse(result['checks']['queuedCancellationNoExecution'])
        job['attempt'] = 0
        evidence['observations'].append({'sequence': 10000, 'elapsedMs': 10000, 'event': 'provider_create', 'requestId': key, 'kind': job['kind']})
        result = self.analyze(evidence, plan, control)
        self.assertFalse(result['checks']['queuedCancellationNoExecution'])
        self.assertFalse(result['checks']['everyUncancelledSubmittedOnce'])

    def test_running_cancel_does_not_replace_missing_resource_queue_coverage(self):
        evidence, plan, control = self.fixture()
        key = 'perf-race.perf-fake-095'
        # Retain the original running-cancel trace, remove the only transcode
        # queue cancellation. Its active counterpart cannot stand in for it.
        control['requestIds'].remove(key)
        control['responses'] = [row for row in control['responses'] if row['requestId'] != key]
        control['selectedFrom'] = [row for row in control['selectedFrom'] if row['requestId'] != key]
        evidence['observations'] = [row for row in evidence['observations'] if row['requestId'] != key]
        result = self.analyze(evidence, plan, control)
        self.assertFalse(result['checks']['allClassesQueuedCancellationObserved'])
        self.assertFalse(result['checks']['queuedCancellationNoExecution'])
        self.assertTrue(result['checks']['runningCancellationConfirmed'])


class DriverStopTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_failed_oracle_stops_without_counting_remaining_rounds(self):
        import aiohttp
        evidence, plan, control = CancellationContractTests().fixture()
        evidence, control = [json.loads(json.dumps(value).replace('perf-race', 'perf-stop-1')) for value in (evidence, control)]
        create_counts = {row['requestId']: 1 for row in evidence['observations'] if row['event'] == 'provider_create'}
        calls, statuses = [], 0
        class Response:
            status = 200
            def __init__(self, value): self.value = value
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return None
            async def json(self): return self.value
            async def read(self): return b'{}'
        class Session:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return None
            def get(self, url, **kwargs): return self.request('GET', url, **kwargs)
            def request(self, method, url, **kwargs):
                nonlocal statuses
                path = url.split('http://127.0.0.1:52900', 1)[1]
                calls.append((method, path, kwargs.get('json')))
                if path.endswith('/manifest'):
                    return Response({'fixture': driver.VERSION, 'testOnly': True,
                                     'planSha256': hashlib.sha256(driver.PLAN.read_bytes()).hexdigest(),
                                     'jobCount': 100, 'hostKind': 'loopback-regression'})
                if path.endswith('/health'): return Response({'frontendBuildId': 'synthetic'})
                if path.endswith('/run'): return Response({'requestIds': [row['request_id'] for row in evidence['jobs']]})
                if path.endswith('/control'):
                    payload = kwargs['json']
                    return Response(control['responses'] if payload['action'] == 'cancel' else [])
                if path.endswith('/evidence'): return Response(evidence)
                if path.endswith('/reconstruct'): return Response({})
                if path.endswith('/status'):
                    statuses += 1
                    jobs = json.loads(json.dumps(evidence['jobs']))
                    if statuses == 1:
                        for job in jobs:
                            if job['request_id'] in control['requestIds']: job['state'] = 'pending'
                    return Response({'jobs': jobs, 'workers': 0, 'providerCreateCounts': create_counts,
                                     'resourceWaiting': {row['requestId']: row['waitingResource'] for row in control['selectedFrom']}})
                raise AssertionError(path)
        failure = {'checks': {'forcedOracleFailure': False}, 'failedChecks': ['forcedOracleFailure']}
        with patch.object(aiohttp, 'ClientSession', return_value=Session()), patch.object(driver, 'analyze_run', return_value=failure):
            report = await driver.run_plan('http://127.0.0.1:52900', run_prefix='perf-stop', repeats=3,
                                           warmup_seconds=0, round_seconds=0, regression=True)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(len(report['rounds']), 1)
        self.assertEqual(report['unexecutedRounds'], [2, 3])
        self.assertEqual(report['stoppedAfterRound'], 1)
        self.assertEqual(sum(path.endswith('/run') for _, path, _ in calls), 1)
        recorded = report['rounds'][0]['cancellationControl']
        self.assertEqual(set(recorded['requestIds']), set(control['requestIds']))
        self.assertEqual(recorded['responses'], control['responses'])
        self.assertTrue(all(row['state'] == 'pending' for row in recorded['selectedFrom']))


if __name__ == '__main__':
    unittest.main()
