"""Original optimization intents use the same durable non-executable barriers."""
import asyncio
import copy
import unittest

import test_optimization as base
from backend.contracts.errors import Conflict, InvalidInput, MissingRecord
from backend.generation.optimization import OptimizationFacade
from backend.providers.parameters import QWEN_MODEL


class OptimizationFenceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.case = base.OptimizationTests()
        self.case.setUp()
        self.facade, self.service, self.jobs = self.case.facade, self.case.service, self.case.core.jobs

    async def asyncTearDown(self):
        await self.case.asyncTearDown()

    async def intent(self, count=1):
        snapshots = [base.snapshot('row-' + str(i)) for i in range(count)]
        quote = await self.facade.estimate({'model': QWEN_MODEL, 'rows': snapshots})
        lease = await self.facade.lease({'target': self.case.target, 'instanceId': 'view-1'})
        return {'quoteId': quote['quoteId'], 'batchId': 'batch-1', 'range': {'scope': 'column', 'fieldId': 'prompt-1'},
                'rows': [{'requestId': 'request-' + str(i), 'snapshot': s,
                          'source': {**s['target'], 'nodeId': 'node', 'workflowSession': 'session', 'epoch': 0,
                                     'inputVersion': 1, 'inputDigest': s['snapshotDigest'], 'model': s['model']}}
                         for i, s in enumerate(snapshots)], 'leaseId': lease['leaseId'], 'budgetCredits': 0}

    async def test_fence_races_preflight_without_waiting_for_facade_lock_and_late_submit_cannot_execute(self):
        payload = await self.intent(2)
        provider = self.service.provider('local-qwen-text')
        entered, release = asyncio.Event(), asyncio.Event()
        original = provider.preflight
        async def delayed(snapshot):
            if snapshot['request_id'] == 'request-0':
                entered.set()
                await release.wait()
            return await original(snapshot)
        provider.preflight = delayed
        pending = asyncio.create_task(self.facade.submit(payload))
        try:
            await asyncio.wait_for(entered.wait(), 2)
            with self.assertRaises(MissingRecord): await self.facade.query({'batchId': 'batch-1'})
            report = await asyncio.wait_for(self.facade.fence(payload), 2)
            self.assertTrue(all(row['replacementAllowed'] for row in report['rows']))
        finally:
            release.set()
        late = await pending
        self.assertEqual([row['status'] for row in late['rows']], ['skipped', 'skipped'])
        for row in late['rows']:
            await self.service.dispatch(row['requestId'])
            self.assertNotIn('input', self.jobs.get(row['requestId'])['snapshot'])
        self.assertEqual(self.case.creates(), [])
        self.assertEqual((await self.facade.submit(payload))['rows'], late['rows'])
        self.assertEqual(len(self.jobs.list_jobs()), 2)

    async def test_fence_pending_cancels_but_never_overwrites_claimed_normal_fact(self):
        payload = await self.intent(2)
        await self.facade.submit(payload)
        job = self.jobs.get('request-0')
        self.jobs.begin_submission('request-0', expected_version=job['version'])
        facts = self.jobs.events('request-0')
        report = await self.facade.fence(payload)
        self.assertFalse(report['rows'][0]['replacementAllowed'])
        self.assertTrue(report['rows'][1]['replacementAllowed'])
        self.assertEqual(self.jobs.events('request-0'), facts)
        self.assertEqual(self.jobs.get('request-0')['state'], 'submitting')
        self.assertEqual(self.jobs.get('request-1')['state'], 'cancelled')
        self.assertEqual(self.case.creates(), [])

    async def test_barrier_survives_facade_restart_and_readonly_recovery_does_not_dispatch(self):
        payload = await self.intent()
        await self.facade.fence(payload)
        restarted = OptimizationFacade(self.service)
        events = self.jobs.events('request-0')
        report = await restarted.recover({'batchId': 'batch-1'})
        self.assertEqual(report['rows'][0]['status'], 'skipped')
        self.assertTrue(report['rows'][0]['replacementAllowed'])
        self.assertEqual(self.jobs.events('request-0'), events)
        self.assertEqual(self.case.creates(), [])
        with self.assertRaises(Conflict):
            await restarted.continue_batch({'batchId': 'batch-1', 'leaseId': 'unused', 'quoteId': 'unused', 'budgetCredits': 0})

    async def test_invalid_scope_or_snapshot_and_credentials_cannot_create_barrier(self):
        payload = await self.intent()
        for path, value in [('source', {'nodeId': 'wrong'}), ('digest', 'b' * 64), ('credential', 'synthetic-secret')]:
            value_payload = copy.deepcopy(payload)
            if path == 'source': value_payload['rows'][0]['source']['tableId'] = 'foreign'
            elif path == 'digest': value_payload['rows'][0]['source']['inputDigest'] = value
            else: value_payload['api_key'] = value
            with self.assertRaises((InvalidInput, Conflict)):
                await self.facade.fence(value_payload)
            self.assertEqual(self.jobs.list_jobs(), [])
        await self.facade.fence(payload)
        changed = copy.deepcopy(payload)
        changed['rows'][0]['source']['nodeId'] = 'other-node'
        with self.assertRaises(Conflict): await self.facade.fence(changed)
        self.assertEqual(len(self.jobs.list_jobs()), 1)

    def reference(self, payload):
        return {**{key: payload[key] for key in ('batchId', 'quoteId', 'range')},
                'references': [{'requestId': row['requestId'], 'source': row['source'],
                                'revision': row['snapshot']['revision'], 'requestSeq': row['snapshot']['requestSeq']}
                               for row in payload['rows']]}

    async def test_prompt_free_reference_can_fence_after_remount_and_late_full_prepare_cannot_cross(self):
        payload = await self.intent()
        reference = self.reference(payload)
        self.facade.quotes.clear()
        report = await OptimizationFacade(self.service).fence(reference)
        self.assertTrue(report['rows'][0]['replacementAllowed'])
        with self.assertRaises(Conflict): await self.facade.submit(payload)
        await self.service.dispatch('request-0')
        self.assertEqual(self.case.creates(), [])
        self.assertNotIn('input', self.jobs.get('request-0')['snapshot'])
        self.assertNotIn('prompt_text', str(self.jobs.get('request-0')))
        changed = copy.deepcopy(reference);changed['references'][0]['source']['inputDigest'] = 'b' * 64
        with self.assertRaises(Conflict): await self.facade.fence(changed)

    async def test_reference_fence_cancels_matching_pending_but_rejects_wrong_revision(self):
        payload = await self.intent()
        await self.facade.submit(payload)
        reference = self.reference(payload)
        wrong = copy.deepcopy(reference);wrong['references'][0]['revision'] += 1
        with self.assertRaises(Conflict): await self.facade.fence(wrong)
        self.assertEqual(self.jobs.get('request-0')['state'], 'pending')
        report = await self.facade.fence(reference)
        self.assertTrue(report['rows'][0]['replacementAllowed'])
        self.assertEqual(self.jobs.get('request-0')['state'], 'cancelled')

    async def test_real_http_envelope_accepts_prompt_free_fence_with_explicit_qwen_provider(self):
        from backend.generation.http import routes
        from test_integration import Request
        import json
        payload = {**self.reference(await self.intent()), 'contractVersion': 1, 'provider': 'qwen'}
        handlers = {(method, path): handler for method, path, handler in routes(self.service)}
        response = await handlers['POST', '/daelab/prompt-optimization/fence'](Request(payload))
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(response.text)['rows'][0]['replacementAllowed'])
