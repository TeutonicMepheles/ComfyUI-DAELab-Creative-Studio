import asyncio
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.integrations.comfyui.services import CoreServices
from backend.providers.parameters import IMAGE_MODEL,QWEN_MODEL,VIDEO_MODEL
from backend.providers.optimization_instructions import INSTRUCTION_VERSION,INSTRUCTION_DIGEST,INPUT_VERSION

ROOT=Path(__file__).resolve().parents[2]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
fixture=module('generation_fixture','tests/host_fixture/generation_fixture.py')
nodes=module('generation_fixture_nodes','tests/host_fixture/generation_fixture_nodes.py')

class Request:
    remote='127.0.0.1';host='127.0.0.1:8226';headers={}
    def __init__(self,body=None,query=None):self.body=body;self.query=query or {}
    async def json(self):return self.body

def image_job(identity='request-1',document='doc-A'):
    return {'requestId':identity,'source':{'documentId':document,'tableId':'table','recordId':'row','fieldId':'field'},
            'input':{'config':{'model':IMAGE_MODEL,'kind':'image','mode':'text2image','settings':{'seed':4}},'segments':[{'type':'text','text':'public synthetic cube'}]}}

def optimization_snapshot():
    inp={'purpose':'image','optimization_requirements':'Clarify action','prompt_text':'A cube beside ⟦DAE_REF_fixture_0001⟧','protected_tokens':['⟦DAE_REF_fixture_0001⟧'],'reference_context':[{'token':'⟦DAE_REF_fixture_0001⟧','kind':'image','label':'reference'}]}
    return {'contractVersion':1,'target':{'documentId':'opt-doc','tableId':'opt-table','recordId':'row','fieldId':'prompt'},'revision':0,'requestSeq':1,'snapshotDigest':'a'*64,'model':QWEN_MODEL,
            'requirements':'Clarify action','purpose':'image','instructionVersion':INSTRUCTION_VERSION,'instructionDigest':INSTRUCTION_DIGEST,'inputVersion':INPUT_VERSION,'maxOutputTokens':128,
            'input':inp,'inputText':json.dumps(inp,ensure_ascii=False,separators=(',',':'))}

class FixtureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='studio-host-fixture-');self.root=Path(self.temp.name)
        for part in ('input','output'):(self.root/part).mkdir()
        self.core=CoreServices(self.root/'user',self.root/'input',self.root/'output')
        self.fixture=fixture.assemble_generation_fixture(self.core,enabled=True,poll_interval=.001)
    async def asyncTearDown(self):
        await self.fixture.close();self.temp.cleanup()
    def handlers(self):return {(m,p):h for m,p,h in fixture.fixture_routes(self.fixture)}
    async def until(self,condition):
        for _ in range(300):
            if condition():return
            await asyncio.sleep(.002)
        self.fail('Fixture condition did not become observable')
    def arm(self,scenario='success',fault='none'):self.fixture.arm({'scenario':scenario,'httpFault':fault})

    async def test_namespace_fence_is_owned_and_blocks_late_original_after_http_429(self):
        self.arm(fault='preflight-429')
        item=image_job('fenced-original')
        item['source'].update(nodeId='node',inputDigest='a'*64,model=IMAGE_MODEL)
        handlers=self.handlers()
        submit=handlers['POST',fixture.PREFIX+'/api/daelab/studio/generation/submit']
        fence=handlers['POST',fixture.PREFIX+'/api/daelab/studio/generation/fence-unsubmitted']
        response=await submit(Request({'jobs':[item]}))
        self.assertEqual(response.status,429);self.assertEqual(self.core.jobs.list_jobs(),[])
        payload={'requestId':item['requestId'],'source':item['source'],'inputDigest':'a'*64,'model':IMAGE_MODEL}
        response=await fence(Request(payload))
        self.assertEqual(response.status,200)
        self.assertTrue(json.loads(response.text)['jobs'][0]['replacementAllowed'])
        self.fixture.require_owned(item['requestId'])
        response=await submit(Request({'jobs':[item]}))
        self.assertEqual(response.status,200)
        await self.fixture.service.wait_idle()
        self.assertEqual(self.core.jobs.get(item['requestId'])['attempt'],0)
        self.assertEqual(len(self.fixture.jobs()),1)
        self.core.jobs.create_or_get('foreign-original',provider='local-qwen-image',execution_kind='local',snapshot={'preparation':'fenced'},source=item['source'])
        response=await fence(Request({**payload,'requestId':'foreign-original'}))
        self.assertEqual(response.status,409)
        opt_fence=handlers['POST',fixture.PREFIX+'/api/daelab/prompt-optimization/fence']
        response=await opt_fence(Request({'rows':[{'requestId':'foreign-original'}]}))
        self.assertEqual(response.status,409)

    async def test_requires_explicit_enable_and_armed_capability_no_models_or_video_claim(self):
        with self.assertRaises(ValueError):fixture.assemble_generation_fixture(self.core)
        with self.assertRaises(Exception):await self.fixture.service.capabilities(IMAGE_MODEL)
        self.arm();caps=await self.fixture.service.capabilities(IMAGE_MODEL)
        self.assertEqual(caps['fixture'],fixture.VERSION);self.assertEqual(caps['realProviderHealth'],'not_checked')
        with self.assertRaises(Exception):await self.fixture.service.capabilities(VIDEO_MODEL)
        self.assertEqual(self.core.jobs.list_jobs(),[])

    async def test_scope_discovery_cannot_expose_non_fixture_tasks(self):
        self.arm()
        scope={'documentId':'fixture-scope','tableId':'table','nodeId':'node'}
        item=image_job('fixture-owned','fixture-scope');item['source'].update(nodeId='node')
        await self.fixture.service.prepare_batch([item])
        handler=self.handlers()['POST',fixture.PREFIX+'/api/daelab/studio/generation/status']
        response=await handler(Request({'source':scope}))
        self.assertEqual(response.status,200)
        self.assertEqual([job['requestId'] for job in json.loads(response.text)['jobs']],['fixture-owned'])
        self.core.jobs.create_or_get('production-private',provider='disabled',execution_kind='local',snapshot={'synthetic':True},source=scope)
        response=await handler(Request({'source':scope}))
        self.assertEqual(response.status,409)
        self.assertNotIn('production-private',response.text)

    async def test_preflight_rejection_has_exact_missing_identity_evidence_without_replay(self):
        self.arm(fault='preflight-429')
        handlers=self.handlers()
        submit=handlers['POST',fixture.PREFIX+'/api/daelab/studio/generation/submit']
        status=handlers['POST',fixture.PREFIX+'/api/daelab/studio/generation/status']
        response=await submit(Request({'jobs':[image_job('never-created')]}))
        self.assertEqual(response.status,429)
        response=await status(Request({'requestIds':['never-created']}))
        self.assertEqual(response.status,404)
        self.assertEqual(json.loads(response.text)['code'],'record_not_found')
        self.assertEqual(self.core.jobs.list_jobs(),[])

    async def test_success_uses_real_png_and_shared_ledger_validator(self):
        self.arm();await self.fixture.service.submit([image_job()]);await self.fixture.service.wait_idle()
        report=self.fixture.service.public('request-1')
        self.assertEqual(report['state'],'succeeded');self.assertEqual(report['source']['documentId'],'doc-A')
        receipt=report['receipt'];self.core.assets.validate_result_receipt(receipt)
        from PIL import Image
        asset=self.core.assets.get(receipt['items'][0]['asset_id']);ref=asset['references'][0]
        path,_=self.core.assets.resolve_reference(ref['root_key'],ref['relative_path'])
        with Image.open(path) as image:self.assertEqual(image.size,(8,8));image.load()
        self.assertEqual(self.fixture.counts['create'],1)

    async def test_two_delayed_documents_release_in_reverse_order_without_cross_write(self):
        self.arm('overlapping');await self.fixture.service.submit([image_job('A','doc-A'),image_job('B','doc-B')])
        await self.until(lambda:self.fixture.counts['create']==2)
        self.fixture.release('B');await self.until(lambda:self.core.jobs.get('B')['state']=='succeeded')
        self.assertNotEqual(self.core.jobs.get('A')['state'],'succeeded')
        self.assertEqual(self.core.jobs.get('B')['source']['documentId'],'doc-B')
        self.fixture.release('A');await self.fixture.service.wait_idle()
        self.assertNotEqual(self.fixture.service.public('A')['result']['sha256'],self.fixture.service.public('B')['result']['sha256'])
        self.assertEqual(self.fixture.counts['create'],2)

    async def test_429_rejection_and_500_uncertainty_have_distinct_durable_facts(self):
        self.arm('fail-429');await self.fixture.service.submit([image_job('rejected')]);await self.fixture.service.wait_idle()
        self.assertEqual(self.core.jobs.get('rejected')['state'],'failed')
        self.arm('uncertain-500');await self.fixture.service.submit([image_job('accepted')]);await self.fixture.service.wait_idle()
        self.assertEqual(self.core.jobs.get('accepted')['state'],'unknown')
        before=self.fixture.counts['create'];await self.fixture.service.recover('accepted')
        self.assertEqual(self.core.jobs.get('accepted')['state'],'succeeded');self.assertEqual(self.fixture.counts['create'],before)

    async def test_no_id_uncertainty_cannot_be_fabricated_into_a_success(self):
        self.arm('uncertain-no-id');await self.fixture.service.submit([image_job()]);await self.fixture.service.wait_idle()
        for _ in range(3):await self.fixture.service.recover('request-1')
        self.assertEqual(self.core.jobs.get('request-1')['state'],'unknown');self.assertEqual(self.fixture.counts['create'],1)
        self.assertEqual(list((self.root/'output').iterdir()),[])

    async def test_restart_stops_workers_and_recovery_never_dispatches_pending(self):
        self.arm('delayed');await self.fixture.service.submit([image_job('active')])
        await self.until(lambda:self.core.jobs.get('active')['state']=='running')
        await self.fixture.service.prepare_batch([image_job('pending')])
        before=self.fixture.counts['create'];await self.fixture.restart()
        self.assertEqual(self.core.jobs.get('active')['state'],'needs_recovery')
        self.assertEqual(self.core.jobs.get('pending')['state'],'pending')
        self.fixture.release('active');await self.fixture.service.recover('active');await self.fixture.service.recover('pending')
        self.assertEqual(self.core.jobs.get('active')['state'],'succeeded');self.assertEqual(self.fixture.counts['create'],before)
        self.assertEqual(len(self.core.jobs.attempts('active')),1);self.assertEqual(self.core.jobs.attempts('pending'),[])

    async def test_fresh_controller_queries_original_receipt_after_prior_workers_stopped(self):
        self.arm('uncertain-500');await self.fixture.service.submit([image_job()]);await self.fixture.service.wait_idle();await self.fixture.close()
        self.fixture=fixture.assemble_generation_fixture(self.core,enabled=True,poll_interval=.001)
        await self.fixture.service.recover('request-1')
        self.assertEqual(self.core.jobs.get('request-1')['state'],'succeeded');self.assertEqual(self.fixture.counts['create'],0)

    async def test_cancellation_and_foreign_restart_guard_are_scoped(self):
        self.arm('overlapping');await self.fixture.service.submit([image_job('A'),image_job('B')])
        await self.until(lambda:self.fixture.counts['create']==2)
        await self.fixture.service.cancel('A');self.fixture.release('B');await self.fixture.service.wait_idle()
        self.assertEqual(self.core.jobs.get('A')['state'],'cancelled');self.assertEqual(self.core.jobs.get('B')['state'],'succeeded')
        foreign,_=self.core.jobs.create_or_get('foreign',provider='other',execution_kind='remote',snapshot={'input':{},'prepared':{}})
        self.core.jobs.begin_submission('foreign',expected_version=foreign['version'])
        with self.assertRaises(self.fixture.product.errors.Conflict):await self.fixture.restart()
        self.assertEqual(self.core.jobs.get('foreign')['state'],'submitting')

    async def test_cancel_intent_between_provider_ack_and_receipt_commit_keeps_owned_task_identity(self):
        self.arm('overlapping')
        entered, resume = threading.Event(), threading.Event()
        original = self.core.jobs.mark_submitted
        versions = []
        def delayed_ack(request_id, task_id, **kwargs):
            if request_id == 'A':
                versions.append(kwargs['expected_version'])
                if len(versions) == 1:
                    entered.set()
                    if not resume.wait(5):
                        raise AssertionError('Test did not release the accepted receipt commit')
            return original(request_id, task_id, **kwargs)
        with patch.object(self.core.jobs, 'mark_submitted', delayed_ack):
            await self.fixture.service.submit([image_job('A'), image_job('B')])
            try:
                await self.until(entered.is_set)
                interim = await self.fixture.service.cancel('A')
                self.assertTrue(interim['cancel_requested'])
                self.assertIsNone(interim['provider_task_id'])
                self.fixture.release('B')
            finally:
                resume.set()
            await self.fixture.service.wait_idle()
        a, b = self.core.jobs.get('A'), self.core.jobs.get('B')
        self.assertEqual(a['state'], 'cancelled', self.core.jobs.events('A'))
        self.assertTrue(a['provider_task_id'].startswith('fixture-'))
        self.assertEqual(b['state'], 'succeeded')
        self.assertEqual(self.fixture.counts['create'], 2)
        self.assertEqual(self.fixture.counts['cancel'], 1)
        self.assertEqual(len(self.core.jobs.attempts('A')), 1)
        self.assertEqual(len(self.core.jobs.attempts('B')), 1)
        self.assertGreaterEqual(len(versions), 2, 'The original receipt must retry its strict CAS without repeating create')

    async def test_http_faults_are_once_only_and_lost_response_preserves_query_identity(self):
        handler=self.handlers()['POST',fixture.PREFIX+'/api/daelab/studio/generation/submit']
        for fault,status in [('preflight-429',429),('before-submit-500',500),('input-error',400),('version-mismatch',409)]:
            self.arm(fault=fault);response=await handler(Request({'jobs':[image_job(fault)]}));self.assertEqual(response.status,status)
            self.assertFalse(json.loads(response.text)['submitted'])
        self.assertEqual(self.core.jobs.list_jobs(),[])
        self.arm(fault='after-submit-500');response=await handler(Request({'jobs':[image_job('lost')]}))
        self.assertEqual(response.status,500);self.assertNotIn('submitted',json.loads(response.text))
        await self.fixture.service.wait_idle();before=self.fixture.counts['create']
        status=self.handlers()['POST',fixture.PREFIX+'/api/daelab/studio/generation/status']
        response=await status(Request({'requestIds':['lost']}));self.assertEqual(response.status,200)
        self.assertEqual(json.loads(response.text)['jobs'][0]['state'],'succeeded');self.assertEqual(self.fixture.counts['create'],before)

    async def test_loopback_and_foreign_task_http_boundaries(self):
        state=self.handlers()['GET',fixture.PREFIX+'/state'];request=Request();request.remote='192.0.2.1'
        self.assertEqual((await state(request)).status,403)
        request=Request();request.headers={'Origin':'https://example.test'};self.assertEqual((await state(request)).status,403)
        self.core.jobs.create_or_get('foreign',provider='other',execution_kind='remote',snapshot={})
        status=self.handlers()['POST',fixture.PREFIX+'/api/daelab/studio/generation/status']
        self.assertEqual((await status(Request({'requestIds':['foreign']}))).status,409)

    async def test_table_optimization_uses_real_dtos_and_protected_reference_review(self):
        self.arm();facade=self.fixture.service._optimization_facade;snapshot=optimization_snapshot()
        quote=await facade.estimate({'model':QWEN_MODEL,'rows':[snapshot]})
        lease=await facade.lease({'target':{'documentId':'opt-doc','tableId':'opt-table'},'instanceId':'view'})
        batch=await facade.submit({'quoteId':quote['quoteId'],'batchId':'batch','range':{'scope':'cell','recordId':'row','fieldId':'prompt'},'rows':[{'requestId':'text','snapshot':snapshot}],'leaseId':lease['leaseId'],'budgetCredits':0})
        self.assertEqual(self.fixture.counts['create'],0)
        payload={'batchId':'batch','requestId':'text','leaseId':lease['leaseId'],**{k:snapshot[k] for k in ('revision','requestSeq','snapshotDigest')}}
        permit=await facade.permit(payload);await facade.advance({**payload,'permitId':permit['permitId']});await self.fixture.service.wait_idle()
        batch=await facade.query({'batchId':'batch'});self.assertEqual(batch['rows'][0]['suggestion']['status'],'valid')
        self.assertIn('⟦DAE_REF_fixture_0001⟧',batch['rows'][0]['suggestion']['text']);self.assertEqual(snapshot['input']['prompt_text'],'A cube beside ⟦DAE_REF_fixture_0001⟧')

    async def test_registration_and_diagnostic_node_are_test_only_and_nonexecuting(self):
        from aiohttp import web
        server=SimpleNamespace(routes=web.RouteTableDef());paths=fixture.register_generation_fixture_routes(server,self.fixture)
        self.assertEqual(len(paths),25);self.assertTrue(all(path.startswith(fixture.PREFIX) for path in paths))
        self.assertEqual(fixture.register_generation_fixture_routes(server,self.fixture),())
        mappings,_=nodes.register_generation_fixture_nodes(self.fixture);report=json.loads(mappings[nodes.NODE_ID]().read('test')[0])
        self.assertFalse(report['modelInference']);self.assertEqual(report['counts'],{})
        self.assertNotIn(nodes.NODE_ID,(ROOT/'__init__.py').read_text(encoding='utf-8'))

class StaticTests(unittest.TestCase):
    def test_fixture_import_has_no_product_host_model_network_or_subprocess_dependency(self):
        source=(ROOT/'tests/host_fixture/generation_fixture.py').read_text(encoding='utf-8')
        self.assertNotIn('LoopbackOllama',source);self.assertNotIn('prompt_queue',source)
        code="import runpy,socket,subprocess,asyncio; socket.create_connection=lambda *a,**k:(_ for _ in ()).throw(AssertionError('network')); subprocess.Popen=lambda *a,**k:(_ for _ in ()).throw(AssertionError('process')); runpy.run_path("+repr(str(ROOT/'tests/host_fixture/generation_fixture.py'))+")"
        result=subprocess.run([sys.executable,'-c',code],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)


class ResourceCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    setUp = FixtureTests.setUp
    asyncTearDown = FixtureTests.asyncTearDown
    until = FixtureTests.until
    arm = FixtureTests.arm
    async def test_fixture_reuses_core_gate_and_never_adds_a_product_resource_alias(self):
        from contextlib import AsyncExitStack
        self.assertIs(self.fixture.service.resources, self.core.resources)
        with self.assertRaises(self.fixture.product.contracts.ProviderUnavailable):
            self.core.resources.check_available('fixture-no-gpu')
        self.arm()
        async with AsyncExitStack() as stack:
            for index in range(3):
                await stack.enter_async_context(self.core.resources.lease('cloud', request_id='shared-' + str(index)))
            await self.fixture.service.submit([image_job('waiting')])
            await self.until(lambda: self.core.resources.snapshot()['resources']['cloud']['queued'] == 1)
            self.assertEqual(self.fixture.counts['create'], 0)
        await self.fixture.service.wait_idle()
        self.assertEqual(self.core.jobs.get('waiting')['state'], 'succeeded')
        self.assertEqual(self.core.jobs.get('waiting')['snapshot']['resource'], 'cloud')

    async def test_legacy_fixture_unknown_restores_shared_capacity_without_mutating_facts_or_recreating(self):
        import copy
        self.arm()
        seed = (await self.fixture.service.prepare_batch([image_job('seed')]))[0]
        snapshot = copy.deepcopy(seed['snapshot'])
        snapshot.update(request_id='legacy', resource='fixture-no-gpu')
        snapshot['prepared']['originalRequestId'] = 'legacy'
        job, _ = self.core.jobs.create_or_get('legacy', provider=seed['provider'], execution_kind='remote', snapshot=snapshot, source=seed['source'])
        job = self.core.jobs.begin_submission('legacy', expected_version=job['version'])
        provider = self.fixture.service.providers[seed['provider']]
        self.core.jobs.transition('legacy', 'unknown', expected_version=job['version'], event_id='legacy-accepted', provider_task_id=provider._task('legacy'))
        original = self.core.jobs.get('legacy')
        await self.core.resources._ready()
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['retained'], 1)
        await self.fixture.service.recover('legacy')
        recovered = self.core.jobs.get('legacy')
        self.assertEqual(recovered['snapshot'], original['snapshot'])
        self.assertEqual(recovered['fingerprint'], original['fingerprint'])
        self.assertEqual(recovered['provider_task_id'], original['provider_task_id'])
        self.assertEqual((recovered['request_id'], recovered['attempt'], recovered['state']), ('legacy', 1, 'succeeded'))
        self.assertEqual(self.fixture.counts['create'], 0)
        self.assertEqual(self.core.resources.snapshot()['resources']['cloud']['active'], 0)

    async def test_foreign_legacy_label_is_not_silently_adapted(self):
        job, _ = self.core.jobs.create_or_get('foreign-alias', provider='foreign', execution_kind='remote', snapshot={'resource': 'fixture-no-gpu', 'prepared': {'fixture': fixture.VERSION}})
        job = self.core.jobs.begin_submission('foreign-alias', expected_version=job['version'])
        self.core.jobs.transition('foreign-alias', 'unknown', expected_version=job['version'], event_id='foreign')
        with self.assertRaises(self.fixture.product.contracts.ProviderUnavailable): await self.core.resources._ready()
        self.assertEqual(self.core.jobs.get('foreign-alias')['snapshot']['resource'], 'fixture-no-gpu')

if __name__=='__main__':unittest.main()
