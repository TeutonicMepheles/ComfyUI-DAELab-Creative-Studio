"""Per-host execution leases for ownership-safe restart reconciliation."""
import os
import uuid
from pathlib import Path


class HostExecutionLock:
    def __init__(self, path):
        self.path = Path(path)
        self.stream = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open('a+b')
        try:
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b'\0')
                stream.flush()
            stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            stream.close()
            return False
        self.stream = stream
        return True

    def release(self):
        if self.stream is None:
            return
        try:
            self.stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
        finally:
            self.stream.close()
            self.stream = None


def create_host_session(lock_directory):
    """Create this process's durable ownership identity and hold its OS lease."""
    session_id = uuid.uuid4().hex
    lease = HostExecutionLock(Path(lock_directory) / f'host-{session_id}.lock')
    if not lease.acquire():
        raise RuntimeError('Cannot create the Creative Studio host execution lease.')
    return session_id, lease


def reconcile_owned_restart(jobs, lock_directory, *, current_session):
    """Reconcile attempts only after reacquiring their former host-session lease.

    An unavailable lease proves that another process is still executing under
    that session, so its task facts remain untouched. Legacy attempts without a
    recorded host session are left for explicit recovery rather than guessed.
    """
    by_session = {}
    for request_id, attempt_id in jobs.active_attempt_owners():
        session_id = jobs.attempt_owner_session(attempt_id)
        if session_id and session_id != current_session:
            by_session.setdefault(session_id, []).append(request_id)
    reconciled = []
    live = []
    for session_id, request_ids in sorted(by_session.items()):
        lease = HostExecutionLock(Path(lock_directory) / f'host-{session_id}.lock')
        if not lease.acquire():
            live.append(session_id)
            continue
        try:
            jobs.reconcile_restart(request_ids=request_ids)
            reconciled.extend(request_ids)
        finally:
            lease.release()
    return {
        'reconciled': sorted(reconciled),
        'liveSessions': sorted(live),
        'legacyUnattributed': jobs.active_attempt_count(unattributed_only=True),
    }
