import asyncio
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.providers.native_text import NativeTextProvider, PE_MODEL, PE_PROVIDER, final_text
from backend.providers.contracts import ProviderUnavailable
from backend.contracts.errors import InvalidInput
from backend.generation.admission import ResourceAdmission
from backend.generation.http import routes
from test_integration import Request
from backend.integrations.comfyui.local_generation import read_configuration, compose_configured_generation
from backend.integrations.comfyui.generation_nodes.native_text import NativeText
from backend.integrations.comfyui.generation_nodes.native_host import ComfyNativeQueue

class Queue:
    def __init__(self): self.pending, self.history = [], {}
    def busy(self): return bool(self.pending)
    def get_current_queue(self): return [], self.pending
    def get_history(self, task): return {task: self.history[task]} if task in self.history else {}
    def put(self, item): self.pending.append(item)


class NativeTextTests(unittest.IsolatedAsyncioTestCase):
    async def test_configuration_to_capability_and_frozen_reference(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            weight = root / 'pe.safetensors'; weight.write_bytes(b'synthetic pinned weight')
            config = root / 'daelab/creative-studio/local-generation.json'; config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'schemaVersion': 1, 'enabled': True, 'resourceLock': str(root / 'gpu.lock'),
                'modelBindings': {'text_pe': {'text_encoders': {'name': weight.name, 'path': str(weight),
                    'sha256': hashlib.sha256(weight.read_bytes()).hexdigest()}}}}))
            queue = Queue()
            async def validate(*args): return True, None, ['save'], {}
            host = ComfyNativeQueue(SimpleNamespace(prompt_queue=queue, number=1), validate)
            core = SimpleNamespace(jobs=object(), assets=object(), resources=ResourceAdmission())
            types = lambda: {'CLIPLoader', 'LoadImage', 'TextGenerate', 'DAELAB.NativeText'}
            service = compose_configured_generation(core, read_configuration(root), native_queue=host,
                node_types=types, resolve_model=lambda category, name: str(weight), release_native_models=lambda: None)
            provider = service.provider(PE_PROVIDER)
            provider.media_input = lambda item: 'frozen-reference.png'
            self.assertTrue((await service.capabilities(PE_MODEL))['available'])
            handlers = {path: handler for _, path, handler in routes(service)}
            discover = handlers['/daelab/prompt-optimization/capabilities']
            async def capability():
                return await discover(Request({'contractVersion': 1, 'model': PE_MODEL}))
            response = await capability()
            self.assertEqual(response.status, 200)
            selected = json.loads(response.body)['models'][0]
            self.assertEqual((selected['id'], selected['provider'], selected['available'], selected['modes']),
                             (PE_MODEL, 'local', True, ['reverse']))
            self.assertTrue(selected['requiresReference'])
            self.assertEqual(queue.pending, [])

            self.assertIn(PE_MODEL, [m['id'] for m in service.model_catalog()['models']])
            data = {'entry': 'canvas', 'model': PE_MODEL, 'mode': 'reverse', 'source': 'Keep the product', 'instruction': 'Forest'}
            built = provider.build(data, [{'kind': 'image'}], 'identity')
            self.assertEqual(built['graph']['image']['inputs']['image'], 'frozen-reference.png')
            self.assertEqual(built['graph']['save']['inputs']['image'], ['image', 0])
            self.assertEqual(built['models']['text_encoders']['name'], weight.name)
            with self.assertRaises(InvalidInput): provider.build(data, [], 'missing')
            captured=[]
            async def prepare(items):
                captured.extend(items)
                provider.build(items[0]['input'],items[0]['input']['assets'],items[0]['requestId'])
                return [{'request_id':items[0]['requestId'],'state':'succeeded'}]
            service.prepare_batch=prepare
            service.public=lambda request_id:{'requestId':request_id,'phase':'complete','receipt':{'kind':'text','text':'A complete prompt'},'result':'A complete prompt'}
            with patch('backend.generation.http.image_data_reference',return_value={'kind':'image'}):
                response=await handlers['/daelab/prompt-optimization/polish'](Request({'contractVersion':1,'requestId':'route-pe','model':PE_MODEL,'mode':'reverse','source':'Keep product','instruction':'Forest','imageDataUrl':'synthetic'}))
            self.assertEqual(response.status,200)
            self.assertEqual(captured[0]['input']['model'],PE_MODEL)
            self.assertEqual(captured[0]['input']['assets'],[{'kind':'image'}])
            self.assertEqual(json.loads(response.body)['model'],PE_MODEL)
            # The same real route preserves file/hash failures instead of falling back.
            for change in ('hash', 'missing'):
                if change == 'hash': weight.write_bytes(b'changed')
                else: weight.unlink()
                failed = await capability()
                self.assertEqual(failed.status, 503)
                error = json.loads(failed.body)
                self.assertEqual(error['code'], 'provider_unavailable')
                self.assertNotIn('Unsupported optimization model', error['error'])
                self.assertEqual(queue.pending, [])
            weight.write_bytes(b'changed')
            with self.assertRaises(ProviderUnavailable): await provider.capabilities(PE_MODEL)

    async def test_incomplete_text_is_never_a_successful_receipt(self):
        queue = Queue()
        async def validate(*args): return True, None, ['save'], {}
        host = ComfyNativeQueue(SimpleNamespace(prompt_queue=queue, number=1), validate)
        await host.enqueue('text-task', {}, owner='ours')
        record = {'text': 'final', 'complete': True, 'maxOutputTokens': 2048, 'outputTokens': 12}
        queue.history['text-task'] = {'prompt': queue.pending.pop(), 'status': {'status_str': 'success', 'completed': True},
                                     'outputs': {'save': {'creative_studio_text': [record]}}}
        self.assertEqual((await host.query('text-task', owner='ours', kind='text')).text, 'final')
        record['outputTokens'] = 2048
        self.assertEqual((await host.query('text-task', owner='ours', kind='text')).error_code, 'incomplete_text_response')
        record['outputTokens'] = 12; record['complete'] = False
        self.assertEqual((await host.query('text-task', owner='ours', kind='text')).state, 'failed')

    def test_reasoning_is_not_mixed_into_final_prompt(self):
        self.assertEqual(final_text('<think>private reasoning</think>\n\nFinal\n  - detail'), 'Final\n  - detail')
        self.assertEqual(final_text('</think>\nFinal'), 'Final')
        self.assertEqual(final_text('<think>unfinished'), '')
        self.assertEqual(final_text('<|unexpected|>content'), '')

    def test_native_node_counts_actual_ids_and_refuses_limit(self):
        class Clip:
            def generate(self, *args, **kwargs): return list(range(4))
        def execute(clip, prompt, maximum, sampling, **kwargs):
            clip.generate(None, max_length=maximum)
            return SimpleNamespace(result=('</think>\nFinal', ''))
        module = SimpleNamespace(TextGenerate=SimpleNamespace(execute=execute))
        with patch.dict('sys.modules', {'comfy_extras.nodes_textgen': module}):
            success = NativeText().execute(Clip(), 'request', 5)['ui']['creative_studio_text'][0]
            failure = NativeText().execute(Clip(), 'request', 4)['ui']['creative_studio_text'][0]
        self.assertEqual((success['text'], success['outputTokens'], success['complete']), ('Final', 4, True))
        self.assertEqual((failure['text'], failure['limitReached'], failure['complete']), ('', True, False))
