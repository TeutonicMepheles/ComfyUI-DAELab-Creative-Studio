"""Explicit maintainer utility: read pinned Git blobs, write only public synthetic fixtures.

Not run by tests; supply the old repository path as an argument. No old Python imports.
"""
import ast
import copy
import hashlib
import json
import re
from pathlib import Path
import subprocess
import sys

COMMIT = "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"
FILES = ["nodes/daelab_comfytv_storyboard/node.py", "nodes/libtv_bridge/node.py", "nodes/libtv_bridge/batch_node.py",
         "nodes/libtv_bridge/runtime.py", "web/llm_style_preview.js", "web/llm_style_preview_panel.mjs", "web/storyboard_legacy_widgets.mjs",
         "user/default/workflows/ComfyTV-StoryBoard-GPT-Image2-完整工作流.json"]


def build(repo):
    blobs = {name: subprocess.check_output(["git", "-C", repo, "show", f"{COMMIT}:{name}"]) for name in FILES}
    sources = [{"path": name, "sha256": hashlib.sha256(value).hexdigest(),
                "url": f"https://github.com/TeutonicMepheles/ComfyUI-DAELab-Custom-Nodes-Library/blob/{COMMIT}/{name}"}
               for name, value in blobs.items()]
    def schema(path, cls):
        tree = ast.parse(blobs[path].decode("utf-8-sig"))
        constants = {}
        for statement in tree.body:
            if isinstance(statement, ast.Assign) and isinstance(statement.targets[0], ast.Name):
                try:
                    constants[statement.targets[0].id] = ast.literal_eval(statement.value)
                except (ValueError, TypeError):
                    pass
        model_tree = ast.parse(blobs["nodes/libtv_bridge/runtime.py"].decode("utf-8-sig"))
        for statement in model_tree.body:
            if isinstance(statement, ast.Assign) and isinstance(statement.targets[0], ast.Name) and statement.targets[0].id == "MODELS":
                constants["MODELS"] = ast.literal_eval(statement.value)
        def literal(node):
            if isinstance(node, (ast.List, ast.Tuple)):
                return [literal(item) for item in node.elts]
            if isinstance(node, ast.Name):
                return constants[node.id]
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "list":
                return list(literal(node.args[0]))
            return ast.literal_eval(node)
        definition = next(item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == cls)
        method = next(item for item in definition.body if isinstance(item, ast.FunctionDef) and item.name == "define_schema")
        call = next(item.value for item in method.body if isinstance(item, ast.Return))
        inputs = next(item.value for item in call.keywords if item.arg == "inputs")
        result = []
        for item in inputs.elts:
            if isinstance(item, ast.Starred):
                continue
            name = literal(item.args[0])
            parent = item.func.value
            if isinstance(parent, ast.Call):
                kind = literal(parent.args[0])
            else:
                kind = {"Int": "INT", "String": "STRING", "Combo": "COMBO", "Boolean": "BOOLEAN", "Image": "IMAGE"}[parent.attr]
            options = {}
            for option in item.keywords:
                if option.arg in {"default", "min", "max", "step", "options", "socketless", "force_input", "optional", "multiline"}:
                    options[option.arg] = literal(option.value)
            result.append({"name": name, "type": kind, "options": options})
        return result
    gpt = schema(FILES[0], "DAELabComfyTVGPTImageStoryboardStage")
    video = schema(FILES[1], "LibTVVideo")
    batch = [{"name": "storyboard_json", "type": "STRING", "options": {"force_input": True}}]
    batch.extend(copy.deepcopy(item) for item in video if item["name"] in {"project_uuid", "request_id", "model", "mode", "duration", "resolution", "ratio", "sound"})
    for item in batch:
        if item["name"] in {"model", "mode", "duration", "resolution"}:
            item["options"]["default"] = {"model": "Seedance 2.0", "mode": "mixed2video", "duration": 5, "resolution": "720p"}[item["name"]]
    original = json.loads(blobs[FILES[-1]])
    original_node = next(node for node in original["nodes"] if node["type"] == "DAELAB.ComfyTV.GPTImageStoryboardStage")
    # Capture only unconditional slots, before the source's B-only additions.
    prototype_constructor = blobs["web/llm_style_preview.js"].decode("utf-8").split("if(variant.id==='B'){this.addInput('素材组'")[0]
    prototype_slots = {side: [{"name": name, "type": kind} for name, kind in re.findall(r"this\.add" + method + r"\('([^']+)','([^']+)'\)", prototype_constructor)]
                       for side, method in (("inputs", "Input"), ("outputs", "Output"))}
    prototype_sizes = {"DAELAB.LLMStylePreview" + variant: [int(width), int(height) + 80]
                       for variant, width, height in re.findall(r"\{id:'([ACDE])',label:'[^']+',width:(\d+),height:(\d+)\}", blobs["web/llm_style_preview_panel.mjs"].decode("utf-8"))}
    if len(prototype_slots["inputs"]) != 2 or len(prototype_slots["outputs"]) != 1 or len(prototype_sizes) != 4:
        raise ValueError("Pinned prototype constructor shape changed; fixture generation refused")
    # Only copy public schema shape; no original titles, prompts, values, IDs or paths.
    stage = {"id": 10, "type": original_node["type"], "pos": [0, 0], "size": [460, 690], "mode": 0,
             "inputs": copy.deepcopy(original_node["inputs"]), "outputs": copy.deepcopy(original_node["outputs"]),
             "properties": {"comfytv_stage_uid": "public-synthetic-stage", "unknownNested": {"retain": [2, 1]}},
             "unknownTopLevel": {"future": "retained"}}
    for item in stage["inputs"]:
        item["link"] = None
    stage["outputs"][0]["links"] = [100]
    stage["outputs"][1]["links"] = [101]
    story = {"schema_version": 4, "shots": [{"id": "shot-public", "shot_no": "01", "image_prompt": "合成夹具：蓝色方块", "image_url": "/view?filename=synthetic.png&type=input", "unknownShot": {"keep": True}}], "unknownDocument": 17}
    stage["widgets_values"] = [0, "synthetic-project", 0, "OpenAI GPT Image 2 (Comfy Credits)", "auto", 1024, 1024, "auto", "low", 7, "fixed", "合成风格", json.dumps(story, ensure_ascii=False), 1, "{}"]
    nodes = [stage]
    batch_node = {"id": 20, "type": "DAELAB.LibTV.StoryboardBatch", "pos": [0, 720], "size": [460, 400], "mode": 0,
                  "inputs": [{"name": item["name"], "type": item["type"], "link": 102 if index == 0 else None,
                              **({} if index == 0 else {"widget": {"name": item["name"]}})} for index, item in enumerate(batch)],
                  "outputs": [{"name": "batch_report", "type": "STRING", "links": [103]}, {"name": "video_paths", "type": "STRING", "links": None}],
                  "widgets_values": ["fixture-project", "old-request", "Seedance 2.0", "mixed2video", 5, "720p", "16:9", False],
                  "properties": {"unknown": "retain"}}
    nodes.append(batch_node)
    for index, variant in enumerate("ACDE"):
        nodes.append({"id": 30 + index, "type": "DAELAB.LLMStylePreview" + variant, "pos": [600, index * 700], "size": [420 if variant == "A" else 700 if variant == "E" else 460, 690], "mode": 0,
                      "inputs": [{"name": "原文", "type": "STRING", "link": 104 if index == 0 else None}, {"name": "参考图片", "type": "IMAGE", "link": None}],
                      "outputs": [{"name": "结果", "type": "STRING", "links": [105] if index == 0 else None}],
                      "widgets_values": [None], "properties": {"llmStylePreview": {"version": 1, "mode": "polish", "source": "合成原文 " + variant, "instruction": "保持合成图形", "unknown": {"retain": variant}}}})
    nodes.append({"id": 90, "type": "Synthetic.Unknown.External", "inputs": [{"name":"images","type":"COMFYTV_IMAGES","link":100},{"name":"image","type":"COMFYTV_IMAGE","link":101},{"name":"text","type":"STRING","link":103},{"name":"result","type":"STRING","link":105}], "outputs":[{"name":"script","type":"STRING","links":[102,104]}], "properties":{"unknown":True}})
    fixture = {"version": 0.4, "nodes": nodes, "links": [[100,10,0,90,0,"COMFYTV_IMAGES"],[101,10,1,90,1,"COMFYTV_IMAGE"],[102,90,0,20,0,"STRING"],[103,20,0,90,2,"STRING"],[104,90,0,30,0,"STRING"],[105,30,0,90,3,"STRING"]], "groups":[], "extra":{"daelabCreativeCanvasV1":{"future":"retain"}}, "unknownWorkflow":{"keep":True}}
    folder = Path(__file__).with_name("fixtures")
    folder.mkdir(exist_ok=True)
    for name, value in [("legacy-readonly-workflow.json",fixture), ("legacy-source-contract.json", {"schemaVersion":1,"sourceCommit":COMMIT,"sources":sources,"nativeInputs":{stage["type"]:gpt,batch_node["type"]:batch},"prototypeSlots":prototype_slots,"prototypeSizes":prototype_sizes,"sourceSerializedGPTInputCount":len(original_node["inputs"]),"sourceSerializedGPTWidgetCount":len(original_node["widgets_values"]),"fixturePolicy":"All values synthetic; GPT slot shape copied from pinned serialized workflow; other shapes from pinned constructors."})]:
        (folder / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    build(sys.argv[1])
