"""Read-only diagnostics; optional provider modules are never imported at startup."""
import hashlib
import json
import re
from pathlib import Path
import tomllib


def product_metadata(root: Path) -> dict:
    try:
        config = tomllib.loads((root / "pyproject.toml").read_text("utf-8"))
        version = config["project"]["version"]
        if not isinstance(version, str):
            raise ValueError("Invalid package version")
    except (OSError, ValueError, KeyError, TypeError):
        return {"version": None, "frontendVersion": None, "buildFingerprint": None,
                "compatible": False, "reason": "Python package metadata is missing or invalid; reinstall the product package."}
    manifest_path = root / "web" / "build-manifest.json"
    if not manifest_path.is_file():
        return {"version": version, "frontendVersion": None,
                "buildFingerprint": None, "compatible": False,
                "reason": "Frontend build manifest is missing; install the built product package."}
    try:
        raw = manifest_path.read_bytes()
        manifest = json.loads(raw)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("version"), str):
            raise ValueError("Invalid frontend metadata")
        if not isinstance(manifest.get("sourceFingerprint"), str) or not re.fullmatch(r"[0-9a-f]{64}", manifest["sourceFingerprint"]):
            raise ValueError("Invalid frontend build identity")
    except (OSError, ValueError, TypeError):
        return {"version": version, "frontendVersion": None, "buildFingerprint": None,
                "compatible": False, "reason": "Frontend build manifest is invalid or unreadable; reinstall the built product package."}
    frontend_version = manifest.get("version")
    compatible = version.replace(".dev", "-dev.") == frontend_version
    return {"version": version, "frontendVersion": frontend_version,
            "frontendBuildId": manifest["sourceFingerprint"],
            "buildFingerprint": hashlib.sha256(raw).hexdigest(), "compatible": compatible,
            "reason": None if compatible else "Python and frontend versions differ; reinstall a matching package and refresh cached frontend assets."}


def capabilities(services_available=False, storage_error=None, integrated=()) -> list[dict]:
    # Missing services remain explicit rather than being simulated as successful.
    return [
        {"id": "core", "available": True, "reason": None},
        {"id": "canvas-shell", "available": True, "reason": None},
        *[{"id": name, "available": services_available, "reason": None if services_available else (storage_error or "Persistent services are not assembled.")}
          for name in ("assets", "jobs")],
        *[{"id": name, "available": name in integrated,
           "reason": None if name in integrated else "Implementation has not been integrated into this build."}
          for name in ("canvas", "table", "storyboard", "prompt-configuration", "prompt", "generation", "editor")],
    ]


class Diagnostics:
    def __init__(self, root: Path, server):
        self.root = root
        self.server = server
        self.routes = (("GET", "/daelab/studio/health", self.health),
                       ("GET", "/daelab/studio/capabilities", self.read_capabilities))

    async def health(self, request):
        from aiohttp import web
        metadata = product_metadata(self.root)
        return web.json_response({"schemaVersion": 1, "core": "available", **metadata},
                                 status=200 if metadata["compatible"] else 503)

    async def read_capabilities(self, request):
        from aiohttp import web
        generation = getattr(self.server, '_creative_studio_generation', None)
        return web.json_response({"schemaVersion": 1, "capabilities": capabilities(
            getattr(self.server, "_creative_studio_services", None) is not None,
            getattr(self.server, "_creative_studio_storage_error", None),
            getattr(self.server, "_creative_studio_integrated", ())),
            "localGeneration": {
                "configured": bool(getattr(generation, 'providers', {})),
                "readinessVerified": False,
                "reason": getattr(self.server, '_creative_studio_generation_configuration_error', None),
            }})


def register_diagnostics(server, root: Path):
    previous = getattr(server, "_creative_studio_diagnostics", None)
    if previous is not None:
        if previous.root.resolve() != root.resolve():
            raise RuntimeError("Another Creative Studio installation owns the diagnostics routes")
        return previous
    instance = Diagnostics(root, server)
    existing = {(route.method, route.path) for route in server.routes
                if hasattr(route, "method") and hasattr(route, "path")}
    for method, route, handler in instance.routes:
        if (method, route) in existing:
            raise RuntimeError(f"Creative Studio route already owned: {method} {route}")
    for method, route, handler in instance.routes:
        server.routes.route(method, route)(handler)
    server._creative_studio_diagnostics = instance
    return instance
