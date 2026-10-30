"""Official GPT Image graph contracts; no paid calls."""
import unittest
from backend.contracts.errors import InvalidInput
from backend.generation.service import MODELS
from backend.providers.comfy_image import ComfyImageProvider
from backend.providers.contracts import ProviderUnavailable


def schema(node):
    options = {'size': ('COMBO', {'options': ['auto', '1024x1024'], 'default': 'auto'}),
               'quality': ('COMBO', {'options': ['low', 'high'], 'default': 'low'}),
               'background': ('COMBO', {'options': ['auto', 'opaque'], 'default': 'auto'}),
               'custom_width': ('INT', {'default': 1024, 'min': 480, 'max': 3840, 'step': 16}),
               'custom_height': ('INT', {'default': 1024, 'min': 480, 'max': 3840, 'step': 16})}
    return {'required': {'model': ('COMFY_DYNAMICCOMBO_V3', {'options': [
        {'key': model, 'inputs': {'required': options}} for model in ComfyImageProvider.models.values()]})}}


class Queue:
    def require_auth(self):
        pass

    async def query(self, task_id, **kwargs):
        return kwargs


class ComfyImageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.provider = ComfyImageProvider(schema=schema, queue=Queue(), media_input=lambda item: item['path'])

    def data(self, model='GPT Image 2', mode='text2image'):
        return {'config': {'model': model, 'mode': mode, 'kind': 'image', 'settings': {'quality': 'high'}},
                'segments': [{'type': 'text', 'text': 'red sphere'}]}

    async def test_all_models_schema_dispatch_defaults_and_one_output(self):
        for model, native in self.provider.models.items():
            self.assertEqual(MODELS[model], self.provider.id)
            caps = await self.provider.capabilities(model)
            self.assertEqual(caps['kind'], 'image')
            self.assertEqual(set(caps['schema']['properties']['modeType']['items']), {'text2image', 'image2image'})
            prepared = self.provider.build(self.data(model), [], 'request')
            graph = prepared['graph']; inputs = graph['generate']['inputs']
            self.assertEqual(inputs['model'], native)
            self.assertEqual(inputs['model.quality'], 'high')
            self.assertEqual(inputs['model.size'], 'auto')
            self.assertEqual(inputs['n'], 1)
            self.assertEqual(graph['save']['class_type'], 'SaveImage')
            self.assertEqual(prepared, self.provider.build(self.data(model), [], 'request'))
        self.assertEqual(await self.provider.query('task', {'request_id': 'request'}), {'owner': 'request', 'kind': 'image'})

    async def test_references_keep_order_and_tokens(self):
        data = self.data(mode='image2image')
        data['segments'] = [{'type': 'asset', 'index': 1}, {'type': 'text', 'text': ' beside '}, {'type': 'asset', 'index': 0}]
        media = [{'kind': 'image', 'path': 'first.png'}, {'kind': 'image', 'path': 'last.png'}]
        graph = self.provider.build(data, media, 'refs')['graph']
        self.assertEqual(graph['generate']['inputs']['prompt'], 'Image 2 beside Image 1')
        self.assertEqual(graph['generate']['inputs']['model.images.image_2'], ['reference_1', 0])
        self.assertEqual(graph['reference_1']['inputs']['image'], 'last.png')
        for bad in ([], [{'kind': 'video', 'path': 'v.mp4'}], media * 9):
            with self.assertRaises(InvalidInput):
                self.provider.build(data, bad, 'bad')
        with self.assertRaises(InvalidInput):
            self.provider.build(self.data(), media, 'bad-mode')

    async def test_missing_node_is_unavailable(self):
        self.provider.schema = lambda node: None
        with self.assertRaises(ProviderUnavailable):
            await self.provider.capabilities('GPT Image 2')
