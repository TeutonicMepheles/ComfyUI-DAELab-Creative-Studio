"""Owned data profiles and append-only activation descriptors; never starts/stops hosts.

Runtime evidence is collected read-only from an exact local PID/port and exact
data-root arguments, then sealed only after that process has exited. A descriptor
is a launch selection, not proof that a host was switched or accepted.
"""
import hashlib
import os
import re
import time
import uuid
import zipfile
from pathlib import Path
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler, Request

from backend.contracts.validation import clean_json
from backend.contracts.errors import InvalidInput
from compat.receipts import inspect_database
from .prepare import (OWNER, BASELINES, identifier, workspace_identity, _check_tree,
                      _copy_tree, _metadata_parts, _inspect_embedded_json)
from .workflow_receipts import inspect_workflow_receipts
from .safety import (MigrationError, checked, contained, relative, inventory, file_hash,
                     json_hash, load_json, write_json, operation_lock, part_paths, publish)

ROOTS = ("user", "input", "output")
PROFILE_MARKER = ".studio-data-profile.json"
MAX_OBSERVATION_AGE = 300

# Reviewed standalone probe identity, shipped as data only. The probe executable
# is intentionally absent from release candidates; never trust a supplied hash or
# depend on an adjacent source checkout. Updating probe code requires reviewing
# and updating these pins together (enforced by the source-bundle contract test).
REVIEWED_PROBE_FILES = (
    ("__init__.py", "5452376c61ea6ecf5131f92c6c176ab08c64e247f96bd8ed575717140a752529", 923),
    ("probe.py", "a496d4d3d7154338306f636c7305dd5512d3652dd5218ea9147264e2e95e959a", 42461),
)
REVIEWED_PROBE_SOURCE_SHA256 = "b4141979861b84d0f32821530994a3428a98b970a4f74bac819b73e0660c5ba6"
REVIEWED_PROBE_MANIFEST_SHA256 = "9188fc3afdd17d6a41cf59ef1f6df8422cc91a53e61ed5268c0f353fd2ca53a8"
REVIEWED_PROBE_MANIFEST_BYTES = 505
REVIEWED_PROBE_COVERAGE = "legacy-memory-v1"


def _observer_identity(binding, install, allowed):
    if binding is None:
        return None
    if not isinstance(binding, dict) or set(binding) != {"root"}:
        raise MigrationError("Unknown runtime observer binding.")
    probe = checked(binding["root"], exists=True)
    if probe.parent != install / "custom_nodes" or probe in allowed:
        raise MigrationError("Runtime observer must be a separate explicit isolated package.")
    record = load_json(probe / "probe-manifest.json")
    files = [{"path": name, "sha256": digest, "bytes": size} for name, digest, size in REVIEWED_PROBE_FILES]
    expected = {"schemaVersion": 1, "kind": "legacy-runtime-probe-package", "coverageVersion": REVIEWED_PROBE_COVERAGE,
                "files": files, "probeSourceSha256": REVIEWED_PROBE_SOURCE_SHA256}
    actual = sorted([entry for entry in inventory(probe) if not
              ("__pycache__" in Path(entry["path"]).parts and entry["path"].endswith(".pyc"))], key=lambda entry: entry["path"])
    expected_files = sorted([{"path": item["path"], "sha256": item["sha256"], "size": item["bytes"]} for item in files] + [
        {"path": "probe-manifest.json", "sha256": REVIEWED_PROBE_MANIFEST_SHA256,
         "size": REVIEWED_PROBE_MANIFEST_BYTES}], key=lambda item: item["path"])
    if record != expected or actual != expected_files:
        raise MigrationError("Runtime observer differs from the fixed reviewed probe identity.")
    allowed.add(probe)
    return {"root": str(probe), "coverageVersion": record["coverageVersion"],
            "probeSourceSha256": record["probeSourceSha256"], "manifestSha256": REVIEWED_PROBE_MANIFEST_SHA256}


def package_identity(spec):
    """Bind explicit code bytes; no code import, Git checkout or installation write."""
    if not isinstance(spec, dict) or spec.get("kind") not in {"studio", "legacy"}:
        raise MigrationError("A fixed package identity is required.")
    install = checked(spec["installationRoot"], exists=True)
    if spec["kind"] == "studio":
        if (set(spec) - {"kind", "installationRoot", "root", "commit", "observer"} or
                not {"kind", "installationRoot", "root", "commit"} <= set(spec)):
            raise MigrationError("Unknown candidate binding fields.")
        root = checked(spec["root"], exists=True)
        if root.parent != install / "custom_nodes":
            raise MigrationError("Candidate must belong to the explicit isolated installation.")
        allowed = {root}
        observer = _observer_identity(spec.get("observer"), install, allowed)
        if {child for child in (install / "custom_nodes").iterdir() if child.name != "__pycache__"} != allowed:
            raise MigrationError("The new isolated installation must enable only its fixed package.")
        record = load_json(root / "release-candidate.json")
        if (not re.fullmatch(r"[0-9a-f]{40}", spec["commit"]) or
                record.get("revision") != spec["commit"] or record.get("schemaVersion") != 1):
            raise MigrationError("Candidate commit and release manifest differ.")
        expected = []
        for entry in record["files"]:
            relative(entry["path"])
            expected.append({"path": entry["path"], "size": entry["bytes"], "sha256": entry["sha256"]})
        actual = inventory(root)
        # Python caches are runtime artifacts; they cannot stand in for source files.
        # Package identity is independent of platform directory enumeration. Keep
        # exact path spelling/content; do not change migration/seal inventory order.
        actual = sorted([entry for entry in actual if entry["path"] != "release-candidate.json" and
                  not ("__pycache__" in Path(entry["path"]).parts and entry["path"].endswith(".pyc"))], key=lambda entry: entry["path"])
        if sorted(expected, key=lambda item: item["path"]) != actual:
            raise MigrationError("Installed candidate bytes differ from the fixed release manifest.")
        if not re.fullmatch(r"[0-9a-f]{64}", record.get("frontendBuildId", "")):
            raise MigrationError("Candidate has no frontend build identity.")
        return {"spec": spec, "filesSha256": json_hash(actual), "manifestSha256": file_hash(root / "release-candidate.json"),
                "frontendBuildId": record["frontendBuildId"], "commit": spec["commit"], "observer": observer}
    if (set(spec) - {"kind", "installationRoot", "roots", "commits", "observer"} or
            not {"kind", "installationRoot", "roots", "commits"} <= set(spec) or
            spec["commits"] != BASELINES or set(spec["roots"]) != set(BASELINES)):
        raise MigrationError("Legacy binding requires both fixed baseline identities.")
    prepared = load_json(install / "prepared.json")
    if prepared.get("configuration", {}).get("owner") != "creative-studio-old-baseline-v1":
        raise MigrationError("Legacy code requires the immutable baseline preparer's manifest.")
    trees = {}
    for name, path in spec["roots"].items():
        root = checked(path, exists=True)
        if root.parent != install / "custom_nodes":
            raise MigrationError("Legacy packages must belong to the isolated installation.")
        trees[name] = sorted([entry for entry in inventory(root) if not
                       ("__pycache__" in Path(entry["path"]).parts and entry["path"].endswith(".pyc"))], key=lambda entry: entry["path"])
        snapshot = next((item for item in prepared["snapshots"] if item["name"] == root.name), None)
        if (snapshot is None or snapshot["source_commit"] != BASELINES[name] or
                file_hash(snapshot["archive"]) != snapshot["archive_sha256"] or
                sorted([{"path": item["path"], "size": item["bytes"], "sha256": item["sha256"]} for item in snapshot["files"]],
                       key=lambda item: item["path"]) != trees[name]):
            raise MigrationError("Legacy archive, commit and installed bytes differ.")
        with zipfile.ZipFile(checked(snapshot["archive"], exists=True)) as archive:
            if archive.comment.decode("ascii") != BASELINES[name]:
                raise MigrationError("Legacy archive is not pinned to the declared Git archive commit.")
            archived = []
            seen = set()
            for member in archive.infolist():
                if member.is_dir():
                    continue
                relative(member.filename)
                if member.filename.casefold() in seen or member.file_size > 256 * 1024 * 1024:
                    raise MigrationError("Legacy archive has duplicate or oversized members.")
                seen.add(member.filename.casefold())
                raw = archive.read(member)
                archived.append({"path": member.filename, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
            if sorted(archived, key=lambda item: item["path"]) != trees[name]:
                raise MigrationError("Legacy archive contents differ from installed baseline bytes.")
    allowed = {Path(value) for value in spec["roots"].values()}
    observer = _observer_identity(spec.get("observer"), install, allowed)
    if {child for child in (install / "custom_nodes").iterdir() if child.name != "__pycache__"} != allowed:
        raise MigrationError("The old isolated installation must enable exactly its two fixed packages.")
    return {"spec": spec, "filesSha256": json_hash(trees), "commits": BASELINES,
            "manifestSha256": file_hash(install / "prepared.json"), "observer": observer}


def profile_identity(workspace_path, profile_id):
    workspace, owner = workspace_identity(workspace_path)
    identifier(profile_id)
    root = contained(workspace, "profiles/" + profile_id)
    marker = load_json(root / PROFILE_MARKER)
    if (marker.get("owner") != OWNER or marker.get("schemaVersion") != 1 or
            marker.get("workspaceId") != owner["workspaceId"] or marker.get("profileId") != profile_id or
            marker.get("path") != str(root) or marker.get("roots") != {name: str(root / name) for name in ROOTS}):
        raise MigrationError("Profile ownership, identity or complete data-root binding differs.")
    for name in ROOTS:
        checked(root / name, exists=True)
    if load_json(root / "READY.json") != {"profileSha256": json_hash(marker)}:
        raise MigrationError("Profile materialization is not complete.")
    return workspace, root, marker


def profile_inventory(root):
    return [{**entry, "path": name + "/" + entry["path"]}
            for name in ROOTS for entry in inventory(root / name)]


def _shutdown_inventory(root):
    """Compare durable values across a normal WAL checkpoint, retaining raw evidence."""
    from .sqlite_snapshot import snapshot_sqlite, sqlite_logical_digest
    raw = profile_inventory(root)
    databases = {entry["path"] for entry in raw if Path(entry["path"]).suffix.lower() in {".db", ".sqlite", ".sqlite3"}}
    result = []
    for entry in raw:
        name = entry["path"]
        if any(name == database + suffix for database in databases for suffix in ("-wal", "-shm")):
            continue
        if name in databases:
            entry = {"path": name, "sha256": sqlite_logical_digest(snapshot_sqlite(contained(root, name))),
                     "size": None, "basis": "sqlite-all-values-v1"}
        result.append(entry)
    return raw, result


def _inspect_partial_profile(root, source_root, mapping, by_source, converted):
    """Read-only validation of both profiles before resuming either one's writes."""
    expected, parts = {}, {}
    for item in mapping:
        name = item["root"] + "/" + item["path"]
        destination = contained(root, name)
        original = by_source[item["source"]]
        payload = converted.get(name)
        entry = {**original, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)} if payload is not None else original
        source = contained(source_root, item["source"])
        expected[name] = (entry, destination)
        for part in part_paths(destination, entry["sha256"]):
            parts[part.relative_to(root).as_posix()] = (entry, destination, source, payload)
    for name in ROOTS:
        folder = root / name
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            checked(path, exists=True)
            if path.is_dir():
                continue
            relative_path = path.relative_to(root).as_posix()
            if relative_path in expected:
                entry, destination = expected[relative_path]
                linked = [part for part in part_paths(destination, entry["sha256"]) if part.exists() and os.path.samefile(part, path)]
                if (path.stat().st_nlink != 1 and not (path.stat().st_nlink == 2 and len(linked) == 1) or
                        file_hash(path, allow_link=bool(linked)) != entry["sha256"] or path.stat().st_size != entry["size"]):
                    raise MigrationError("Partial profile data changed; no profile was modified.")
            elif relative_path in parts:
                entry, destination, source, payload = parts[relative_path]
                linked = destination.exists() and os.path.samefile(destination, path)
                if path.stat().st_size > entry["size"] or path.stat().st_nlink != (2 if linked else 1):
                    raise MigrationError("Partial profile copy identity is invalid.")
                import io
                with (io.BytesIO(payload) if payload is not None else source.open("rb")) as original, path.open("rb") as partial:
                    for chunk in iter(lambda: partial.read(1024 * 1024), b""):
                        if original.read(len(chunk)) != chunk:
                            raise MigrationError("Partial profile bytes differ from the fixed source.")
            else:
                raise MigrationError("Unknown file in incomplete profile; no profile was modified.")


def _materialized_entries(root, source_tree, migration_manifest, mapping, by_source):
    kinds = {item["path"]: item["kind"] for item in migration_manifest["plan"]["files"]}
    mapped = sorted([{**by_source[item["source"]], "path": item["root"] + "/" + item["path"]}
                     for item in mapping], key=lambda item: item["path"])
    comparison, transformations, converted = [dict(entry) for entry in mapped], [], {}
    native = [item for item in mapping if kinds[item["source"]] == "host-sqlite"]
    if not native:
        return mapped, comparison, transformations, converted
    if len(native) != 1 or native[0]["root"] != "user" or native[0]["path"] != "comfyui.db":
        raise MigrationError("The native asset database must map exactly to user/comfyui.db.")
    from .host_database import remap_host_database, logical_database_digest
    references, referenced_entries = {}, {}
    origin = checked(migration_manifest["plan"]["sourceRoot"], exists=True)
    declared_roots = migration_manifest["plan"].get("referenceRoots", {})
    for item in mapping:
        destination = contained(root, item["root"] + "/" + item["path"]) if root.exists() else checked(root / item["root"] / item["path"])
        sources = [contained(origin, item["source"])]
        if item["root"] in declared_roots:
            sources.append(contained(checked(declared_roots[item["root"]], exists=True), item["path"]))
        for source in sources:
            if not source.exists():
                continue
            if file_hash(source) != by_source[item["source"]]["sha256"]:
                raise MigrationError("A declared reference source differs from the verified backup.")
            key = str(source)
            if key in references and references[key] != str(destination):
                raise MigrationError("A source reference has ambiguous profile destinations.")
            references[key] = str(destination)
            referenced_entries[key] = by_source[item["source"]]
    item = native[0]
    roots = {name: root / name for name in ROOTS}
    result = remap_host_database(contained(source_tree, item["source"]), references, roots)
    raw = result["bytes"]
    if (result["manifest"]["sourceSHA256"] != by_source[item["source"]]["sha256"] or
            result["manifest"]["resultSHA256"] != hashlib.sha256(raw).hexdigest()):
        raise MigrationError("Native database conversion identity differs from its verified backup.")
    for verified in result["manifest"]["verifiedSourceFiles"]:
        expected = referenced_entries.get(str(checked(verified["path"], exists=True)))
        if expected is None or verified["sha256"] != expected["sha256"] or verified["size"] != expected["size"]:
            raise MigrationError("Native asset source changed between snapshot verification and conversion.")
    converted["user/comfyui.db"] = raw
    transformations.append({"source": item["source"], "destination": "user/comfyui.db", **result["manifest"]})
    for entry in mapped:
        if entry["path"] == "user/comfyui.db":
            entry.update(sha256=hashlib.sha256(raw).hexdigest(), size=len(raw))
    for entry in comparison:
        if entry["path"] == "user/comfyui.db":
            entry.update(sha256=logical_database_digest(raw, roots), size=None, basis="native-asset-logical-v1")
    return mapped, comparison, transformations, converted


def _comparison_inventory(root, marker, entries):
    result = [dict(entry) for entry in sorted(entries, key=lambda item: item["path"])]
    native = any(item["path"] == "user/comfyui.db" for item in result)
    if native:
        from .host_database import logical_database_digest
        for entry in result:
            if entry["path"] == "user/comfyui.db":
                entry.update(sha256=logical_database_digest(root / entry["path"], marker["roots"]),
                             size=None, basis="native-asset-logical-v1")
    return result


def prepare_profiles(plan, *, fault=lambda point: None):
    if not isinstance(plan, dict) or set(plan) != {"schemaVersion", "workspaceRoot", "migrationId", "setId", "mapping", "oldPackage", "newPackage"} or plan["schemaVersion"] != 1:
        raise MigrationError("Unknown profile plan schema.")
    workspace, owner = workspace_identity(plan["workspaceRoot"])
    migration_id, set_id = identifier(plan["migrationId"]), identifier(plan["setId"])
    identifier(set_id + "-old")
    identifier(set_id + "-new")
    target = contained(workspace, migration_id)
    manifest = load_json(target / "manifest.json")
    report = manifest["report"]
    if (manifest.get("workspaceId") != owner["workspaceId"] or manifest.get("owner") != OWNER or
            manifest.get("migrationId") != migration_id or json_hash(manifest["plan"]) != report["planSha256"] or
            json_hash(report["inventory"]) != report["inventorySha256"] or not report["switchPreflightClear"] or
            load_json(target / "COMPLETE.json").get("state") != "snapshot_complete"):
        raise MigrationError("A complete reviewed migration snapshot is required.")
    entries = report["inventory"]
    _check_tree(target / "backup", entries, complete=True)
    _check_tree(target / "working", entries, complete=True)
    mapping = plan["mapping"]
    if not isinstance(mapping, list) or len(mapping) != len(entries):
        raise MigrationError("Every source file requires one explicit profile mapping.")
    sources, destinations = set(), set()
    for item in mapping:
        if set(item) != {"source", "root", "path"} or item["root"] not in ROOTS:
            raise MigrationError("Unknown profile mapping.")
        relative(item["source"])
        relative(item["path"])
        destination = item["root"] + "/" + item["path"]
        if item["source"] in sources or destination.casefold() in destinations:
            raise MigrationError("Profile mapping is duplicate or case-colliding.")
        if item["source"].startswith(("input/", "output/")) and item["source"] != destination:
            raise MigrationError("Media paths must retain their original root-relative references.")
        sources.add(item["source"])
        destinations.add(destination.casefold())
    if sources != {entry["path"] for entry in entries}:
        raise MigrationError("Profile mapping omits source data.")
    packages = {"old": package_identity(plan["oldPackage"]), "new": package_identity(plan["newPackage"])}
    if plan["oldPackage"]["kind"] != "legacy" or plan["newPackage"]["kind"] != "studio":
        raise MigrationError("Separate old and new installations are required.")
    if plan["oldPackage"]["installationRoot"] == plan["newPackage"]["installationRoot"]:
        raise MigrationError("Old and new code installations must be distinct.")
    with operation_lock(workspace, "profiles"):
        profiles = contained(workspace, "profiles")
        output = {}
        by_source = {entry["path"]: entry for entry in entries}
        prepared = []
        visited = {record["profileId"] for record in _events(workspace)}
        for role, tree in (("old", "backup"), ("new", "working")):
            profile_id = set_id + "-" + role
            root = contained(workspace, "profiles/" + profile_id)
            mapped, comparison, transformations, converted = _materialized_entries(root, target / tree, manifest, mapping, by_source)
            marker = {"schemaVersion": 1, "owner": OWNER, "workspaceId": owner["workspaceId"], "profileId": profile_id,
                      "path": str(root), "role": role, "setId": set_id, "migrationId": migration_id,
                      "roots": {name: str(root / name) for name in ROOTS}, "package": packages[role],
                      "planSha256": json_hash(plan), "mapping": mapping, "initialInventory": mapped,
                      "comparisonInventory": comparison, "transformations": transformations,
                      "sourceInventorySha256": report["inventorySha256"], "recoveryPlans": manifest["plan"].get("recoveryPlans", [])}
            if _bound_processes(marker):
                raise MigrationError("A process binds profile data; preparation cannot write or resume it.")
            if root.exists() and not (root / PROFILE_MARKER).exists():
                parts = _metadata_parts(root, [marker])
                if not parts or {entry.name for entry in root.iterdir()} != parts:
                    raise MigrationError("Existing profile is not owned by this operation.")
            if (root / PROFILE_MARKER).exists() and load_json(root / PROFILE_MARKER) != marker:
                raise MigrationError("Profile belongs to a different preparation request.")
            ready = (root / "READY.json").exists()
            if ready:
                if (load_json(root / "READY.json") != {"profileSha256": json_hash(marker)} or
                        sorted(profile_inventory(root), key=lambda item: item["path"]) != mapped):
                    raise MigrationError("Completed profile data changed; preparation never restores user edits or deletions.")
            elif profile_id in visited:
                raise MigrationError("A selected profile cannot enter preparation recovery.")
            elif root.exists():
                allowed = {PROFILE_MARKER, *ROOTS} | _metadata_parts(root, [marker, {"profileSha256": json_hash(marker)}])
                if {entry.name for entry in root.iterdir()} - allowed:
                    raise MigrationError("Unknown content in incomplete profile.")
                _inspect_partial_profile(root, target / tree, mapping, by_source, converted)
            prepared.append((role, tree, profile_id, root, marker, mapped, ready, converted))
        profiles.mkdir(exist_ok=True)
        for role, tree, profile_id, root, marker, mapped, ready, converted in prepared:
            output[role] = profile_id
            if ready:
                continue
            root.mkdir(exist_ok=True)
            write_json(root / PROFILE_MARKER, marker)
            fault("profile_manifest:" + role)
            for name in ROOTS:
                (root / name).mkdir(exist_ok=True)
            from .safety import copy_verified
            for item in mapping:
                name = item["root"] + "/" + item["path"]
                destination = contained(root, name)
                if name in converted:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    publish(destination, converted[name])
                else:
                    copy_verified(contained(target / tree, item["source"]), destination, by_source[item["source"]])
                fault("profile_copied:" + role + ":" + item["source"])
            if sorted(profile_inventory(root), key=lambda item: item["path"]) != mapped:
                raise MigrationError("Profile contains unexpected or changed data.")
            write_json(root / "READY.json", {"profileSha256": json_hash(marker)})
        return {"state": "profiles_ready", "profiles": output, "serviceAction": "none", "hostAcceptance": False}


def _events(workspace):
    folder = contained(workspace, "activation")
    if not folder.exists():
        return []
    records, previous = [], None
    files = sorted(path for path in folder.iterdir() if path.suffix == ".json")
    for number, path in enumerate(files, 1):
        if path.name != f"{number:06}.json":
            raise MigrationError("Activation journal is incomplete.")
        record = load_json(path)
        if record.get("sequence") != number or record.get("previousSha256") != previous:
            raise MigrationError("Activation journal identity changed.")
        records.append(record)
        previous = json_hash(record)
    return records


def active_profile(workspace_path):
    workspace, _ = workspace_identity(workspace_path)
    records = _events(workspace)
    if not records:
        return {"active": None, "serviceAction": "none"}
    record = records[-1]
    _, _, marker = profile_identity(workspace, record["profileId"])
    if record["profileSha256"] != json_hash(marker):
        raise MigrationError("Active profile identity changed.")
    return {"active": record["profileId"], "roots": marker["roots"], "package": marker["package"],
            "sequence": record["sequence"], "serviceAction": "none", "hostAcceptance": False}


def _process(pid):
    # Optional inspection dependency; fail closed rather than guessing from PID alone.
    try:
        import psutil
    except ImportError:
        raise MigrationError("Runtime inspection requires psutil in the operator Python environment.") from None
    try:
        process = psutil.Process(pid)
        return {"pid": pid, "created": process.create_time(), "executable": process.exe(),
                "arguments": process.cmdline(), "cwd": process.cwd(), "listeners": [connection.laddr.port for connection in process.net_connections(kind="tcp")
                    if connection.status == psutil.CONN_LISTEN and connection.laddr.ip in {"127.0.0.1", "::1"}]}
    except psutil.NoSuchProcess:
        return None
    except (psutil.AccessDenied, OSError):
        raise MigrationError("Cannot verify the exact runtime process.") from None


def _directory_arguments(arguments, *, allow_abbreviations=True):
    result = {}
    flags = {"--user-directory", "--input-directory", "--output-directory", "--base-directory", "--database-url"}
    for index, argument in enumerate(arguments):
        flag, separator, inline = argument.partition("=")
        if allow_abbreviations and flag not in flags and flag.startswith("--") and len(flag) > 2:
            matches = [candidate for candidate in flags if candidate.startswith(flag)]
            if len(matches) == 1:
                flag = matches[0]  # argparse also permits unambiguous long-option prefixes.
        if flag in flags:
            value = inline if separator else arguments[index + 1] if index + 1 < len(arguments) else ""
            result.setdefault(flag, []).append(value)
    return result


def _argument_path(value, cwd):
    # Normalize only documented Win32 aliases; unknown device namespaces cannot
    # establish that an unrelated process is outside the owned data roots.
    value = str(value)
    if os.name == "nt":
        if value[:8].casefold() == "\\\\?\\unc\\":
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\") and re.match(r"^[A-Za-z]:[\\/]", value[4:]):
            value = value[4:]
        elif value.startswith(("\\\\?\\", "\\\\.\\")):
            raise MigrationError("Unknown device namespace in runtime data binding.")
    path = Path(value)
    if not path.is_absolute():
        if not cwd:
            raise MigrationError("Relative runtime data roots require readable process cwd.")
        path = Path(cwd) / path
    # Resolve local aliases (junctions, symlinks and Windows short names) only for
    # comparison; migration writes still reject every linked path via checked().
    if not path.drive.startswith("\\\\"):
        path = path.resolve(strict=False)
    resolved = str(path)
    if os.name == "nt" and resolved.startswith("\\\\?\\"):
        if resolved[:8].casefold() == "\\\\?\\unc\\":
            resolved = "\\\\" + resolved[8:]
        elif re.match(r"^[A-Za-z]:[\\/]", resolved[4:]):
            resolved = resolved[4:]
        else:
            raise MigrationError("Unresolved device namespace in runtime data binding.")
    return os.path.normcase(os.path.normpath(resolved)).casefold()


def _database_path(value, cwd):
    if not isinstance(value, str) or not value.startswith("sqlite:///"):
        raise MigrationError("Only the explicit local SQLite host database URI is supported.")
    path = value[len("sqlite:///"):]
    if not path or path == ":memory:" or path.startswith("file:") or "?" in path or "#" in path or "%" in path:
        raise MigrationError("Ambiguous or non-file SQLite database binding is unsupported.")
    return _argument_path(path, cwd)


def _bound_processes(marker):
    try:
        import psutil
    except ImportError:
        raise MigrationError("Runtime inspection requires psutil in the operator Python environment.") from None
    roots = {Path(_argument_path(value, None)) for value in marker["roots"].values()}
    found = []
    # Only read command-line metadata. Never signal or terminate any process.
    for process in psutil.process_iter(["pid", "cmdline", "cwd", "name"]):
        arguments = process.info.get("cmdline")
        if arguments is None and "python" in (process.info.get("name") or "").lower():
            raise MigrationError("A Python runtime has unreadable command-line metadata.")
        is_python = "python" in (process.info.get("name") or "").lower() or bool(
            arguments and "python" in Path(arguments[0]).name.lower())
        bindings = _directory_arguments(arguments or [], allow_abbreviations=is_python)
        databases = [_database_path(value, process.info.get("cwd")) for value in bindings.get("--database-url", [])
                     if value.startswith("sqlite") and value not in {"sqlite://", "sqlite:///:memory:"}]
        if any(Path(database).is_relative_to(root) or root.is_relative_to(Path(database)) for database in databases for root in roots):
            found.append(process.info["pid"])
            continue
        for flag in ("--user-directory", "--input-directory", "--output-directory"):
            values = bindings.get(flag, [])
            if not values:
                # Fixed host folder_paths.py derives omitted data roots from base_directory.
                name = flag.removeprefix("--").removesuffix("-directory")
                values = [str(Path(base) / name) for base in bindings.get("--base-directory", [])]
            candidates = [Path(_argument_path(value, process.info.get("cwd"))) for value in values]
            if any(candidate.is_relative_to(root) or root.is_relative_to(candidate) for candidate in candidates for root in roots):
                found.append(process.info["pid"])
                break
    return found


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise MigrationError("Runtime evidence cannot follow redirects.")


def _request(port, path, payload=None):
    import json
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    request = Request(f"http://127.0.0.1:{port}{path}",
                      data=json.dumps(payload).encode("utf-8") if payload is not None else None,
                      headers={"Content-Type": "application/json"} if payload is not None else {})
    with opener.open(request, timeout=5) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise MigrationError("Runtime evidence exceeds the bounded response limit.")
    return json.loads(raw)


def _get(port, path):
    return _request(port, path)


def fence_profile(workspace_path, profile_id, pid, port):
    """The only mutating HTTP operation: explicitly close reviewed isolated ingress.

    It never submits/cancels tasks, stops a process or automatically removes a fence.
    Missing/unreviewed probe capabilities remain a hard refusal.
    """
    workspace, root, marker = profile_identity(workspace_path, profile_id)
    if not marker["package"].get("observer"):
        raise MigrationError("An explicitly installed reviewed observer is required for this fence.")
    if (isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or isinstance(port, bool) or
            not isinstance(port, int) or not 1024 <= port <= 65535 or port == 8000):
        raise MigrationError("An explicit isolated PID and non-production port are required.")
    with operation_lock(workspace, "profiles"):
        if active_profile(workspace)["active"] != profile_id:
            raise MigrationError("Only the selected profile can explicitly fence its runtime.")
        process = _process(pid)
        _runtime_matches(process, marker, port)
        if package_identity(marker["package"]["spec"]) != marker["package"]:
            raise MigrationError("Legacy code or observer identity changed.")
        nonce = uuid.uuid4().hex
        result = _request(port, "/daelab/migration/legacy-runtime/fence",
                          {"nonce": nonce, "profileSha256": json_hash(marker)})
        if not isinstance(result, dict) or result.get("nonce") != nonce:
            raise MigrationError("Legacy fence acknowledgment is unknown; inspect the original host without retrying work.")
        # A fresh GET is authoritative for coverage; a successful POST alone is not quiescence.
        evidence = _runtime_evidence(port, process, marker, allow_busy=True)
        if _process(pid) != process:
            raise MigrationError("Runtime changed while installing its ingress fence.")
        return {"profileId": profile_id, "fence": evidence["fence"], "quiescence": evidence["quiescence"],
                "serviceAction": "ingress_fenced", "tasksCancelled": 0, "hostStopped": False}


def _runtime_matches(process, marker, port):
    if process is None or port not in process["listeners"]:
        raise MigrationError("The explicit process does not own this loopback listener.")
    bindings = _directory_arguments(process["arguments"])
    for flag, expected in [("--" + name + "-directory", value) for name, value in marker["roots"].items()] + [
            ("--base-directory", marker["package"]["spec"]["installationRoot"])]:
        if len(bindings.get(flag, [])) != 1:
            raise MigrationError("The process does not bind every explicit profile root.")
        if _argument_path(bindings[flag][0], process.get("cwd")) != _argument_path(expected, None):
            raise MigrationError("The process data roots differ from the selected profile.")
    databases = bindings.get("--database-url", [])
    expected = _argument_path(str(Path(marker["roots"]["user"]) / "comfyui.db"), None)
    if len(databases) > 1 or databases and _database_path(databases[0], process.get("cwd")) != expected:
        raise MigrationError("The effective host database must belong to the complete profile user root.")


def _runtime_evidence(port, process, marker, *, allow_busy=False):
    probe = marker["package"].get("observer")
    if not probe:
        raise MigrationError("Runtime workers require the explicitly installed reviewed probe and ingress fence.")
    nonce = uuid.uuid4().hex
    collected_after = time.time()
    result = _get(port, "/daelab/migration/legacy-runtime?nonce=" + nonce)
    try:
        clean_json(result, max_bytes=1024 * 1024)
        runtime, sources, fence = result["runtime"], result["sources"], result["fence"]
        spec = marker["package"]["spec"]
        if (result.get("schemaVersion") != 1 or result.get("kind") != "legacy-runtime-quiescence" or
                result.get("nonce") != nonce or result.get("quiescence") not in ({"clear", "busy"} if allow_busy else {"clear"}) or
                (not allow_busy and result.get("blockers") != []) or
                result.get("coverageVersion") != probe["coverageVersion"] or result.get("probeSourceSha256") != probe["probeSourceSha256"] or
                result.get("profileRole") != marker["role"] or
                not collected_after - 2 <= result["observedAt"] <= time.time() + 2 or
                runtime["pid"] != process["pid"] or runtime["processCreated"] != process["created"] or
                checked(runtime["installationRoot"], exists=True) != checked(spec["installationRoot"], exists=True) or
                not isinstance(result.get("observations"), dict) or
                fence.get("active") is not True or fence.get("profileSha256") != json_hash(marker) or
                fence.get("profileRole") != marker["role"] or fence.get("pid") != process["pid"] or
                fence.get("processCreated") != process["created"] or fence.get("coverageVersion") != "legacy-ingress-v1" or
                not isinstance(fence.get("id"), str) or not re.fullmatch(r"[0-9a-f]{32}", fence["id"]) or
                fence.get("unreviewedEntrypoints") != [] or fence.get("acceptedAfterFence") != 0):
            raise MigrationError("Legacy runtime coverage is incomplete, stale, busy or bound to another process.")
        if marker["role"] == "old":
            if (checked(runtime["canvasRoot"], exists=True) != checked(spec["roots"]["canvas"], exists=True) or
                    checked(runtime["businessRoot"], exists=True) != checked(spec["roots"]["business"], exists=True) or
                    sources["canvasCommit"] != BASELINES["canvas"] or sources["businessCommit"] != BASELINES["business"] or not sources["files"]):
                raise MigrationError("Legacy source identity does not match its fixed archives.")
            for entry in sources["files"]:
                source = contained(checked(spec["roots"][entry["repository"]], exists=True), entry["path"])
                if file_hash(source) != entry["sha256"]:
                    raise MigrationError("Loaded legacy runtime source differs from its bound package.")
        elif (sources["candidateCommit"] != marker["package"]["commit"] or
              sources["frontendBuildId"] != marker["package"]["frontendBuildId"] or
              checked(runtime["studioRoot"], exists=True) != checked(spec["root"], exists=True)):
            raise MigrationError("Running Studio candidate identity differs from the selected profile.")
    except (InvalidInput, KeyError, TypeError, ValueError):
        raise MigrationError("Legacy runtime evidence is unknown or invalid; selection is blocked.") from None
    return result


def observe_runtime(workspace_path, profile_id, pid, port):
    workspace, root, marker = profile_identity(workspace_path, profile_id)
    if (isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or isinstance(port, bool) or
            not isinstance(port, int) or not 1024 <= port <= 65535 or port == 8000):
        raise MigrationError("An explicit isolated PID and non-production port are required.")
    with operation_lock(workspace, "profiles"):
        if active_profile(workspace)["active"] != profile_id:
            raise MigrationError("Only the selected profile can collect runtime evidence.")
        before = _process(pid)
        _runtime_matches(before, marker, port)
        if package_identity(marker["package"]["spec"]) != marker["package"]:
            raise MigrationError("The fixed package bytes changed.")
        data, durable = _shutdown_inventory(root)
        queue = _get(port, "/queue")
        if not isinstance(queue, dict) or queue.get("queue_running") != [] or queue.get("queue_pending") != []:
            raise MigrationError("Native queue must be observed empty before shutdown.")
        if marker["role"] == "new":
            health = _get(port, "/daelab/studio/health")
            if health.get("compatible") is not True or health.get("frontendBuildId") != marker["package"]["frontendBuildId"]:
                raise MigrationError("The running package does not match the fixed candidate.")
        runtime_coverage = _runtime_evidence(port, before, marker)
        after = _process(pid)
        final_data, final_durable = _shutdown_inventory(root)
        if after != before or final_durable != durable:
            raise MigrationError("Runtime identity changed while observing quiescence.")
        observation_id = uuid.uuid4().hex
        record = {"schemaVersion": 1, "observationId": observation_id, "profileSha256": json_hash(marker),
                  "observedAt": time.time(), "pid": pid, "processCreated": before["created"],
                  "processIdentitySha256": json_hash(before), "port": port, "nativeQueueEmpty": True,
                  "packageSha256": json_hash(marker["package"]), "activeSequence": active_profile(workspace)["sequence"],
                  "inventorySha256": json_hash(final_data), "rawInventory": final_data,
                  "durableInventory": durable, "durableInventorySha256": json_hash(durable), "runtimeCoverage": runtime_coverage}
        folder = root / "runtime"
        folder.mkdir(exist_ok=True)
        write_json(folder / (observation_id + ".json"), record)
        return record


def _check_quiescent_data(root, marker):
    """Read all data, reject uncheckpointed SQL, credentials and untracked live work."""
    records = []
    for entry in profile_inventory(root):
        path = contained(root, entry["path"])
        suffix = path.suffix.lower()
        if suffix in {".db", ".sqlite", ".sqlite3"}:
            if entry["path"] == "user/comfyui.db":
                from .host_database import inspect_host_database
                inspect_host_database(path, marker["roots"].values())
                continue
            result = inspect_database(path)
            if result.get("issues"):
                raise MigrationError("Profile database requires offline review/checkpoint.")
            records.extend(result.get("records", []))
        elif suffix == ".json":
            document = load_json(path)
            try:
                clean_json(document, max_bytes=64 * 1024 * 1024)
                _inspect_embedded_json(document)
            except InvalidInput:
                raise MigrationError("Sensitive or unsupported profile JSON requires private review.") from None
            # The same recursive reader covers root lists, rows/jobs containers,
            # workflow widgets, nested subgraphs and JSON serialized in strings.
            result = inspect_workflow_receipts(document)
            if result["issues"]:
                raise MigrationError("Profile JSON contains uninspectable task facts.")
            records.extend(result["records"])
        elif suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".mp4", ".webm", ".mov", ".mkv", ".wav", ".mp3", ".flac", ".ogg", ".docx"}:
            raise MigrationError("Unclassified runtime data must be reviewed before profile switching.")
    seen = {}
    for record in records:
        key = (record.get("provider"), record.get("requestId"))
        if key in seen and seen[key] != record["rawSha256"]:
            raise MigrationError("Conflicting task identities require explicit review.")
        seen[key] = record["rawSha256"]
        if not record.get("terminal"):
            # Stopped process alone cannot turn unknown work into a completed fact.
            match = any(isinstance(plan, dict) and plan.get("action") == "query_original_only" and
                        all(plan.get(key) == record.get(key) for key in ("requestId", "provider", "providerTaskId"))
                        for plan in marker["recoveryPlans"])
            if (not match or not record.get("providerTaskId") or not record.get("provider") or
                    record.get("retired") or record.get("queryOnlySwitchEligible") is not True or not record.get("recognized")):
                raise MigrationError("In-flight task has no exact query-only recovery plan.")


def seal_profile(workspace_path, profile_id, observation_id):
    workspace, root, marker = profile_identity(workspace_path, profile_id)
    if not re.fullmatch(r"[0-9a-f]{32}", observation_id):
        raise MigrationError("A collected runtime observation is required.")
    with operation_lock(workspace, "profiles"):
        observed = load_json(root / "runtime" / (observation_id + ".json"))
        current = active_profile(workspace)
        if (current["active"] != profile_id or observed.get("activeSequence") != current["sequence"] or
                observed.get("profileSha256") != json_hash(marker) or observed.get("observationId") != observation_id or
                observed.get("nativeQueueEmpty") is not True or observed.get("packageSha256") != json_hash(marker["package"]) or
                not 0 <= time.time() - observed["observedAt"] <= MAX_OBSERVATION_AGE):
            raise MigrationError("Quiescence observation is stale or belongs to another profile/session.")
        _verify_runtime_coverage(observed, marker)
        process = _process(observed["pid"])
        if process is not None and process["created"] == observed["processCreated"]:
            raise MigrationError("The observed host must be stopped explicitly before sealing.")
        if _bound_processes(marker):
            raise MigrationError("Another process still binds profile data roots.")
        if package_identity(marker["package"]["spec"]) != marker["package"]:
            raise MigrationError("Fixed package bytes changed before shutdown was sealed.")
        before, durable = _shutdown_inventory(root)
        if (json_hash(durable) != observed.get("durableInventorySha256") or durable != observed.get("durableInventory") or
                json_hash(observed.get("rawInventory")) != observed.get("inventorySha256")):
            raise MigrationError("Profile data changed after the empty-queue observation; collect fresh evidence.")
        _check_quiescent_data(root, marker)
        if profile_inventory(root) != before:
            raise MigrationError("Profile changed during offline inspection.")
        record = {"schemaVersion": 1, "profileSha256": json_hash(marker), "observationSha256": json_hash(observed),
                  "observationId": observation_id, "inventory": before, "inventorySha256": json_hash(before),
                  "activeSequence": current["sequence"], "packageSha256": json_hash(marker["package"])}
        folder = root / "seals"
        folder.mkdir(exist_ok=True)
        seal_id = json_hash(record)
        write_json(folder / (seal_id + ".json"), record)
        return {"sealId": seal_id, "profileId": profile_id, "inventorySha256": record["inventorySha256"]}


def _verify_seal(workspace, profile_id, seal_id, records):
    _, root, marker = profile_identity(workspace, profile_id)
    if package_identity(marker["package"]["spec"]) != marker["package"]:
        raise MigrationError("Profile code binding has changed.")
    data = profile_inventory(root)
    if _bound_processes(marker):
        raise MigrationError("A process still binds profile data roots.")
    visits = [record for record in records if record["profileId"] == profile_id]
    if not visits:
        if seal_id is not None or sorted(data, key=lambda item: item["path"]) != marker["initialInventory"]:
            raise MigrationError("A never-selected profile must match its complete initial snapshot.")
        _check_quiescent_data(root, marker)
        return root, marker, data
    if not isinstance(seal_id, str) or not re.fullmatch(r"[0-9a-f]{64}", seal_id):
        raise MigrationError("Previously selected profiles require collected shutdown evidence.")
    seal = load_json(root / "seals" / (seal_id + ".json"))
    if (json_hash(seal) != seal_id or seal.get("profileSha256") != json_hash(marker) or
            seal.get("activeSequence") != visits[-1]["sequence"] or seal.get("inventory") != data or
            seal.get("inventorySha256") != json_hash(data) or seal.get("packageSha256") != json_hash(marker["package"])):
        raise MigrationError("Shutdown evidence does not match current profile data/session.")
    observed = load_json(root / "runtime" / (seal["observationId"] + ".json"))
    if json_hash(observed) != seal["observationSha256"]:
        raise MigrationError("Runtime observation changed after sealing.")
    _verify_runtime_coverage(observed, marker)
    process = _process(observed["pid"])
    if process is not None and process["created"] == observed["processCreated"]:
        raise MigrationError("Observed runtime is still alive.")
    return root, marker, data


def _verify_runtime_coverage(observed, marker):
    proof = observed.get("runtimeCoverage")
    probe = marker["package"].get("observer")
    if not isinstance(proof, dict) or not probe:
        raise MigrationError("Legacy shutdown requires collected fenced runtime coverage.")
    runtime, fence = proof.get("runtime", {}), proof.get("fence", {})
    if (proof.get("schemaVersion") != 1 or proof.get("kind") != "legacy-runtime-quiescence" or
            proof.get("quiescence") != "clear" or proof.get("blockers") != [] or
            proof.get("profileRole") != marker["role"] or
            proof.get("coverageVersion") != probe["coverageVersion"] or proof.get("probeSourceSha256") != probe["probeSourceSha256"] or
            runtime.get("pid") != observed["pid"] or runtime.get("processCreated") != observed["processCreated"] or
            fence.get("active") is not True or fence.get("profileSha256") != json_hash(marker) or
            fence.get("profileRole") != marker["role"] or fence.get("pid") != observed["pid"] or
            fence.get("processCreated") != observed["processCreated"] or fence.get("coverageVersion") != "legacy-ingress-v1" or
            fence.get("activeSequence") != observed["activeSequence"] or
            fence.get("unreviewedEntrypoints") != [] or fence.get("acceptedAfterFence") != 0):
        raise MigrationError("Legacy point-in-time evidence cannot replace a verified ingress fence.")


def select_profile(workspace_path, operation_id, profile_id, *, expected_sequence, current_seal=None, target_seal=None,
                   rollback=False, fault=lambda point: None):
    workspace, owner = workspace_identity(workspace_path)
    identifier(operation_id)
    identifier(profile_id)
    with operation_lock(workspace, "profiles"):
        records = _events(workspace)
        previous = records[-1] if records else None
        request = {"operationId": operation_id, "profileId": profile_id, "expectedSequence": expected_sequence, "currentSeal": current_seal,
                   "targetSeal": target_seal, "rollback": bool(rollback)}
        repeated = next((record for record in records if record["operationId"] == operation_id), None)
        if repeated:
            if repeated["requestSha256"] != json_hash(request):
                raise MigrationError("Activation operation ID was reused for a different request.")
            return repeated
        if isinstance(expected_sequence, bool) or not isinstance(expected_sequence, int) or expected_sequence != len(records):
            raise MigrationError("Active descriptor changed; inspect the current selection before retrying.")
        if previous and previous["profileId"] == profile_id:
            raise MigrationError("Profile is already selected; use the original operation ID for retry.")
        root, marker, data = _verify_seal(workspace, profile_id, target_seal, records)
        preservation = None
        if previous:
            old_root, old_marker, old_data = _verify_seal(workspace, previous["profileId"], current_seal, records)
            if old_marker["role"] == "old" and marker["role"] == "new":
                # A fresh set can explicitly carry edits made while validating the
                # old host. Its complete backup and code identity must match the
                # still-selected old profile; merely naming another set is not enough.
                _, _, paired_old = profile_identity(workspace, marker["setId"] + "-old")
                if (_comparison_inventory(old_root, old_marker, old_data) != marker["comparisonInventory"] or
                        paired_old["comparisonInventory"] != marker["comparisonInventory"] or
                        paired_old["planSha256"] != marker["planSha256"] or
                        paired_old["package"] != old_marker["package"]):
                    raise MigrationError("Old profile changed after the new snapshot was prepared; prepare a fresh migration/profile set.")
            elif marker["setId"] != old_marker["setId"]:
                raise MigrationError("Profiles belong to different migration sets.")
            if rollback:
                if old_marker["role"] != "new" or marker["role"] != "old":
                    raise MigrationError("Rollback requires the selected new and its bound old profile.")
                folder = contained(workspace, "preservations")
                folder.mkdir(exist_ok=True)
                preservation_root = contained(folder, operation_id)
                preserved = {"owner": OWNER, "workspaceId": owner["workspaceId"], "operationId": operation_id,
                             "profileSha256": json_hash(old_marker), "activeSequence": previous["sequence"],
                             "inventory": old_data, "inventorySha256": json_hash(old_data)}
                if preservation_root.exists() and not (preservation_root / "manifest.json").exists():
                    parts = _metadata_parts(preservation_root, [preserved])
                    if not parts or {entry.name for entry in preservation_root.iterdir()} != parts:
                        raise MigrationError("Unknown preservation directory cannot be adopted.")
                preservation_root.mkdir(exist_ok=True)
                write_json(preservation_root / "manifest.json", preserved)
                copy_root = preservation_root / "data"
                _copy_tree(old_root, copy_root, old_data, fault, "active_new_preserved")
                write_json(preservation_root / "COMPLETE.json", {"manifestSha256": json_hash(preserved)})
                preservation = {"path": str(preservation_root), "manifestSha256": json_hash(preserved)}
                fault("active_new_preserved")
            elif old_marker["role"] == "new" and marker["role"] == "old":
                raise MigrationError("New-to-old selection must preserve data through rollback-profile.")
            if profile_inventory(old_root) != old_data:
                raise MigrationError("Active profile changed during selection; no descriptor was published.")
        elif rollback or current_seal is not None:
            raise MigrationError("There is no active profile to roll back.")
        if profile_inventory(root) != data:
            raise MigrationError("Target profile changed during selection.")
        if _bound_processes(marker) or previous and _bound_processes(old_marker):
            raise MigrationError("A profile runtime started before descriptor publication.")
        record = {"schemaVersion": 1, "owner": OWNER, "workspaceId": owner["workspaceId"],
                  "sequence": len(records) + 1, "previousSha256": json_hash(previous) if previous else None,
                  "operationId": operation_id, "requestSha256": json_hash(request), "profileId": profile_id,
                  "profileSha256": json_hash(marker), "roots": marker["roots"], "package": marker["package"],
                  "inventorySha256": json_hash(data), "preservation": preservation,
                  "state": "profile_selected", "serviceAction": "none", "hostAcceptance": False}
        folder = contained(workspace, "activation")
        folder.mkdir(exist_ok=True)
        fault("before_active_descriptor")
        write_json(folder / f"{record['sequence']:06}.json", record)
        fault("active_descriptor_published")
        return record
