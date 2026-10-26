"""Real SQLite/catalog and bounded synthetic file bytes, no HTTP listener."""
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from backend.assets import AssetCatalog
from backend.contracts.errors import StorageError
from backend.integrations.comfyui.asset_api import AssetAPI
from test_asset_http import Request


class AssetRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.roots={k:self.root/k for k in ('input','output','temp')}
        for p in self.roots.values(): p.mkdir()
        for root in self.roots.values(): (root/'sample.png').write_bytes(b'synthetic immutable file')
        self.catalog=AssetCatalog(self.root/'assets.sqlite',roots=self.roots)
        self.api=AssetAPI(self.catalog)

    def media(self, root='input', node='node-a'):
        return {'kind':'image','name':'合成图','asset':{'version':1,'kind':'image','name':'合成图','filename':'sample.png','subfolder':'','type':root},'source':{'operation':'upload','documentId':'workflow-a','nodeId':node}}

    def call(self, action, value, **kwargs):
        response=asyncio.run(getattr(self.api, action)(Request(value,**kwargs)))
        return response.status,json.loads(response.body)

    def test_upload_registration_is_not_a_favorite_and_retries_keep_identity_and_provenance(self):
        status,body=self.call('register',self.media());self.assertEqual(status,200)
        registration=body['registration'];self.assertEqual(self.call('register',self.media())[1],body)
        self.assertEqual(registration['contentSha256'],hashlib.sha256(b'synthetic immutable file').hexdigest())
        self.call('register',self.media(node='node-b'))
        record=self.catalog.get(registration['assetId'])
        self.assertEqual(len(record['references']),1);self.assertEqual(len(record['provenance']),2)
        self.assertEqual(self.catalog.search(),[])

    def test_restored_original_bytes_revalidate_the_same_reference(self):
        value=self.media();registration=self.call('register',value)[1]['registration'];value['asset']=registration['asset']
        path=self.roots['input']/'sample.png';path.unlink()
        self.assertFalse(self.catalog.validate_reference(registration['referenceId'])['usable'])
        path.write_bytes(b'synthetic immutable file')
        status,body=self.call('register',value)
        self.assertEqual(status,200);self.assertEqual(body['registration']['referenceId'],registration['referenceId'])
        self.assertEqual(body['registration']['status'],'available')
        reopened=AssetCatalog(self.root/'assets.sqlite',roots=self.roots)
        self.assertEqual(reopened.get(registration['assetId'])['content_sha256'],registration['contentSha256'])

    def test_same_content_distinct_roots_keep_exact_favorite_reference(self):
        a=self.call('register',self.media())[1]['registration']
        value=self.media('output');b=self.call('register',value)[1]['registration']
        self.assertEqual(a['assetId'],b['assetId']);self.assertNotEqual(a['referenceId'],b['referenceId'])
        value['asset']=b['asset']
        for action in ('favorite','lookup'):
            status,body=self.call(action,value);self.assertEqual(status,200)
            self.assertEqual(body['entry']['referenceId'],b['referenceId']);self.assertEqual(body['entry']['asset']['type'],'output')
        status,body=self.call('resolve',{'assetId':b['assetId'],'referenceId':b['referenceId']})
        self.assertEqual(status,200);self.assertEqual(body['registration']['asset']['type'],'output')

    def test_changed_file_rejects_old_identity_before_recording_new_contents(self):
        value=self.media();registered=self.call('register',value)[1]['registration'];value['asset']=registered['asset']
        (self.roots['input']/'sample.png').write_bytes(b'replaced bytes')
        for action in ('register','lookup','favorite'):
            self.assertEqual(self.call(action,value)[0],409)
        self.assertEqual(self.call('resolve',{'assetId':registered['assetId'],'referenceId':registered['referenceId']})[0],409)
        self.assertEqual(self.catalog.get(registered['assetId'])['content_sha256'],registered['contentSha256'])
        self.assertEqual(self.catalog.search(),[])

    def test_text_snapshots_never_rewrite_old_text_or_create_favorites(self):
        value={'kind':'text','name':'文本','text':'甲\n乙','source':{'operation':'text-commit','nodeId':'one'}}
        first=self.call('register',value)[1]['registration'];self.assertEqual(first,self.call('register',value)[1]['registration'])
        value['text']='新文本';second=self.call('register',value)[1]['registration']
        self.assertNotEqual(first['assetId'],second['assetId']);self.assertEqual(self.catalog.get(first['assetId'])['text_snapshot'],'甲\n乙')
        self.assertEqual(self.catalog.search(),[]);self.assertNotIn('text',first)

    def test_cross_origin_invalid_paths_sources_and_temp_do_not_publish(self):
        self.assertEqual(self.call('register',self.media(),headers={'Origin':'https://foreign.invalid'})[0],400)
        for field,value in [('filename','../sample.png'),('subfolder','../output'),('filename','C:sample.png'),('type','temp')]:
            payload=self.media();payload['asset'][field]=value
            self.assertEqual(self.call('register',payload)[0],400)
        payload=self.media();payload['source']['authorization']='secret'
        self.assertEqual(self.call('register',payload)[0],400)
        self.assertEqual(self.catalog.search(),[])

    def test_storage_failure_is_not_reported_as_registered_or_favorited(self):
        with patch.object(self.catalog,'register_file',side_effect=StorageError('synthetic write failure')):
            status,body=self.call('register',self.media())
        self.assertEqual(status,503);self.assertNotIn('registration',body);self.assertEqual(self.catalog.search(),[])
