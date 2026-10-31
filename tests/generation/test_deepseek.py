"""Synthetic DeepSeek requests through the shared ledger. No cloud calls."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from backend.contracts.errors import InvalidInput, Conflict
from backend.providers.contracts import ProviderUnavailable, SubmissionUncertain, SubmissionRejected
from backend.providers.deepseek import DeepSeekProvider, request_key
from backend.generation.service import GenerationService
from backend.generation.optimization import OptimizationFacade
from backend.generation.http import routes
from backend.integrations.comfyui.services import CoreServices
from test_optimization import snapshot
from test_integration import Request


class Transport:
    def __init__(self):
        self.calls = []
        self.error = None
        self.text = 'A red cube slowly rotates.'

    async def create(self, body, key):
        self.calls.append((body, key))
        task_id = 'chat-' + str(len(self.calls))
        await asyncio.sleep(0)
        if self.error:
            raise self.error
        return {'id': task_id, 'choices': [{'finish_reason': 'stop', 'message': {'content': self.text}}],
                'usage': {'prompt_tokens': 32, 'completion_tokens': 8}}


class DeepSeekTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-deepseek-')
        root = Path(self.temp.name)
        for part in ('input', 'output'): (root / part).mkdir()
        self.core = CoreServices(root / 'user', root / 'input', root / 'output')
        self.transport = Transport()
        self.provider = DeepSeekProvider(transport=self.transport, read_frozen=lambda _: None)
        self.service = GenerationService(self.core.jobs, self.core.assets, providers={self.provider.id: self.provider})
        self.service.enabled_remote_providers.add(self.provider.id)
        self.facade = OptimizationFacade(self.service)
        self.handlers = {(m, p): fn for m, p, fn in routes(self.service)}

    async def asyncTearDown(self):
        await self.service.wait_idle()
        self.temp.cleanup()

    async def prepare(self, budget=None):
        s = snapshot(); s['model'] = 'deepseek-flash'
        quote = await self.facade.estimate({'model': s['model'], 'rows': [s]})
        self.assertGreater(quote['budgetUpperCredits'], 0)
        lease = await self.facade.lease({'target': {k: s['target'][k] for k in ('documentId', 'tableId')}, 'instanceId': 'view'})
        payload = {'batchId': 'batch', 'quoteId': quote['quoteId'], 'leaseId': lease['leaseId'],
                   'budgetCredits': quote['budgetUpperCredits'] if budget is None else budget,
                   'range': {'scope': 'column', 'fieldId': 'prompt-1'}, 'rows': [{'requestId': 'row', 'snapshot': s}]}
        report = await self.facade.submit(payload)
        permit_input = {'batchId': 'batch', 'requestId': 'row', 'leaseId': lease['leaseId'], **{k: s[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}}
        permit = await self.facade.permit(permit_input)
        return {**permit_input, 'provider': 'deepseek', 'permitId': permit['permitId']}, report

    async def test_table_budget_key_gate_and_single_submission(self):
        args, report = await self.prepare()
        self.assertEqual(report['provider'], 'deepseek')
        self.assertEqual(self.transport.calls, [])
        with self.assertRaises(ProviderUnavailable): await self.facade.advance(args)
        self.assertIn(args['permitId'], self.facade.permits)
        token = request_key.set('synthetic-page-secret')
        try: await self.facade.advance(args)
        finally: request_key.reset(token)
        await self.service.wait_idle()
        with self.assertRaises(Conflict):
            token = request_key.set('synthetic-page-secret')
            try: await self.facade.advance(args)
            finally: request_key.reset(token)
        result = await self.facade.query({'batchId': 'batch'})
        self.assertEqual(result['rows'][0]['status'], 'succeeded')
        self.assertEqual(result['rows'][0]['suggestion']['status'], 'valid')
        self.assertEqual(len(self.transport.calls), 1)
        body, key = self.transport.calls[0]
        self.assertEqual(key, 'synthetic-page-secret')
        self.assertEqual(body['model'], 'deepseek-flash')
        self.assertEqual(body['thinking'], {'type': 'disabled'})
        self.assertNotIn(key, json.dumps(self.core.jobs.get('row')))
        self.assertEqual(request_key.get(), '')

    async def test_insufficient_budget_creates_no_job(self):
        with self.assertRaises(InvalidInput): await self.prepare(budget=0)
        self.assertEqual(self.core.jobs.list_jobs(), [])

    async def test_ambiguous_delivery_is_never_replayed(self):
        self.provider.key_resolver = lambda: 'synthetic-server-secret'
        self.transport.error = SubmissionUncertain()
        args, _ = await self.prepare()
        await self.facade.advance(args); await self.service.wait_idle()
        await self.facade.recover({'batchId': 'batch'}); await self.service.wait_idle()
        self.assertEqual(len(self.transport.calls), 1)
        self.assertEqual(self.core.jobs.get('row')['state'], 'unknown')

    async def test_standalone_http_keys_are_isolated_and_not_persisted(self):
        async def polish(number):
            payload = {'contractVersion': 1, 'model': 'deepseek', 'requestId': 'canvas-' + str(number),
                       'mode': 'polish', 'source': 'A red cube rotates.', 'instruction': 'Clarify.'}
            return await self.handlers['POST', '/daelab/prompt-optimization/polish'](
                Request(payload, headers={'X-DAELab-DeepSeek-Key': 'synthetic-secret-' + str(number)}))
        results = await asyncio.gather(polish(1), polish(2))
        self.assertEqual([r.status for r in results], [200, 200])
        self.assertEqual({key for _, key in self.transport.calls}, {'synthetic-secret-1', 'synthetic-secret-2'})
        for job in self.core.jobs.list_jobs(): self.assertNotIn('synthetic-secret', json.dumps(job))
        self.assertEqual(request_key.get(), '')

    async def test_transport_assigns_distinct_ids_before_yielding(self):
        replies = await asyncio.gather(self.transport.create({}, 'synthetic-1'),
                                       self.transport.create({}, 'synthetic-2'))
        self.assertEqual([reply['id'] for reply in replies], ['chat-1', 'chat-2'])

    async def test_rejection_and_truncated_response_are_not_success(self):
        self.provider.key_resolver = lambda: 'synthetic-server-secret'
        self.transport.error = SubmissionRejected('HTTP 401')
        args, _ = await self.prepare()
        await self.facade.advance(args); await self.service.wait_idle()
        self.assertEqual(self.core.jobs.get('row')['state'], 'failed')
        self.assertEqual(self.core.jobs.get('row')['error_code'], 'definitely_rejected')

    async def test_invalid_protected_reference_result_is_rejected(self):
        self.provider.key_resolver = lambda: 'synthetic-server-secret'
        self.transport.text = 'Bad invented reference ⟦DAE_REF_new_1⟧'
        args, _ = await self.prepare()
        await self.facade.advance(args); await self.service.wait_idle()
        self.assertEqual(self.core.jobs.get('row')['error_code'], 'protected_reference_violation')
