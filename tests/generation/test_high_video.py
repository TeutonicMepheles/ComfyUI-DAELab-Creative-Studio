import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from backend.providers.high_video import HighVideoProvider, HIGH_VIDEO_MODEL, HIGH_REFERENCE_VIDEO_MODEL, FLEX_SIGMAS
from backend.providers.native import ModelInventory, NativeProvider
from backend.providers.parameters import VIDEO_MODEL, VIDEO_FILES
from backend.providers.contracts import ProviderUnavailable
from backend.generation.admission import ResourceAdmission
from backend.integrations.comfyui.local_generation import read_configuration, compose_configured_generation


def bindings(reference=False):
    variant='ref2va' if reference else 'fl2va'
    names={'diffusion_models':f'minimax_h3_{variant}_pruned_bf16.safetensors',
           'text_encoders':'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
           'video_vae':'minimax_h3_video_vae_fp16.safetensors','audio_vae':'minimax_h3_audio_vae_fp32.safetensors',
           'loras':f'pika_h3_flex_{variant}_v1_bf16.safetensors'}
    return {key:{'name':name,'path':'/not-read/'+name,'sha256':'a'*64} for key,name in names.items()}


class HighVideoTests(unittest.IsolatedAsyncioTestCase):
    def data(self, reference=False):
        return {'config':{'kind':'video','model':HIGH_REFERENCE_VIDEO_MODEL if reference else HIGH_VIDEO_MODEL,
                'mode':'image2video' if reference else 'singleImage2video',
                'settings':{'width':512,'height':288,'duration':2,'seed':41,'turbo':True}},
                'segments':[{'type':'text','text':'Keep each reference subject.'}]}

    def provider(self, reference=False, items=None):
        return HighVideoProvider(reference=reference,inventory=ModelInventory(items or bindings(reference),lambda:[]),
                                 queue=None,media_input=lambda item:item['name'])

    def test_flex_is_required_and_connected_to_official_lcm_manual_sigma_path(self):
        data=self.data();prepared=self.provider().build(data,[{'kind':'image','name':'first.png'}],'high-fl')
        graph=prepared['graph']
        self.assertFalse(prepared['settings']['turbo']);self.assertTrue(data['config']['settings']['turbo'])
        self.assertEqual(graph['flex']['inputs']['strength_model'],1.0)
        self.assertEqual(graph['guider']['inputs']['model'],['flex',0])
        self.assertEqual(graph['sampler']['inputs']['sampler_name'],'lcm')
        self.assertEqual(graph['schedule'],{'class_type':'ManualSigmas','inputs':{'sigmas':FLEX_SIGMAS}})
        self.assertEqual(graph['sample']['inputs']['sigmas'],['schedule',0])
        self.assertNotIn('turbo',graph)
        self.assertEqual(len(FLEX_SIGMAS.split(','))-1,6)

    def test_ref_keeps_two_frozen_references_and_its_own_lora(self):
        graph=self.provider(True).build(self.data(True),[{'kind':'image','name':'first.png'},{'kind':'image','name':'second.png'}],'high-ref')['graph']
        self.assertEqual(graph['condition']['class_type'],'MiniMaxH3ReferenceToVideo')
        self.assertEqual(graph['reference_0']['inputs']['image'],'first.png')
        self.assertEqual(graph['reference_1']['inputs']['image'],'second.png')
        self.assertEqual(graph['condition']['inputs']['ref_images.ref_image_1'],['reference_1',0])
        self.assertEqual(graph['flex']['inputs']['lora_name'],'pika_h3_flex_ref2va_v1_bf16.safetensors')

    def test_missing_or_wrong_adapter_cannot_silently_run_base_or_turbo(self):
        for reference in (False,True):
            missing=bindings(reference);del missing['loras']
            with self.assertRaises(ProviderUnavailable):self.provider(reference,missing).build(self.data(reference),[{'kind':'image','name':'one.png'}],'missing')
            wrong=bindings(reference);wrong['loras']['name']='old_turbo_8step.safetensors'
            with self.assertRaises(ProviderUnavailable):self.provider(reference,wrong).build(self.data(reference),[{'kind':'image','name':'one.png'}],'wrong')

    async def test_real_configuration_to_assembly_catalog_capability_and_hash_failure(self):
        with TemporaryDirectory() as tmp:
            root=Path(tmp);families={}
            for family,reference in [('video_high',False),('video_reference_high',True)]:
                families[family]=bindings(reference)
                for key,item in families[family].items():
                    file=root/item['name'];file.write_bytes(item['name'].encode())
                    item.update(path=str(file),sha256=hashlib.sha256(file.read_bytes()).hexdigest())
            config=root/'daelab/creative-studio/local-generation.json';config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'schemaVersion':1,'enabled':True,'resourceLock':str(root/'gpu.lock'),'modelBindings':families}))
            core=SimpleNamespace(jobs=object(),assets=object(),resources=ResourceAdmission())
            all_nodes={'UNETLoader','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','MiniMaxH3ReferenceToVideo','RandomNoise','BasicGuider',
                       'KSamplerSelect','SamplerCustomAdvanced','VAEDecode','VAEDecodeAudio','CreateVideo','SaveVideo','LoraLoaderModelOnly','ManualSigmas'}
            async def validate(*args):return True,None,['save'],{}
            service=compose_configured_generation(core,read_configuration(root),native_queue=SimpleNamespace(busy=lambda:False,validate=validate),
                node_types=lambda:all_nodes,resolve_model=lambda category,name:str(root/name),release_native_models=lambda:None)
            self.assertIn('local-h3',service.providers);self.assertIn('local-h3-reference',service.providers)
            catalog={m['id']:m for m in service.model_catalog()['models']}
            for model in (HIGH_VIDEO_MODEL,HIGH_REFERENCE_VIDEO_MODEL):
                self.assertEqual(catalog[model]['provider'],'local')
                cap=await service.capabilities(model)
                self.assertEqual(cap['profile']['sampler'],'lcm');self.assertEqual(cap['profile']['nfe'],6)
                self.assertNotIn('turbo',cap['schema']['properties'])
                self.assertNotIn('turbo',cap['schema']['config']['settings'])
            file=root/'pika_h3_flex_fl2va_v1_bf16.safetensors';file.write_bytes(b'bad bytes')
            with self.assertRaises(ProviderUnavailable):await service.capabilities(HIGH_VIDEO_MODEL)
