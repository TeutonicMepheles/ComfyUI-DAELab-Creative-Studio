"""Immutable old-version CPU baseline fixture. Never installs a production package.

The two complete old repositories exist only below ignored .local/ fixture roots.
No workflows, task receipts, user data, model paths or ComfyTV are imported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import socket
import stat
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OWNER = "creative-studio-old-baseline-v1"
MARKER = "old-baseline-owner.json"
PINNED = {
    "canvas": ("ComfyUI-DAELab-Creative-Canvas", "3176b5a67dbcd0b66f795976e5a81bcdfe346093"),
    "business": ("ComfyUI-DAELab-Custom-Nodes-Library", "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"),
}
HOST_COMMIT = "3c1b7a17fdf239d35ce98cc777756f572d089795"
PROTECTED_PORTS = {8000, 8224, 8226}
DATA_NAMES = {"user", "input", "output", "temp", "models", "custom_nodes"}


class BaselineError(ValueError):
    pass


def _json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _write_new(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def _sha(file):
    digest = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _git(source, *args):
    result = subprocess.run(["git", "-C", str(source), *args], check=False, capture_output=True)
    if result.returncode:
        raise BaselineError("Git baseline verification failed; no source data was modified.")
    return result.stdout


def _linked(path):
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def _plain_ancestors(path):
    absolute = Path(os.path.abspath(path))
    for candidate in [absolute, *absolute.parents]:
        if candidate.exists() and _linked(candidate):
            raise BaselineError("Fixture paths cannot traverse symlinks or junctions.")
    return absolute.resolve()


def _overlap(a, b):
    return a == b or a in b.parents or b in a.parents


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def resolve_configuration(runtime_file, environment_root, archive_root, port=8225):
    runtime = _json(runtime_file)
    if not isinstance(port, int) or not 1024 <= port <= 65535 or port in PROTECTED_PORTS:
        raise BaselineError("Use a dedicated unprivileged port; 8000/8224/8226 are protected.")
    environment, archive = _plain_ancestors(environment_root), _plain_ancestors(archive_root)
    host = Path(runtime["host"]["root"]).resolve()
    executable = Path(runtime["host"]["python"]).resolve()
    sources = {}
    for label, (name, commit) in PINNED.items():
        entry = runtime["sourceBaselines"][label]
        if entry["commit"] != commit:
            raise BaselineError("Runtime manifest does not identify the approved old source commits.")
        source = Path(entry["path"]).resolve()
        if Path(_git(source, "rev-parse", "--show-toplevel").decode().strip()).resolve() != source:
            raise BaselineError("Source path is not its repository root.")
        if _git(source, "rev-parse", commit+"^{commit}").decode().strip() != commit:
            raise BaselineError("Source commit did not resolve to the approved immutable revision.")
        remote = _git(source, "remote", "get-url", "origin").decode().strip()
        allowed = {f"https://github.com/TeutonicMepheles/{name}.git", f"https://github.com/TeutonicMepheles/{name}", f"git@github.com:TeutonicMepheles/{name}.git"}
        if remote not in allowed:
            raise BaselineError("Source repository origin differs from the approved owner/name.")
        sources[label] = {"name": name, "commit": commit, "path": str(source), "origin": remote}
    if not executable.is_file() or not (host / "main.py").is_file() or not (host / "folder_paths.py").is_file():
        raise BaselineError("Recorded ComfyUI host/Python entry points are unavailable.")
    if runtime["host"]["gitHead"] != HOST_COMMIT or _git(host, "rev-parse", "HEAD").decode().strip() != HOST_COMMIT or _git(host, "status", "--porcelain").strip():
        raise BaselineError("Host revision or clean-source state changed from the recorded baseline.")
    if (host / "extra_model_paths.yaml").exists():
        raise BaselineError("Host has a global extra-model-paths configuration; do not expose production paths.")
    protected = [host, *(Path(s["path"]) for s in sources.values()), (Path.home() / "Documents/ComfyUI").resolve(), ROOT / ".local/host-new", ROOT / ".local/host-new-fixture"]
    if _overlap(environment, archive) or any(_overlap(p, root) for p in [environment, archive] for root in protected):
        raise BaselineError("Fixture roots must not overlap protected production, source or active host paths.")
    for destination in (environment, archive):
        if destination.name.casefold() in DATA_NAMES or destination.parent.name.casefold() in DATA_NAMES - {"temp"}:
            raise BaselineError("Do not adopt an existing ComfyUI data directory.")
    config = {"owner": OWNER, "runtime_file": str(Path(runtime_file).resolve()), "source_host": str(host), "python": str(executable), "environment_root": str(environment), "archive_root": str(archive), "port": port, "sources": sources, "host_commit": HOST_COMMIT, "cpu_only": True, "models_shared": False}
    for destination in (environment, archive):
        if destination.exists():
            if not destination.is_dir() or not (destination / MARKER).is_file():
                raise BaselineError("Existing fixture directory lacks matching ownership; no overwrite or cleanup is permitted.")
            if _json(destination / MARKER) != config:
                raise BaselineError("Existing baseline fixture ownership/configuration does not match.")
    if not port_free(port):
        raise BaselineError("Baseline port is occupied; no process was interrupted.")
    return config


def archive_members(archive):
    """Validate the complete ZIP before writing any extracted member."""
    records, seen = [], set()
    with zipfile.ZipFile(archive) as zipped:
        total = 0
        if len(zipped.infolist()) > 100000:
            raise BaselineError("Baseline archive entry count exceeds the fixture limit.")
        for member in zipped.infolist():
            name = member.filename
            if member.orig_filename != name:
                raise BaselineError("Archive filename normalization is not allowed.")
            parts = name.rstrip("/").split("/")
            windows = PureWindowsPath(name)
            if not name or "\\" in name or "\x00" in name or ":" in name or name.startswith("/") or windows.drive or any(p in {"", "..", "."} or p.endswith((".", " ")) or re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", p, re.IGNORECASE) for p in parts):
                raise BaselineError("Archive member path escaped the fixture.")
            key = name.rstrip("/").casefold()
            if key in seen:
                raise BaselineError("Archive contains duplicate or case-colliding paths.")
            seen.add(key)
            mode = member.external_attr >> 16
            file_type = stat.S_IFMT(mode)
            if file_type not in {0, stat.S_IFREG, stat.S_IFDIR} or member.flag_bits & 1:
                raise BaselineError("Archive links, special files and encrypted entries are forbidden.")
            if member.is_dir():
                continue
            total += member.file_size
            if member.file_size > 256 * 1024**2 or total > 512 * 1024**2:
                raise BaselineError("Baseline archive exceeds the fixture size limit.")
            content = zipped.read(member)
            records.append({"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    if not any(record["path"] == "__init__.py" for record in records):
        raise BaselineError("Old package archive has no root registration entry.")
    return records


def extract_new(archive, destination, records):
    destination = _plain_ancestors(destination)
    if destination.exists():
        raise BaselineError("Existing extracted baseline is never replaced.")
    checked = archive_members(archive)
    if checked != records:
        raise BaselineError("Archive changed after preflight.")
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as zipped:
        for record in records:
            target = destination / record["path"]
            if not target.resolve().is_relative_to(destination):
                raise BaselineError("Archive destination escaped the owned fixture.")
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(zipped.read(record["path"]))


def verify_snapshot(directory, records):
    expected = {record["path"]: record for record in records}
    actual = {}
    for base, directories, files in os.walk(directory, followlinks=False):
        root = Path(base)
        for name in [*directories, *files]:
            if _linked(root / name):
                raise BaselineError("Extracted baseline contains a link or junction.")
        for name in files:
            file = root / name
            relative = file.relative_to(directory).as_posix()
            actual[relative] = {"path": relative, "bytes": file.stat().st_size, "sha256": _sha(file)}
    if actual != expected:
        raise BaselineError("Extracted baseline changed; no refresh, overwrite or startup was performed.")


def command_for(config):
    root = Path(config["environment_root"])
    return [config["python"], "-s", str(Path(config["source_host"]) / "main.py"),
            "--base-directory", str(root), "--user-directory", str(root / "user"),
            "--input-directory", str(root / "input"), "--output-directory", str(root / "output"),
            "--temp-directory", str(root / "temp"),
            "--database-url", "sqlite:///" + (root / "user/comfyui.db").as_posix(),
            "--listen", "127.0.0.1", "--port", str(config["port"]), "--cpu", "--offline",
            "--disable-auto-launch", "--disable-all-custom-nodes", "--whitelist-custom-nodes",
            *[entry["name"] for entry in config["sources"].values()], "--feature-flag", "enable_telemetry=false"]


def prepare(config):
    if resolve_configuration(config["runtime_file"], config["environment_root"], config["archive_root"], config["port"]) != config:
        raise BaselineError("Configuration changed after validation.")
    root, archive_root = Path(config["environment_root"]), Path(config["archive_root"])
    if not port_free(config["port"]):
        raise BaselineError("Baseline port became occupied; nothing was interrupted.")
    # Recheck all roots before mutations; callers cannot bypass the configuration guard.
    for destination in (root, archive_root):
        _plain_ancestors(destination)
        if destination.exists() and (not (destination / MARKER).is_file() or _json(destination / MARKER) != config):
            raise BaselineError("Existing baseline directory is not owned by this exact configuration.")
    manifest_path = root / "prepared.json"
    if manifest_path.exists():
        manifest = _json(manifest_path)
        for entry in manifest["snapshots"]:
            if _sha(entry["archive"]) != entry["archive_sha256"]:
                raise BaselineError("Stored Git archive changed.")
            verify_snapshot(root / "custom_nodes" / entry["name"], entry["files"])
        return manifest
    if root.exists() or archive_root.exists():
        raise BaselineError("Incomplete existing fixture is preserved; use an explicitly chosen new owned location.")
    for destination in (root, archive_root):
        destination.mkdir(parents=True)
        _write_new(destination / MARKER, config)
    for name in ("user", "input", "output", "temp", "models", "custom_nodes", "logs", "evidence"):
        (root / name).mkdir()
    snapshots = []
    for source in config["sources"].values():
        tree = _git(source["path"], "ls-tree", "-rz", source["commit"])
        for row in tree.split(b"\x00"):
            if row and not row.startswith((b"100644 blob ", b"100755 blob ")):
                raise BaselineError("Source snapshot contains links or submodules; preserve and inspect it explicitly.")
        archive = archive_root / (source["name"] + "-" + source["commit"] + ".zip")
        with archive.open("xb") as stream:
            result = subprocess.run(["git", "-C", source["path"], "archive", "--format=zip", source["commit"]], stdout=stream, stderr=subprocess.PIPE)
        if result.returncode:
            raise BaselineError("Git archive failed; partial fixture is preserved, not reused.")
        records = archive_members(archive)
        destination = root / "custom_nodes" / source["name"]
        extract_new(archive, destination, records)
        verify_snapshot(destination, records)
        snapshots.append({"name": source["name"], "source_commit": source["commit"], "archive": str(archive), "archive_sha256": _sha(archive), "files": records})
    manifest = {"configuration": config, "snapshots": snapshots, "command": command_for(config), "prepared_at_unix": time.time(), "status": "prepared", "workflow_imports": 0, "task_receipt_imports": 0, "generation_requests": 0, "model_downloads": 0}
    _write_new(manifest_path, manifest)
    return manifest


def _get(port, route):
    opener = build_opener(ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}{route}", timeout=3) as response:
        return json.load(response)


def _child_environment():
    environment = dict(os.environ)
    for key in list(environment):
        if key.upper() in {"PYTHONPATH", "PYTHONSTARTUP"} or re.search(r"(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)$", key.upper()):
            environment.pop(key)
    environment.update({"PYTHONDONTWRITEBYTECODE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    return environment


def verify_host_identity(stats, manifest):
    config = manifest["configuration"]
    argv = stats.get("system", {}).get("argv", [])
    if argv != manifest["command"][2:]:
        raise BaselineError("Unexpected command identity on the baseline port.")
    system = stats["system"]
    for key, expected in {"comfyui_version": "0.39.2", "required_frontend_version": "1.53.10", "pytorch_version": "2.8.0+cu129"}.items():
        if system.get(key) != expected:
            raise BaselineError("Host runtime versions differ from the approved reference.")
    if not system.get("python_version", "").startswith("3.12.11 "):
        raise BaselineError("Host Python differs from the approved reference.")
    if any(device.get("type") != "cpu" for device in stats.get("devices", [])):
        raise BaselineError("Baseline host is not CPU-only.")
    return config


def start(manifest, timeout=60):
    config = manifest["configuration"]
    if resolve_configuration(config["runtime_file"], config["environment_root"], config["archive_root"], config["port"]) != config or manifest["command"] != command_for(config):
        raise BaselineError("Prepared command or configuration changed before startup.")
    root = Path(config["environment_root"])
    if not port_free(config["port"]):
        raise BaselineError("Baseline port became occupied; no process was interrupted.")
    for entry in manifest["snapshots"]:
        verify_snapshot(root / "custom_nodes" / entry["name"], entry["files"])
    stamp = str(time.time_ns())
    stdout, stderr = root / "logs" / f"{stamp}.stdout.log", root / "logs" / f"{stamp}.stderr.log"
    options = {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    with stdout.open("xb") as out, stderr.open("xb") as err:
        process = subprocess.Popen(manifest["command"], cwd=config["source_host"], env=_child_environment(), stdin=subprocess.DEVNULL, stdout=out, stderr=err, **options)
    attempt = {"pid": process.pid, "status": "starting", "command": manifest["command"], "stdout": str(stdout), "stderr": str(stderr), "started_at_unix": time.time()}
    _write_new(root / "evidence" / f"{stamp}-start.json", attempt)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            _write_new(root / "evidence" / f"{stamp}-failed.json", {**attempt, "status": "failed", "exit_code": process.returncode})
            raise BaselineError(f"Old baseline host exited; inspect {stderr}")
        try:
            stats = _get(config["port"], "/system_stats")
            verify_host_identity(stats, manifest)
            object_info, queue = _get(config["port"], "/object_info"), _get(config["port"], "/queue")
            allowed = {entry["name"] for entry in config["sources"].values()}
            registered = {name: data.get("python_module") for name, data in object_info.items() if str(data.get("python_module", "")).startswith("custom_nodes.")}
            if any(not any(package in module for package in allowed) for module in registered.values()):
                raise BaselineError("An unapproved custom node package entered the old baseline.")
            expected = {"DAELAB.MediaUpload", "DAELAB.TextInput", "DAELAB.MaterialGroup", "DAELAB.VideoEdit", "DAELAB.Table", "DAELAB.ScriptParser", "DAELAB.StoryboardImport", "DAELAB.LibTV.VideoGenerate", "DAELAB.LLMStylePreviewB"}
            if not expected.issubset(object_info) or len(registered) != 74:
                raise BaselineError("Old baseline registration differs from the expected 74 backend node IDs.")
            if queue.get("queue_running") or queue.get("queue_pending"):
                raise BaselineError("Unexpected task appeared in the baseline queue; no interruption was issued.")
            _write_new(root / "evidence" / f"{stamp}-system-stats.json", stats)
            _write_new(root / "evidence" / f"{stamp}-object-info.json", object_info)
            report = {**attempt, "status": "running", "url": f"http://127.0.0.1:{config['port']}", "registrations": registered, "backend_node_count": len(registered), "queue": queue, "generation_requests_by_launcher": 0, "workflow_imports_by_launcher": 0, "task_receipt_imports": 0, "models_shared": False, "comfytv_bundled": False, "sources": [{"name": entry["name"], "commit": entry["source_commit"], "archive_sha256": entry["archive_sha256"]} for entry in manifest["snapshots"]], "limitations": ["CPU UI baseline only; no inference or product acceptance", "ComfyUI --offline restricts frontend/partner nodes, not a process-wide network firewall", "Do not click generation, local model setup or recovery controls in this behavior fixture"]}
            _write_new(root / "evidence" / f"{stamp}-ready.json", report)
            return report
        except BaselineError:
            raise
        except (OSError, ValueError):
            time.sleep(0.5)
    _write_new(root / "evidence" / f"{stamp}-timeout.json", {**attempt, "status": "timeout"})
    raise BaselineError(f"Old baseline startup timed out; inspect owned PID {process.pid}; nothing was interrupted.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", default=str(ROOT / ".local/baseline/runtime.json"))
    parser.add_argument("--environment-root", default=str(ROOT / ".local/host-old"))
    parser.add_argument("--archive-root", default=str(ROOT / ".local/baseline-code"))
    parser.add_argument("--port", type=int, default=8225)
    parser.add_argument("--start", action="store_true")
    args = parser.parse_args()
    try:
        manifest = prepare(resolve_configuration(args.runtime, args.environment_root, args.archive_root, args.port))
        result = start(manifest) if args.start else {"status": "prepared", "environment_root": args.environment_root}
        print(json.dumps({key: result[key] for key in ("status", "url", "pid", "stdout", "stderr", "backend_node_count", "environment_root") if key in result}, indent=2))
        return 0
    except (BaselineError, OSError, KeyError, ValueError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
