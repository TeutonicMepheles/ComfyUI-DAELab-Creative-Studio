"""Host contract tests with inert Comfy IO; actual host acceptance is separate."""
import importlib
import asyncio
import json
import math
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web


class Port:
    def __init__(self, kind):
        self.kind = kind

    def Input(self, name, **kwargs):
        return {"kind": self.kind, "name": name, **kwargs}

    def Output(self, name, **kwargs):
        return {"kind": self.kind, "name": name, **kwargs}


class Output:
    def __init__(self, *result, **kwargs):
        self.result = result
        self.ui = kwargs.get("ui")


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.roots = {name: self.root / name for name in ("input", "output", "temp")}
        for path in self.roots.values():
            path.mkdir()
        folders = types.ModuleType("folder_paths")
        for name, path in self.roots.items():
            setattr(folders, f"get_{name}_directory", lambda value=path: str(value))
        io = types.SimpleNamespace(ComfyNode=object, Schema=lambda **kw: types.SimpleNamespace(**kw),
                                   String=Port("STRING"), Image=Port("IMAGE"), Video=Port("VIDEO"),
                                   Custom=Port, NodeOutput=Output)
        io.Autogrow = Port("AUTOGROW")
        io.Autogrow.TemplatePrefix = lambda port, **kw: {"port": port, **kw}
        latest = types.ModuleType("comfy_api.latest")
        latest.io = io
        latest.InputImpl = types.SimpleNamespace(VideoFromFile=lambda path: {"video_path": path})
        comfy_api = types.ModuleType("comfy_api")
        comfy_api.latest = latest
        comfy = types.ModuleType("comfy")
        comfy.model_management = types.SimpleNamespace(throw_exception_if_processing_interrupted=lambda: None)
        utils = types.ModuleType("comfy.utils")
        utils.ProgressBar = lambda count: types.SimpleNamespace(update_absolute=lambda *args: None)
        self.server = types.SimpleNamespace(routes=web.RouteTableDef())
        server_module = types.ModuleType("server")
        server_module.PromptServer = types.SimpleNamespace(instance=self.server)
        self.before = set(sys.modules)
        self.patcher = patch.dict(sys.modules, {"folder_paths": folders, "comfy_api": comfy_api,
            "comfy_api.latest": latest, "comfy": comfy, "comfy.utils": utils, "server": server_module})
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        def unload():
            for name in list(sys.modules):
                if name not in self.before and name.startswith("backend.integrations.comfyui.canvas_nodes"):
                    del sys.modules[name]
        self.addCleanup(unload)
        self.module = importlib.import_module("backend.integrations.comfyui.canvas_nodes")

    def test_import_and_node_lookup_do_not_register_routes(self):
        self.assertEqual(list(self.server.routes), [])
        nodes, names = self.module.register_nodes()
        self.assertEqual(list(self.server.routes), [])
        self.assertEqual(set(nodes), {"DAELAB.MediaUpload", "DAELAB.TextInput", "DAELAB.MaterialGroup", "DAELAB.VideoEdit"})
        self.assertEqual(set(nodes), set(names))
        again, _ = self.module.register_nodes()
        self.assertIsNot(again, nodes)
        self.assertEqual(again, nodes)

    def test_stable_schema_preserves_native_slot_positions(self):
        nodes, _ = self.module.register_nodes()
        schemas = {key: node.define_schema() for key, node in nodes.items()}
        self.assertEqual([p["name"] for p in schemas["DAELAB.MediaUpload"].outputs],
                         ["image_ref", "image_refs", "video_ref", "image", "video"])
        self.assertEqual([p["kind"] for p in schemas["DAELAB.MediaUpload"].outputs],
                         ["COMFYTV_IMAGE", "COMFYTV_IMAGES", "COMFYTV_VIDEO", "IMAGE", "VIDEO"])
        self.assertEqual([p["name"] for p in schemas["DAELAB.VideoEdit"].inputs],
                         ["edit_data", "assets", "videos", "images", "groups"])
        self.assertEqual([p["name"] for p in schemas["DAELAB.VideoEdit"].outputs], ["video", "video_ref"])
        self.assertTrue(schemas['DAELAB.VideoEdit'].not_idempotent)
        self.assertTrue(math.isnan(nodes['DAELAB.VideoEdit'].fingerprint_inputs(edit_data='synthetic')))
        self.assertEqual(schemas["DAELAB.MaterialGroup"].outputs[0]["kind"], "DAELAB_ASSETS")
        for key, schema in schemas.items():
            self.assertEqual(schema.node_id, key)

    def test_collection_serialization_preserves_unknown_asset_fields_and_order(self):
        from backend.assets import AssetCatalog
        catalog = AssetCatalog(self.root / 'assets.sqlite', roots=self.roots)
        nodes, _ = self.module.register_nodes(asset_catalog=catalog)
        for name in ("first.mp4", "second.mp4"):
            (self.roots["input"] / name).write_bytes(b"reference validation does not decode")
        assets = [dict(id="asset", nodeId="n2", kind="video", filename="second.mp4", extra={"keep": True}),
                  dict(id="asset", nodeId="n1", kind="video", filename="first.mp4")]
        encoded = json.dumps({"version": 1, "assets": assets})
        result = nodes["DAELAB.MaterialGroup"].execute(encoded).result[0]
        self.assertEqual([a["nodeId"] for a in result["assets"]], ["n2", "n1"])
        self.assertEqual(result["assets"][0]["extra"], {"keep": True})
        self.assertEqual(json.loads(encoded)["assets"], assets)
        self.assertEqual(nodes["DAELAB.MaterialGroup"].execute('{"version":1,"assets":[]}').result[0]["assets"], [])
        with self.assertRaises(ValueError):
            nodes["DAELAB.MaterialGroup"].execute("[]")
        text = "合成文字\nsecond line"
        self.assertEqual(nodes["DAELAB.TextInput"].execute(text).result, (text,))

    def test_missing_catalog_refuses_consumption_but_schema_and_workflow_lookup_remain_available(self):
        from backend.contracts.errors import StorageError
        nodes, _ = self.module.register_nodes()
        self.assertEqual(nodes['DAELAB.TextInput'].define_schema().outputs[0]['kind'],'STRING')
        with self.assertRaises(StorageError): nodes['DAELAB.TextInput'].execute('preserve raw text')
        with self.assertRaises(StorageError): nodes['DAELAB.MaterialGroup'].execute('{"version":1,"assets":[]}')

    def test_group_text_consumption_registers_ordered_immutable_snapshots_without_changing_slots(self):
        from backend.assets import AssetCatalog
        catalog=AssetCatalog(self.root/'group-assets.sqlite',roots=self.roots)
        nodes,_=self.module.register_nodes(asset_catalog=catalog)
        raw={'version':1,'assets':[],'texts':['second','first','second'],'textSources':['n2','n1','n3']}
        result=nodes['DAELAB.MaterialGroup'].execute(json.dumps(raw)).result[0]
        self.assertEqual(result['texts'],raw['texts']);self.assertEqual(catalog.search(),[])
        second=catalog.register_text('second')
        self.assertTrue({'n2','n3'} <= {p['detail'].get('nodeId') for p in second['provenance']})
        with self.assertRaisesRegex(ValueError,'未就绪'):
            nodes['DAELAB.MaterialGroup'].execute(json.dumps({**raw,'ready':False}))

    def test_routes_are_explicit_idempotent_and_conflicts_do_not_partially_register(self):
        added = self.module.register_routes(self.server)
        self.assertEqual(len(added), 3)
        self.assertEqual(self.module.register_routes(self.server), ())
        self.assertEqual(len(list(self.server.routes)), 3)
        other = types.SimpleNamespace(routes=web.RouteTableDef())
        async def unrelated(request):
            return web.Response()
        other.routes.post("/daelab/edit/preview")(unrelated)
        with self.assertRaisesRegex(RuntimeError, "duplicate route ownership"):
            self.module.register_routes(other)
        self.assertEqual(len(list(other.routes)), 1)

    def test_material_route_rejects_remote_origin_and_malformed_payloads(self):
        module = importlib.import_module("backend.integrations.comfyui.canvas_nodes.material_output_api")
        class Request:
            remote = "127.0.0.1"
            host = "127.0.0.1:8224"
            headers = {}
            async def json(self):
                return []
        request = Request()
        self.assertEqual(asyncio.run(module.output_materials(request)).status, 400)
        request.remote = "192.0.2.1"
        self.assertEqual(asyncio.run(module.output_materials(request)).status, 403)
        request.remote = "127.0.0.1"
        request.headers = {"Origin": "https://external.invalid"}
        self.assertEqual(asyncio.run(module.output_materials(request)).status, 403)

    def test_export_routes_bind_the_shared_service_without_partial_registration(self):
        from backend.integrations.comfyui.services import CoreServices
        from backend.media.export_service import ExportService
        core = CoreServices(self.root / 'user', self.roots['input'], self.roots['output'])
        service = ExportService(core.jobs, core.assets)
        video = importlib.import_module('backend.integrations.comfyui.canvas_nodes.video_edit')
        other = types.SimpleNamespace(routes=web.RouteTableDef())
        async def unrelated(request):
            return web.Response()
        other.routes.post('/daelab/studio/media-exports')(unrelated)
        with self.assertRaisesRegex(RuntimeError, 'duplicate route ownership'):
            self.module.register_routes(other, export_service=service)
        self.assertIsNone(video._export_service)
        self.assertEqual(len(list(other.routes)), 1)
        self.assertEqual(len(self.module.register_routes(self.server, export_service=service)), 7)
        self.assertIs(video._export_service, service)
        self.assertEqual(self.module.register_routes(self.server, export_service=service), ())
        with self.assertRaisesRegex(RuntimeError, 'different injected'):
            self.module.register_routes(self.server, export_service=ExportService(core.jobs, core.assets))

    def test_video_node_routes_native_context_and_preserves_original_result_contract(self):
        from PIL import Image
        from backend.integrations.comfyui.services import CoreServices
        from backend.media.export_service import ExportService
        from backend.providers.contracts import ProviderUnavailable
        nodes, _ = self.module.register_nodes()
        with self.assertRaises(ProviderUnavailable):
            nodes['DAELAB.VideoEdit'].execute('{"version":1,"clips":[]}')
        Image.new('RGB', (16, 16), 'red').save(self.roots['input'] / 'red.png')
        core = CoreServices(self.root / 'user', self.roots['input'], self.roots['output'])
        self.module.register_routes(self.server, export_service=ExportService(core.jobs, core.assets))
        raw = json.dumps({'version': 1, 'clips': [{'source': {'asset': {'filename': 'red.png'}}, 'duration': .25}]})
        context = types.SimpleNamespace(prompt_id='fixture-native', node_id='3:4', list_index=0)
        with patch('backend.integrations.comfyui.canvas_nodes.video_edit.native_execution_context', return_value=context):
            result = nodes['DAELAB.VideoEdit'].execute(raw)
        self.assertEqual(len(result.result), 2)
        self.assertTrue(Path(result.result[0]['video_path']).is_file())
        self.assertTrue(result.result[1].startswith('/view?filename='))
        self.assertEqual(result.ui['edit_data'], [raw])
        self.assertEqual(result.ui['creative_studio_export'][0]['state'], 'succeeded')


if __name__ == "__main__":
    unittest.main()
