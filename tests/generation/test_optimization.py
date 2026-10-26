"""Optimization UI lifecycle against the one durable job ledger, no inference."""
import asyncio
import copy
import json
from pathlib import Path
import tempfile
import unittest

from backend.contracts.errors import Conflict
from backend.generation.optimization import OptimizationFacade
from backend.generation.http import routes
from backend.generation.service import GenerationService
from backend.integrations.comfyui.services import CoreServices
from backend.providers.qwen import QwenProvider
from backend.providers.parameters import QWEN_MODEL
from backend.providers.contracts import SubmissionRejected, SubmissionUncertain
from backend.providers.optimization_instructions import INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION
from test_service import Admission
from test_integration import Request
from qwen_test_binding import binding_fixture


def snapshot(record='row-1'):
    inp = {'purpose': 'image', 'optimization_requirements': 'Clarify the action.', 'prompt_text': 'A red cube rotates.', 'protected_tokens': [], 'reference_context': []}
    return {'contractVersion': 1, 'target': {'documentId': 'doc-1', 'tableId': 'table-1', 'recordId': record, 'fieldId': 'prompt-1'},
            'revision': 1, 'requestSeq': 2, 'snapshotDigest': 'a' * 64, 'model': QWEN_MODEL, 'requirements': 'Clarify the action.', 'purpose': 'image',
            'instructionVersion': INSTRUCTION_VERSION, 'instructionDigest': INSTRUCTION_DIGEST, 'inputVersion': INPUT_VERSION,
            'maxOutputTokens': 128, 'input': inp, 'inputText': json.dumps(inp, ensure_ascii=False, separators=(',', ':'))}


class Transport:
    def __init__(self): self.calls=[];self.error=None;self.gate=None
    async def request(self, action, body=None):
        self.calls.append((action, body))
        if action == 'tags': return {'models': [{'name': QWEN_MODEL,'digest':self.digest}]}
        if action == 'ps': return {'models':[]}
        if self.gate: await self.gate.wait()
        if self.error: raise self.error
        return {'done': True, 'done_reason': 'stop', 'response': 'A red cube slowly rotates.', 'eval_count': 8}


class OptimizationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='studio-optimization-');self.root=Path(self.temp.name)
        for part in ('input','output'): (self.root/part).mkdir()
        self.core=CoreServices(self.root/'user',self.root/'input',self.root/'output')
        self.transport=Transport();self.admission=Admission()
        binding=binding_fixture(self.root/'registry');self.transport.digest=binding.expected_manifest_sha256
        provider=QwenProvider(transport=self.transport,read_frozen=lambda _:None,binding=binding)
        self.service=GenerationService(self.core.jobs,self.core.assets,providers={provider.id:provider},admission=self.admission,poll_interval=0)
        self.facade=OptimizationFacade(self.service)
        self.target={'documentId':'doc-1','tableId':'table-1'}
    async def asyncTearDown(self):
        if self.transport.gate:self.transport.gate.set()
        await self.service.wait_idle();self.temp.cleanup()
    async def prepare(self,count=1,batch='batch-1'):
        snapshots=[snapshot('row-'+str(i)) for i in range(count)]
        q=await self.facade.estimate({'model':QWEN_MODEL,'rows':snapshots})
        lease=await self.facade.lease({'target':self.target,'instanceId':'view-1'})
        p={'quoteId':q['quoteId'],'batchId':batch,'range':{'scope':'column','fieldId':'prompt-1'},'rows':[{'requestId':batch+'-request-'+str(i),'snapshot':s} for i,s in enumerate(snapshots)],'leaseId':lease['leaseId'],'budgetCredits':0}
        report=await self.facade.submit(p)
        return report,lease,p
    async def advance(self,report,lease,index=0):
        row=report['rows'][index];s=row['snapshot']
        p={'batchId':report['batchId'],'requestId':row['requestId'],'leaseId':lease['leaseId'],**{k:s[k] for k in ('snapshotDigest','revision','requestSeq')}}
        permit=await self.facade.permit(p)
        p['permitId']=permit['permitId'];p['provider']='qwen'
        return await self.facade.advance(p),p
    def creates(self): return [c for c in self.transport.calls if c[0]=='generate']

    async def test_estimate_and_submit_are_nonexecuting_then_one_shot_advance_and_readonly_query(self):
        report,lease,_=await self.prepare(2)
        self.assertEqual(self.creates(),[])
        self.assertEqual({j['state'] for j in self.core.jobs.list_jobs()},{'pending'})
        _,p=await self.advance(report,lease)
        with self.assertRaises(Conflict):await self.facade.advance(p)
        await self.service.wait_idle()
        report=await self.facade.query({'batchId':'batch-1'})
        self.assertEqual([r['status'] for r in report['rows']],['succeeded','queued'])
        self.assertEqual(report['rows'][0]['suggestion']['status'],'valid')
        self.assertIsNone(report['rows'][0]['actualCredits'])
        self.assertEqual(len(self.creates()),1)
        facts=self.core.jobs.events('batch-1-request-0')
        await self.facade.query({'target':self.target});await self.facade.query({'batchId':'batch-1'})
        self.assertEqual(self.core.jobs.events('batch-1-request-0'),facts)

    async def test_restart_pauses_pending_and_recover_never_creates(self):
        report,lease,_=await self.prepare()
        self.facade=OptimizationFacade(self.service)
        report=await self.facade.recover({'batchId':'batch-1'})
        self.assertTrue(report['paused']);self.assertEqual(self.creates(),[])
        lease=await self.facade.lease({'target':self.target,'instanceId':'view-2'})
        with self.assertRaises(Conflict):await self.advance(report,lease)
        q=await self.facade.estimate({'model':QWEN_MODEL,'rows':[r['snapshot'] for r in report['rows']]})
        report=await self.facade.continue_batch({'batchId':'batch-1','leaseId':lease['leaseId'],'quoteId':q['quoteId'],'budgetCredits':0})
        await self.advance(report,lease);await self.service.wait_idle();self.assertEqual(len(self.creates()),1)

    async def test_stop_while_waiting_for_resource_rechecks_before_external_boundary(self):
        report,lease,_=await self.prepare()
        await self.admission.lock.acquire()
        await self.advance(report,lease)
        await self.facade.stop({'batchId':'batch-1','leaseId':lease['leaseId']})
        self.admission.lock.release();await self.service.wait_idle()
        self.assertEqual(self.creates(),[])
        self.assertEqual(self.core.jobs.get('batch-1-request-0')['state'],'pending')
        self.assertEqual((await self.facade.query({'batchId':'batch-1'}))['rows'][0]['status'],'stopped')

    async def test_foreign_instance_stale_revision_expired_permit_and_overlap_reject(self):
        report,lease,p=await self.prepare()
        with self.assertRaises(Conflict):await self.facade.lease({'target':self.target,'instanceId':'view-2'})
        row=report['rows'][0];s=row['snapshot'];base={'batchId':'batch-1','requestId':row['requestId'],'leaseId':lease['leaseId'],**{k:s[k] for k in ('snapshotDigest','revision','requestSeq')}}
        with self.assertRaises(Conflict):await self.facade.permit({**base,'revision':99})
        permit=await self.facade.permit(base);self.facade.permits[permit['permitId']]['expiresAt']=0
        with self.assertRaises(Conflict):await self.facade.advance({**base,'permitId':permit['permitId']})
        p=copy.deepcopy(p);p['batchId']='other';p['rows'][0]['requestId']='other-request'
        with self.assertRaises(Conflict):await self.facade.submit(p)
        self.assertEqual(self.creates(),[])

    async def test_skip_changes_only_never_sent_row_and_preserves_other_targets(self):
        report,lease,_=await self.prepare(2)
        await self.facade.skip({'batchId':'batch-1','requestId':report['rows'][0]['requestId'],'leaseId':lease['leaseId']})
        report=await self.facade.query({'batchId':'batch-1'})
        self.assertEqual([r['status'] for r in report['rows']],['skipped','queued'])
        await self.advance(report,lease,1);await self.service.wait_idle();self.assertEqual(len(self.creates()),1)

    async def test_known_429_and_ambiguous_500_retain_distinct_facts_without_replay(self):
        for error,state in [(SubmissionRejected('429'), 'failed'), (SubmissionUncertain('500'),'unknown')]:
            with self.subTest(state=state):
                self.transport.error=error
                # Different target avoids overlap; previous terminal facts remain.
                report,lease,_=await self.prepare(batch='batch-'+state)
                await self.advance(report,lease);await self.service.wait_idle()
                self.assertEqual(self.core.jobs.get('batch-'+state+'-request-0')['state'],state)
                before=len(self.creates())
                for _ in range(4):await self.facade.recover({'batchId':'batch-'+state})
                await self.service.wait_idle();self.assertEqual(len(self.creates()),before)

    async def test_stopped_range_can_be_replaced_but_old_continue_cannot_overlap(self):
        report,lease,_=await self.prepare()
        await self.facade.stop({'batchId':'batch-1','leaseId':lease['leaseId']})
        await self.prepare(batch='replacement')
        q=await self.facade.estimate({'model':QWEN_MODEL,'rows':[r['snapshot'] for r in report['rows']]})
        with self.assertRaises(Conflict):
            await self.facade.continue_batch({'batchId':'batch-1','leaseId':lease['leaseId'],'quoteId':q['quoteId'],'budgetCredits':0})
        self.assertEqual(self.creates(),[])

    async def test_batch_identity_cannot_append_or_replace_rows_on_replay(self):
        report,lease,p=await self.prepare()
        self.assertEqual((await self.facade.submit(p))['batchId'],report['batchId'])
        p=copy.deepcopy(p);p['rows'][0]['requestId']='replacement'
        with self.assertRaises(Conflict):await self.facade.submit(p)
        self.assertEqual(len(self.core.jobs.list_jobs()),1);self.assertEqual(self.creates(),[])

    async def test_canvas_polish_freezes_optional_scope_and_returns_ledger_receipt(self):
        handler={(m,p):h for m,p,h in routes(self.service)}['POST','/daelab/prompt-optimization/polish']
        scope={'documentId':'node','workflowSession':'session','epoch':3,'fieldId':'prompt','inputVersion':7}
        payload={'contractVersion':1,'requestId':'canvas-request','model':'qwen','mode':'polish','source':'A red cube','instruction':'Clarify','sourceScope':scope}
        response=await handler(Request(payload));self.assertEqual(response.status,200)
        report=__import__('json').loads(response.text)
        self.assertEqual(report['source'],scope);self.assertEqual(report['state'],'succeeded')
        self.assertEqual(report['receipt']['text'],report['result']);self.assertEqual(len(report['inputFingerprint']),64)
        self.assertEqual(self.core.jobs.get('canvas-request')['source'],scope)
        payload['sourceScope']={**scope,'workflowSession':'different'}
        response=await handler(Request(payload));self.assertEqual(response.status,409);self.assertEqual(len(self.creates()),1)

    async def test_http_capability_fixture_and_contract_version_are_explicit(self):
        handlers={(m,p):h for m,p,h in routes(self.service)}
        handler=handlers['POST','/daelab/prompt-optimization/capabilities']
        response=await handler(Request({'contractVersion':1,'model':QWEN_MODEL}))
        self.assertEqual(response.status,200);self.assertTrue(json.loads(response.text)['available'])
        response=await handler(Request({'contractVersion':999,'model':QWEN_MODEL}))
        self.assertEqual(response.status,400)
        response=await handler(Request({'contractVersion':1,'model':'deepseek-flash'}))
        self.assertEqual(response.status,503);self.assertEqual(self.creates(),[])

    async def test_async_facade_db_reads_leave_loop_while_control_authority_stays_on_loop(self):
        from contextlib import ExitStack
        import threading
        from unittest.mock import patch
        owner = threading.get_ident()
        def guard(fn, off_loop):
            def invoke(*args, **kwargs):
                self.assertEqual(threading.get_ident() != owner, off_loop)
                return fn(*args, **kwargs)
            return invoke
        with ExitStack() as stack:
            for name in ('get', 'list_jobs', 'create_or_get', 'request_cancel', 'begin_submission', 'transition', 'mark_submitted'):
                original = getattr(self.core.jobs, name)
                stack.enter_context(patch.object(self.core.jobs, name, guard(original, True)))
            for name in ('_control', '_quote', '_lease'):
                stack.enter_context(patch.object(self.facade, name, guard(getattr(self.facade, name), False)))
            report, lease, payload = await self.prepare(2)
            await self.facade.query({'target': self.target})
            await self.facade.query({'batchId': 'batch-1'})
            await self.facade.stop({'batchId': 'batch-1', 'leaseId': lease['leaseId']})
            await self.facade.continue_batch({'batchId': 'batch-1', 'leaseId': lease['leaseId'], 'quoteId': payload['quoteId'], 'budgetCredits': 0})
            await self.advance(report, lease)
            await self.service.wait_idle()
            await self.facade.skip({'batchId': 'batch-1', 'requestId': report['rows'][1]['requestId'], 'leaseId': lease['leaseId']})
            await self.facade.recover({'batchId': 'batch-1'})
        self.assertEqual(len(self.creates()), 1)
        self.assertEqual([j['state'] for j in self.core.jobs.list_jobs()][::-1].count('cancelled'), 1)
