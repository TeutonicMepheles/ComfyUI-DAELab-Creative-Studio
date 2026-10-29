import unittest

from backend.contracts.errors import InvalidInput
from backend.providers.native import ModelInventory, NativeProvider
from backend.providers.parameters import REFERENCE_VIDEO_MODEL


class H3ReferenceTests(unittest.TestCase):
    def setUp(self):
        bindings = {key: {'name': key, 'sha256': 'a' * 64, 'path': '/unused/' + key}
                    for key in ('diffusion_models', 'text_encoders', 'video_vae', 'audio_vae')}
        self.provider = NativeProvider('video', reference=True, inventory=ModelInventory(bindings, lambda: {}),
                                       queue=None, media_input=lambda item: item['path'])
        self.data = {'config': {'kind': 'video', 'model': REFERENCE_VIDEO_MODEL, 'mode': 'image2video',
                                'settings': {'width': 512, 'height': 288, 'duration': 1.5, 'seed': 17}},
                     'segments': [{'type': 'asset', 'index': 1}, {'type': 'text', 'text': ' follows '},
                                  {'type': 'asset', 'index': 0}]}
        self.media = [{'kind': 'image', 'path': 'first.png'}, {'kind': 'image', 'path': 'second.png'}]

    def test_reference_order_and_prompt_indices_are_preserved(self):
        result = self.provider.build(self.data, self.media, 'reference-order')
        graph = result['graph']
        self.assertEqual(graph['condition']['class_type'], 'MiniMaxH3ReferenceToVideo')
        self.assertEqual(graph['condition']['inputs']['prompt'], '<Picture 2> follows <Picture 1>')
        for index, name in enumerate(('first.png', 'second.png')):
            self.assertEqual(graph[f'reference_{index}']['inputs']['image'], name)
            self.assertEqual(graph['condition']['inputs'][f'ref_images.ref_image_{index}'], [f'reference_{index}', 0])
        self.assertNotIn('first_frame', graph['condition']['inputs'])
        self.assertNotIn('turbo', graph)
        self.assertEqual(result['settings']['seed'], 17)

    def test_invalid_reference_inputs_and_acceleration_are_rejected(self):
        for media in ([], self.media * 5, [{'kind': 'video', 'path': 'clip.mp4'}]):
            with self.subTest(media=media), self.assertRaises(InvalidInput):
                self.provider.build(self.data, media, 'invalid')
        self.data['config']['settings']['turbo'] = True
        with self.assertRaises(InvalidInput):
            self.provider.build(self.data, self.media, 'wrong-lora')
        self.data['config']['settings']['turbo'] = False
        self.data['config']['mode'] = 'frames2video'
        with self.assertRaises(InvalidInput):
            self.provider.build(self.data, self.media, 'wrong-mode')
