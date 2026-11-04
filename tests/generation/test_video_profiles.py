"""Video profile construction only; no model bytes, host queue or inference."""
import unittest
from backend.providers.native import NativeProvider, ModelInventory
from backend.providers.parameters import VIDEO_MODEL, BASE_VIDEO_MODEL, BASE_REFERENCE_VIDEO_MODEL, VIDEO_FILES

class VideoProfileTests(unittest.TestCase):
    def provider(self, profile, reference=False):
        keys = set(VIDEO_FILES) - ({'loras'} if profile == 'base' else set())
        bindings = {key: {'name':key+'.safetensors','path':'/not-read/'+key,'sha256':'a'*64} for key in keys}
        return NativeProvider('video', inventory=ModelInventory(bindings, lambda:[]), queue=None, media_input=lambda item:'reference.png', reference=reference, video_profile=profile)
    def data(self, model, mode='text2video', settings=None):
        return {'config':{'kind':'video','model':model,'mode':mode,'settings':settings or {'width':512,'height':288,'duration':2,'seed':7}},'segments':[{'type':'text','text':'Synthetic video profile check'}]}
    def test_low_tier_is_twenty_steps_without_turbo_lora(self):
        provider=self.provider('base');prepared=provider.build(self.data(BASE_VIDEO_MODEL),[],'low-tier-text')
        self.assertEqual(provider.id,'local-h3-base')
        self.assertEqual(prepared['model'],BASE_VIDEO_MODEL)
        self.assertNotIn('turbo',prepared['graph'])
        self.assertNotIn('loras',prepared['models'])
        self.assertEqual(prepared['graph']['schedule']['inputs']['steps'],20)
        self.assertEqual(prepared['graph']['sampler']['inputs']['sampler_name'],'res_multistep')
        self.assertEqual(prepared['graph']['video']['inputs']['fps'],24.0)
        self.assertEqual(prepared['graph']['condition']['class_type'],'MiniMaxH3ImageToVideo')
    def test_low_tier_reference_keeps_order_and_identity(self):
        provider=self.provider('base',reference=True);media=[{'kind':'image'},{'kind':'image'}]
        prepared=provider.build(self.data(BASE_REFERENCE_VIDEO_MODEL,'image2video'),media,'low-tier-reference')
        self.assertEqual(provider.id,'local-h3-reference-base')
        self.assertEqual(prepared['model'],BASE_REFERENCE_VIDEO_MODEL)
        self.assertEqual(prepared['graph']['condition']['class_type'],'MiniMaxH3ReferenceToVideo')
        self.assertEqual(prepared['graph']['condition']['inputs']['ref_images.ref_image_0'],['reference_0',0])
        self.assertEqual(prepared['graph']['condition']['inputs']['ref_images.ref_image_1'],['reference_1',0])
        self.assertNotIn('turbo',prepared['graph'])
    def test_legacy_routes_stay_separate_and_frozen(self):
        legacy=self.provider('turbo');prepared=legacy.build(self.data(VIDEO_MODEL),[],'original-video')
        self.assertEqual(legacy.id,'local-h3')
        self.assertEqual(prepared['model'],VIDEO_MODEL)
        self.assertIn('turbo',prepared['graph'])
        self.assertEqual(prepared['graph']['schedule']['inputs']['steps'],8)
        self.assertEqual(legacy.build(self.data(VIDEO_MODEL),[],'original-video'),prepared)
        legacy_ref=self.provider('turbo',reference=True)
        self.assertEqual(legacy_ref.id,'local-h3-reference')
        self.assertEqual(legacy_ref.model,__import__('backend.providers.parameters',fromlist=['REFERENCE_VIDEO_MODEL']).REFERENCE_VIDEO_MODEL)
    def test_low_tier_ignores_a_turbo_request_in_saved_settings(self):
        provider=self.provider('base');
        prepared=provider.build(self.data(BASE_VIDEO_MODEL,settings={'width':512,'height':288,'duration':2,'turbo':True,'seed':7}),[],'low-tier-turbo-request')
        self.assertNotIn('turbo',prepared['graph'])
        self.assertEqual(prepared['graph']['schedule']['inputs']['steps'],20)
    def test_catalog_and_routing_register_the_low_tier_models(self):
        from backend.generation.service import MODELS
        self.assertEqual(MODELS[BASE_VIDEO_MODEL], 'local-h3-base')
        self.assertEqual(MODELS[BASE_REFERENCE_VIDEO_MODEL], 'local-h3-reference-base')
        self.assertEqual(MODELS[VIDEO_MODEL], 'local-h3')
        self.assertEqual(self.provider('base').id, MODELS[BASE_VIDEO_MODEL])
        self.assertEqual(self.provider('base', reference=True).id, MODELS[BASE_REFERENCE_VIDEO_MODEL])
