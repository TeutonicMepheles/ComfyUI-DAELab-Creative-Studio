"""Inert request objects prove API ownership and off-loop work; no listening host."""
import asyncio
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image

from backend.integrations.comfyui.services import CoreServices
from backend.media.export_api import ExportAPI
from backend.media.export_service import ExportService
from test_exports import Queue


class Request:
    scheme, host, content_type = 'http', '127.0.0.1:8226', 'application/json'
    def __init__(self, payload=None, request_id='export', headers=None):
        self.payload = json.dumps(payload).encode()
        self.headers = {'Origin': 'http://127.0.0.1:8226'} if headers is None else headers
        self.content = self
        self.match_info = {'request_id': request_id}

    async def iter_chunked(self, size):
        for offset in range(0, len(self.payload), size):
            yield self.payload[offset:offset + size]


class ExportHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / 'input').mkdir()
        (root / 'output').mkdir()
        Image.new('RGB', (16, 16)).save(root / 'input/image.png')
        self.core = CoreServices(root / 'user', root / 'input', root / 'output')
        self.queue = Queue()
        self.service = ExportService(self.core.jobs, self.core.assets, native_queue=self.queue)
        self.api = ExportAPI(self.service)
        self.body = {'requestId': 'export', 'edit_data': {'version': 1, 'clips': [
            {'source': {'asset': {'filename': 'image.png'}}, 'duration': .25}]}}

    def call(self, method, request):
        response = asyncio.run(getattr(self.api, method)(request))
        return response.status, json.loads(response.body)

    def test_submit_get_cancel_never_do_sqlite_or_media_on_event_loop(self):
        main_thread = threading.get_ident()
        originals = {name: getattr(self.core.jobs, name) for name in ('get', 'create_or_get', 'begin_submission', 'mark_submitted', 'request_cancel', 'confirm_cancelled')}
        def guarded(fn):
            def invoke(*args, **kwargs):
                self.assertNotEqual(threading.get_ident(), main_thread)
                return fn(*args, **kwargs)
            return invoke
        from contextlib import ExitStack
        with ExitStack() as stack:
            for name, fn in originals.items():
                stack.enter_context(patch.object(self.core.jobs, name, side_effect=guarded(fn)))
            status, submitted = self.call('submit', Request(self.body))
            self.assertEqual(status, 202)
            self.assertEqual(submitted['state'], 'submitted')
            self.assertEqual(self.call('get', Request())[1]['requestId'], 'export')
            status, cancelled = self.call('cancel', Request({'expectedVersion': submitted['version']}))
            self.assertEqual((status, cancelled['state']), (200, 'cancelled'))
        self.assertEqual(len(self.queue.calls), 1)

    def test_slow_prepare_does_not_block_event_loop_and_submit_does_not_render(self):
        started, released = threading.Event(), threading.Event()
        original = self.service.prepare
        def slow(*args, **kwargs):
            started.set()
            if not released.wait(2):
                raise AssertionError('HTTP event loop was blocked')
            return original(*args, **kwargs)
        async def run():
            task = asyncio.create_task(self.api.submit(Request(self.body)))
            while not started.is_set():
                await asyncio.sleep(.005)
            released.set()
            return await task
        with patch.object(self.service, 'prepare', side_effect=slow), patch('backend.media.export_service.render', side_effect=AssertionError('HTTP must not render')):
            self.assertEqual(asyncio.run(run()).status, 202)

    def test_cross_site_missing_origin_credentials_and_arbitrary_paths_rejected(self):
        for headers in ({}, {'Origin': 'https://foreign.invalid'}, {'Origin': 'http://127.0.0.1:8226', 'Sec-Fetch-Site': 'cross-site'}):
            self.assertEqual(self.call('submit', Request(self.body, headers=headers))[0], 400)
        for payload in ({**self.body, 'credentials': {'key': 'synthetic'}},
                        {**self.body, 'edit_data': {'version': 1, 'password': 'synthetic', 'clips': []}},
                        {**self.body, 'outputPath': 'C:/outside/output.mp4'}):
            self.assertEqual(self.call('submit', Request(payload))[0], 400)
        self.assertEqual(self.queue.calls, [])
        self.assertEqual(self.core.jobs.list_jobs(), [])

    def test_recovery_rejects_replacement_inputs_and_only_queries_original(self):
        self.call('submit', Request(self.body))
        self.assertEqual(self.call('recover', Request({'edit_data': {}}))[0], 400)
        self.assertEqual(self.call('recover', Request({}))[0], 200)
        self.assertEqual(len(self.queue.queries), 1)
        self.assertEqual(len(self.queue.calls), 1)
        self.assertEqual(self.call('get', Request(request_id='absent'))[0], 404)


if __name__ == '__main__':
    unittest.main()
