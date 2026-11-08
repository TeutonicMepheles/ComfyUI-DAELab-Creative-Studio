"""Explicit three-package coexistence arbitration and fail-closed self-check.

Creative Studio, the legacy Creative Canvas (CC) and the legacy Custom Nodes
Library (CNL) overlap on a small, fully enumerable registration surface. The
arbitration file ``user/daelab/coexistence.json`` (when present) pins every
contested item to exactly one owner package by package ID (``studio``/``cnl``);
both packages read the same file, so ownership never depends on load order.

Without the arbitration file, startup behaviour is byte-identical to the
previous fail-closed duplicate-install protection: any legacy package directory
still aborts registration before any node or route is published.
"""
from __future__ import annotations

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Contested registration surface. Every item must appear in the arbitration
# file (no layer fallback), because a partial file is a partial patch.
# ---------------------------------------------------------------------------

LEGACY_PACKAGE_NAMES = frozenset({
    "ComfyUI-DAELab-Creative-Canvas",
    "ComfyUI-DAELab-Custom-Nodes-Library",
})

CONTESTED_NODES = frozenset({
    "DAELAB.Table",
    "DAELAB.ScriptParser",
    "DAELAB.LLMStylePreviewB",
    "DAELAB.ComfyTV.GPTImageStoryboardStage",
})

CONTESTED_ROUTES = frozenset({
    "POST /daelab/storyboard/import_document",
    "POST /daelab/storyboard/parse-prompts",
    "POST /daelab/script-parser/document",
    "POST /daelab/script-parser/normalize",
    "POST /daelab/script-parser/classify",
    "GET /daelab/script-parser/ai-status",
})

# The prompt-optimization surface is a prefix with 14 named actions, not a
# single literal route. The legacy CNL registers a wildcard ``{action}`` route
# that would silently swallow every named action, so it is expressed here as a
# prefix with an explicit allow-list of actions.
PROMPT_OPTIMIZATION_PREFIX = "POST /daelab/prompt-optimization/"
PROMPT_OPTIMIZATION_ACTIONS = (
    "polish", "capabilities", "estimate", "lease", "submit", "query", "recover",
    "permit", "advance", "stop", "interrupt", "continue", "skip", "fence",
)

CONTESTED_EXTENSIONS = frozenset({
    "DAELab.DataTable",
    "DAELab.ScriptParser",
    "DAELab.LLMStylePreview",
    "DAELab.PromptOptimization.Identity.v1",
})

PACKAGE_IDS = frozenset({"studio", "cnl"})

# Directory-name prefixes used to classify a registered class ``__module__``
# back to its owning package. ComfyUI imports each custom node package under
# its directory basename.
_STUDIO_PREFIX = "ComfyUI-DAELab-Creative-Studio"
_CNL_PREFIX = "ComfyUI-DAELab-Custom-Nodes-Library"


def classify_module(module_name: str) -> str:
    """Map a registered class ``__module__`` to its owner package ID.

    ComfyUI exposes ``__module__`` either as a dotted name
    (``ComfyUI-DAELab-Creative-Studio.backend…``) or, in this deployment, as a
    full import path (``…\\custom_nodes\\ComfyUI-DAELab-Creative-Studio.backend…``).
    Taking the last path segment's first dotted component recognises both forms
    while structurally excluding a bare directory segment such as a repo
    checkout path (``…\\PACKAGE\\.local\\…``), whose last segment is unrelated.
    """
    tail = module_name.replace("\\", "/").rsplit("/", 1)[-1]
    component = tail.split(".", 1)[0]
    if component == _STUDIO_PREFIX:
        return "studio"
    if component == _CNL_PREFIX:
        return "cnl"
    return "unknown"


def arbitration_path(user_directory: Path) -> Path:
    return user_directory / "daelab" / "coexistence.json"


def load_arbitration(user_directory: Path) -> dict | None:
    """Read and parse the arbitration file; ``None`` means "not opted in".

    A malformed file raises ``ValueError`` rather than silently disabling
    coexistence: the user explicitly opted in, so a broken file must fail
    closed with a clear reason.
    """
    path = arbitration_path(user_directory)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"coexistence.json is unreadable: {error}") from error
    if not isinstance(data, dict):
        raise ValueError("coexistence.json must be a JSON object")
    return data


def _owner_errors(table: dict, expected_keys, label: str) -> list[str]:
    errors = []
    if not isinstance(table, dict):
        return [f"{label} must be an object mapping identifiers to a package ID"]
    missing = [key for key in expected_keys if key not in table]
    if missing:
        errors.append(f"{label} is missing {sorted(_key_str(k) for k in missing)}")
    for key, owner in table.items():
        if owner not in PACKAGE_IDS:
            errors.append(f"{label} owner for {_key_str(key)!r} must be one of {sorted(PACKAGE_IDS)}, got {owner!r}")
    return errors


def _key_str(key) -> str:
    if isinstance(key, tuple):
        return " ".join(key)
    return str(key)


def _normalize_route_owners(table) -> dict:
    """Collapse ``GET  /path`` (alignment padding) to the canonical ``GET /path``."""
    if not isinstance(table, dict):
        return table
    normalized = {}
    for key, owner in table.items():
        if isinstance(key, tuple):
            normalized[" ".join(key)] = owner
        else:
            normalized[" ".join(str(key).split())] = owner
    return normalized


def validate_arbitration(arbitration: dict) -> list[str]:
    """Return every reason the arbitration file is incomplete or inconsistent."""
    errors = []
    allowed = arbitration.get("allowLegacyPackages")
    if not isinstance(allowed, list) or not all(isinstance(name, str) for name in allowed):
        errors.append("allowLegacyPackages must be a list of legacy package directory names")
    else:
        unknown = [name for name in allowed if name not in LEGACY_PACKAGE_NAMES]
        if unknown:
            errors.append(f"allowLegacyPackages contains unknown package names: {unknown}")

    errors.extend(_owner_errors(arbitration.get("nodeOwners"), CONTESTED_NODES, "nodeOwners"))
    errors.extend(_owner_errors(_normalize_route_owners(arbitration.get("routeOwners")), CONTESTED_ROUTES, "routeOwners"))
    errors.extend(_owner_errors(arbitration.get("extensionOwners"), CONTESTED_EXTENSIONS, "extensionOwners"))

    prefixes = arbitration.get("routePrefixes")
    if not isinstance(prefixes, dict) or PROMPT_OPTIMIZATION_PREFIX not in prefixes:
        errors.append(f"routePrefixes must declare {PROMPT_OPTIMIZATION_PREFIX!r}")
    else:
        entry = prefixes[PROMPT_OPTIMIZATION_PREFIX]
        if not isinstance(entry, dict) or entry.get("owner") not in PACKAGE_IDS:
            errors.append(f"routePrefixes[{PROMPT_OPTIMIZATION_PREFIX!r}] must declare an owner in {sorted(PACKAGE_IDS)}")
        actions = entry.get("allowedActions") if isinstance(entry, dict) else None
        if not isinstance(actions, list) or set(actions) != set(PROMPT_OPTIMIZATION_ACTIONS):
            errors.append(f"routePrefixes[{PROMPT_OPTIMIZATION_PREFIX!r}].allowedActions must enumerate exactly the {len(PROMPT_OPTIMIZATION_ACTIONS)} named actions")

    return errors


def authorized_legacy_packages(arbitration: dict) -> set[str]:
    allowed = arbitration.get("allowLegacyPackages")
    if not isinstance(allowed, list):
        return set()
    return {name for name in allowed if name in LEGACY_PACKAGE_NAMES}


def filter_readonly_mappings(mappings: dict, arbitration: dict) -> dict:
    """Skip a read-only compatibility node whose owner is another package.

    Only registration is skipped; ``compat/workflows/reader.py`` keeps its
    offline read-only inspection independent of the registered class.
    """
    owners = arbitration.get("nodeOwners", {})
    return {key: value for key, value in mappings.items() if owners.get(key, "studio") == "studio"}


def check_node_owners(node_modules: dict, arbitration: dict, classify=classify_module) -> list[str]:
    """Fail-closed node self-check: registered ``__module__`` vs ``nodeOwners``."""
    errors = []
    owners = arbitration.get("nodeOwners", {})
    for node_id in sorted(CONTESTED_NODES):
        expected = owners.get(node_id)
        if expected is None:
            errors.append(f"{node_id}: no owner declared in nodeOwners")
            continue
        module = node_modules.get(node_id)
        if module is None:
            errors.append(f"{node_id}: not registered (expected owner {expected!r})")
            continue
        actual = classify(module)
        if actual != expected:
            errors.append(f"{node_id}: registered by {module!r} ({actual!r}), expected owner {expected!r}")
    return errors


def check_extension_owners(extension_sources: dict, arbitration: dict) -> list[str]:
    """Fail-closed extension self-check: source package vs ``extensionOwners``.

    ``extension_sources`` maps each contested extension name to the package ID
    that registered it (derived from the registering module's origin), or the
    sentinel ``"duplicate"`` when more than one package registered the name.
    """
    errors = []
    owners = arbitration.get("extensionOwners", {})
    for name in sorted(CONTESTED_EXTENSIONS):
        expected = owners.get(name)
        if expected is None:
            errors.append(f"{name}: no owner declared in extensionOwners")
            continue
        actual = extension_sources.get(name)
        if actual is None:
            errors.append(f"{name}: not registered (expected owner {expected!r})")
        elif actual != expected:
            errors.append(f"{name}: registered by {actual!r}, expected owner {expected!r}")
    return errors


def check_prompt_optimization_routes(registered_routes, arbitration: dict) -> list[str]:
    """Fail-closed route self-check for the prompt-optimization prefix.

    ``registered_routes`` is an iterable of ``(method, path)`` as actually
    registered by all packages, where ``path`` may contain an aiohttp ``{...}``
    wildcard. Catches the legacy CNL wildcard ``{action}`` that would swallow
    every named action without producing a duplicate literal route.
    """
    errors = []
    prefix_entry = arbitration.get("routePrefixes", {}).get(PROMPT_OPTIMIZATION_PREFIX, {})
    owner = prefix_entry.get("owner")
    allowed = prefix_entry.get("allowedActions") or list(PROMPT_OPTIMIZATION_ACTIONS)

    registered = list(registered_routes)
    for method, path in registered:
        if method == "POST" and path.startswith("/daelab/prompt-optimization/") and ("{" in path or "}" in path):
            errors.append(f"wildcard route {method} {path} shadows named prompt-optimization actions (owner {owner!r})")
    for action in allowed:
        literal = f"/daelab/prompt-optimization/{action}"
        matches = [p for (m, p) in registered if m == "POST" and p == literal]
        if len(matches) != 1:
            errors.append(f"{literal}: expected exactly one handler (owner {owner!r}), found {len(matches)}")
    return errors


def check_contested_routes(registered_routes, arbitration: dict) -> list[str]:
    """Fail-closed route self-check for the six literal contested routes.

    Each ``routeOwners`` literal route must be registered exactly once; a
    second literal registration means the legacy package did not yield its
    route, and aiohttp would silently pick one handler by registration order.
    """
    errors = []
    owners = _normalize_route_owners(arbitration.get("routeOwners", {}))
    registered = list(registered_routes)
    for key in sorted(CONTESTED_ROUTES):
        method, path = key.split(" ", 1)
        expected = owners.get(key)
        matches = [p for (m, p) in registered if m == method and p == path]
        if len(matches) != 1:
            errors.append(f"{key}: expected exactly one handler (owner {expected!r}), found {len(matches)}")
    return errors
