import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from backend.providers.native import ModelInventory
from backend.providers.qwen import QwenProvider
from backend.providers.contracts import ProviderUnavailable, SubmissionUncertain, SubmissionRejected
from backend.providers.parameters import QWEN_MODEL
from backend.generation.admission import LocalAdmission
from backend.integrations.comfyui.generation_nodes.native_host import ComfyNativeQueue


class Queue:
    def __init__(self):
        self.running, self.pending, self.history, self.interrupts = [], [], {}, []
    def get_current_queue(self): return self.running, self.pending
    def get_history(self, task_id): return {task_id: self.history[task_id]} if task_id in self.history else {}
    def put(self, item): self.pending.append(item)
    def delete_queue_item(self, predicate):
        for item in self.pending:
            if predicate(item): self.pending.remove(item); return True
        return False
    def interrupt_if_running(self, task_id): self.interrupts.append(task_id)


class NativeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.queue = Queue()
        async def validate(*_args): return (True, None, ['save'], {})
        self.host = ComfyNativeQueue(SimpleNamespace(prompt_queue=self.queue, number=1), validate)

    async def test_pending_cancel_matches_both_native_and_request_id(self):
        await self.host.enqueue('a', {}, owner='row-a')
        await self.host.enqueue('b', {}, owner='row-b')
        self.assertFalse(await self.host.cancel('a', owner='row-b'))
        self.assertTrue(await self.host.cancel('a', owner='row-a'))
        self.assertEqual([i[1] for i in self.queue.pending], ['b'])
        self.assertEqual(self.queue.interrupts, [])

    async def test_running_cancel_never_uses_global_interrupt_or_claims_immediate_stop(self):
        await self.host.enqueue('a', {}, owner='row-a')
        self.queue.running.append(self.queue.pending.pop())
        self.assertFalse(await self.host.cancel('a', owner='row-a'))
        self.assertEqual(self.queue.interrupts, ['a'])
        self.assertEqual((await self.host.query('a', owner='row-a', kind='image')).state, 'running')
        self.queue.interrupt_if_running = None
        with self.assertRaises(ProviderUnavailable): await self.host.cancel('a', owner='row-a')
        self.assertEqual(self.queue.interrupts, ['a'])

    async def test_foreign_queue_and_history_identity_are_rejected(self):
        await self.host.enqueue('a', {}, owner='foreign')
        with self.assertRaises(SubmissionRejected): await self.host.query('a', owner='ours', kind='image')
        self.queue.history['a'] = {'prompt': self.queue.pending.pop(), 'status': {'status_str': 'success', 'completed': True}, 'outputs': {'save': {'images': [{'filename': 'result.png', 'type': 'output'}]}}}
        with self.assertRaises(SubmissionRejected): await self.host.query('a', owner='ours', kind='image')
        observed = await self.host.query('a', owner='foreign', kind='image')
        self.assertEqual(observed.state, 'succeeded')
        self.assertEqual(observed.files, ({'root': 'output', 'path': 'result.png', 'kind': 'image'},))
        self.queue.history['a']['status']['completed'] = False
        self.assertEqual((await self.host.query('a', owner='foreign', kind='image')).state, 'failed')

    async def test_native_validation_failure_never_puts_a_queue_item(self):
        async def invalid(*_args): return (False, {}, [], {})
        self.host.validate_prompt = invalid
        with self.assertRaises(SubmissionRejected): await self.host.enqueue('a', {}, owner='row')
        self.assertEqual(self.queue.pending, [])


class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_io_at_construction_and_quarantine_blocks_until_verified_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'new' / 'gpu.lock'
            calls = []
            async def release(): calls.append('release-native')
            async def bad_unload(): calls.append('unload'); raise ProviderUnavailable('synthetic unload failure')
            admission = LocalAdmission(path, native_busy=lambda: False, ensure_unloaded=bad_unload, release_native_models=release)
            self.assertFalse(path.parent.exists())
            with self.assertRaises(ProviderUnavailable):
                async with admission.lease('ollama'): calls.append('execute')
            self.assertEqual(calls, ['release-native', 'execute', 'unload'])
            self.assertTrue(path.with_suffix('.quarantine').exists())
            with self.assertRaises(ProviderUnavailable):
                async with admission.lease('native'): self.fail('quarantine must block dispatch')
            async def good_unload(): calls.append('verified-unload')
            admission.ensure_unloaded = good_unload
            async with admission.lease('native'): calls.append('safe-native')
            self.assertFalse(path.with_suffix('.quarantine').exists())
            self.assertEqual(calls[-2:], ['verified-unload', 'safe-native'])

    async def test_native_foreign_work_blocks_local_resource_without_unloading_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            async def forbidden(): self.fail('must not unload models owned by a busy native queue')
            admission = LocalAdmission(Path(tmp) / 'gpu.lock', native_busy=lambda: True, ensure_unloaded=forbidden, release_native_models=forbidden)
            with self.assertRaises(ProviderUnavailable):
                async with admission.lease('ollama'): self.fail('must not dispatch')

    async def test_missing_model_or_changed_hash_has_exact_unavailable_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'model.bin'
            expected = hashlib.sha256(b'pinned').hexdigest()
            inventory = ModelInventory({'weights': {'name': 'fixed.bin', 'path': file, 'sha256': expected}}, lambda: ['Sampler'])
            models = inventory.descriptions(['weights'])
            with self.assertRaisesRegex(ProviderUnavailable, 'fixed.bin'): inventory.verify(models, {'a': {'class_type': 'Sampler'}})
            file.write_bytes(b'wrong')
            with self.assertRaisesRegex(ProviderUnavailable, 'hash differs'): inventory.verify(models, {'a': {'class_type': 'Sampler'}})
            file.write_bytes(b'pinned'); inventory.verify(models, {'a': {'class_type': 'Sampler'}})
            with self.assertRaisesRegex(ProviderUnavailable, 'Missing native nodes: Other'): inventory.verify(models, {'a': {'class_type': 'Other'}})

    async def test_capabilities_keep_source_control_defaults_without_queue_submission(self):
        from backend.providers.native import NativeProvider
        from backend.providers.parameters import VIDEO_MODEL,VIDEO_FILES
        with tempfile.TemporaryDirectory() as tmp:
            weight=Path(tmp)/'weight';weight.write_bytes(b'fixture')
            bindings={key:{'name':key,'path':str(weight),'sha256':hashlib.sha256(weight.read_bytes()).hexdigest()} for key in VIDEO_FILES if key!='loras'}
            class Inventory(ModelInventory):
                def verify(self,models,graph):pass
            class Host:
                async def validate(self,*_args):pass
                async def enqueue(self,*_args,**_kwargs):raise AssertionError('capability must not queue')
            provider=NativeProvider('video',inventory=Inventory(bindings,lambda:set()),queue=Host(),media_input=lambda _:None)
            props=(await provider.capabilities(VIDEO_MODEL))['schema']['properties']
            self.assertEqual([props['width']['default'],props['height']['default'],props['duration']['default']],[512,288,2])
            self.assertFalse(props['turbo']['default']);self.assertEqual(props['width']['displayName'],'宽度')
            provider.inventory.bindings['loras']={**bindings['video_vae'],'name':'turbo'}
            self.assertTrue((await provider.capabilities(VIDEO_MODEL))['schema']['properties']['turbo']['default'])

    async def test_native_resolver_must_select_the_same_pinned_model_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            first=Path(tmp)/'pinned.safetensors';first.write_bytes(b'weight')
            other=Path(tmp)/'shadow.safetensors';other.write_bytes(b'weight')
            binding={'vae':{'name':'model.safetensors','path':str(first),'sha256':hashlib.sha256(first.read_bytes()).hexdigest()}}
            inventory=ModelInventory(binding,lambda:{'VAELoader'},lambda category,name:str(other))
            with self.assertRaises(ProviderUnavailable):inventory.verify(inventory.descriptions(['vae']),{'v':{'class_type':'VAELoader'}})
            inventory.resolve_model=lambda category,name:str(first)
            inventory.verify(inventory.descriptions(['vae']),{'v':{'class_type':'VAELoader'}})

    async def test_qwen_missing_model_and_lost_response_never_fall_back_or_replay(self):
        from qwen_test_binding import binding_fixture
        class Transport:
            def __init__(self,digest): self.calls=[];self.ready=False;self.digest=digest
            async def request(self,action,body=None):
                self.calls.append(action)
                if action=='tags':return {'models':[{'name':QWEN_MODEL,'digest':self.digest}] if self.ready else []}
                if action=='ps':return {'models':[]}
                raise TimeoutError('synthetic lost response')
        with tempfile.TemporaryDirectory() as tmp:
            binding=binding_fixture(Path(tmp)/'registry');transport=Transport(binding.expected_manifest_sha256)
            provider=QwenProvider(transport=transport,read_frozen=lambda _:b'',binding=binding)
            data={'mode':'polish','source':'synthetic','instruction':'keep facts'}
            snapshot={'input':data,'media':[],'prepared':provider.build(data,[],'request')}
            with self.assertRaises(ProviderUnavailable):await provider.preflight(snapshot)
            self.assertEqual(transport.calls,['tags','ps'])
            transport.ready=True;await provider.preflight(snapshot)
            with self.assertRaises(SubmissionUncertain):await provider.create('request',snapshot)
            self.assertEqual(transport.calls.count('generate'),1)
            self.assertIsNone(await provider.lookup('request',snapshot));self.assertFalse(await provider.cancel('request',snapshot))


if __name__ == '__main__': unittest.main()


class OwnedInterruptTests(unittest.TestCase):
    def test_atomic_native_owner_guard_refuses_foreign_or_parallel_runners(self):
        from backend.integrations.comfyui.generation_nodes.native_host import owned_native_interrupt
        import threading
        from types import SimpleNamespace
        def item(task,owner):return (0,task,{}, {'creative_studio_request_id':owner})
        calls=[];queue=SimpleNamespace(mutex=threading.RLock(),currently_running={1:item('native','request')})
        request=owned_native_interrupt(queue,lambda flag:calls.append(flag))
        self.assertFalse(request('native','foreign'));self.assertEqual(calls,[])
        queue.currently_running[2]=item('other','foreign')
        self.assertFalse(request('native','request'));self.assertEqual(calls,[])
        del queue.currently_running[2]
        self.assertTrue(request('native','request'));self.assertEqual(calls,[True])
        queue.currently_running={1:item('new','foreign')}
        self.assertFalse(request('native','request'));self.assertEqual(calls,[True])
