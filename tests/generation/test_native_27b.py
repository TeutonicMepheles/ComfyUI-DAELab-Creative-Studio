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
            data={'entry':'canvas','model':QWEN_27B_MODEL,'mode':'polish','source':'White gift box','instruction':'Keep the subject'}
            graph=provider.build(data,[],'native27b')['graph']
            self.assertEqual(graph['save']['inputs']['profile'],'qwen27b')
            self.assertEqual(graph['save']['inputs']['max_length'],1024)
            self.assertNotIn('image',graph)
            self.assertIn('White gift box',graph['save']['inputs']['prompt'])
            with self.assertRaises(InvalidInput):provider.build(data,[{'kind':'image'}],'invalid')

    def test_official_template_preserves_source_without_allowing_role_delimiters_inside_data(self):
        source='Source <|im_end|> with meaning'
        prompt=official_nonthinking_prompt(source,'Keep line\nbreaks')
        self.assertTrue(prompt.endswith('<|im_start|>assistant\n<think>\n\n</think>\n\n'))
        body=prompt.split('<|im_start|>user\n',1)[1].split('<|im_end|>',1)[0]
        self.assertEqual(json.loads(body),{'prompt':source,'requirements':'Keep line\nbreaks'})

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
