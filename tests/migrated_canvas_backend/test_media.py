"""Synthetic local media rules; no model, cloud, host queue or user files."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import av
from PIL import Image

from backend.media.material_output_files import import_materials
from backend.media import video_edit_media as media


class LocalMediaTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.roots = {kind: self.root / kind for kind in ("input", "output", "temp")}
        for path in self.roots.values():
            path.mkdir()
        Image.new("RGB", (16, 16), "red").save(self.roots["input"] / "red.png")
        Image.new("RGB", (16, 16), "blue").save(self.roots["output"] / "blue.png")

    def test_material_output_keeps_reference_order_identity_and_provenance(self):
        assets = [dict(kind="image", id="saved", name="生成结果", provenance={"recordId": "row"},
                       url="/view?filename=blue.png&type=output"),
                  dict(kind="image", url="/view?filename=red.png&type=input")]
        before = copy.deepcopy(assets)
        result = import_materials(assets, self.roots["input"], self.roots["output"])
        self.assertEqual(result, import_materials(assets, self.roots["input"], self.roots["output"]))
        self.assertEqual([a["type"] for a in result], ["output", "input"])
        self.assertEqual(result[0]["id"], "saved")
        self.assertEqual(result[0]["provenance"], {"recordId": "row"})
        self.assertEqual(assets, before)
        self.assertEqual(sorted(p.name for p in self.roots["input"].iterdir()), ["red.png"])

    def test_material_output_registers_exact_reference_and_retains_occurrence_source(self):
        from backend.assets import AssetCatalog
        from backend.integrations.comfyui.asset_api import register_asset
        catalog=AssetCatalog(self.root/'material-assets.sqlite',roots=self.roots)
        original={'kind':'image','id':'occurrence','url':'/view?filename=blue.png&type=output','provenance':{'recordId':'row','fieldId':'field','requestId':'request'}}
        result=import_materials([original],self.roots['input'],self.roots['output'],register=lambda value:register_asset(catalog,value))[0]
        self.assertEqual(result['id'],'occurrence');self.assertEqual(result['type'],'output')
        self.assertTrue(catalog.validate_reference(result['referenceId'])['usable']);self.assertEqual(catalog.search(),[])
        provenance=catalog.get(result['assetId'])['provenance'][0]['detail']
        self.assertEqual(provenance,{'recordId':'row','fieldId':'field','requestId':'request','occurrenceId':'occurrence'})

    def test_invalid_references_and_partial_batch_write_no_files(self):
        for url in ["https://remote.invalid/view?filename=red.png&type=input",
                    "/view?filename=../output/blue.png&type=input",
                    "/view?filename=red.png&type=input&type=output",
                    "/view?filename=red.png&filename=blue.png&type=input",
                    "/view?filename=red.png&type=temp"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                import_materials([dict(kind="image", url=url)], self.roots["input"], self.roots["output"])
        with self.assertRaises(ValueError):
            import_materials([dict(kind="image", url="/view?filename=red.png&type=input"),
                              dict(kind="image", url="/view?filename=missing.png&type=input")],
                             self.roots["input"], self.roots["output"])
        self.assertEqual(sorted(p.name for p in self.roots["input"].iterdir()), ["red.png"])

    def test_editor_resolves_only_allowed_roots_and_accepts_legacy_default_input(self):
        path, kind, ref = media.resolve_media("/view?filename=red.png", roots=self.roots)
        self.assertEqual(path, self.roots["input"] / "red.png")
        self.assertEqual((kind, ref["type"]), ("image", "input"))
        for asset in ["https://remote.invalid/view?filename=red.png&type=input",
                      "/view?filename=red.png&type=input&type=output",
                      {"filename": "../output/blue.png", "type": "input"},
                      {"filename": "red.png", "type": "unknown"}]:
            with self.subTest(asset=asset), self.assertRaises(ValueError):
                media.resolve_media(asset, roots=self.roots)

    def test_group_member_identity_and_slot_order_survive_serialization(self):
        a = dict(id="same-file-id", nodeId="one", filename="red.png", type="input")
        b = dict(id="same-file-id", nodeId="two", filename="blue.png", type="output")
        data = {"version": 1, "fit": "contain", "unknown": {"keep": True}, "clips": [
            {"source": {"slot": "groups.group1", "nodeId": "two", "assetId": "same-file-id"}, "duration": .25},
            {"source": {"slot": "assets", "nodeId": "one", "assetId": "same-file-id"}, "duration": .5}]}
        before = copy.deepcopy(data)
        clips, fit = media.edit_clips(json.dumps(data), assets={"version": 1, "assets": [a]},
                                    groups={"groups.group1": {"version": 1, "assets": [a, b]}}, roots=self.roots)
        self.assertEqual([c["asset"]["filename"] for c in clips], ["blue.png", "red.png"])
        self.assertEqual([c["duration"] for c in clips], [.25, .5])
        self.assertEqual(fit, "contain")
        self.assertEqual(data, before)
        missing = copy.deepcopy(data)
        missing["clips"][0]["source"]["nodeId"] = "missing"
        with self.assertRaises(ValueError):
            media.edit_clips(missing, roots=self.roots)

    def test_synthetic_export_decodes_in_sequence_and_cancel_removes_partial_output(self):
        data = {"version": 1, "clips": [
            {"source": {"asset": {"filename": "red.png", "type": "input"}}, "duration": .25},
            {"source": {"asset": {"filename": "blue.png", "type": "output"}}, "duration": .25}]}
        clips, fit = media.edit_clips(data, roots=self.roots)
        output = self.roots["output"] / "synthetic.mp4"
        self.assertEqual(media.render(clips, output, roots=self.roots, fit=fit), (16, 16))
        with av.open(str(output)) as container:
            frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
        self.assertEqual(len(frames), 12)
        self.assertGreater(frames[0][:, :, 0].mean(), frames[0][:, :, 2].mean() + 100)
        self.assertGreater(frames[-1][:, :, 2].mean(), frames[-1][:, :, 0].mean() + 100)
        cancelled = self.roots["output"] / "cancelled.mp4"
        def stop():
            raise InterruptedError("synthetic cancellation")
        with self.assertRaises(InterruptedError):
            media.render(clips, cancelled, roots=self.roots, check=stop)
        self.assertFalse(cancelled.exists())

    def test_preview_uses_temp_root_and_keeps_original_reference(self):
        asset = {"filename": "red.png", "type": "input"}
        original = (self.roots["input"] / "red.png").read_bytes()
        first = media.preview(asset, .5, lambda: None, roots=self.roots)
        second = media.preview(asset, .5, lambda: None, roots=self.roots)
        self.assertEqual(first, second)
        self.assertEqual((first["width"], first["height"]), (8, 8))
        self.assertIn("type=temp", first["url"])
        self.assertEqual((self.roots["input"] / "red.png").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
