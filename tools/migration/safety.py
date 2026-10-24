"""Explicit ownership and exclusive publication; never deletes source or user data."""
import hashlib
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path, PurePosixPath


class MigrationError(ValueError):
    pass


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value or "\x00" in value:
        raise MigrationError("Invalid relative path.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or any(part in ("", ".", "..") for part in path.parts):
        raise MigrationError("Path must be normalized, relative and contained.")
    for part in path.parts:
        if (part.endswith((" ", ".")) or any(ord(c) < 32 for c in part) or
                re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", part, re.I)):
            raise MigrationError("Unsupported filesystem path component.")
    return path


def checked(path, *, exists=False):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise MigrationError("An explicit absolute path without traversal is required.")
    for component in [*reversed(path.parents), path]:
        if component.is_symlink() or getattr(component, "is_junction", lambda: False)():
            raise MigrationError("Symbolic links and junctions are not accepted.")
    resolved = path.resolve(strict=exists)
    if resolved != path.absolute():
        raise MigrationError("Path resolution changed the requested location.")
    return resolved


def contained(root, name):
    root = checked(root, exists=True)
    target = checked(root.joinpath(*relative(name).parts))
    if not target.is_relative_to(root) or target == root:
        raise MigrationError("Path escaped its owned root.")
    return target


def file_hash(path, *, allow_link=False):
    path = checked(path, exists=True)
    if not path.is_file() or not allow_link and path.stat().st_nlink != 1:
        raise MigrationError("Only ordinary, unlinked files can be included.")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root):
    root = checked(root, exists=True)
    if not root.is_dir():
        raise MigrationError("An existing directory is required.")
    result = []
    def visit(folder):
        for entry in sorted(folder.iterdir()):
            checked(entry, exists=True)
            name = entry.relative_to(root).as_posix()
            relative(name)
            if entry.is_dir():
                visit(entry)
            elif entry.is_file():
                result.append({"path": name, "sha256": file_hash(entry), "size": entry.stat().st_size})
            else:
                raise MigrationError("Special files are not supported.")
    visit(root)
    return result


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def json_hash(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def load_json(path):
    path = checked(path, exists=True)
    if path.stat().st_size > 64 * 1024 * 1024:
        raise MigrationError("JSON exceeds the 64 MiB inspection limit.")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise MigrationError("Duplicate JSON keys cannot be migrated safely.")
            result[key] = value
        return result
    try:
        return json.loads(path.read_text("utf-8-sig"), object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(MigrationError("Non-finite JSON is unsupported.")))
    except (UnicodeError, ValueError, RecursionError):
        raise MigrationError("JSON could not be inspected; preserve the original for review.") from None


def publish(path, payload):
    """Exclusive atomic publication. Interrupted parts remain inspectable, never overwritten."""
    path = checked(path)
    checked(path.parent, exists=True)
    temporary = path.parent / (".part-" + hashlib.sha256(payload).hexdigest())
    if path.exists():
        if path.read_bytes() != payload:
            raise MigrationError("Existing migration artifact does not match; refusing replacement.")
        if temporary.exists() and os.path.samefile(temporary, path):
            temporary.unlink()  # recover a crash between link publication and unlink
        return
    checked(temporary)
    offset = 0
    if temporary.exists():
        existing = temporary.read_bytes()
        if not payload.startswith(existing) or temporary.stat().st_nlink != 1:
            raise MigrationError("Interrupted metadata does not match the intended operation.")
        offset = len(existing)
    with temporary.open("ab" if offset else "xb" if not temporary.exists() else "ab") as stream:
        stream.write(payload[offset:])
        stream.flush()
        os.fsync(stream.fileno())
    try:
        # link() is an exclusive atomic publication on Windows and POSIX. Rename
        # would replace an existing destination on POSIX.
        os.link(temporary, path)
    except FileExistsError:
        if path.read_bytes() != payload:
            raise MigrationError("Concurrent migration produced inconsistent data.") from None
    finally:
        # Delete only the exact temporary file created by this invocation.
        temporary.unlink()


def write_json(path, value):
    publish(path, canonical(value) + b"\n")


def copy_verified(source, destination, entry):
    source, destination = checked(source, exists=True), checked(destination)
    if file_hash(source) != entry["sha256"]:
        raise MigrationError("Source changed after preflight; create a fresh offline snapshot.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    checked(destination.parent, exists=True)
    temporary = destination.parent / (".part-" + entry["sha256"])
    checked(temporary)
    if destination.exists():
        if temporary.exists() and os.path.samefile(temporary, destination):
            if file_hash(destination, allow_link=True) != entry["sha256"]:
                raise MigrationError("Interrupted publication is inconsistent.")
            temporary.unlink()
        if file_hash(destination) != entry["sha256"] or destination.stat().st_size != entry["size"]:
            raise MigrationError("Existing destination differs; refusing to overwrite it.")
        return
    offset = 0
    if temporary.exists():
        if temporary.stat().st_nlink != 1 or temporary.stat().st_size > entry["size"]:
            raise MigrationError("Interrupted copy is inconsistent.")
        with source.open("rb") as reader, temporary.open("rb") as part:
            for chunk in iter(lambda: part.read(1024 * 1024), b""):
                if reader.read(len(chunk)) != chunk:
                    raise MigrationError("Interrupted copy is not a prefix of its fixed source.")
                offset += len(chunk)
    with source.open("rb") as reader, temporary.open("ab" if temporary.exists() else "xb") as writer:
        reader.seek(offset)
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            writer.write(chunk)
        writer.flush()
        os.fsync(writer.fileno())
    if file_hash(temporary) != entry["sha256"] or file_hash(source) != entry["sha256"]:
        raise MigrationError("Source changed during copying; partial data was not published.")
    try:
        os.link(temporary, destination)
    except FileExistsError:
        if file_hash(destination) != entry["sha256"]:
            raise MigrationError("Concurrent destination conflict.") from None
    finally:
        temporary.unlink()


def recover_parts(folder, entries):
    """Return verified partial-copy names that inventory may omit during resumption."""
    pending = set()
    for entry in entries:
        destination = contained(folder, entry["path"])
        part = destination.parent / (".part-" + entry["sha256"])
        checked(part)
        if not part.exists():
            continue
        if destination.exists() and os.path.samefile(part, destination):
            if file_hash(destination, allow_link=True) != entry["sha256"]:
                raise MigrationError("Interrupted published file has an invalid hash.")
            part.unlink()
        elif part.stat().st_nlink == 1 and part.stat().st_size <= entry["size"]:
            pending.add(part.relative_to(folder).as_posix())
        else:
            raise MigrationError("Unrecognized partial file.")
    return pending


@contextmanager
def operation_lock(workspace, identifier):
    """OS lock is released on process death; an existing lock file is not a stale lease."""
    path = contained(workspace, ".lock-" + identifier)
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise MigrationError("This migration is already running in another process.") from None
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise MigrationError("This migration is already running in another process.") from None
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
