import hashlib
import json
import re

from .errors import InvalidInput

_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$")
_SECRET_KEYS = {
    "apikey", "authorization", "accesstoken", "refreshtoken", "password",
    "secret", "clientsecret", "credentials", "credential", "sensitivedata",
    "cookie", "setcookie", "bearertoken", "authtoken",
    "deepseekkey", "xdaelabdeepseekkey",
}
_SECRET_SUFFIXES = ("apikey", "accesstoken", "refreshtoken", "bearertoken", "authtoken", "clientsecret", "password", "credential", "credentials")
_AUTH_CONTAINERS = {"headers", "auth", "authentication", "connection", "providerconfig"}


def identity(value, name="identity"):
    if not isinstance(value, str) or not _IDENTITY.fullmatch(value):
        raise InvalidInput(f"Invalid {name}; use a stable nonempty identifier.")
    return value


def clean_json(value, *, max_bytes=2 * 1024 * 1024):
    """Reject secret-bearing payloads, rather than redact and collide fingerprints."""
    def inspect(item, depth=0, parents=()):
        if depth > 64:
            raise InvalidInput("JSON nesting exceeds the supported limit.")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise InvalidInput("JSON object keys must be strings.")
                normalized = re.sub(r"[^a-z0-9]", "", key.lower())
                if (normalized in _SECRET_KEYS or normalized.endswith(_SECRET_SUFFIXES)
                        or normalized in {"key", "token"} and any(p in _AUTH_CONTAINERS for p in parents)):
                    raise InvalidInput("Credentials must remain in the connection manager.")
                inspect(child, depth + 1, (*parents, normalized))
        elif isinstance(item, (list, tuple)):
            for child in item:
                inspect(child, depth + 1, parents)
        elif item is not None and not isinstance(item, (str, bool, int, float)):
            raise InvalidInput("Value is not JSON serializable.")
    inspect(value)
    try:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise InvalidInput("Value is not finite canonical JSON.") from None
    if len(encoded.encode("utf-8")) > max_bytes:
        raise InvalidInput("JSON exceeds the supported request size.")
    return encoded


def digest(value):
    return hashlib.sha256(clean_json(value).encode("utf-8")).hexdigest()


def safe_label(value, name="label", *, limit=1024):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise InvalidInput(f"Invalid {name}.")
    return value
