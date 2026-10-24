"""Durable task facts and submission claims, not a scheduler or execution engine."""

import json
import uuid
from datetime import datetime, timezone

from ..contracts.database import Database
from ..contracts.errors import Conflict, InvalidInput, InvalidTransition, MissingRecord
from ..contracts.validation import clean_json, digest, identity

STATES = frozenset({"pending", "submitting", "submitted", "running", "fetching", "succeeded", "failed", "needs_recovery", "unknown", "cancelled"})
TERMINAL_STATES = frozenset({"succeeded", "failed", "cancelled"})
_NEXT = {
    "pending": {"cancelled"},
    "submitting": {"submitted", "unknown", "failed"},
    "submitted": {"running", "fetching", "failed", "needs_recovery"},
    "running": {"fetching", "failed", "needs_recovery"},
    "fetching": {"succeeded", "failed", "needs_recovery"},
    "needs_recovery": {"running", "fetching", "failed", "unknown"},
    "unknown": {"submitted", "failed"},
    "succeeded": set(), "failed": set(), "cancelled": set(),
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _decode(row):
    if row is None:
        raise MissingRecord("Task identity was not found.")
    result = dict(row)
    for source, target in [("input_json", "snapshot"), ("source_json", "source"), ("result_json", "result")]:
        value = result.pop(source)
        result[target] = json.loads(value) if value is not None else None
    result["cancel_requested"] = bool(result["cancel_requested"])
    return result


class JobLedger:
    def __init__(self, database_path, *, result_validator=None):
        self.database = Database(database_path)
        self.result_validator = result_validator

    def create_or_get(self, request_id, *, provider, execution_kind, snapshot, source=None):
        identity(request_id, "request ID")
        identity(provider, "provider ID")
        if not isinstance(execution_kind, str) or execution_kind not in {"local", "remote", "media"}:
            raise InvalidInput("Execution kind must be local, remote or media.")
        if not isinstance(snapshot, dict) or source is not None and not isinstance(source, dict):
            raise InvalidInput("Input snapshot and source must be JSON objects.")
        source = source or {}
        snapshot_json, source_json = clean_json(snapshot), clean_json(source)
        fingerprint = digest({"provider": provider, "execution_kind": execution_kind, "snapshot": snapshot, "source": source})
        with self.database.transaction() as connection:
            existing = connection.execute("SELECT * FROM jobs WHERE request_id=?", (request_id,)).fetchone()
            if existing is not None:
                if existing["fingerprint"] != fingerprint:
                    raise Conflict("Request ID already belongs to different immutable inputs or source scope.")
                return _decode(existing), False
            now = _now()
            connection.execute("""INSERT INTO jobs(request_id,provider,execution_kind,input_json,fingerprint,source_json,state,version,created_at,updated_at)
                VALUES(?,?,?,?,?,?,'pending',0,?,?)""", (request_id, provider, execution_kind, snapshot_json, fingerprint, source_json, now, now))
            self._event(connection, request_id, "created", 0, "created", {"fingerprint": fingerprint})
            return self._get(connection, request_id), True

    def get(self, request_id):
        identity(request_id, "request ID")
        with self.database.read() as connection:
            return self._get(connection, request_id)

    @staticmethod
    def _get(connection, request_id):
        return _decode(connection.execute("SELECT * FROM jobs WHERE request_id=?", (request_id,)).fetchone())

    @staticmethod
    def _expect(job, version):
        if not isinstance(version, int) or isinstance(version, bool) or job["version"] != version:
            raise Conflict("Task revision changed; reload the original identity before acting.")

    @staticmethod
    def _event(connection, request_id, event_id, version, event_type, detail):
        identity(event_id, "event ID")
        detail_json = clean_json(detail)
        prior = connection.execute("SELECT event_type,detail_json FROM job_events WHERE request_id=? AND event_id=?", (request_id, event_id)).fetchone()
        if prior:
            if prior["event_type"] != event_type or prior["detail_json"] != detail_json:
                raise Conflict("Event ID already identifies a different event.")
            return False
        connection.execute("INSERT INTO job_events(request_id,event_id,version,event_type,detail_json,created_at) VALUES(?,?,?,?,?,?)", (request_id, event_id, version, event_type, detail_json, _now()))
        return True

    def begin_submission(self, request_id, *, expected_version):
        """Exactly one caller claims pending. Commit BEFORE calling a provider."""
        with self.database.transaction() as connection:
            job = self._get(connection, request_id)
            self._expect(job, expected_version)
            if job["state"] != "pending" or job["cancel_requested"]:
                raise InvalidTransition("Only an uncancelled pending task may submit; recovery never resubmits.")
            now, attempt_id = _now(), str(uuid.uuid4())
            attempt = job["attempt"] + 1
            connection.execute("INSERT INTO job_attempts(request_id,attempt,attempt_id,state,created_at,updated_at) VALUES(?,?,?,'submitting',?,?)", (request_id, attempt, attempt_id, now, now))
            connection.execute("UPDATE jobs SET state='submitting',attempt=?,version=version+1,updated_at=? WHERE request_id=?", (attempt, now, request_id))
            self._event(connection, request_id, "submit:"+attempt_id, expected_version+1, "submission_claimed", {"attempt_id": attempt_id})
            result = self._get(connection, request_id)
            result["attempt_id"] = attempt_id
            return result

    def mark_submitted(self, request_id, provider_task_id, *, expected_version, event_id):
        identity(provider_task_id, "provider task ID")
        return self.transition(request_id, "submitted", expected_version=expected_version, event_id=event_id, provider_task_id=provider_task_id)

    def transition(self, request_id, state, *, expected_version, event_id, provider_task_id=None, result=None, error_code=None):
        if not isinstance(state, str) or state not in STATES:
            raise InvalidInput("Unknown task state.")
        identity(event_id, "event ID")
        if error_code is not None:
            identity(error_code, "error code")
        if provider_task_id is not None:
            identity(provider_task_id, "provider task ID")
        # Results contain asset IDs, file hashes or approved text, never credentials.
        if result is not None:
            if not isinstance(result, dict):
                raise InvalidInput("Result must be a JSON object.")
            clean_json(result)
        detail = {"state": state, "provider_task_id": provider_task_id, "result": result, "error_code": error_code}
        # A committed event is an immutable fact. Redelivery must not re-run a
        # decoder or change asset availability after the output has been moved.
        # Recheck again inside the write transaction to close concurrent delivery.
        with self.database.read() as connection:
            job = self._get(connection, request_id)
            prior = connection.execute("SELECT detail_json FROM job_events WHERE request_id=? AND event_id=?", (request_id, event_id)).fetchone()
            if prior:
                if prior["detail_json"] != clean_json(detail):
                    raise Conflict("Event ID already identifies different transition data.")
                return job
            self._expect(job, expected_version)
        if state == "succeeded":
            if result and result.get("kind") == "text":
                if not isinstance(result.get("text"), str) or not result["text"]:
                    raise InvalidInput("Successful text result must contain its approved output.")
            elif result and result.get("kind") == "assets":
                if (self.result_validator is None
                        or getattr(self.result_validator, "verifies_media_decode", False) is not True
                        or self.result_validator(result) is not True):
                    raise InvalidTransition("Asset success requires both an asset receipt verifier and complete media decoding.")
            else:
                raise InvalidInput("Success requires a text or verified asset result receipt.")
        with self.database.transaction() as connection:
            job = self._get(connection, request_id)
            prior = connection.execute("SELECT detail_json FROM job_events WHERE request_id=? AND event_id=?", (request_id, event_id)).fetchone()
            if prior:
                if prior["detail_json"] != clean_json(detail):
                    raise Conflict("Event ID already identifies different transition data.")
                return job  # Duplicate delivery is harmless even after later transitions.
            self._expect(job, expected_version)
            if state not in _NEXT[job["state"]]:
                raise InvalidTransition("Transition would regress facts or submit an already claimed task.")
            remote_id = provider_task_id or job["provider_task_id"]
            if job["provider_task_id"] and provider_task_id and provider_task_id != job["provider_task_id"]:
                raise Conflict("Provider task identity is immutable for this execution.")
            if state in {"submitted", "running", "fetching", "succeeded"} and not remote_id:
                raise InvalidTransition("A confirmed provider or native execution identity is required.")
            if state == "succeeded" and not result:
                raise InvalidTransition("Success requires a validated result receipt.")
            if state == "cancelled":
                raise InvalidTransition("Use request_cancel or confirm_cancelled to distinguish cancellation facts.")
            if remote_id:
                duplicate = connection.execute("SELECT request_id FROM jobs WHERE provider=? AND provider_task_id=? AND request_id<>?", (job["provider"], remote_id, request_id)).fetchone()
                if duplicate:
                    raise Conflict("Provider execution already belongs to a different request identity.")
            now = _now()
            connection.execute("UPDATE jobs SET state=?,version=version+1,provider_task_id=?,result_json=?,error_code=?,updated_at=? WHERE request_id=?", (state, remote_id, clean_json(result) if result is not None else clean_json(job["result"]) if job["result"] is not None else None, error_code, now, request_id))
            connection.execute("UPDATE job_attempts SET state=?,provider_task_id=?,updated_at=? WHERE request_id=? AND attempt=?", (state, remote_id, now, request_id, job["attempt"]))
            self._event(connection, request_id, event_id, expected_version+1, "transition", detail)
            return self._get(connection, request_id)

    def request_cancel(self, request_id, *, expected_version, supports_remote_cancel=False):
        """No host interrupt occurs here; pending is final, active is only intent."""
        with self.database.transaction() as connection:
            job = self._get(connection, request_id)
            self._expect(job, expected_version)
            if job["state"] in TERMINAL_STATES:
                return {"job": job, "action": "none"}
            queued = job["state"] == "pending"
            state = "cancelled" if queued else job["state"]
            connection.execute("UPDATE jobs SET state=?,cancel_requested=1,version=version+1,updated_at=? WHERE request_id=?", (state, _now(), request_id))
            self._event(connection, request_id, f"cancel:{expected_version+1}", expected_version+1, "cancel_intent", {"queued": queued})
            action = "none" if queued else "confirm_owned_local_interrupt" if job["execution_kind"] == "local" else "request_provider_cancel" if supports_remote_cancel else "continue_tracking_original"
            return {"job": self._get(connection, request_id), "action": action}

    def confirm_cancelled(self, request_id, *, expected_version, provider_task_id, confirmation):
        identity(provider_task_id, "provider task ID")
        if confirmation not in {"provider_cancelled", "owned_native_execution_stopped"}:
            raise InvalidInput("Cancellation needs an explicit provider/native confirmation.")
        with self.database.transaction() as connection:
            job = self._get(connection, request_id)
            self._expect(job, expected_version)
            if not job["cancel_requested"] or job["state"] in TERMINAL_STATES or job["provider_task_id"] != provider_task_id:
                raise InvalidTransition("Cancellation was not confirmed for this active owned execution.")
            if confirmation == "owned_native_execution_stopped" and job["execution_kind"] not in {"local", "media"}:
                raise InvalidTransition("Native interruption cannot confirm a remote task cancellation.")
            now = _now()
            connection.execute("UPDATE jobs SET state='cancelled',version=version+1,updated_at=? WHERE request_id=?", (now, request_id))
            connection.execute("UPDATE job_attempts SET state='cancelled',updated_at=? WHERE request_id=? AND attempt=?", (now, request_id, job["attempt"]))
            self._event(connection, request_id, f"cancelled:{expected_version+1}", expected_version+1, "cancel_confirmed", {"provider_task_id": provider_task_id, "confirmation": confirmation})
            return self._get(connection, request_id)

    def reconcile_restart(self):
        """Call only after former workers are stopped; never invoke any provider."""
        with self.database.transaction() as connection:
            rows = connection.execute("SELECT * FROM jobs WHERE state IN ('submitting','submitted','running','fetching')").fetchall()
            for row in rows:
                job = _decode(row)
                state = "needs_recovery" if job["provider_task_id"] else "unknown"
                now = _now()
                connection.execute("UPDATE jobs SET state=?,version=version+1,error_code='worker_restart',updated_at=? WHERE request_id=?", (state, now, job["request_id"]))
                connection.execute("UPDATE job_attempts SET state=?,updated_at=? WHERE request_id=? AND attempt=?", (state, now, job["request_id"], job["attempt"]))
                self._event(connection, job["request_id"], f"restart:{job['version']+1}", job["version"]+1, "restart_reconciled", {"previous_state": job["state"], "state": state})
            return [self._get(connection, row["request_id"]) for row in rows]

    def recovery_action(self, request_id, *, supports_query=False, supports_idempotency_lookup=False):
        job = self.get(request_id)
        if job["state"] in TERMINAL_STATES:
            return {"action": "read_result" if job["state"] == "succeeded" else "none", "request_id": request_id, "provider_task_id": job["provider_task_id"]}
        if job["provider_task_id"] and supports_query:
            action = "query_original"
        elif job["state"] == "unknown" and supports_idempotency_lookup:
            action = "lookup_original_request"
        elif job["state"] == "pending":
            action = "await_explicit_dispatch"
        else:
            action = "manual_reconciliation"
        return {"action": action, "request_id": request_id, "provider_task_id": job["provider_task_id"], "fingerprint": job["fingerprint"]}

    def claim_recovery(self, request_id, *, expected_version, limit=3):
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
            raise InvalidInput("Recovery limit must be between 1 and 100.")
        with self.database.transaction() as connection:
            job = self._get(connection, request_id)
            self._expect(job, expected_version)
            if job["state"] not in {"needs_recovery", "unknown", "fetching"} or job["recovery_count"] >= limit:
                raise InvalidTransition("Recovery is unavailable or its retry limit was reached; inspect the original task.")
            connection.execute("UPDATE jobs SET recovery_count=recovery_count+1,version=version+1,updated_at=? WHERE request_id=?", (_now(), request_id))
            self._event(connection, request_id, f"recovery:{job['recovery_count']+1}", expected_version+1, "recovery_claimed", {"count": job["recovery_count"]+1})
            return self._get(connection, request_id)

    def retry_local_as_new(self, request_id, new_request_id):
        """Explicit caller action; retains old terminal facts and original correlation."""
        original = self.get(request_id)
        if original["execution_kind"] != "local" or original["state"] not in {"failed", "cancelled"}:
            raise InvalidTransition("A new local execution requires a confirmed stopped or failed original task.")
        source = {**original["source"], "previous_request_id": request_id}
        return self.create_or_get(new_request_id, provider=original["provider"], execution_kind="local", snapshot=original["snapshot"], source=source)

    def events(self, request_id):
        with self.database.read() as connection:
            self._get(connection, request_id)
            return [{**dict(row), "detail": json.loads(row["detail_json"])} for row in connection.execute("SELECT * FROM job_events WHERE request_id=? ORDER BY sequence", (request_id,))]

    def attempts(self, request_id):
        with self.database.read() as connection:
            self._get(connection, request_id)
            return [dict(row) for row in connection.execute("SELECT * FROM job_attempts WHERE request_id=? ORDER BY attempt", (request_id,))]

    def list_jobs(self, *, state=None, source_filter=None, limit=100, offset=0):
        """Read a bounded page of immutable source scope, filtering before pagination.

        All specified source fields must match. This never reconciles, dispatches,
        mutates states or reads another storage authority. Callers reloading a batch
        can continue with offset while retaining the same source filter.
        """
        if (state is not None and state not in STATES or type(limit) is not int or not 1 <= limit <= 1000
                or type(offset) is not int or not 0 <= offset <= 1_000_000_000):
            raise InvalidInput("Invalid task query.")
        if source_filter is None:
            source_filter = {}
        if not isinstance(source_filter, dict) or set(source_filter) - {'batchId', 'documentId', 'tableId', 'operation'}:
            raise InvalidInput("Invalid task source query.")
        clauses, parameters = [], []
        if state:
            clauses.append('state=?')
            parameters.append(state)
        for field, value in sorted(source_filter.items()):
            identity(value, "source query value")
            clauses.append('json_extract(source_json,?)=?')
            parameters.extend(('$."' + field + '"', value))
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        with self.database.read() as connection:
            rows = connection.execute('SELECT * FROM jobs' + where + ' ORDER BY created_at,request_id LIMIT ? OFFSET ?',
                                      (*parameters, limit, offset))
            return [_decode(row) for row in rows]

    def diagnostics(self, request_id):
        """Safe task correlation export; does not include prompt/result/source bodies."""
        job = self.get(request_id)
        keys = ("request_id", "provider", "execution_kind", "fingerprint", "state", "version", "provider_task_id", "attempt", "cancel_requested", "error_code", "recovery_count", "created_at", "updated_at")
        return {"task": {key: job[key] for key in keys}, "attempts": self.attempts(request_id), "events": [{key: event[key] for key in ("sequence", "event_id", "version", "event_type", "created_at")} for event in self.events(request_id)]}
