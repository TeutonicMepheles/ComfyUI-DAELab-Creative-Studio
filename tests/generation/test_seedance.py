"""No cloud calls: native graph contracts and transient queue credentials."""
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from backend.contracts.errors import InvalidInput
from backend.generation.service import GenerationService
from backend.integrations.comfyui.comfy_video import ComfyVideoQueue, authenticated_submission
from backend.integrations.comfyui.services import CoreServices
from backend.providers.contracts import ProviderUnavailable
from backend.providers.comfy_video import SeedanceProvider, SEEDANCE_MODELS as MODELS, SEEDANCE_NODES as NODES


def schema(name):
    if name not in NODES.values():
        return None
    inputs = {'prompt': ('STRING', {'default': ''}), 'resolution': ('COMBO', {'options': ['480p', '720p']}),
              'duration': ('INT', {'default': 5, 'min': 4, 'max': 30}), 'generate_audio': ('BOOLEAN', {'default': True})}
    if name != NODES['frames2video']:
        inputs['ratio'] = ('COMBO', {'options': ['16:9', '9:16'], 'default': '16:9'})
    return {'required': {'model': ('COMFY_DYNAMICCOMBO_V3', {'options': [
        {'key': model, 'inputs': {'required': inputs}} for model in MODELS]})}}


class NativeQueue:
    def __init__(self):
        self.pending, self.running, self.history = [], [], {}

    def put(self, value):
        self.pending.append(value)

    def get_history(self, task_id):
        return self.history

    def get_current_queue(self):
        return self.running, self.pending

    def delete_queue_item(self, predicate):
        for index, item in enumerate(self.pending):
            if predicate(item):
                self.pending.pop(index)
                return True
        return False


class SeedanceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.native = NativeQueue()
        self.server = SimpleNamespace(number=0, prompt_queue=self.native)
        async def validate(task_id, graph, partial):
            return True, None, ['save'], {}
        self.queue = ComfyVideoQueue(self.server, validate)
        self.provider = SeedanceProvider(schema=schema, queue=self.queue, media_input=lambda item: 'frozen/' + item['filename'])

    async def authorized(self, callback, token='synthetic-token'):
        async def handle(request):
            return await callback()
        return await authenticated_submission(handle)(SimpleNamespace(headers={'X-DAELAB-Comfy-Token': token}))

    def input(self, mode='mixed2video'):
        return {'config': {'model': 'Seedance 2.5', 'kind': 'video', 'mode': mode, 'settings': {'enableSound': 'off'}},
                'segments': [{'type': 'text', 'text': 'literal @image_1 '}, {'type': 'asset', 'index': 2},
                             {'type': 'text', 'text': ' then '}, {'type': 'asset', 'index': 0}]}

    async def test_mixed_reference_order_actual_files_prompt_tokens_and_no_secrets(self):
        async def check():
            data = self.input()
            media = [{'kind': 'image', 'filename': 'a.png'}, {'kind': 'image', 'filename': 'b.png'}, {'kind': 'video', 'filename': 'v.mp4'}]
            prepared = self.provider.build(data, media, 'request-1')
            graph = prepared['graph']; inputs = graph['generate']['inputs']
            self.assertEqual(inputs['model.prompt'], 'literal @image_1 Video 1 then Image 1')
            self.assertEqual(inputs['model.reference_images.image_1'], ['reference_0', 0])
            self.assertEqual(inputs['model.reference_images.image_2'], ['reference_1', 0])
            self.assertEqual(inputs['model.reference_videos.video_1'], ['reference_2', 0])
            self.assertEqual(graph['reference_2'], {'class_type': 'LoadVideo', 'inputs': {'file': 'frozen/v.mp4'}})
            self.assertFalse(inputs['model.generate_audio'])
            self.assertEqual(inputs['model.resolution'], '480p')
            self.assertNotIn('synthetic-token', json.dumps(prepared))
            self.assertEqual(prepared, self.provider.build(data, media, 'request-1'))
            self.assertNotEqual(inputs['seed'], self.provider.build(data, media, 'request-2')['graph']['generate']['inputs']['seed'])
        await self.authorized(check)

    async def test_frames_use_first_last_slots_and_video_cannot_silently_become_a_frame(self):
        async def check():
            data = self.input('frames2video'); data['segments'] = [{'type': 'text', 'text': 'frame test'}]
            media = [{'kind': 'image', 'filename': 'first.png'}, {'kind': 'image', 'filename': 'last.png'}]
            graph = self.provider.build(data, media, 'frames')['graph']
            self.assertEqual(graph['generate']['inputs']['first_frame'], ['reference_0', 0])
            self.assertEqual(graph['generate']['inputs']['last_frame'], ['reference_1', 0])
            self.assertNotIn('model.ratio', graph['generate']['inputs'])
            media[1]['kind'] = 'video'
            with self.assertRaises(InvalidInput):
                self.provider.build(data, media, 'bad')
        await self.authorized(check)

    async def test_frame_modes_refuse_inline_asset_tokens_before_native_enqueue(self):
        async def check():
            for mode, count in [('singleImage2video', 1), ('frames2video', 2)]:
                data = self.input(mode)
                data['segments'] = [{'type': 'asset', 'index': 0}]
                media = [{'kind': 'image', 'filename': str(i) + '.png'} for i in range(count)]
                with self.assertRaisesRegex(InvalidInput, '首帧／首尾帧模式不能'):
                    self.provider.build(data, media, 'frame-mention')
                data['segments'] = [{'type': 'text', 'text': 'literal @图片'}]
                graph = self.provider.build(data, media, 'frame-text')['graph']
                self.assertEqual(graph['generate']['inputs']['model.prompt'], 'literal @图片')
                self.assertEqual(graph['generate']['inputs']['first_frame'], ['reference_0', 0])
            self.assertEqual(self.native.pending, [])
        await self.authorized(check)

    async def test_capabilities_follow_installed_nodes_and_do_not_need_login(self):
        caps = await self.provider.capabilities('Seedance 2.5')
        self.assertEqual(list(caps['schema']['properties']['modeType']['items']), list(NODES))
        self.assertTrue(caps['schema']['config']['strictModes'])
        self.assertNotIn('frames2video_ratio', caps['schema']['properties'])
        self.provider.schema = lambda name: schema(name) if name == NODES['text2video'] else None
        caps = await self.provider.capabilities('Seedance 2.5')
        self.assertEqual(list(caps['schema']['properties']['modeType']['items']), ['text2video'])

    async def test_auth_is_required_and_only_native_sensitive_slot_receives_it(self):
        with self.assertRaises(ProviderUnavailable):
            self.provider.build(self.input(), [], 'missing-login')
        async def enqueue():
            await self.queue.enqueue('task', {'generate': {}}, owner='owner')
        await self.authorized(enqueue)
        item = self.native.pending[0]
        self.assertEqual(item[5], {'auth_token_comfy_org': 'synthetic-token'})
        self.assertNotIn('synthetic-token', json.dumps(item[:5]))
        with self.assertRaises(ProviderUnavailable):
            self.queue.require_auth()

    async def test_two_concurrent_submissions_keep_credentials_separate(self):
        async def send(index):
            async def enqueue():
                await asyncio.sleep(0)
                await self.queue.enqueue(str(index), {}, owner=str(index))
            await self.authorized(enqueue, 'token-' + str(index))
        await asyncio.gather(send(1), send(2))
        for item in self.native.pending:
            self.assertEqual(item[5]['auth_token_comfy_org'], 'token-' + item[1])

    async def test_cancel_only_removes_owned_pending_task_and_uncertain_remote_is_not_failure(self):
        async def enqueue():
            await self.queue.enqueue('task', {}, owner='owner')
        await self.authorized(enqueue)
        self.assertFalse(await self.queue.cancel('task', owner='foreign'))
        item = self.native.pending.pop(); self.native.running.append(item)
        self.assertFalse(await self.queue.cancel('task', owner='owner'))
        self.native.history = {'task': {'prompt': item[:5], 'status': {'status_str': 'error'}}}
        self.assertEqual((await self.queue.query('task', owner='owner', kind='video')).state, 'unknown')
        self.native.running.clear(); self.native.pending.append(item)
        self.assertTrue(await self.queue.cancel('task', owner='owner'))

    async def test_remote_execution_requires_explicit_assembly(self):
        service = GenerationService(None, None, providers={self.provider.id: self.provider})
        with self.assertRaises(ProviderUnavailable):
            await service.capabilities('Seedance 2.5')
        service.enabled_remote_providers.add(self.provider.id)
        self.assertEqual((await service.capabilities('Seedance 2.5'))['provider'], 'comfy')

    async def test_ledger_submit_recovery_and_duplicate_request_never_enqueue_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            core = CoreServices(root / 'user', root / 'input', root / 'output')
            service = GenerationService(core.jobs, core.assets, providers={self.provider.id: self.provider}, poll_limit=1, poll_interval=0)
            service.enabled_remote_providers.add(self.provider.id)
            data = self.input('text2video'); data['segments'] = [{'type': 'text', 'text': 'synthetic'}]
            jobs = [{'requestId': 'cloud-original', 'input': data, 'source': {}}]
            async def submit():
                await service.submit(jobs)
                await service.wait_idle()
            await self.authorized(submit)
            await self.authorized(submit)
            await service.recover('cloud-original')
            self.assertEqual(len(self.native.pending), 1)
            stored = core.jobs.get('cloud-original')
            self.assertEqual(stored['execution_kind'], 'remote')
            self.assertNotIn('synthetic-token', json.dumps(stored))
            await service.cancel('cloud-original')
            self.assertEqual(self.native.pending, [])
