"""Prepare or start a CPU-only ComfyUI acceptance host without touching production.

Only directories carrying this tool's ownership manifest can be reused. Package
copies are snapshots: refresh is explicit and requires the host port to be free.
This launcher does not run prompts, download models, start Ollama, or grant GPU
admission. --offline constrains ComfyUI; it is not a Python network firewall.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener


MARKER = "creative-studio-isolation.json"
OWNER = "creative-studio-cpu-host-v1"
PACKAGE_NAME = "ComfyUI-DAELab-Creative-Studio"
FIXTURE_NAME = "creative_studio_test_fixture"
EXCLUDED = {".git", ".local", ".github", ".pytest_cache", "__pycache__",
            "node_modules", "docs", "tests", "tools", "dev", ".codex", ".agents"}
DATA_NAMES = {"user", "input", "output", "temp", "models", "custom_nodes"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"}
RAW_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov",
                ".wav", ".mp3", ".ogg", ".flac", ".mkv", ".webm", ".avi",
                ".heic", ".docx", ".pdf", ".zip", ".safetensors", ".ckpt",
                ".pt", ".gguf"}


def excluded_file(file: Path) -> bool:
    name, suffix = file.name.casefold(), file.suffix.casefold()
    return (name == ".env" or name.startswith(".env.")
            or name.startswith(("credentials.", "secrets.", "client_secret", "api-key.", "api_key."))
            or name in {"auth.json", "token.json", "tokens.json", MARKER.casefold(), ".ds_store"}
            or suffix in PRIVATE_SUFFIXES | RAW_SUFFIXES
            or suffix.startswith((".sqlite", ".db")) or suffix in {".pyc", ".pyo", ".log"})


class IsolationError(ValueError):
    pass


def inside(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def resolve_configuration(source_host: str, python: str, environment_root: str,
                          package_root: str, port: int, fixture_package: str | None = None) -> dict:
    if not 1024 <= port <= 65535 or port == 8000:
        raise IsolationError("Use an unprivileged isolated port; production port 8000 is forbidden")
    paths = {key: Path(value).expanduser().resolve() for key, value in {
        "source_host": source_host, "python": python,
        "environment_root": environment_root, "package_root": package_root}.items()}
    host, executable, root, package = (paths[k] for k in
                                     ("source_host", "python", "environment_root", "package_root"))
    if not (host / "main.py").is_file() or not (host / "folder_paths.py").is_file():
        raise IsolationError("Source host must contain ComfyUI main.py and folder_paths.py")
    if (host / "extra_model_paths.yaml").exists():
        raise IsolationError("Source host has an implicit extra_model_paths.yaml; review/remove it in an isolated host copy first")
    if not executable.is_file():
        raise IsolationError("The requested Python executable does not exist")
    if not (package / "__init__.py").is_file():
        raise IsolationError("Package root must contain the single-package __init__.py entry")
    if inside(root, host) or inside(host, root) or inside(package, root):
        raise IsolationError("Environment must not overlap the source host or contain the package source")
    production = (Path.home() / "Documents" / "ComfyUI").resolve()
    if inside(root, production) or inside(production, root):
        raise IsolationError("The existing ComfyUI user workspace is protected")
    if root.name.casefold() in DATA_NAMES or root.parent.name.casefold() in DATA_NAMES - {"temp"}:
        raise IsolationError("Do not use an existing user/input/output/temp/models/custom_nodes directory")
    config = {key: str(value) for key, value in paths.items()}
    fixture = Path(fixture_package).expanduser().resolve() if fixture_package else None
    if fixture and (not (fixture / "__init__.py").is_file() or inside(fixture, root)):
        raise IsolationError("Explicit fixture package must be an external package with __init__.py")
    config.update({"owner": OWNER, "port": port, "cpu_only": True,
                   "fixture_package": str(fixture) if fixture else None})
    marker = root / MARKER
    if root.exists():
        if not root.is_dir() or not marker.is_file():
            raise IsolationError("Refusing an existing directory without this tool's ownership manifest")
        try:
            existing = json.loads(marker.read_text(encoding="utf-8"))
        except (ValueError, OSError) as error:
            raise IsolationError("Invalid isolation ownership manifest") from error
        if any(existing.get(key) != value for key, value in config.items()):
            raise IsolationError("Isolation manifest does not match the requested source, package, Python or port")
    if not port_free(port):
        raise IsolationError(f"Port {port} is already in use; no process was interrupted")
    return config


def package_files(package: Path) -> list[Path]:
    result = []
    for folder, directories, filenames in os.walk(package, followlinks=False):
        base = Path(folder)
        directories[:] = sorted(d for d in directories if d not in EXCLUDED
                                and not (base == package and d.casefold() in DATA_NAMES | {"evidence"}))
        for name in [*directories, *filenames]:
            candidate = base / name
            if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
                raise IsolationError(f"Package snapshot refuses links or junctions: {candidate.relative_to(package)}")
        result.extend(base / name for name in sorted(filenames) if not excluded_file(base / name))
    return result


def package_manifest(package: Path, files: list[Path]) -> dict:
    entries = [{"path": file.relative_to(package).as_posix(), "bytes": file.stat().st_size,
                "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in files]
    fingerprint = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    return {"sha256": fingerprint, "files": entries}


def command_for(config: dict) -> list[str]:
    root = Path(config["environment_root"])
    whitelist = [PACKAGE_NAME] + ([FIXTURE_NAME] if config.get("fixture_package") else [])
    return [config["python"], "-s", str(Path(config["source_host"]) / "main.py"),
            "--base-directory", str(root),
            "--user-directory", str(root / "user"),
            "--input-directory", str(root / "input"),
            "--output-directory", str(root / "output"),
            "--temp-directory", str(root / "temp"),
            "--database-url", "sqlite:///" + (root / "user" / "comfyui.db").as_posix(),
            "--listen", "127.0.0.1", "--port", str(config["port"]),
            "--cpu", "--offline", "--disable-all-custom-nodes",
            "--whitelist-custom-nodes", *whitelist,
            "--feature-flag", "enable_telemetry=false"]


def prepare(config: dict, refresh_package: bool = False) -> dict:
    root, package = Path(config["environment_root"]), Path(config["package_root"])
    files = package_files(package)
    snapshot = package_manifest(package, files)
    fixture = Path(config["fixture_package"]) if config.get("fixture_package") else None
    fixture_files = package_files(fixture) if fixture else []
    fixture_snapshot = package_manifest(fixture, fixture_files) if fixture else None
    marker = root / MARKER
    previous = json.loads(marker.read_text(encoding="utf-8")) if marker.exists() else {}
    if previous and previous.get("package_snapshot", {}).get("sha256") != snapshot["sha256"] and not refresh_package:
        raise IsolationError("Package changed: use a fresh environment or explicit --refresh-package with the host stopped")
    if previous and previous.get("fixture_snapshot") != fixture_snapshot and not refresh_package:
        raise IsolationError("Fixture changed: explicit --refresh-package is required with the host stopped")
    destination = root / "custom_nodes" / PACKAGE_NAME
    # Revalidate containment immediately before any recursive removal.
    if destination.exists() and (not inside(destination.resolve(), root.resolve())
                                 or destination.is_symlink()
                                 or getattr(destination, "is_junction", lambda: False)()):
        raise IsolationError("Package destination escapes the owned environment")
    root.mkdir(parents=True, exist_ok=True)
    for name in ("user", "input", "output", "temp", "models", "logs", "custom_nodes"):
        directory = root / name
        if directory.exists() and (directory.is_symlink()
                                   or getattr(directory, "is_junction", lambda: False)()):
            raise IsolationError(f"Isolation data directory cannot be a link: {name}")
        directory.mkdir(exist_ok=True)
    if destination.exists() and refresh_package:
        if not marker.is_file() or not port_free(config["port"]):
            raise IsolationError("Refresh requires an owned environment and a stopped host")
        shutil.rmtree(destination)
    if not destination.exists():
        destination.mkdir()
        for file in files:
            copied = destination / file.relative_to(package)
            copied.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, copied)
    copied_manifest = package_manifest(destination, package_files(destination))
    if copied_manifest != snapshot:
        raise IsolationError("Package snapshot does not match source; no host was started")
    if fixture:
        fixture_destination = root / "custom_nodes" / FIXTURE_NAME
        if fixture_destination.exists() and (not inside(fixture_destination.resolve(), root.resolve())
                                            or fixture_destination.is_symlink()
                                            or getattr(fixture_destination, "is_junction", lambda: False)()):
            raise IsolationError("Fixture destination escapes the owned environment")
        if fixture_destination.exists() and refresh_package:
            if not marker.is_file() or not port_free(config["port"]):
                raise IsolationError("Fixture refresh requires an owned environment and a stopped host")
            shutil.rmtree(fixture_destination)
        if not fixture_destination.exists():
            fixture_destination.mkdir()
            for file in fixture_files:
                copied = fixture_destination / file.relative_to(fixture)
                copied.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, copied)
        if package_manifest(fixture_destination, package_files(fixture_destination)) != fixture_snapshot:
            raise IsolationError("Fixture snapshot does not match source; no host was started")
    manifest = {**config, "package_snapshot": snapshot, "command": command_for(config),
                "fixture_snapshot": fixture_snapshot,
                "prepared_at_unix": time.time(), "status": "prepared",
                "limitations": ["CPU host only; no generation was requested",
                                "ComfyUI offline mode is not a Python network firewall",
                                "GPU hosts require external coordination with production"]}
    marker.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def start(manifest: dict, timeout: float = 90) -> dict:
    root = Path(manifest["environment_root"])
    if not port_free(manifest["port"]):
        raise IsolationError("Port became occupied before startup; no process was interrupted")
    stamp = str(time.time_ns())
    stdout, stderr = root / "logs" / f"{stamp}.stdout.log", root / "logs" / f"{stamp}.stderr.log"
    options = {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    with stdout.open("wb") as out, stderr.open("wb") as err:
        process = subprocess.Popen(manifest["command"], cwd=manifest["source_host"],
                                   stdout=out, stderr=err, stdin=subprocess.DEVNULL, **options)
    manifest.update({"pid": process.pid, "status": "starting", "stdout": str(stdout), "stderr": str(stderr)})
    marker = root / MARKER
    marker.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise IsolationError(f"Isolated host exited with {process.returncode}; inspect {stderr}")
        try:
            with opener.open(f"http://127.0.0.1:{manifest['port']}/system_stats", timeout=2) as response:
                stats = json.load(response)
            argv = stats.get("system", {}).get("argv", [])
            if str(root) not in argv or "--cpu" not in argv:
                raise IsolationError("Unexpected host identity on the isolated port")
            manifest.update({"status": "running", "system_stats": stats})
            marker.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            return manifest
        except (OSError, ValueError) as error:
            if isinstance(error, IsolationError):
                raise
        time.sleep(0.5)
    raise IsolationError(f"Startup timed out; inspect PID {process.pid} and {stderr}; no process was interrupted")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("source-host", "python", "environment-root", "package-root"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--fixture-package", help="Explicit test-only custom node package; absent from the production default")
    parser.add_argument("--start", action="store_true", help="Start CPU-only host after preparing the snapshot")
    parser.add_argument("--refresh-package", action="store_true", help="Replace only the owned package snapshot while host is stopped")
    args = parser.parse_args()
    try:
        config = resolve_configuration(args.source_host, args.python, args.environment_root, args.package_root, args.port, args.fixture_package)
        manifest = prepare(config, args.refresh_package)
        if args.start:
            manifest = start(manifest)
        print(json.dumps({key: manifest.get(key) for key in ("status", "environment_root", "port", "pid", "stdout", "stderr")}, indent=2))
        return 0
    except (IsolationError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
