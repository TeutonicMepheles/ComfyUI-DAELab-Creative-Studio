import asyncio
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.providers.qwen_binding import QwenModelBinding
from backend.providers.qwen import QwenProvider,LoopbackOllama
from backend.providers.contracts import ProviderUnavailable
from backend.providers.parameters import QWEN_MODEL
from qwen_test_binding import binding_fixture

class BindingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='studio-qwen-binding-');self.root=Path(self.temp.name);self.binding=binding_fixture(self.root/'registry')
    def tearDown(self):self.temp.cleanup()
    async def test_construction_is_no_io_and_unbound_same_name_is_unavailable(self):
        path=self.root/'absent'
        binding=QwenModelBinding(manifest_path=path/'registry',installed_manifest_path=path/'installed',blobs_root=path/'blobs',expected_manifest_sha256='a'*64,expected_blobs=[])
        self.assertFalse(path.exists())
        with self.assertRaises(ProviderUnavailable):binding.verify()
        provider=QwenProvider(transport=None,read_frozen=lambda _:None)
        with self.assertRaises(ProviderUnavailable):await provider.preflight({})
    async def test_manifest_and_all_six_actual_blob_hashes_are_verified(self):
        weights=self.binding.verify();self.assertEqual(len(weights['blobs']),6)
        self.assertEqual(weights['registryDigest'],'sha256:'+hashlib.sha256(self.binding.manifest_path.read_bytes()).hexdigest())
        blob=self.binding.expected_blobs[0];path=self.binding.blobs_root/('sha256-'+blob['sha256'])
        raw=path.read_bytes();path.write_bytes(bytes([raw[0]^1])+raw[1:])
        with self.assertRaises(ProviderUnavailable):self.binding.verify()
    async def test_same_name_installed_manifest_replacement_is_rejected(self):
        self.binding.verify();self.binding.installed_manifest_path.write_text('{}',encoding='utf-8')
        with self.assertRaises(ProviderUnavailable):self.binding.verify()
    async def test_extra_manifest_blob_is_rejected_even_if_manifest_hash_was_rebound(self):
        value=json.loads(self.binding.manifest_path.read_bytes());value['layers'].append({'mediaType':'application/vnd.ollama.image.extra','digest':'sha256:'+'a'*64,'size':1})
        raw=json.dumps(value).encode();self.binding.manifest_path.write_bytes(raw);self.binding.installed_manifest_path.write_bytes(raw);self.binding.expected_manifest_sha256=hashlib.sha256(raw).hexdigest()
        with self.assertRaises(ProviderUnavailable):self.binding.verify()
    async def test_provider_snapshot_contains_weights_and_same_name_wrong_digest_never_generates(self):
        class Transport:
            calls=[];resident=[]
            async def request(inner,action,body=None):
                inner.calls.append(action)
                if action=='tags':return {'models':[{'name':QWEN_MODEL,'digest':'b'*64}]}
                if action=='ps':return {'models':inner.resident}
                raise AssertionError('must not generate')
        transport=Transport();provider=QwenProvider(transport=transport,read_frozen=lambda _:None,binding=self.binding)
        data={'mode':'polish','source':'cube','instruction':'clarify'};prepared=provider.build(data,[],'request')
        self.assertEqual(prepared['weights'],self.binding.verify())
        with self.assertRaises(ProviderUnavailable):await provider.create('request',{'input':data,'prepared':prepared})
        self.assertNotIn('generate',transport.calls)
    async def test_frozen_weight_mismatch_or_foreign_residency_rejects_before_generate(self):
        class Transport:
            def __init__(inner,digest):inner.digest=digest;inner.calls=[]
            async def request(inner,action,body=None):
                inner.calls.append(action)
                if action=='tags':return {'models':[{'name':QWEN_MODEL,'digest':inner.digest}]}
                if action=='ps':return {'models':[{'name':QWEN_MODEL}]}
                raise AssertionError('must not unload or generate')
        transport=Transport(self.binding.expected_manifest_sha256);provider=QwenProvider(transport=transport,read_frozen=lambda _:None,binding=self.binding)
        prepared=provider.build({'mode':'polish','source':'cube','instruction':'clarify'},[],'request')
        changed=copy.deepcopy(prepared);changed['weights']['manifestSha256']='c'*64
        with self.assertRaises(ProviderUnavailable):await provider.preflight({'prepared':changed})
        self.assertEqual(transport.calls,[])
        with self.assertRaises(ProviderUnavailable):await provider.preflight({'prepared':prepared})
        self.assertNotIn('generate',transport.calls)
    async def test_release_verification_never_sends_unload_for_owned_or_foreign_models(self):
        class Transport(LoopbackOllama):
            def __init__(inner):super().__init__(release_checks=1);inner.calls=[];inner.models=[{'name':'foreign-model'}]
            async def request(inner,action,body=None):inner.calls.append((action,body));return {'models':inner.models}
        transport=Transport()
        with self.assertRaises(ProviderUnavailable):await transport.ensure_unloaded()
        transport.models=[{'name':QWEN_MODEL}]
        with self.assertRaises(ProviderUnavailable):await transport.ensure_unloaded()
        transport.models=[];await transport.ensure_unloaded()
        self.assertEqual(transport.calls,[('ps',None)]*3)
