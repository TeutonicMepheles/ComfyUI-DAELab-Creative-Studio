"""Shared GPT optimization with simulated Comfy credit transport, no cloud calls."""
import json
import tempfile
import unittest
from pathlib import Path

from backend.generation.http import routes
from backend.generation.optimization import OptimizationFacade
from backend.generation.service import GenerationService
from backend.integrations.comfyui.services import CoreServices
from backend.integrations.comfyui.comfy_video import authenticated_submission, _submission_auth
from backend.providers.comfy_text import ComfyTextProvider, MODEL
from backend.providers.contracts import ProviderUnavailable, SubmissionUncertain
from test_integration import Request
from test_optimization import snapshot
from test_service import png


class Transport:
    def __init__(self): self.calls = []; self.error = None
    def models(self): return [MODEL]
    def require_auth(self):
        if not _submission_auth.get(): raise ProviderUnavailable('Login required')
    async def price(self, model):
        return {'provider': 'comfy', 'currency': 'credits', 'model': model, 'input': 10, 'output': 20, 'version': 'synthetic'}
    async def create(self, body):
        self.require_auth();self.calls.append((body, dict(_submission_auth.get())))
        if self.error: raise self.error
        return {'id': 'resp_synthetic', 'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'A red cube slowly rotates.'}]}],
                'usage': {'input_tokens': 20, 'output_tokens': 8}}, {'actualCredits': .03}
    async def query(self, task_id): raise AssertionError('Completed requests must not be queried')


class ComfyTextTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();root = Path(self.temp.name)
        for name in ('input', 'output'): (root/name).mkdir()
        self.core = CoreServices(root/'user',root/'input',root/'output')
        self.transport = Transport()
        self.provider = ComfyTextProvider(transport=self.transport, read_frozen=lambda _: png())
        self.service = GenerationService(self.core.jobs,self.core.assets,providers={self.provider.id:self.provider})
        self.service.enabled_remote_providers.add(self.provider.id)
        self.handlers = {path:authenticated_submission(fn) for method,path,fn in routes(self.service)}
    async def asyncTearDown(self):
        await self.service.wait_idle();self.temp.cleanup()
    async def call(self, action, payload, auth=True):
        path='/daelab/prompt-optimization/'+action
        request=Request({'contractVersion':1,**payload},headers={'Authorization':'Bearer synthetic-comfy-token'} if auth else {})
        request.path=path
        return await self.handlers[path](request)

    async def test_standalone_uses_comfy_auth_and_same_ledger_without_secret_persistence(self):
        payload={'model':MODEL,'requestId':'standalone','mode':'polish','source':'A red cube.','instruction':'Clarify.'}
        rejected=await self.call('polish',payload,False)
        self.assertEqual(rejected.status,503);self.assertEqual(self.core.jobs.list_jobs(),[])
        response=await self.call('polish',payload)
        result=json.loads(response.text)
        self.assertEqual(response.status,200,result)
        self.assertEqual(result['provider'],'comfy');self.assertEqual(result['state'],'succeeded')
        body,auth=self.transport.calls[0]
        self.assertEqual(body['model'],MODEL);self.assertEqual(body['reasoning'],{'effort':'none'})
        self.assertEqual(auth,{'auth_token_comfy_org':'synthetic-comfy-token'})
        self.assertNotIn('synthetic-comfy-token',json.dumps(self.core.jobs.get('standalone')))
        self.assertIsNone(_submission_auth.get())
        await self.call('polish',payload)
        self.assertEqual(len(self.transport.calls),1)

    async def test_table_uses_same_provider_and_credit_estimate(self):
        facade=self.service._optimization_facade
        s=snapshot();s['model']=MODEL
        quote=await facade.estimate({'model':MODEL,'rows':[s]})
        self.assertEqual(quote['currency'],'credits');self.assertGreater(quote['budgetUpperCredits'],0)
        lease=await facade.lease({'target':{'documentId':'doc-1','tableId':'table-1'},'instanceId':'view'})
        await facade.submit({'batchId':'batch','quoteId':quote['quoteId'],'leaseId':lease['leaseId'],'budgetCredits':quote['budgetUpperCredits'],
                            'rows':[{'requestId':'table-row','snapshot':s}],'range':{'scope':'column','fieldId':'prompt-1'}})
        p={'provider':'comfy','batchId':'batch','requestId':'table-row','leaseId':lease['leaseId'],**{k:s[k] for k in ('snapshotDigest','revision','requestSeq')}}
        permit=await facade.permit(p);p['permitId']=permit['permitId']
        self.assertEqual((await self.call('advance',p,False)).status,503)
        self.assertEqual((await self.call('advance',p)).status,200)
        await self.service.wait_idle()
        report=await facade.query({'batchId':'batch'})
        self.assertEqual(report['rows'][0]['status'],'succeeded')
        self.assertEqual(report['rows'][0]['actualCredits'],.03)
        self.assertEqual(self.core.jobs.get('table-row')['provider'],'comfy-gpt-text')

    async def test_reference_image_becomes_typed_native_input_without_paths(self):
        prepared=self.provider.build({'entry':'canvas','mode':'reverse','source':'','instruction':'Describe.'},[{}],'reverse')
        content=prepared['request']['input'][1]['content']
        self.assertEqual(content[1]['type'],'input_image')
        self.assertTrue(content[1]['image_url'].startswith('data:image/jpeg;base64,'))

    async def test_lost_response_never_creates_again_on_recovery(self):
        self.transport.error=SubmissionUncertain()
        await self.call('polish',{'model':MODEL,'requestId':'lost','mode':'polish','source':'A cube.','instruction':'Clarify.'})
        await self.service.recover('lost')
        self.assertEqual(self.core.jobs.get('lost')['state'],'unknown')
        self.assertEqual(len(self.transport.calls),1)
