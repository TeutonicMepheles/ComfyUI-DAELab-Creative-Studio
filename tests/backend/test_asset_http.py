"""SQLite/HTTP contract integration without opening a server or touching user data."""
import asyncio
import copy
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import concurrent.futures
import importlib
import sys
import types
import unittest
from unittest.mock import patch

from backend.assets.catalog import AssetCatalog, _stable
from backend.contracts.database import APPLICATION_ID, _MIGRATIONS
from backend.contracts.errors import InvalidInput
from backend.integrations.comfyui.asset_api import AssetAPI
from compat.legacy.favorites import import_browser_favorites


class Request:
    scheme = 'http'
    host = '127.0.0.1:8226'
    content_type = 'application/json'
    def __init__(self, value=None, *, query=None, headers=None, favorite_id=None):
        self.payload = json.dumps(value).encode()
        self.content = self
        self.headers = {'Origin': 'http://127.0.0.1:8226', 'Sec-Fetch-Site': 'same-origin'} if headers is None else headers
        self.query = query or {}
        self.match_info = {'favorite_id': favorite_id}
    async def iter_chunked(self, size):
        for start in range(0, len(self.payload), size):
            yield self.payload[start:start + size]


class AssetHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.input = self.root / 'input'
        self.input.mkdir()
        (self.input / 'one.png').write_bytes(b'synthetic-content')
        self.catalog = AssetCatalog(self.root / 'studio.sqlite', roots={'input': self.input})
        self.api = AssetAPI(self.catalog)
        self.text = {'kind': 'text', 'name': '合成收藏', 'text': 'synthetic text'}

    def call(self, name, request):
        response = asyncio.run(getattr(self.api, name)(request))
        return response.status, json.loads(response.body)

    def legacy(self, text='synthetic text', **extra):
        return {'version': 1, 'entries': [{'id': 'original-1', **self.text, 'text': text, **extra}]}

    def test_add_lookup_remove_restore_and_reopen_are_durable(self):
        status, saved = self.call('favorite', Request(self.text))
        self.assertEqual(status, 200)
        entry = saved['entry']
        self.assertEqual(self.call('lookup', Request(self.text))[1]['entry']['id'], entry['id'])
        self.assertEqual(self.call('unfavorite', Request(favorite_id=entry['id']))[0], 200)
        reopened = AssetCatalog(self.root / 'studio.sqlite', roots={'input': self.input})
        self.assertEqual(reopened.search(), [])
        self.assertIsNotNone(reopened.find_favorite(entry['assetId'], include_removed=True)['removed_at'])
        status, restored = self.call('favorite', Request(self.text))
        self.assertEqual(restored['entry']['id'], entry['id'])
        self.assertEqual(len(reopened.search()), 1)

    def test_same_and_different_origin_import_never_revive_cancelled_identity(self):
        original = self.legacy(future={'preserved': [1, 2]})
        backup = copy.deepcopy(original)
        body = {'origin': 'http://127.0.0.1:8000', 'document': original}
        status, imported = self.call('import_legacy', Request(body))
        self.assertEqual(status, 200)
        self.assertEqual(imported['accepted'], 1)
        entry = self.catalog.search()[0]
        self.catalog.unfavorite(entry['favorite_id'])
        second = self.call('import_legacy', Request(body))[1]
        self.assertEqual(second['report'][0]['status'], 'already_imported_cancelled')
        body['origin'] = 'http://localhost:8000'
        third = self.call('import_legacy', Request(body))[1]
        self.assertEqual(third['report'][0]['status'], 'cancelled_preserved')
        self.assertEqual(self.catalog.search(), [])
        export = self.catalog.export_favorites()
        self.assertEqual(len(export['origins']), 2)
        for origin in export['origins']:
            self.assertEqual(json.loads(origin['raw_json'])['legacy_raw'], original['entries'][0])
        self.assertEqual(original, backup)

    def test_changed_source_identity_is_reported_and_original_retained(self):
        import_browser_favorites(self.catalog, origin='http://old.local', document=self.legacy())
        report = import_browser_favorites(self.catalog, origin='http://old.local', document=self.legacy('changed'))
        self.assertEqual(report['rejected'], 1)
        self.assertEqual(self.catalog.search()[0]['text_snapshot'], 'synthetic text')

    def test_import_mixed_entries_reports_invalid_and_missing_files(self):
        original = self.legacy()
        original['entries'] += [{'id': 'missing', 'kind': 'image', 'name': 'missing', 'asset': {
            'kind': 'image', 'filename': 'missing.png', 'subfolder': '', 'type': 'input'}},
            {'id': 'bad', 'kind': 'image', 'name': 'escape', 'asset': {
                'kind': 'image', 'filename': '../bad.png', 'type': 'input'}}]
        report = import_browser_favorites(self.catalog, origin='http://old.local', document=original)
        self.assertEqual((report['accepted'], report['rejected']), (2, 1))
        self.assertEqual(report['report'][1]['status'], 'missing')
        self.assertTrue(report['source_preserved'])

    def test_cross_origin_missing_origin_credentials_and_paths_are_rejected(self):
        for headers in ({}, {'Origin': 'http://evil.invalid'}, {'Origin': 'http://127.0.0.1:8226', 'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.call('favorite', Request(self.text, headers=headers))[0], 400)
            self.assertEqual(self.call('unfavorite', Request(favorite_id='nonexistent', headers=headers))[0], 400)
        for body in ({**self.text, 'api_key': 'must-not-save'}, {**self.text, 'metadata': {'credential': 'no'}},
                     {'kind': 'image', 'name': 'bad', 'asset': {'kind': 'image', 'filename': 'C:\\secret.png', 'type': 'input'}}):
            self.assertEqual(self.call('favorite', Request(body))[0], 400)
        self.assertEqual(self.catalog.search(), [])

    def test_search_is_bounded_paginated_and_literal(self):
        for n in range(65):
            asset = self.catalog.register_text(f'text {n}')
            self.catalog.favorite(asset['asset_id'], display_name=f'name {n}%_')
        status, first = self.call('search', Request(query={'limit': '48'}))
        status2, second = self.call('search', Request(query={'limit': '48', 'offset': '48'}))
        self.assertEqual((status, status2), (200, 200))
        self.assertEqual((len(first['entries']), len(second['entries']), first['total']), (48, 17, 65))
        self.assertTrue(first['hasMore']); self.assertFalse(second['hasMore'])
        self.assertFalse(set(e['id'] for e in first['entries']) & set(e['id'] for e in second['entries']))
        self.assertEqual(self.call('search', Request(query={'q': '%_'}))[1]['total'], 65)
        for query in ({'limit': '101'}, {'offset': '-1'}, {'limit': 'no'}):
            self.assertEqual(self.call('search', Request(query=query))[0], 400)

    def test_cap_is_2000_active_favorites_and_restore_respects_it(self):
        asset = self.catalog.register_text('cancel me')
        canceled = self.catalog.favorite(asset['asset_id'], display_name='cancel me')
        self.catalog.unfavorite(canceled)
        # Populate the real schema in one transaction rather than 4000 fsync calls.
        with self.catalog.database.transaction() as connection:
            for n in range(2000):
                record = self.catalog._text_record(f'bounded {n}')
                self.catalog._insert(connection, record)
                self.catalog._favorite(connection, record['asset_id'], f'bounded {n}')
        with self.assertRaisesRegex(InvalidInput, '2000'):
            self.catalog.favorite(asset['asset_id'], display_name='cancel me')
        self.assertEqual(self.catalog.search_page()['total'], 2000)
        self.catalog.unfavorite(self.catalog.search(limit=1)[0]['favorite_id'])
        self.catalog.favorite(asset['asset_id'], display_name='cancel me')
        self.assertEqual(self.catalog.search_page()['total'], 2000)

    def test_v2_database_migrates_without_losing_origin_or_jobs(self):
        path = self.root / 'v2.sqlite'
        connection = sqlite3.connect(path)
        try:
            for version in (1, 2):
                for statement in _MIGRATIONS[version]: connection.execute(statement)
            connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
            connection.execute('PRAGMA user_version=2')
            connection.execute("INSERT INTO assets VALUES('a','text:a','text',NULL,1,'x','then')")
            connection.execute("INSERT INTO favorites VALUES('f','a','saved','then')")
            connection.execute("INSERT INTO favorite_origins VALUES('old','legacy','hash','f','{}')")
            connection.commit()
        finally:
            connection.close()
        catalog = AssetCatalog(path, roots={'input': self.input})
        self.assertEqual(catalog.search()[0]['favorite_id'], 'f')
        self.assertEqual(len(catalog.export_favorites()['origins']), 1)
        catalog.unfavorite('f')
        self.assertEqual(len(catalog.export_favorites()['origins']), 1)

    def test_file_identity_deduplicates_content_and_changed_file_no_longer_matches(self):
        value = {'kind': 'image', 'name': 'image', 'asset': {'version': 1, 'kind': 'image', 'name': 'image', 'filename': 'one.png', 'subfolder': '', 'type': 'input'}}
        entry = self.call('favorite', Request(value))[1]['entry']
        (self.input / 'two.png').write_bytes((self.input / 'one.png').read_bytes())
        value['asset']['filename'] = 'two.png'
        second = self.call('favorite', Request(value))[1]['entry']
        self.assertEqual(entry['id'], second['id'])
        (self.input / 'two.png').write_bytes(b'changed')
        self.assertIsNone(self.call('lookup', Request(value))[1]['entry'])

    def test_http_catalog_work_runs_off_event_loop_thread(self):
        main = threading.get_ident()
        original = self.catalog.search_page
        def checked(*args, **kwargs):
            self.assertNotEqual(threading.get_ident(), main)
            return original(*args, **kwargs)
        with patch.object(self.catalog, 'search_page', checked):
            self.assertEqual(self.call('search', Request())[0], 200)

    def test_last_favorite_slot_is_atomic_under_competing_writers(self):
        with self.catalog.database.transaction() as connection:
            for n in range(1999):
                record = self.catalog._text_record(f'existing {n}')
                self.catalog._insert(connection, record)
                self.catalog._favorite(connection, record['asset_id'], f'existing {n}')
        candidates = [self.catalog.register_text(f'candidate {n}')['asset_id'] for n in range(4)]
        def claim(asset_id):
            try:
                self.catalog.favorite(asset_id, display_name='competing')
                return True
            except InvalidInput:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(claim, candidates))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.catalog.search_page()['total'], 2000)

    def test_renamed_host_package_import_uses_its_own_compat_and_backend(self):
        name = 'synthetic_renamed_studio'
        module = types.ModuleType(name)
        module.__path__ = [str(Path(__file__).resolve().parents[2])]
        with patch.dict(sys.modules, {name: module}):
            api_type = importlib.import_module(name + '.backend.integrations.comfyui.asset_api').AssetAPI
            catalog_type = importlib.import_module(name + '.backend.assets.catalog').AssetCatalog
            catalog = catalog_type(self.root / 'renamed.sqlite', roots={'input': self.input})
            response = asyncio.run(api_type(catalog).favorite(Request(self.text)))
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.body)['entry']['text'], 'synthetic text')


if __name__ == '__main__': unittest.main()
