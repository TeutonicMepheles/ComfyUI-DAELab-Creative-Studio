"""Assisted local model configuration: manual scan + hash reverse-lookup + human confirm.

The host never discovers or downloads models on its own. This module only turns
a *known* model manifest (``family/category/name/bytes/sha256``, one entry per
supported model × quantization) and a manual scan of ComfyUI's model
directories into a *suggested* ``local-generation.json``. Nothing is applied
until the user confirms, and nothing is ever matched by filename alone: a
file's identity is its content hash, so a same-name-but-different-hash file is
surfaced as a conflict for a human to decide.

The manifest lives next to this module (``model_manifest.json``) and carries no
machine paths. Scanning only fills the missing ``path`` back in.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

# Mirror ``backend/providers/native.py``: the binding category key is not always
# the ComfyUI model directory name. Reuse the same mapping so a model that is
# actually present is never reported as missing just because the scan looked in
# the wrong directory.
CATEGORY_DIR = {"mmproj": "text_encoders", "video_vae": "vae", "audio_vae": "vae"}

# The fixed local families, exactly as ``local_generation.read_configuration``
# accepts them. A scan only fills entries already allowed by the schema.
SUPPORTED_FAMILIES = frozenset({
    "image", "image_base", "video", "video_base", "video_reference",
    "video_reference_base", "text_pe", "text_27b", "video_high", "video_reference_high",
})

MANIFEST_PATH = Path(__file__).with_name("model_manifest.json")
SUGGESTED_FILENAME = "local-generation.suggested.json"
CONFIG_FILENAME = "local-generation.json"


def _config_directory(user_directory) -> Path:
    return Path(user_directory).resolve() / "daelab" / "creative-studio"


def _default_resource_lock(user_directory) -> str:
    """A machine-owned admission lock used when no existing config supplies one."""
    return str(_config_directory(user_directory) / "resource.lock")


def _basename(name: str) -> str:
    return name.replace("\\", "/").rsplit("/", 1)[-1]


def load_manifest() -> list[dict]:
    """Read the known model manifest; raise ``ValueError`` on any structural problem."""
    with MANIFEST_PATH.open("rb") as stream:
        data = json.loads(stream.read().decode("utf-8-sig"))
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise ValueError("model_manifest.json must be an object with an entries list")
    entries = []
    for item in data["entries"]:
        if not isinstance(item, dict):
            raise ValueError("Each model manifest entry must be an object")
        missing = {"family", "category", "name", "bytes", "sha256"} - item.keys()
        if missing:
            raise ValueError(f"Model manifest entry is missing {sorted(missing)}: {item!r}")
        family = item["family"]
        if family not in SUPPORTED_FAMILIES:
            raise ValueError(f"Unknown model manifest family: {family!r}")
        if item["category"] not in ("diffusion_models", "text_encoders", "mmproj", "vae", "video_vae", "audio_vae", "loras"):
            raise ValueError(f"Unknown model manifest category: {item['category']!r}")
        if not isinstance(item["name"], str) or not item["name"].strip():
            raise ValueError("Model manifest entry name must be a non-empty string")
        if type(item["bytes"]) is not int or item["bytes"] <= 0:
            raise ValueError("Model manifest entry bytes must be a positive integer")
        if not isinstance(item["sha256"], str) or len(item["sha256"]) != 64 or not all(c in "0123456789abcdef" for c in item["sha256"]):
            raise ValueError("Model manifest entry sha256 must be 64 lowercase hex characters")
        entries.append(item)
    return entries


def discover(folder_paths, entries: list[dict]) -> dict:
    """Enumerate candidate files per manifest entry by name.

    ``folder_paths`` is ComfyUI's ``folder_paths`` module. ``name`` is the raw
    string ``get_filename_list`` returns (a subdirectory file keeps its
    relative prefix), never a basename, so a later ``get_full_path`` resolves
    back to the same file. A same-name file is a candidate regardless of its
    size: a size difference is a strong "wrong quantization/version" signal
    that must be surfaced as a conflict, not silently treated as missing.
    """
    candidates: dict[tuple[str, str], list[dict]] = {}
    for entry in entries:
        key = (entry["family"], entry["category"])
        directory = CATEGORY_DIR.get(entry["category"], entry["category"])
        found: list[dict] = []
        for name in folder_paths.get_filename_list(directory):
            if _basename(name) != entry["name"]:
                continue
            full = folder_paths.get_full_path(directory, name)
            if not full:
                continue
            path = Path(full)
            try:
                size = path.stat().st_size
            except OSError:
                continue
            found.append({"name": name, "path": str(path), "bytes": size})
        candidates[key] = found
    return candidates


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def match(candidates: dict, entries: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Hash each unique candidate file once and classify every manifest entry.

    Returns ``(hits, conflicts, missing)``. A hit reuses the manifest's
    ``sha256`` and adds the discovered path; a conflict is a same-name file
    whose content hash differs (a different quantization/version) or whose size
    differs from the manifest; a missing entry had no matching file at all.
    """
    # Hash each distinct file once, even when several families share it.
    hashes: dict[str, str] = {}
    for found in candidates.values():
        for candidate in found:
            path = candidate["path"]
            if path not in hashes:
                try:
                    hashes[path] = _hash_file(Path(path))
                except OSError:
                    hashes[path] = None

    hits: list[dict] = []
    conflicts: list[dict] = []
    missing: list[dict] = []
    for entry in entries:
        key = (entry["family"], entry["category"])
        found = candidates.get(key, [])
        if not found:
            missing.append({"family": entry["family"], "category": entry["category"], "name": entry["name"]})
            continue
        candidate = found[0]
        actual = hashes.get(candidate["path"])
        if actual is None:
            missing.append({"family": entry["family"], "category": entry["category"], "name": entry["name"]})
            continue
        if actual == entry["sha256"]:
            hits.append({"family": entry["family"], "category": entry["category"],
                         "name": candidate["name"], "path": candidate["path"], "sha256": entry["sha256"]})
        else:
            conflicts.append({"family": entry["family"], "category": entry["category"],
                              "name": candidate["name"], "path": candidate["path"],
                              "expectedSha256": entry["sha256"], "actualSha256": actual,
                              "expectedBytes": entry["bytes"], "actualBytes": candidate["bytes"],
                              "sizeMismatch": candidate["bytes"] != entry["bytes"]})
    return hits, conflicts, missing


def suggest(hits: list[dict], conflicts: list[dict], *, existing_config, user_directory) -> dict:
    """Build a complete ``schemaVersion:1`` config from scan results.

    When an existing config is present, only the scanned ``modelBindings``
    entries are overridden; ``schemaVersion``/``enabled``/``resourceLock``/
    ``qwenBinding`` are preserved. A new machine gets a minimal complete config
    (no ``qwenBinding``) and a machine-owned default resource lock.
    """
    scanned: dict[str, dict] = {}
    for hit in hits:
        scanned.setdefault(hit["family"], {})[hit["category"]] = {
            "name": hit["name"], "path": hit["path"], "sha256": hit["sha256"],
        }
    for conflict in conflicts:
        scanned.setdefault(conflict["family"], {})[conflict["category"]] = {
            "name": conflict["name"], "path": conflict["path"], "sha256": conflict["actualSha256"],
        }

    if existing_config is not None:
        merged = {family: dict(categories) for family, categories in existing_config["modelBindings"].items()}
        for family, categories in scanned.items():
            merged.setdefault(family, {}).update(categories)
        config = {
            "schemaVersion": 1,
            "enabled": True,
            "resourceLock": existing_config["resourceLock"],
            "modelBindings": merged,
        }
        if existing_config.get("qwenBinding") is not None:
            config["qwenBinding"] = existing_config["qwenBinding"]
        return config

    return {
        "schemaVersion": 1,
        "enabled": True,
        "resourceLock": _default_resource_lock(user_directory),
        "modelBindings": scanned,
    }


def write_suggested(config: dict, user_directory) -> Path:
    """Write the preview file the UI renders; it is never read by the host."""
    directory = _config_directory(user_directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / SUGGESTED_FILENAME
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def confirm(config: dict, user_directory) -> Path:
    """Overwrite ``local-generation.json`` with the confirmed config."""
    directory = _config_directory(user_directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / CONFIG_FILENAME
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def read_existing(user_directory):
    """Return the parsed, normalized existing config or ``None``.

    Reuses the production reader so merging starts from exactly the same
    validated shape the host accepts. An invalid existing file is surfaced as a
    ``ValueError``; the scan does not silently discard a broken config.
    """
    from .local_generation import read_configuration
    return read_configuration(user_directory)


class ModelScan:
    """HTTP surface for the manual scan and confirm actions."""

    def __init__(self, server, root: Path, folder_paths):
        self.server = server
        self.root = root
        self.folder_paths = folder_paths
        self.routes = (("POST", "/daelab/studio/scan-models", self.scan),
                       ("POST", "/daelab/studio/apply-models", self.apply))

    async def scan(self, request):
        from aiohttp import web
        try:
            entries = load_manifest()
            existing = read_existing(self.folder_paths.get_user_directory())
            candidates = discover(self.folder_paths, entries)
            hits, conflicts, missing = match(candidates, entries)
            suggested = suggest(hits, [], existing_config=existing, user_directory=self.folder_paths.get_user_directory())
            write_suggested(suggested, self.folder_paths.get_user_directory())
        except (OSError, ValueError, TypeError) as error:
            return web.json_response({"schemaVersion": 1, "error": str(error)}, status=500)
        # Keep the full scan (with conflict details) for the confirm step; the
        # suggested.json preview only holds the certain hits.
        self.server._creative_studio_model_scan = {
            "hits": hits, "conflicts": conflicts, "missing": missing,
            "existing_config": existing,
        }
        return web.json_response({
            "schemaVersion": 1,
            "hits": hits,
            "conflicts": conflicts,
            "missing": missing,
            "suggestedWritten": True,
        })

    async def apply(self, request):
        from aiohttp import web
        state = getattr(self.server, "_creative_studio_model_scan", None)
        if state is None:
            return web.json_response({"schemaVersion": 1, "error": "没有可应用的扫描结果，请先点击「扫描模型」。"}, status=409)
        try:
            body = await request.json()
        except (ValueError, TypeError):
            body = {}
        adopt = body.get("adoptConflicts") if isinstance(body, dict) else None
        if adopt is not None and (not isinstance(adopt, list) or not all(isinstance(item, dict) and item.get("family") and item.get("category") for item in adopt)):
            return web.json_response({"schemaVersion": 1, "error": "adoptConflicts 必须是包含 family/category 的对象数组。"}, status=400)
        adopted = []
        if adopt:
            chosen = {(item["family"], item["category"]) for item in adopt}
            adopted = [conflict for conflict in state["conflicts"] if (conflict["family"], conflict["category"]) in chosen]
        try:
            config = suggest(state["hits"], adopted, existing_config=state["existing_config"],
                             user_directory=self.folder_paths.get_user_directory())
            confirm(config, self.folder_paths.get_user_directory())
        except (OSError, ValueError, TypeError) as error:
            return web.json_response({"schemaVersion": 1, "error": str(error)}, status=500)
        return web.json_response({"schemaVersion": 1, "applied": True, "restartRequired": True})


def register_model_scan(server, root: Path):
    """Register the scan/apply routes once, fail-closed on a route clash."""
    previous = getattr(server, "_creative_studio_model_scan_service", None)
    if previous is not None:
        return previous
    import folder_paths
    instance = ModelScan(server, root, folder_paths)
    existing = {(route.method, route.path) for route in server.routes
                if hasattr(route, "method") and hasattr(route, "path")}
    for method, route, _handler in instance.routes:
        if (method, route) in existing:
            raise RuntimeError(f"Creative Studio route already owned: {method} {route}")
    for method, route, handler in instance.routes:
        server.routes.route(method, route)(handler)
    server._creative_studio_model_scan_service = instance
    return instance
