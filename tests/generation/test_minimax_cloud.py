"""Cloud MiniMax graph construction only; no uploads or inference."""
import unittest

from backend.contracts.errors import InvalidInput
from backend.generation.service import MODELS
from backend.providers.comfy_video import MinimaxProvider


def schema(node_id):
    if node_id not in MinimaxProvider.nodes.values():
        return None
    inputs = {'prompt': ('STRING', {'default': ''}), 'resolution': ('COMBO', {'options': ['768P', '2K']}),
              'duration': ('INT', {'default': 5, 'min': 4, 'max': 15})}
    if node_id != MinimaxProvider.nodes['frames2video']:
        inputs['ratio'] = ('COMBO', {'options': ['16:9', '9:16'], 'default': '16:9'})
    return {'required': {'model': ('COMFY_DYNAMICCOMBO_V3', {'options': [
        {'key': 'MiniMax H3', 'inputs': {'required': inputs}}]})}}


class Queue:
    def require_auth(self):
        pass


class MinimaxCloudTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.provider = MinimaxProvider(schema=schema, queue=Queue(), media_input=lambda item: 'frozen/' + item['name'])

    def data(self, mode):
        return {'config': {'model': 'Minimax H3', 'kind': 'video', 'mode': mode, 'settings': {}},
                'segments': [{'type': 'text', 'text': '合成测试'}]}

    async def test_modes_parameters_and_native_model_name_match_cloud_h3(self):
        caps = await self.provider.capabilities('Minimax H3')
        self.assertEqual(caps['provider'], 'comfy')
        self.assertEqual(list(caps['schema']['properties']['modeType']['items']), list(MinimaxProvider.nodes))
        self.assertEqual(caps['schema']['properties']['text2video_resolution']['enum'], ['768P', '2K'])
        self.assertNotIn('frames2video_ratio', caps['schema']['properties'])
        self.assertFalse(any('enableSound' in key for key in caps['schema']['properties']))
        prepared = self.provider.build(self.data('text2video'), [], 'new-request')
        inputs = prepared['graph']['generate']['inputs']
        self.assertEqual(inputs['model'], 'MiniMax H3')
        self.assertEqual(inputs['model.resolution'], '768P')
        self.assertNotIn('model.generate_audio', inputs)

    async def test_missing_reference_node_hides_only_reference_mode(self):
        self.provider.schema = lambda name: None if name == MinimaxProvider.nodes['mixed2video'] else schema(name)
        caps = await self.provider.capabilities('Minimax H3')
        self.assertEqual(list(caps['schema']['properties']['modeType']['items']), ['text2video', 'singleImage2video', 'frames2video'])

    async def test_mixed_images_and_videos_keep_numbering_and_original_files(self):
        data = self.data('mixed2video')
        data['segments'] += [{'type': 'asset', 'index': 1}, {'type': 'text', 'text': '跟随'}, {'type': 'asset', 'index': 2}]
        media = [{'kind': 'image', 'name': 'a.png'}, {'kind': 'video', 'name': 'v.mp4'}, {'kind': 'image', 'name': 'b.png'}]
        graph = self.provider.build(data, media, 'mixed')['graph']
        inputs = graph['generate']['inputs']
        self.assertEqual(graph['generate']['class_type'], 'MinimaxHailuo03ReferenceNode')
        self.assertEqual(inputs['model.prompt'], '合成测试Video 1跟随Image 2')
        self.assertEqual(inputs['model.reference_images.image_2'], ['reference_2', 0])
        self.assertEqual(inputs['model.reference_videos.video_1'], ['reference_1', 0])
        self.assertEqual(graph['reference_1'], {'class_type': 'LoadVideo', 'inputs': {'file': 'frozen/v.mp4'}})

    async def test_frame_roles_and_local_cloud_identity_are_separate(self):
        media = [{'kind': 'image', 'name': 'first.png'}, {'kind': 'image', 'name': 'last.png'}]
        graph = self.provider.build(self.data('frames2video'), media, 'frames')['graph']
        self.assertEqual(graph['generate']['inputs']['first_frame'], ['reference_0', 0])
        self.assertEqual(graph['generate']['inputs']['last_frame'], ['reference_1', 0])
        self.assertEqual(MODELS['Minimax H3'], 'comfy-minimax')
        self.assertEqual(MODELS['MiniMax H3 FL（本地）'], 'local-h3')
        data = self.data('text2video'); data['config']['model'] = 'MiniMax H3 FL（本地）'
        with self.assertRaises(InvalidInput):
            self.provider.build(data, [], 'not-a-fallback')
        media[1]['kind'] = 'video'
        with self.assertRaises(InvalidInput):
            self.provider.build(self.data('frames2video'), media, 'bad-frame')
