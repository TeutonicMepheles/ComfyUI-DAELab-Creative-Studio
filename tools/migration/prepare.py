"""Versioned offline snapshots and rollback copies. No installation/switch capability."""
import re
import uuid
from pathlib import Path

from backend.contracts.validation import clean_json
from backend.contracts.errors import InvalidInput
from backend.integrations.comfyui.bootstrap import detect_conflicts
from compat.receipts import inspect_receipts, inspect_database
from compat.workflows.reader import inspect_workflow, media_references
from .workflow_receipts import inspect_workflow_receipts
from .safety import (MigrationError, checked, contained, relative, inventory, file_hash,
                     json_hash, load_json, write_json, copy_verified, operation_lock, recover_parts, canonical)

OWNER = "daelab-creative-studio-offline-migration"
VERSION = 1
KINDS = frozenset({"workflow", "receipt-json", "receipt-sqlite", "product-sqlite", "media", "config", "favorites"})
BASELINES = {"canvas": "3176b5a67dbcd0b66f795976e5a81bcdfe346093",
             "business": "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"}


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", value):
        raise MigrationError("Migration ID must be 1-64 lowercase letters, digits, hyphens or underscores.")
    return value


def initialize_workspace(path):
    root = checked(path)
    checked(root.parent, exists=True)
    if root.exists():
        raise MigrationError("Workspace must be a new directory; existing directories are never adopted.")
    root.mkdir()
    marker = {"owner": OWNER, "schemaVersion": VERSION, "workspaceId": str(uuid.uuid4()), "path": str(root)}
    write_json(root / ".studio-migration-workspace.json", marker)
    return marker


def workspace_identity(path):
    root = checked(path, exists=True)
    marker = load_json(root / ".studio-migration-workspace.json")
    if (not isinstance(marker, dict) or marker.get("owner") != OWNER or
            marker.get("schemaVersion") != VERSION or marker.get("path") != str(root) or
            not isinstance(marker.get("workspaceId"), str)):
        raise MigrationError("Unknown workspace ownership or schema.")
    return root, marker


def validate_plan(plan):
    allowed = {"schemaVersion", "migrationId", "sourceRoot", "workspaceRoot", "files", "versions",
               "quiesced", "unpersistedTasks", "recoveryPlans", "customNodeRoots", "newPackageRoot"}
    if not isinstance(plan, dict) or set(plan) - allowed or plan.get("schemaVersion") != VERSION:
        raise MigrationError("Unknown migration plan schema or fields.")
    identifier(plan.get("migrationId"))
    source = checked(plan.get("sourceRoot", ""), exists=True)
    workspace, marker = workspace_identity(plan.get("workspaceRoot", ""))
    if source == workspace or source.is_relative_to(workspace) or workspace.is_relative_to(source):
        raise MigrationError("Source and owned workspace must be disjoint directories.")
    if not isinstance(plan.get("files"), list) or not plan["files"]:
        raise MigrationError("Plan must explicitly classify every source file.")
    names = set()
    for entry in plan["files"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "kind"} or entry["kind"] not in KINDS:
            raise MigrationError("Unknown file classification.")
        relative(entry["path"])
        if entry["path"].casefold() in names:
            raise MigrationError("Duplicate or case-colliding source path.")
        names.add(entry["path"].casefold())
    if not isinstance(plan.get("quiesced"), bool) or not isinstance(plan.get("unpersistedTasks"), int) or isinstance(plan["unpersistedTasks"], bool) or plan["unpersistedTasks"] < 0:
        raise MigrationError("Explicit quiescence and nonnegative unpersisted task count are required.")
    if not isinstance(plan.get("versions"), dict) or not isinstance(plan.get("recoveryPlans", []), list):
        raise MigrationError("Source versions and explicit recovery plans are required.")
    if bool(plan.get("customNodeRoots")) != bool(plan.get("newPackageRoot")):
        raise MigrationError("Conflict inspection requires both package and custom-node roots.")
    try:
        clean_json(plan, max_bytes=8 * 1024 * 1024)
    except InvalidInput:
        raise MigrationError("Plan contains sensitive or unsupported data.") from None
    return source, workspace, marker


def preflight(plan):
    source, workspace, marker = validate_plan(plan)
    files = inventory(source)
    kinds = {item["path"]: item["kind"] for item in plan["files"]}
    if set(kinds) != {item["path"] for item in files}:
        raise MigrationError("Every source file must be classified exactly once, including database sidecars.")
    reports, blockers, safety_errors, tasks = [], [], [], []
    if not plan["quiesced"]:
        blockers.append({"code": "source_not_quiesced"})
        safety_errors.append({"code": "source_not_quiesced"})
    if plan["unpersistedTasks"]:
        blockers.append({"code": "unpersisted_workers_not_migratable", "count": plan["unpersistedTasks"]})
    if any(plan["versions"].get(key) != commit for key, commit in BASELINES.items()):
        blockers.append({"code": "source_version_requires_review"})
    if not isinstance(plan["versions"].get("comfyui"), str) or not plan["versions"]["comfyui"].strip():
        blockers.append({"code": "host_version_not_recorded"})
    conflicts = []
    if plan.get("customNodeRoots"):
        roots = [checked(root, exists=True) for root in plan["customNodeRoots"]]
        conflicts = [str(path) for path in detect_conflicts(checked(plan["newPackageRoot"], exists=True), roots)]
        if conflicts:
            blockers.append({"code": "old_or_duplicate_implementation_enabled", "paths": conflicts})
    else:
        blockers.append({"code": "installation_conflicts_not_inspected"})
    media_paths = {item["path"] for item in files if kinds[item["path"]] == "media"}
    hashes = {item["path"]: item["sha256"] for item in files}
    for entry in files:
        name, kind = entry["path"], kinds[entry["path"]]
        path = contained(source, name)
        report = {"path": name, "kind": kind, "issues": []}
        if kind == "media" and path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".mp4", ".webm", ".mov", ".mkv", ".wav", ".mp3", ".flac", ".ogg", ".docx"}:
            safety_errors.append({"code": "unsupported_media_file", "path": name})
        if kind in {"receipt-sqlite", "product-sqlite"}:
            result = inspect_database(path)
            report.update(result)
            tasks.extend(result.get("records", []))
            if "database_requires_offline_checkpoint" in result.get("issues", []):
                safety_errors.append({"code": "database_requires_offline_checkpoint", "path": name})
            if any(issue in result.get("issues", []) for issue in ("sensitive_or_unsupported_json", "sensitive_or_uninspectable_database_json", "unreadable_database", "unknown_database_schema", "corrupt_receipt_record")):
                safety_errors.append({"code": "uninspectable_or_sensitive_database", "path": name})
            for ref in result.get("references", []):
                try:
                    if ref["root"] not in {"input", "output"}:
                        raise MigrationError("Unmapped asset root.")
                    target = ref["root"] + "/" + str(relative(ref["path"]))
                    if target not in media_paths:
                        report["issues"].append("missing_media:" + target)
                    elif ref.get("sha256") and ref["sha256"] != hashes[target]:
                        report["issues"].append("asset_content_changed:" + target)
                except (MigrationError, TypeError, KeyError):
                    report["issues"].append("unmapped_asset_reference")
        elif kind != "media":
            try:
                document = load_json(path)
            except MigrationError:
                report["issues"].append("corrupt_json_preserved_for_review")
                # Uninspectable JSON could contain credentials: do not copy it automatically.
                safety_errors.append({"code": "uninspectable_json", "path": name})
                reports.append(report)
                continue
            try:
                clean_json(document, max_bytes=64 * 1024 * 1024)
                _inspect_embedded_json(document)
            except InvalidInput:
                safety_errors.append({"code": "sensitive_or_unsupported_json", "path": name})
                reports.append(report)
                continue
            if kind == "workflow":
                try:
                    report.update(inspect_workflow(document))
                    embedded = inspect_workflow_receipts(document)
                    report["embeddedTaskCount"] = len(embedded["records"])
                    report["issues"].extend(embedded["issues"])
                    tasks.extend({**task, "provenance": {**task["provenance"], "file": name}} for task in embedded["records"])
                    if any(node["disposition"] == "unknown_preserved" for node in report["nodes"]):
                        report["issues"].append("unknown_nodes_preserved")
                    for ref in media_references(document):
                        try:
                            target = "/".join(part for part in (ref["root"], ref["subfolder"], ref["filename"]) if part)
                            relative(target)
                            if target not in media_paths:
                                report["issues"].append("missing_media:" + target)
                        except (MigrationError, TypeError):
                            report["issues"].append("invalid_media_reference")
                except ValueError:
                    report["issues"].append("unknown_workflow_schema")
            elif kind == "receipt-json":
                result = inspect_receipts(document)
                report.update(result)
                tasks.extend(result["records"])
            elif kind == "favorites":
                if not isinstance(document, dict) or document.get("version") != 1 or not isinstance(document.get("entries"), list):
                    report["issues"].append("unknown_favorites_schema")
                report["import"] = "explicit AssetAPI import required; original origin and file retained"
        if report["issues"]:
            blockers.append({"code": "file_requires_review", "path": name, "issues": report["issues"]})
        reports.append(report)
    seen = {}
    for task in tasks:
        key = (task.get("provider"), task.get("requestId"))
        previous = seen.get(key)
        if previous and previous["rawSha256"] != task["rawSha256"]:
            blockers.append({"code": "conflicting_task_identity", "requestId": task["requestId"]})
        seen[key] = task
        if task.get("terminal"):
            continue
        recovery = next((item for item in plan.get("recoveryPlans", []) if isinstance(item, dict) and
                         item.get("requestId") == task.get("requestId") and
                         item.get("provider") == task.get("provider") and
                         item.get("providerTaskId") == task.get("providerTaskId") and
                         item.get("action") == "query_original_only"), None)
        if (not recovery or not task.get("providerTaskId") or not task.get("provider") or
                task.get("retired") or task.get("queryOnlySwitchEligible") is not True or not task.get("recognized")):
            blockers.append({"code": "inflight_task_blocks_switch", "requestId": task.get("requestId"),
                             "recovery": task.get("recovery"), "executionKind": task.get("executionKind", "unknown")})
    return {"schemaVersion": VERSION, "owner": OWNER, "migrationId": plan["migrationId"],
            "planSha256": json_hash(plan), "workspaceId": marker["workspaceId"],
            "inventory": files, "inventorySha256": json_hash(files), "files": reports,
            "tasks": tasks, "blockers": blockers, "safetyErrors": safety_errors,
            "snapshotAllowed": not safety_errors, "switchPreflightClear": not blockers and not safety_errors,
            "activationAllowed": False, "serviceAction": "none", "executionCalls": 0,
            "versionEvidence": "declared snapshot versions; verify against pinned code manifests before any host switch"}


def _inspect_embedded_json(value, depth=0):
    """Material/task JSON inside native widgets may itself contain a sensitive object."""
    import json
    if depth > 64:
        raise InvalidInput("Nested serialized JSON exceeds the supported limit.")
    if isinstance(value, dict):
        for child in value.values():
            _inspect_embedded_json(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _inspect_embedded_json(child, depth + 1)
    elif isinstance(value, str) and value.lstrip().startswith(("{", "[")):
        try:
            child = json.loads(value)
        except (ValueError, RecursionError):
            return
        clean_json(child, max_bytes=64 * 1024 * 1024)
        _inspect_embedded_json(child, depth + 1)


def _check_tree(folder, entries, *, complete):
    partials = recover_parts(folder, entries)
    actual = inventory(folder)
    actual = [entry for entry in actual if entry["path"] not in partials]
    expected = {entry["path"]: entry for entry in entries}
    for entry in actual:
        if entry["path"] not in expected or expected[entry["path"]] != entry:
            raise MigrationError("Owned destination contains unexpected or inconsistent files; no files were replaced.")
    if complete and (len(actual) != len(entries) or partials):
        raise MigrationError("Migration backup is incomplete.")


def _copy_tree(source, destination, entries, fault, label):
    destination.mkdir(exist_ok=True)
    _check_tree(destination, entries, complete=False)
    for entry in entries:
        copy_verified(contained(source, entry["path"]), contained(destination, entry["path"]), entry)
        fault(label + ":" + entry["path"])
    _check_tree(destination, entries, complete=True)


def _metadata_parts(folder, documents):
    """Only exact prefixes of this operation's known metadata may be resumed."""
    import hashlib
    names = set()
    for document in documents:
        payload = canonical(document) + b"\n"
        name = ".part-" + hashlib.sha256(payload).hexdigest()
        path = checked(folder / name)
        if path.exists():
            if not payload.startswith(path.read_bytes()):
                raise MigrationError("Interrupted metadata has unexpected bytes.")
            names.add(name)
    return names


def migrate(plan, *, fault=lambda point: None):
    """Create a verified backup, isolated working copy and read-only reports; never switch."""
    report = preflight(plan)
    if not report["snapshotAllowed"]:
        raise MigrationError("Preflight safety errors block copying; inspect the read-only report.")
    source, workspace, marker = validate_plan(plan)
    migration_id = plan["migrationId"]
    with operation_lock(workspace, migration_id):
        target = contained(workspace, migration_id)
        manifest = {"schemaVersion": VERSION, "owner": OWNER, "workspaceId": marker["workspaceId"],
                    "migrationId": migration_id, "plan": plan, "report": report}
        backup_complete = {"inventorySha256": report["inventorySha256"]}
        completion = {"schemaVersion": VERSION, "migrationId": migration_id,
                      "inventorySha256": report["inventorySha256"], "planSha256": report["planSha256"],
                      "state": "snapshot_complete", "activationAllowed": False,
                      "reviewRequired": bool(report["blockers"])}
        if target.exists():
            if not (target / "manifest.json").exists():
                parts = _metadata_parts(target, [manifest])
                if not parts or {child.name for child in target.iterdir()} != parts:
                    raise MigrationError("Existing directory has no recoverable ownership manifest.")
                write_json(target / "manifest.json", manifest)
            elif load_json(target / "manifest.json") != manifest:
                raise MigrationError("Existing migration has a different plan, source or ownership.")
            write_json(target / "manifest.json", manifest)  # finishes an interrupted publication link
        else:
            target.mkdir()
            write_json(target / "manifest.json", manifest)
        fault("manifest_created")
        allowed = {"manifest.json", "backup", "working", "BACKUP_COMPLETE.json", "COMPLETE.json", "report.json", "rollback"}
        allowed |= _metadata_parts(target, [manifest, backup_complete, completion, report])
        if any(child.name not in allowed for child in target.iterdir()):
            raise MigrationError("Unknown content in migration directory.")
        _copy_tree(source, target / "backup", report["inventory"], fault, "backup_copied")
        write_json(target / "BACKUP_COMPLETE.json", backup_complete)
        fault("backup_complete")
        _copy_tree(target / "backup", target / "working", report["inventory"], fault, "working_copied")
        if inventory(source) != report["inventory"]:
            raise MigrationError("Source changed during migration; final completion was not published.")
        fault("before_manifest_commit")
        write_json(target / "report.json", report)
        write_json(target / "COMPLETE.json", completion)
        fault("complete")
        return {**completion, "path": str(target)}


def rollback(workspace_path, migration_id, *, fault=lambda point: None):
    """Preserve every new working file BEFORE restoring a separate pre-migration copy."""
    workspace, marker = workspace_identity(workspace_path)
    identifier(migration_id)
    with operation_lock(workspace, migration_id):
        target = contained(workspace, migration_id)
        manifest = load_json(target / "manifest.json")
        if (manifest.get("owner") != OWNER or manifest.get("schemaVersion") != VERSION or
                manifest.get("workspaceId") != marker["workspaceId"] or manifest.get("migrationId") != migration_id):
            raise MigrationError("Unknown migration ownership; rollback refused.")
        report = manifest["report"]
        original = report["inventory"]
        if (json_hash(original) != report["inventorySha256"] or
                json_hash(manifest["plan"]) != report["planSha256"] or
                load_json(target / "BACKUP_COMPLETE.json") != {"inventorySha256": report["inventorySha256"]}):
            raise MigrationError("Migration manifest or backup identity is inconsistent.")
        _check_tree(target / "backup", original, complete=True)
        current = inventory(target / "working") if (target / "working").exists() else []
        rollback_root = target / "rollback"
        rollback_manifest = {"schemaVersion": VERSION, "owner": OWNER, "migrationId": migration_id,
                             "workspaceId": marker["workspaceId"], "newData": current,
                             "newDataSha256": json_hash(current), "oldDataSha256": report["inventorySha256"]}
        preservation = {"inventorySha256": json_hash(current)}
        result = {"schemaVersion": VERSION, "state": "rollback_copy_complete", "activationAllowed": False,
                  "oldDataSha256": report["inventorySha256"], "newDataSha256": json_hash(current)}
        if rollback_root.exists():
            if not (rollback_root / "manifest.json").exists():
                parts = _metadata_parts(rollback_root, [rollback_manifest])
                if not parts or {child.name for child in rollback_root.iterdir()} != parts:
                    raise MigrationError("Rollback directory has no recoverable ownership manifest.")
                write_json(rollback_root / "manifest.json", rollback_manifest)
            elif load_json(rollback_root / "manifest.json") != rollback_manifest:
                raise MigrationError("New data changed after rollback began; preserve it under a new reviewed operation.")
            write_json(rollback_root / "manifest.json", rollback_manifest)
        else:
            rollback_root.mkdir()
            write_json(rollback_root / "manifest.json", rollback_manifest)
        allowed = {"manifest.json", "preserved-new", "NEW_DATA_PRESERVED.json", "restored-old", "COMPLETE.json"}
        allowed |= _metadata_parts(rollback_root, [rollback_manifest, preservation, result])
        if any(child.name not in allowed for child in rollback_root.iterdir()):
            raise MigrationError("Unknown content in rollback directory.")
        if current:
            _copy_tree(target / "working", rollback_root / "preserved-new", current, fault, "new_preserved")
        else:
            (rollback_root / "preserved-new").mkdir(exist_ok=True)
        write_json(rollback_root / "NEW_DATA_PRESERVED.json", preservation)
        fault("new_data_preserved")
        _copy_tree(target / "backup", rollback_root / "restored-old", original, fault, "old_restored")
        if (inventory(target / "working") if (target / "working").exists() else []) != current:
            raise MigrationError("New data changed during rollback; restored copy is not ready for use.")
        write_json(rollback_root / "COMPLETE.json", result)
        return {**result, "path": str(rollback_root)}
