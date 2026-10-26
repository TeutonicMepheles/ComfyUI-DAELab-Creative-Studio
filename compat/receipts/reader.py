"""Read-only adapters for pinned table JSON, LibTV cache and optimization SQLite.

Consumers: tools.migration. Removal: only after an explicit support decision and
verified export of every retained original. No old runtime or provider is imported.
"""
import hashlib
import copy
import json
import re
import sqlite3
from pathlib import Path

if __package__ == "compat.receipts":
    from backend.contracts.validation import clean_json
    from backend.contracts.errors import InvalidInput
else:
    from ...backend.contracts.validation import clean_json
    from ...backend.contracts.errors import InvalidInput

SOURCE_VERSION = "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"
TERMINAL = frozenset({"complete", "completed", "succeeded", "failed", "cancelled"})
STATES = TERMINAL | {"pending", "waiting", "queued", "preparing", "prepared", "running", "submitting",
                     "submitted", "polling", "fetching", "unknown", "needs_recovery", "needs_input",
                     "paused", "pausing", "stopped", "submitted_or_uncertain", "prepare_uncertain", "generated"}
EXECUTION_KINDS = frozenset({"local", "remote", "media"})
# Explicit owned IDs from the generation composition contract, not prefix/name
# guessing. A conflicting legacy declaration must never grant remote recovery.
OWNED_LOCAL_PROVIDERS = frozenset({"local-qwen-image", "local-h3", "local-qwen-text"})


def safe_identity(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:@/\-]{1,256}", value) else None


def _record(value, inherited_provider=None):
    request = value.get("request", {})
    if not isinstance(request, dict):
        request = {}
    provider = safe_identity(value.get("provider")) or inherited_provider
    kind = value.get("execution_kind", value.get("executionKind"))
    execution_kind = kind if isinstance(kind, str) and kind in EXECUTION_KINDS else "unknown"
    request_id = safe_identity(value.get("requestId") or value.get("request_id") or request.get("request_id"))
    state = value.get("phase", value.get("status", value.get("state")))
    remote = value.get("remote", {})
    if not isinstance(remote, dict):
        remote = {}
    data = remote.get("data", {})
    task = data.get("taskInfo", {}) if isinstance(data, dict) else {}
    if not isinstance(task, dict):
        task = {}
    provider_task_id = safe_identity(value.get("provider_task_id") or value.get("taskId") or
                                    value.get("remoteResponseId") or task.get("taskId") or remote.get("taskId"))
    known_state = isinstance(state, str) and state in STATES
    recognized = known_state and bool(request_id)
    retired = provider in {"libtv", "gpt", "gpt-image", "legacy-gpt"} or "node_key" in value
    return {"requestId": request_id, "provider": provider, "providerTaskId": provider_task_id,
            "executionKind": execution_kind,
            "queryOnlySwitchEligible": execution_kind == "remote" and provider not in OWNED_LOCAL_PROVIDERS,
            "state": state if known_state else "unknown_schema", "recognized": recognized,
            "terminal": recognized and state in TERMINAL, "readOnly": True,
            "execution": "disabled", "retired": retired,
            "recovery": "historical_read_only" if retired else
                        "external_query_same_identity_required" if provider_task_id and provider else
                        "unrecoverable_without_external_evidence",
            "fingerprint": safe_identity(value.get("fingerprint")),
            "resultPresent": bool(value.get("result") or value.get("file") or value.get("suggestion")),
            "rawSha256": hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                                   separators=(",", ":")).encode()).hexdigest()}


def inspect_receipts(document):
    if not isinstance(document, (dict, list)):
        return {"schemaVersion": 1, "records": [], "issues": ["unknown_receipt_schema"]}
    if isinstance(document, list):
        items, provider = document, None
    elif isinstance(document.get("rows"), list):
        items, provider = document["rows"], safe_identity(document.get("provider"))
    elif isinstance(document.get("jobs"), list):
        items, provider = document["jobs"], safe_identity(document.get("provider"))
    else:
        items, provider = [document], None
    records = [_record(item, provider) for item in items if isinstance(item, dict)]
    issues = []
    if len(records) != len(items) or any(not record["recognized"] for record in records):
        issues.append("unknown_receipt_schema")
    versions = [document.get(key) for key in ("schemaVersion", "contractVersion") if isinstance(document, dict) and key in document]
    if any(version != 1 for version in versions):
        issues.append("unknown_receipt_version")
    seen = {}
    for record in records:
        key = (record["provider"], record["requestId"])
        if key in seen and seen[key] != record["rawSha256"]:
            issues.append("conflicting_request_identity")
        seen[key] = record["rawSha256"]
    return {"schemaVersion": 1, "sourceVersion": SOURCE_VERSION, "records": records,
            "issues": sorted(set(issues)), "execution": "disabled"}


def read_receipt(document):
    """Read full historical results without any queue/provider/ledger mutation port."""
    clean_json(document, max_bytes=64 * 1024 * 1024)
    return {"schemaVersion": 1, "readOnly": True, "canResume": False, "canSubmit": False,
            "report": inspect_receipts(document), "raw": copy.deepcopy(document)}


def inspect_database(path):
    """Offline only. immutable mode avoids journal/SHM writes during dry-run.

    Product database inspection is a storage-format adapter, not JobLedger construction:
    constructing that public service would run migrations on the source. No SQL writes.
    """
    path = Path(path)
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            return {"records": [], "issues": ["database_requires_offline_checkpoint"], "execution": "disabled"}
    try:
        connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("PRAGMA trusted_schema=OFF")
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError()
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "objects" in tables:
                rows, issues = [], []
                if tables - {"objects", "sqlite_sequence"}:
                    return {"records": [], "issues": ["unknown_database_schema"]}
                if [r[1] for r in connection.execute("PRAGMA table_info(objects)")] != ["kind", "id", "body"]:
                    return {"records": [], "issues": ["unknown_database_schema"]}
                for kind, identifier, body in connection.execute("SELECT kind,id,body FROM objects ORDER BY kind,id"):
                    try:
                        document = json.loads(body)
                        clean_json(document, max_bytes=64 * 1024 * 1024)
                        if kind != "batch":
                            continue  # quotes/config remain in the byte-identical archive.
                        result = inspect_receipts(document)
                        rows.extend(result["records"])
                        issues.extend(result["issues"])
                    except InvalidInput:
                        issues.append("sensitive_or_unsupported_json")
                    except (ValueError, TypeError):
                        issues.append("corrupt_receipt_record")
                return {"records": rows, "issues": sorted(set(issues)), "format": "legacy-optimization-v1", "execution": "disabled"}
            if "jobs" in tables:
                if tables - {"jobs", "job_attempts", "job_events", "assets", "asset_references", "favorites", "favorite_origins", "asset_provenance", "sqlite_sequence"}:
                    return {"records": [], "issues": ["unknown_database_schema"]}
                # Frozen storage contract v1-v3. A newer schema requires a reviewed adapter.
                if (connection.execute("PRAGMA application_id").fetchone()[0] != 0x43535431 or
                        connection.execute("PRAGMA user_version").fetchone()[0] not in (1, 2, 3)):
                    return {"records": [], "issues": ["unknown_database_schema"]}
                columns = ["request_id", "provider", "provider_task_id", "state", "fingerprint", "execution_kind"]
                for table in sorted(tables):
                    # Only scan JSON-bearing columns in product-owned tables. Never execute
                    # schema text or dynamically use a name outside a strict identifier.
                    if not re.fullmatch(r"[a-z_]+", table):
                        continue
                    json_columns = [r[1] for r in connection.execute(f'PRAGMA table_info("{table}")')
                                    if re.fullmatch(r"[a-z_]+_json", r[1])]
                    for column in json_columns:
                        for (body,) in connection.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'):
                            try:
                                clean_json(json.loads(body), max_bytes=64 * 1024 * 1024)
                            except (ValueError, TypeError, InvalidInput):
                                return {"records": [], "issues": ["sensitive_or_uninspectable_database_json"]}
                rows = [dict(zip(columns, row)) for row in connection.execute(
                    "SELECT request_id,provider,provider_task_id,state,fingerprint,execution_kind FROM jobs ORDER BY request_id")]
                references = []
                if "asset_references" in tables:
                    keys = ("root", "path", "sha256", "status")
                    references = [dict(zip(keys, row)) for row in connection.execute(
                        "SELECT root_key,relative_path,content_sha256,status FROM asset_references ORDER BY reference_id")]
                return {**inspect_receipts(rows), "format": "creative-studio-v1-v3", "references": references}
            return {"records": [], "issues": ["unknown_database_schema"]}
        finally:
            connection.close()
    except (sqlite3.Error, OSError):
        return {"records": [], "issues": ["unreadable_database"], "execution": "disabled"}
