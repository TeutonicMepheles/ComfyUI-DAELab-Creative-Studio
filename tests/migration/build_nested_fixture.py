"""Public synthetic nested workflow; never reads runtime/user data."""
import copy
import json
from pathlib import Path

FIXTURES = Path(__file__).with_name("fixtures")
ROOT = "63eca6da-0a01-4501-9000-000000000001"
OUTER = "63eca6da-0a01-4501-9000-000000000002"
INNER = "63eca6da-0a01-4501-9000-000000000003"


def wrapper(node_id, graph_id, title, pos):
    return {"id": node_id, "type": graph_id, "title": title, "pos": pos,
            "size": [300, 120], "flags": {}, "order": 0, "mode": 0,
            "inputs": [], "outputs": [], "properties": {}, "widgets_values": [],
            "unknownNode": {"publicSynthetic": title}}


def unknown(node_id, kind, wire, scope):
    return {"id": node_id, "type": "Synthetic.Unknown.External", "title": f"Synthetic unknown {scope}",
            "pos": [600, 0], "size": [250, 160], "flags": {}, "mode": 2,
            "inputs": [{"name": "value", "type": kind, "link": wire, "unknownSlot": {"scope": scope}}],
            "outputs": [], "properties": {"savedOpaqueValue": ["synthetic", None, 7]},
            "unknownNode": {"scope": scope, "nested": [1, {"keep": True}]},
            "extensions": {"unknownNode": {"namespaced": scope}}}


def graph(graph_id, name, nodes, link):
    return {"id": graph_id, "version": 1, "state": {"lastNodeId": 22, "lastLinkId": 201, "lastGroupId": 0, "lastRerouteId": 0},
            "revision": 0, "config": {}, "name": name, "nodes": nodes,
            "links": [link], "groups": [], "inputs": [], "outputs": [], "widgets": [],
            "inputNode": {"id": -10, "bounding": [-320, 0, 160, 120]},
            "outputNode": {"id": -20, "bounding": [920, 0, 160, 120]},
            "extra": {}, "unknownWorkflow": {"scope": name},
            "extensions": {"unknownWorkflow": {"namespaced": name}, "foreign": {"scope": name}}}


def build():
    old = json.loads((FIXTURES / "legacy-readonly-workflow.json").read_text("utf-8"))
    prototype, gpt = copy.deepcopy(old["nodes"][2]), copy.deepcopy(old["nodes"][0])
    for node, node_id, wire in [(prototype, 11, 101), (gpt, 21, 201)]:
        node.update(id=node_id, pos=[0, 0], mode=2)
        for slot in node["inputs"]:
            slot["link"] = None
        for index, slot in enumerate(node["outputs"]):
            slot["links"] = [wire] if index == 0 else None
    links = [{"id": wire, "origin_id": source, "origin_slot": 0, "target_id": target,
              "target_slot": 0, "type": kind, "unknownWire": {"scope": scope},
              "extensions": {"unknownWire": {"namespaced": scope}}}
             for wire, source, target, kind, scope in [(101, 11, 12, "STRING", "outer"), (201, 21, 22, "COMFYTV_IMAGES", "inner")]]
    outer = graph(OUTER, "Synthetic outer", [prototype, unknown(12, "STRING", 101, "outer"), wrapper(13, INNER, "Open inner graph", [0, 800])], links[0])
    inner = graph(INNER, "Synthetic inner", [gpt, unknown(22, "COMFYTV_IMAGES", 201, "inner")], links[1])
    return {"id": ROOT, "version": 0.4, "last_node_id": 22, "last_link_id": 201,
            "nodes": [wrapper(1, OUTER, "Open outer graph", [0, 0])], "links": [], "groups": [], "config": {}, "extra": {},
            "definitions": {"subgraphs": [outer, inner], "unknownDefinitions": {"publicSynthetic": True}},
            "unknownWorkflow": {"scope": "root"}, "extensions": {"unknownWorkflow": {"namespaced": "root"}}}


if __name__ == "__main__":
    (FIXTURES / "nested-readonly-workflow.json").write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
