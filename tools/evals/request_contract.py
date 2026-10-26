"""Pure comparison of captured requests. Never imports a provider or executes media."""
import argparse
import hashlib
import json
from pathlib import Path
import re


class RequestContractError(ValueError):
    pass


_MISSING = {"$absent": True}
_IGNORED = {"/runId", "/outputPrefix", "/finalRequest/runId", "/finalRequest/outputPrefix", "/finalRequest/save/inputs/filename_prefix"}
_SECRETS = {"authorization", "cookie", "setcookie", "secret", "deepseekkey", "xdaelabdeepseekkey"}
_SECRET_SUFFIXES = ("apikey", "accesstoken", "refreshtoken", "bearertoken", "authtoken", "password", "clientsecret", "credential", "credentials")
_MODEL_INPUTS = {"model", "system", "prompt", "negative_prompt", "images", "options", "seed", "noise_seed", "temperature", "num_ctx", "num_predict", "steps", "cfg", "sampler_name", "scheduler", "denoise", "width", "height", "length", "frames", "fps", "resolution", "unet_name", "clip_name", "vae_name", "lora_name", "strength_model", "class_type"}


def canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError, RecursionError):
        raise RequestContractError("Request must be finite JSON.") from None


def sha256(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def validate_payload(value, depth=0, parents=()):
    if depth > 64:
        raise RequestContractError("Request nesting limit exceeded.")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise RequestContractError("Request keys must be text.")
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            if (normalized in _SECRETS or normalized.endswith(_SECRET_SUFFIXES)
                    or normalized in {"key", "token"} and any(p in {"headers", "auth", "connection"} for p in parents)):
                raise RequestContractError("Credential-bearing payload cannot be captured or compared.")
            validate_payload(child, depth + 1, (*parents, normalized))
    elif isinstance(value, list):
        for child in value:
            validate_payload(child, depth + 1, parents)
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        raise RequestContractError("Request must contain only JSON values.")
    if depth == 0:
        canonical(value)


def differences(before, after, pointer=""):
    """Exact JSON values, including numeric equality; capture hashes stay byte-bound."""
    before_json, after_json = canonical(before), canonical(after)
    if pointer in _IGNORED or before_json == after_json:
        return []
    # Python compares int/float exactly without first rounding the integer to
    # float. Exclude bool, and validate finiteness above even on ignored paths.
    if type(before) in (int, float) and type(after) in (int, float) and before == after:
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            path = pointer + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in before or key not in after:
                if path not in _IGNORED:
                    result.append({"path": path, "baselineSha256": sha256(before.get(key, _MISSING)), "studioSha256": sha256(after.get(key, _MISSING))})
            else:
                result.extend(differences(before[key], after[key], path))
        return result
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [change for index, (a, b) in enumerate(zip(before, after)) for change in differences(a, b, f"{pointer}/{index}")]
    return [{"path": pointer or "/", "baselineSha256": sha256(before), "studioSha256": sha256(after)}]


def compare_requests(baseline, studio, explanations=()):
    """An explanation never permits changing effective inputs, weights or parameters."""
    for value in (baseline, studio, list(explanations)):
        validate_payload(value)
    for item in (baseline, studio):
        if not isinstance(item, dict) or not isinstance(item.get("finalRequest"), dict) or not item["finalRequest"] or not isinstance(item.get("effective"), dict) or not item["effective"]:
            raise RequestContractError("Both captures require finalRequest and effective fields.")
    if baseline.get("sampleId") != studio.get("sampleId") or not baseline.get("sampleId"):
        raise RequestContractError("Compare the same registered sample identity.")
    # Provenance and timestamps live outside the compared request projection.
    a = {key: baseline[key] for key in ("finalRequest", "effective")}
    b = {key: studio[key] for key in ("finalRequest", "effective")}
    changes = differences(a, b)
    indexed = {}
    for explanation in explanations:
        required = {"path", "baselineSha256", "studioSha256", "reason", "reviewer"}
        if not isinstance(explanation, dict) or set(explanation) != required or any(not isinstance(explanation[k], str) or not explanation[k].strip() for k in required):
            raise RequestContractError("Every difference explanation needs exact hashes, reason and reviewer.")
        if explanation["path"] in indexed:
            raise RequestContractError("Duplicate difference explanations are invalid.")
        indexed[explanation["path"]] = explanation
    unexplained, immutable, wire_immutable, used = [], [], [], set()
    for change in changes:
        pointer = change["path"]
        if pointer.startswith("/effective/") or pointer == "/effective":
            immutable.append(pointer)
        if pointer.startswith("/finalRequest/") and any(part.replace("~1", "/").replace("~0", "~") in _MODEL_INPUTS for part in pointer.split("/")[2:]):
            wire_immutable.append(pointer)
        explanation = indexed.get(pointer)
        if explanation and all(explanation[key] == change[key] for key in ("baselineSha256", "studioSha256")):
            used.add(pointer)
        else:
            unexplained.append(pointer)
    stale = sorted(set(indexed) - used)
    return {"schemaVersion": 1, "sampleId": baseline["sampleId"], "passed": not (unexplained or immutable or wire_immutable or stale),
            "differences": changes, "unexplained": unexplained, "immutableEffectiveDifferences": immutable,
            "immutableModelRequestDifferences": wire_immutable,
            "unusedOrStaleExplanations": stale, "inferenceAcceptance": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("studio", type=Path)
    parser.add_argument("--explanations", type=Path)
    args = parser.parse_args()
    try:
        result = compare_requests(json.loads(args.baseline.read_text("utf-8")), json.loads(args.studio.read_text("utf-8")),
                                  json.loads(args.explanations.read_text("utf-8")) if args.explanations else [])
    except (RequestContractError, OSError, ValueError):
        print(json.dumps({"passed": False, "error": "Invalid, unreadable or credential-bearing comparison inputs."}))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
