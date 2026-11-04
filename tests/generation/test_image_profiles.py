"""Profile construction only; no model bytes, host queue or inference."""
import unittest
from backend.providers.native import NativeProvider, ModelInventory
from backend.providers.parameters import IMAGE_MODEL, BASE_IMAGE_MODEL, IMAGE_FILES

class ImageProfileTests(unittest.TestCase):
    def provider(self, profile):
        keys = set(IMAGE_FILES) - ({'mmproj'} if profile == 'base' else set())
        bindings = {key: {'name':key+'.safetensors','path':'/not-read/'+key,'sha256':'a'*64} for key in keys}
        return NativeProvider('image', inventory=ModelInventory(bindings, lambda:[]), queue=None, media_input=lambda item:'reference.png', image_profile=profile)
    def data(self, model, mode='text2image'):
        return {'config':{'kind':'image','model':model,'mode':mode,'settings':{'width':1024,'height':1024,'seed':123}},'segments':[{'type':'text','text':'Synthetic profile check'}]}
    def test_base_is_native_clip_with_25_steps_and_without_gguf_projector(self):
        provider=self.provider('base');prepared=provider.build(self.data(BASE_IMAGE_MODEL),[],'base-request')
        self.assertEqual(provider.id,'local-qwen-image-base')
        self.assertEqual(prepared['graph']['clip']['class_type'],'CLIPLoader')
        self.assertEqual(prepared['graph']['sample']['inputs']['steps'],25)
        self.assertNotIn('mmproj',prepared['models'])
        self.assertEqual(prepared['model'],BASE_IMAGE_MODEL)
    def test_legacy_turbo_remains_separate_and_frozen(self):
        provider=self.provider('turbo');prepared=provider.build(self.data(IMAGE_MODEL),[],'original-request')
        self.assertEqual(provider.id,'local-qwen-image')
        self.assertEqual(prepared['graph']['clip']['class_type'],'CLIPLoaderGGUF')
        self.assertEqual(prepared['graph']['sample']['inputs']['steps'],8)
        self.assertIn('mmproj',prepared['models'])
        self.assertEqual(provider.build(self.data(IMAGE_MODEL),[],'original-request'),prepared)
    def test_base_reference_uses_original_conditioning_and_identity(self):
        provider=self.provider('base');media=[{'kind':'image'}]
        prepared=provider.build(self.data(BASE_IMAGE_MODEL,'image2image'),media,'base-reference')
        self.assertEqual(prepared['graph']['condition']['inputs']['images.image_1'],['reference_size',0])
        self.assertEqual(prepared['graph']['sample']['inputs']['latent_image'],['condition',2])
        self.assertEqual(prepared['graph']['reference']['inputs']['image'],'reference.png')
