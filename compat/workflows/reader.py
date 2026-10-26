"""Compatibility decisions pinned to NODE_INVENTORY; raw graphs remain authoritative."""
import copy
import json
import re
import hashlib

SOURCE_VERSION = "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"
READ_ONLY = frozenset({
    "DAELAB.ComfyTV.GPTImageStoryboardStage", "DAELAB.LibTV.StoryboardBatch",
    "DAELAB.LLMStylePreviewA", "DAELAB.LLMStylePreviewC",
    "DAELAB.LLMStylePreviewD", "DAELAB.LLMStylePreviewE",
})
SUPPORTED = frozenset({
    "DAELAB.MediaUpload", "DAELAB.TextInput", "DAELAB.MaterialGroup", "DAELAB.VideoEdit",
    "DAELAB.Table", "DAELAB.ScriptParser", "DAELAB.StoryboardImport",
    "DAELAB.LLMStylePreviewB", "DAELAB.LibTV.VideoGenerate",
})


def inspect_workflow(document):
    if not isinstance(document, dict) or not isinstance(document.get("nodes"), list):
        raise ValueError("Native workflow requires an object with a nodes array.")
    nodes = document["nodes"]
    reports = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("type"), str):
            raise ValueError("Workflow node schema is unknown; original file must be retained.")
        kind = node["type"]
        visible_type = kind if re.fullmatch(r"[\w .:/-]{1,256}", kind) else "unrecognized:" + hashlib.sha256(kind.encode()).hexdigest()
        reports.append({"index": index, "nodeType": visible_type,
                        "disposition": "read_only" if kind in READ_ONLY else
                        "supported" if kind in SUPPORTED else "unknown_preserved",
                        "rawPreserved": True})
    links = document.get("links", [])
    if not isinstance(links, (list, dict)):
        raise ValueError("Workflow links schema is unknown; original file must be retained.")
    return {"schemaVersion": 1, "nodeCount": len(nodes), "linkCount": len(links),
            "nodes": reports, "mutation": "none", "execution": "disabled",
            "unknownFields": "preserved in byte-identical original and migration copy"}


def read_compat_node(node):
    if not isinstance(node, dict) or node.get("type") not in READ_ONLY:
        raise ValueError("Node is not in the six-type read-only compatibility registry.")
    return {"schemaVersion": 1, "sourceVersion": SOURCE_VERSION,
            "readOnly": True, "canExecute": False, "raw": copy.deepcopy(node),
            "conversion": "Explicitly configure a supported node in a new copy; never reuse this receipt to submit."}


def readonly_node_mappings():
    """Two exact historical backend schemas; A/C/D/E are registered only in the frontend."""
    from .node_schemas import native_readonly_mappings
    return native_readonly_mappings()


def media_references(document):
    """Inspect native material dictionaries and serialized material JSON, without rewriting."""
    found = []
    def walk(value, depth=0):
        if depth > 64:
            raise ValueError("Workflow nesting exceeds the supported limit.")
        if isinstance(value, dict):
            if value.get("type") in ("input", "output") and isinstance(value.get("filename"), str):
                found.append({"root": value["type"], "filename": value["filename"],
                              "subfolder": value.get("subfolder", "")})
            for child in value.values():
                walk(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                walk(child, depth + 1)
        elif isinstance(value, str) and value.lstrip().startswith(("{", "[")):
            try:
                nested = json.loads(value)
            except (ValueError, RecursionError):
                return
            walk(nested, depth + 1)
    walk(document)
    return found
