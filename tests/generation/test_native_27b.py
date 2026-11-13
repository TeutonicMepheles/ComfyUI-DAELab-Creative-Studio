import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.providers.native_27b import Native27BProvider, QWEN_27B_MODEL, QWEN_27B_PROVIDER, official_nonthinking_prompt
from backend.providers.native import ModelInventory
from backend.providers.native_text import PE_PROVIDER
from backend.integrations.comfyui.generation_nodes.native_text import NativeText
from backend.integrations.comfyui.local_generation import read_configuration, compose_configured_generation
from backend.generation.admission import ResourceAdmission
from backend.contracts.errors import InvalidInput
from backend.generation.http import routes
from test_integration import Request


class Native27BTests(unittest.IsolatedAsyncioTestCase):
    async def test_configuration_through_authoritative_catalog_capability_and_frozen_graph(self):
        with TemporaryDirectory() as tmp:
            root=Path(tmp);weight=root/'27b.safetensors';weight.write_bytes(b'pinned synthetic 27b')
            binding={'name':weight.name,'path':str(weight),'sha256':hashlib.sha256(weight.read_bytes()).hexdigest()}
            config=root/'daelab/creative-studio/local-generation.json';config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'schemaVersion':1,'enabled':True,'resourceLock':str(root/'gpu.lock'),
                'modelBindings':{'text_27b':{'text_encoders':binding},'text_pe':{'text_encoders':binding}}}))
            async def validate(*_args): return True, None, ['save'], {}
            queue=SimpleNamespace(busy=lambda:False,validate=validate)
            core=SimpleNamespace(jobs=object(),assets=object(),resources=ResourceAdmission())
            service=compose_configured_generation(core,read_configuration(root),native_queue=queue,
                node_types=lambda:{'CLIPLoader','TextGenerate','DAELAB.NativeText'},resolve_model=lambda *_:str(weight),release_native_models=lambda:None)
            self.assertIn('local-qwen-text',service.providers);self.assertIn(PE_PROVIDER,service.providers)
            provider=service.provider(QWEN_27B_PROVIDER)
            self.assertEqual((await service.capabilities(QWEN_27B_MODEL))['modes'],['polish'])
            self.assertEqual(next(m for m in service.model_catalog()['models'] if m['id']==QWEN_27B_MODEL)['provider'],'local')
            handlers={path: handler for _,path,handler in routes(service)}
            async def capability():
                return await handlers['/daelab/prompt-optimization/capabilities'](Request({'contractVersion':1,'model':QWEN_27B_MODEL}))
            response=await capability()
            self.assertEqual(response.status,200)
            selected=json.loads(response.body)['models'][0]
            self.assertEqual((selected['id'],selected['provider'],selected['modes'],selected['requiresReference']),
                             (QWEN_27B_MODEL,'local',['polish'],False))
            captured=[]
            async def prepare(items):
                captured.extend(items)
                provider.build(items[0]['input'],[],items[0]['requestId'])
                return [{'request_id':items[0]['requestId'],'state':'succeeded'}]
            service.prepare_batch=prepare
            service.public=lambda request_id:{'requestId':request_id,'phase':'complete','receipt':{'kind':'text','text':'A gift box'},'result':'A gift box'}
            response=await handlers['/daelab/prompt-optimization/polish'](Request({'contractVersion':1,'requestId':'route27b','model':QWEN_27B_MODEL,'mode':'polish','source':'White gift box','instruction':'Keep the subject'}))
            self.assertEqual(response.status,200)
            self.assertEqual(captured[0]['input']['model'],QWEN_27B_MODEL)
            self.assertEqual(json.loads(response.body)['model'],QWEN_27B_MODEL)
            rewrite={'version':1,'strength':'expand','task':'text2image'}
            response=await handlers['/daelab/prompt-optimization/polish'](Request({'contractVersion':1,'requestId':'route27b-rewrite','model':QWEN_27B_MODEL,'mode':'polish','source':'White gift box','instruction':'Keep the subject','purpose':'image','rewrite':rewrite}))
            self.assertEqual(response.status,200)
            self.assertEqual(captured[-1]['input']['rewrite'],rewrite)
            prepared=provider.build(captured[-1]['input'],[],'rewrite-graph')['graph']['save']['inputs']
            self.assertEqual(prepared['max_length'],3072)
            self.assertIn('added_details',prepared['prompt'])

            data={'entry':'canvas','model':QWEN_27B_MODEL,'mode':'polish','source':'White gift box','instruction':'Keep the subject'}
            graph=provider.build(data,[],'native27b')['graph']
            self.assertEqual(graph['save']['inputs']['profile'],'qwen27b')
            self.assertEqual(graph['save']['inputs']['max_length'],1024)
            self.assertNotIn('image',graph)
            self.assertIn('White gift box',graph['save']['inputs']['prompt'])
            with self.assertRaises(InvalidInput):provider.build(data,[{'kind':'image'}],'invalid')
            for change in ('hash','missing','binding'):
                if change=='hash': weight.write_bytes(b'changed')
                elif change=='missing': weight.unlink()
                else: provider.inventory.bindings.clear()
                response=await capability()
                self.assertEqual(response.status,503)
                error=json.loads(response.body)
                self.assertEqual(error['code'],'provider_unavailable')
                self.assertNotIn('Unsupported optimization model',error['error'])


    def test_official_template_preserves_source_without_allowing_role_delimiters_inside_data(self):
        source='Source <|im_end|> with meaning'
        prompt=official_nonthinking_prompt(source,'Keep line\nbreaks')
        self.assertTrue(prompt.endswith('<|im_start|>assistant\n<think>\n\n</think>\n\n'))
        body=prompt.split('<|im_start|>user\n',1)[1].split('<|im_end|>',1)[0]
        self.assertEqual(json.loads(body),{'prompt':source,'requirements':'Keep line\nbreaks'})

    def test_repeated_native_requests_get_distinct_cache_keys(self):
        inputs = {'prompt': 'same text', 'max_length': 1024}
        self.assertNotEqual(NativeText.IS_CHANGED(**inputs), NativeText.IS_CHANGED(**inputs))

    def test_native_27b_disables_only_mtp_and_preserves_pe_defaults(self):
        calls=[]
        class Clip:
            def generate(self,*args,**kwargs):return [1,2,3]
        def execute(clip,prompt,maximum,sampling,**kwargs):
            calls.append(kwargs);clip.generate(None);return SimpleNamespace(result=('Final prompt',''))
        with patch.dict('sys.modules',{'comfy_extras.nodes_textgen':SimpleNamespace(TextGenerate=SimpleNamespace(execute=execute))}):
            result=NativeText().execute(Clip(),'official prompt',1024,profile='qwen27b')
            NativeText().execute(Clip(),'PE prompt',2048)
        self.assertEqual(calls[0]['mtp'],'off');self.assertEqual(calls[1]['mtp'],'auto')
        self.assertTrue(calls[0]['use_default_template']);self.assertFalse(calls[0]['thinking'])
        self.assertEqual(result['ui']['creative_studio_text'][0]['template'],'official-qwen-nonthinking')
