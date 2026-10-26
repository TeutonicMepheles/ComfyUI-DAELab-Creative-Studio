"""Prepare synthetic E5 inputs or a sealed owned old-profile snapshot; never runs hosts.

Plans are emitted for explicit preflight/migrate/prepare-profiles CLI execution.
Existing destinations are never adopted, refreshed, deleted or overwritten.
"""
import argparse
import copy
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .prepare import BASELINES, initialize_workspace, identifier
from .profiles import (package_identity, active_profile, profile_identity, profile_inventory,
                       _events, _verify_seal)
from .safety import (MigrationError, checked, canonical, inventory, json_hash, load_json,
                     write_json, copy_verified, file_hash)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/performance"
MEDIA = "DAELAB/m6-synthetic-v1"
FAVORITES = "user/imports/legacy-favorites.json"


def _bindings(value):
    if not isinstance(value, dict) or set(value) != {"oldPackage", "newPackage"}:
        raise MigrationError("Explicit oldPackage/newPackage bindings are required.")
    for role, key in (("legacy", "oldPackage"), ("studio", "newPackage")):
        if value[key].get("kind") != role or not package_identity(value[key]).get("observer"):
            raise MigrationError("E5 requires separate fixed packages and the explicit reviewed runtime probe.")
    return value


def _fresh_root(value, bindings, *, protected=()):
    root = checked(value)
    checked(root.parent, exists=True)
    if root.exists():
        raise MigrationError("E5 preparation requires a new destination.")
    forbidden = [checked(spec["installationRoot"], exists=True) for spec in bindings.values()]
    forbidden.extend(checked(path, exists=True) for path in protected)
    if any(root == path or root.is_relative_to(path) or path.is_relative_to(root) for path in forbidden):
        raise MigrationError("E5 destination must be disjoint from bound installations and original data/workspace.")
    if any((parent / marker).exists() for parent in root.parents
           for marker in (".studio-data-profile.json", ".studio-migration-workspace.json")):
        raise MigrationError("E5 cannot create input data inside an existing profile or migration workspace.")
    return root


def _kind(name):
    if name == "user/comfyui.db":
        return "host-sqlite"
    if name == FAVORITES:
        return "favorites"
    if Path(name).suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        return "receipt-sqlite"
    if name.endswith(".json"):
        return "workflow" if "/workflows/" in name else "config"
    if Path(name).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".mp4", ".webm", ".mov", ".mkv", ".wav", ".mp3", ".flac", ".ogg", ".docx"}:
        return "media"
    raise MigrationError("Unclassified source data requires review before generating a plan.")


def _plans(root, workspace, bindings, migration_id, set_id, *, reference_roots=None, provenance):
    entries = inventory(root / "source")
    migration = {"schemaVersion": 1, "migrationId": identifier(migration_id), "sourceRoot": str(root / "source"),
                 "workspaceRoot": str(workspace), "files": [{"path": e["path"], "kind": _kind(e["path"])} for e in entries],
                 "versions": {**BASELINES, "comfyui": "0.39.2"}, "quiesced": True, "unpersistedTasks": 0,
                 "recoveryPlans": provenance.get("recoveryPlans", []),
                 "customNodeRoots": [str(Path(bindings["newPackage"]["installationRoot"]) / "custom_nodes")],
                 "newPackageRoot": bindings["newPackage"]["root"]}
    if reference_roots:
        migration["referenceRoots"] = reference_roots
    profiles = {"schemaVersion": 1, "workspaceRoot": str(workspace), "migrationId": migration_id,
                "setId": identifier(set_id), **bindings,
                "mapping": [{"source": e["path"], "root": e["path"].split("/", 1)[0], "path": e["path"].split("/", 1)[1]} for e in entries]}
    write_json(root / "migration-plan.json", migration)
    write_json(root / "profile-plan.json", profiles)
    report = {"schemaVersion": 1, "kind": "isolated-e5-preparation", "sourceInventory": entries,
              "sourceInventorySha256": json_hash(entries), "provenance": provenance,
              "migrationPlan": str(root / "migration-plan.json"), "profilePlan": str(root / "profile-plan.json"),
              "workspace": str(workspace), "serviceAction": "none", "hostAcceptance": False,
              "note": "quiesced applies to never-run synthetic bytes or a verified stopped owned profile; it is not runtime evidence."}
    write_json(root / "PREPARED.json", report)
    return report


def seed(root_path, bindings):
    bindings = _bindings(bindings)
    root = _fresh_root(root_path, bindings)
    root.mkdir()
    write_json(root / ".e5-owned.json", {"kind": "new-synthetic-e5", "path": str(root)})
    source = root / "source"
    for name in ("user/default/workflows", "user/imports", "input/" + MEDIA, "output/" + MEDIA):
        (source / name).mkdir(parents=True)
    sources = [FIXTURES / "FX-PERF-S-no-video.json", FIXTURES / "media/pattern.png", FIXTURES / "media/loop.mp4",
               ROOT / "tests/migration/fixtures/comfyui-assets-schema.json"]
    for src, target in ((sources[1], source / "input" / MEDIA / "pattern.png"), (sources[2], source / "output" / MEDIA / "loop.mp4")):
        target.write_bytes(src.read_bytes())
    template = load_json(sources[0])
    nodes = [copy.deepcopy(next(n for n in template["nodes"] if n["type"] == kind)) for kind in ("DAELAB.TextInput", "DAELAB.MediaUpload")]
    for index, node in enumerate(nodes, 1):
        node.update(id=index, order=index - 1, pos=[(index - 1) * 560, 80], futureNodeMetadata={"preserve": [1, "合成未知字段"]})
        for slot in node["inputs"]:
            slot["link"] = None
        for slot in node["outputs"]:
            slot["links"] = []
    nodes[0]["widgets_values"] = ["M6 合成原文：保留旧收藏、未知字段与既有媒体。请通过 UI 编辑并保存。"]
    asset = {"version": 1, "id": "m6-input-image", "kind": "image", "name": "M6 合成图片", "filename": "pattern.png", "subfolder": MEDIA, "type": "input"}
    nodes[1]["widgets_values"] = [json.dumps(asset, ensure_ascii=False, separators=(",", ":"))]
    workflow = {"id": "bb76dd08-6b32-42cb-a929-3827ca26fe37", "revision": 0, "version": 0.4,
                "last_node_id": 2, "last_link_id": 0, "nodes": nodes, "links": [], "groups": [], "config": {},
                "extra": {"ds": {"scale": 0.7, "offset": [40, 40]}},
                "unknownWorkflow": {"futureVersion": 7, "preserve": ["中文", None, {"value": 3}]},
                "extensions": {"unknownWorkflow": {"separateOriginalValue": True}}}
    write_json(source / "user/default/workflows/M6-synthetic.json", workflow)
    favorites = {"version": 1, "entries": [
        {"id": "m6-legacy-text", "kind": "text", "name": "合成旧收藏文本", "text": "固定旧收藏。", "futureMetadata": {"keep": True}},
        {"id": "m6-legacy-image", "kind": "image", "name": "合成旧收藏图片", "asset": asset},
        {"id": "m6-legacy-video", "kind": "video", "name": "合成旧收藏成片", "asset": {"version": 1, "kind": "video", "filename": "loop.mp4", "subfolder": MEDIA, "type": "output"}}]}
    write_json(source / FAVORITES, favorites)
    schema = load_json(sources[3])
    with closing(sqlite3.connect(source / "user/comfyui.db")) as db:
        for row in sorted(schema["schema"], key=lambda r: r["type"] != "table"):
            db.execute(row["sql"])
        db.execute("INSERT INTO alembic_version VALUES (?)", (schema["revision"],))
        for index, (root_name, name, mime) in enumerate((("input", "pattern.png", "image/png"), ("output", "loop.mp4", "video/mp4")), 1):
            media = source / root_name / MEDIA / name
            content_id, asset_id = f"00000000-0000-4000-8000-{index:012}", f"10000000-0000-4000-8000-{index:012}"
            db.execute("INSERT INTO asset_contents(id,size_bytes,path,created_at) VALUES (?,?,?,?)", (content_id, media.stat().st_size, str(media), "2026-01-01"))
            db.execute("INSERT INTO assets(id,content_id,name,mime_type,loader_path,user_metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                       (asset_id, content_id, name, mime, str(media), '{"favorite":true,"future":[3,1]}', "2026-01-01", "2026-01-01"))
        db.execute("INSERT INTO tags VALUES ('M6 synthetic')")
        db.execute("INSERT INTO asset_tags VALUES (?,?,?,?)", ("10000000-0000-4000-8000-000000000001", "M6 synthetic", "manual", "2026-01-01"))
        db.commit()
    workspace = root / "workspace"
    initialize_workspace(workspace)
    return _plans(root, workspace, bindings, "initial", "round1", provenance={"kind": "public-synthetic-never-run",
                  "files": [{"path": p.relative_to(ROOT).as_posix(), "sha256": file_hash(p)} for p in sources],
                  "nativeAssets": 2, "legacyFavorites": 3, "unknownFields": "root/node/extensions; unsupported node types still require review"})


def capture(root_path, bindings, workspace_path, profile_id, seal_id, migration_id, set_id):
    bindings = _bindings(bindings)
    workspace, profile, marker = profile_identity(workspace_path, profile_id)
    root = _fresh_root(root_path, bindings, protected=(workspace, profile, *marker["roots"].values()))
    if active_profile(workspace)["active"] != profile_id or marker["role"] != "old" or marker["package"] != package_identity(bindings["oldPackage"]):
        raise MigrationError("Capture requires the active sealed old profile and the exact old package binding.")
    _, _, entries = _verify_seal(workspace, profile_id, seal_id, _events(workspace))
    for entry in entries:
        _kind(entry["path"])
    root.mkdir()
    write_json(root / ".e5-owned.json", {"kind": "sealed-old-e5-snapshot", "path": str(root)})
    source = root / "source"
    source.mkdir()
    for entry in entries:
        copy_verified(profile / entry["path"], source / entry["path"], entry)
    _verify_seal(workspace, profile_id, seal_id, _events(workspace))
    if inventory(source) != sorted(entries, key=lambda entry: entry["path"]) or profile_inventory(profile) != entries:
        raise MigrationError("Owned old profile changed during capture; no plan was published.")
    return _plans(root, workspace, bindings, migration_id, set_id, reference_roots=marker["roots"],
                  provenance={"kind": "verified-stopped-owned-old-profile", "profileId": profile_id,
                              "profileSha256": json_hash(marker), "sealId": seal_id, "recoveryPlans": marker["recoveryPlans"]})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("seed", "capture"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--bindings", required=True)
    for name in ("workspace", "profile", "seal", "migration-id", "set-id"):
        parser.add_argument("--" + name)
    args = parser.parse_args(argv)
    try:
        destination = checked(args.root)
        if not destination.is_relative_to(checked(ROOT / ".local", exists=True)):
            raise MigrationError("The synthetic E5 CLI writes only a new directory below this source checkout's .local.")
        bindings = load_json(args.bindings)
        result = seed(args.root, bindings) if args.command == "seed" else capture(
            args.root, bindings, args.workspace, args.profile, args.seal, args.migration_id, args.set_id)
        print(json.dumps({key: result[key] for key in ("migrationPlan", "profilePlan", "workspace", "serviceAction", "hostAcceptance")}, indent=2))
        return 0
    except (MigrationError, OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        print(json.dumps({"error": "E5 preparation refused; preserve the owned destination and review explicit bindings."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
