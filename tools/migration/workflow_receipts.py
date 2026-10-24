"""Read frozen historical receipt containers, including serialized widget JSON.

Pinned business 7ff56cb51ef6f7fc3bcf5707792d655037c61b30:
web/table_generation_model.mjs generationReceipt()/history;
web/storyboard_table_adapter.mjs row.meta.generation;
web/data_table_nodes.mjs daelabTableReports and daelabLibTVBatch;
web/prompt_optimization_model.mjs daelabPromptOptimizationV1.batches.
This adapter never normalizes, modifies, executes or resumes the workflow.
"""
import hashlib
import json
import re

from compat.receipts import inspect_receipts

IDENTITIES = frozenset({"requestId", "request_id", "provider_task_id", "taskId", "remoteResponseId"})
STATES = frozenset({"phase", "state", "status"})


def inspect_workflow_receipts(document):
    records, issues, seen = [], set(), set()

    def segment(value):
        text = str(value)
        return text if re.fullmatch(r"[A-Za-z0-9_.:@/-]{1,128}", text) else "key-sha256:" + hashlib.sha256(text.encode()).hexdigest()[:16]

    def record(value, path, node):
        if path in seen:
            return
        seen.add(path)
        if not isinstance(value, dict):
            issues.add("unknown_embedded_task_container")
            return
        report = inspect_receipts([value])
        issues.update(report["issues"])
        for item in report["records"]:
            item["provenance"] = {"kind": "workflow_embedded_receipt", "jsonPath": path,
                                  **({"nodeId": segment(node)} if node is not None else {})}
            records.append(item)

    def unique(pairs):
        value = {}
        for key, child in pairs:
            if key in value:
                raise ValueError("Duplicate embedded JSON keys")
            value[key] = child
        return value

    def walk(value, path="/", node=None, force=False, depth=0):
        if depth > 64:
            issues.add("embedded_task_nesting_requires_review")
            return
        if isinstance(value, str) and value.lstrip().startswith(("{", "[")):
            try:
                child = json.loads(value, object_pairs_hook=unique)
            except (ValueError, RecursionError):
                issues.add("uninspectable_embedded_json")
                return
            walk(child, path + "#json", node, force, depth + 1)
            return
        if isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, path + "/" + str(index), node, force, depth + 1)
            return
        if not isinstance(value, dict):
            if force:
                issues.add("unknown_embedded_task_container")
            return
        if isinstance(value.get("type"), str) and "id" in value:
            node = value["id"]
        is_receipt = bool(IDENTITIES & value.keys()) or ("request" in value and bool(STATES & value.keys()))
        if force or is_receipt:
            record(value, path, node)
        for key, child in value.items():
            child_path = path.rstrip("/") + "/" + segment(key)
            if key == "generationColumns":
                if not isinstance(child, dict):
                    issues.add("unknown_embedded_task_container")
                else:
                    for field, receipt in child.items():
                        walk(receipt, child_path + "/" + segment(field), node, True, depth + 1)
            elif key == "generation" and isinstance(child, dict) and (STATES | IDENTITIES | {"request"}) & child.keys():
                walk(child, child_path, node, True, depth + 1)
            elif key == "history" and (force or is_receipt):
                if not isinstance(child, list):
                    issues.add("unknown_embedded_task_history")
                else:
                    walk(child, child_path, node, True, depth + 1)
            elif key in {"daelabTableReports", "daelabLibTVBatch"}:
                if not isinstance(child, dict):
                    issues.add("unknown_embedded_task_container")
                walk(child, child_path, node, False, depth + 1)
            elif key == "daelabPromptOptimizationV1" and isinstance(child, dict):
                batches = child.get("batches", [])
                if batches:
                    # Saved references do not prove the original SQLite rows are
                    # terminal. Do not manufacture their status from UI metadata.
                    issues.add("optimization_batch_references_require_review")
                    walk(batches, child_path + "/batches", node, True, depth + 1)
                for other, item in child.items():
                    if other != "batches":
                        walk(item, child_path + "/" + segment(other), node, False, depth + 1)
            else:
                walk(child, child_path, node, False, depth + 1)

    walk(document)
    return {"records": records, "issues": sorted(issues), "execution": "disabled"}
