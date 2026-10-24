import json
import tempfile
from pathlib import Path
import unittest

from backend.generation.assembly import assemble_generation
from backend.generation.http import routes
from backend.integrations.comfyui.services import CoreServices


class Request:
    def __init__(self, payload): self.payload = payload
    async def json(self): return self.payload


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_discovery_is_readonly_intersection_with_explicit_scan_cursor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'input').mkdir(); (root / 'output').mkdir()
            core = CoreServices(root / 'user', root / 'input', root / 'output')
            service = assemble_generation(core)
            source = {'documentId': 'document', 'tableId': 'table', 'nodeId': 'node'}
            scopes = [dict(source, nodeId='other-node'), source, dict(source, tableId='other-table'), dict(source, documentId='other-document')]
            for index, scope in enumerate(scopes):
                core.jobs.create_or_get(f'request-{index}', provider='disabled', execution_kind='local', snapshot={'synthetic': index}, source=scope)
            before = [core.jobs.diagnostics(f'request-{i}') for i in range(4)]
            handler = {(method, path): handler for method, path, handler in routes(service)}['POST', '/daelab/studio/generation/status']
            first = json.loads((await handler(Request({'source': source, 'limit': 1}))).text)
            self.assertEqual(first['jobs'], [])
            self.assertEqual(first['nextOffset'], 1)
            second = json.loads((await handler(Request({'source': source, 'limit': 1, 'offset': first['nextOffset']}))).text)
            self.assertEqual([job['requestId'] for job in second['jobs']], ['request-1'])
            self.assertEqual([core.jobs.diagnostics(f'request-{i}') for i in range(4)], before)
            for payload in [{'source': {}}, {'source': {'documentId': 'document'}}, {'source': dict(source, unexpected='x')}, {'source': source, 'requestIds': ['request-1']}, {'source': source, 'limit': 1001}, {'source': source, 'offset': -1}]:
                self.assertEqual((await handler(Request(payload))).status, 400)


if __name__ == '__main__': unittest.main()
