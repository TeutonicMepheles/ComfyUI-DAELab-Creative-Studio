import unittest

from backend.contracts.errors import InvalidInput
from backend.providers.parameters import IMAGE_FILES, compile_segments, image_graph, settings_for
from backend.providers.parameters import IMAGE_MODEL
from backend.providers.native import NativeProvider


class QwenReferenceTests(unittest.TestCase):
    def test_provider_stages_the_frozen_asset_and_pins_the_reference_graph(self):
        class Inventory:
            def descriptions(self, keys):
                return {key: {'name': IMAGE_FILES[key], 'sha256': 'fixed'} for key in keys}
        seen = []
        def stage(item):
            seen.append(dict(item))
            return 'staged/picture8.png'
        provider = NativeProvider('image', inventory=Inventory(), queue=None, media_input=stage)
        media = [{'kind': 'image', 'asset_id': 'picture8', 'sha256': 'original-content'}]
        prepared = provider.build({'config': {'kind': 'image', 'model': IMAGE_MODEL,
                                  'mode': 'image2image', 'settings': {'seed': 42}},
                                  'segments': [{'type': 'asset', 'index': 0}]}, media, 'reference-request')
        self.assertEqual(seen, media)
        self.assertEqual(prepared['graph']['reference']['inputs']['image'], 'staged/picture8.png')
        self.assertEqual(prepared['settings']['seed'], 42)
        self.assertEqual(media[0]['asset_id'], 'picture8')

    def test_reference_is_encoded_and_controls_sampling_geometry(self):
        media = [{'kind': 'image', 'native_input': 'frozen/picture8.png'}]
        text = compile_segments([{'type': 'text', 'text': 'Change background '},
                                 {'type': 'asset', 'index': 0}], media)
        values = settings_for('image', 'image2image', {'width': 512, 'height': 288, 'seed': 42}, media)
        graph = image_graph(text, values, IMAGE_FILES, 'output', media=media)
        self.assertEqual(graph['reference']['inputs']['image'], 'frozen/picture8.png')
        self.assertEqual(graph['reference_size']['inputs']['width'], 512)
        self.assertEqual(graph['reference_size']['inputs']['height'], 288)
        condition = graph['condition']['inputs']
        self.assertEqual(condition['images.image_1'], ['reference_size', 0])
        self.assertEqual(condition['vae'], ['vae', 0])
        self.assertEqual(condition['resolution'], 0)
        self.assertEqual(condition['prompt'], 'Change background @image_1')
        self.assertEqual(graph['sample']['inputs']['latent_image'], ['condition', 2])
        self.assertNotIn('latent', graph)

    def test_wrong_modes_counts_and_media_never_silently_become_text_generation(self):
        for mode, media in [('image2image', []), ('image2image', [{'kind': 'video'}]),
                            ('image2image', [{'kind': 'image'}] * 2),
                            ('text2image', [{'kind': 'image'}]), ('unknown', [])]:
            with self.subTest(mode=mode, media=media), self.assertRaises(InvalidInput):
                settings_for('image', mode, {}, media)


class QwenCapabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_reference_mode_requires_installed_nodes_and_never_stages_or_enqueues(self):
        nodes = {'LoadImage', 'ImageScale'}
        class Inventory:
            def descriptions(self, keys):
                return {key: {'name': IMAGE_FILES[key], 'sha256': 'fixed'} for key in keys}
            def verify(self, models, graph): pass
            def node_types(self): return nodes
        class Queue:
            async def validate(self, *args): pass
        def stage(_): raise AssertionError('capabilities must not stage media')
        provider = NativeProvider('image', inventory=Inventory(), queue=Queue(), media_input=stage)
        cap = await provider.capabilities(IMAGE_MODEL)
        self.assertEqual(cap['schema']['properties']['modeType']['items']['image2image'], [1, 1])
        nodes.clear()
        cap = await provider.capabilities(IMAGE_MODEL)
        self.assertNotIn('image2image', cap['schema']['properties']['modeType']['items'])
