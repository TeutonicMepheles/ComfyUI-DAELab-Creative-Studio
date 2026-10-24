"""Prepare immutable old/new local GPU evaluation environments; never launch them.

All code comes from named Git commits. Models are referenced read-only through an
explicit path map. A launch plan is evidence preparation, not GPU admission or a
permission to run any request. Existing environments are preserved on every error.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

from tools.host.prepare_baseline import (
    _plain_ancestors, _git, _sha, _write_new, archive_members, extract_new, verify_snapshot,
)

OWNER = "creative-studio-gpu-eval-preparation-v1"
PINNED_SOURCES = {
    "canvas": "3176b5a67dbcd0b66f795976e5a81bcdfe346093",
    "business": "7ff56cb51ef6f7fc3bcf5707792d655037c61b30",
    "ggufPlugin": "373048b8403a7820620065210a691263d4da0a61",
}


def _read(path):
    return json.loads(Path(path).read_text("utf-8-sig"))


def _commit(repo, revision):
    actual = _git(str(repo), "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    if actual != revision:
        raise ValueError("Use a full immutable commit identity")
    tree = _git(str(repo), "ls-tree", "-rz", revision)
    if any(row and not row.startswith((b"100644 blob ", b"100755 blob ")) for row in tree.split(b"\0")):
        raise ValueError("Snapshot contains a link or submodule; inspect it explicitly")


def model_bindings(runtime):
    """Map only the recorded fixed files, preserving their category and hash."""
    root = Path(runtime["weightRoot"]).resolve()
    indexed = {entry["path"]: entry for entry in runtime["weights"]}
    names = {
        "image": {
            "diffusion_models": "diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors",
            "text_encoders": "text_encoders/Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf",
            "mmproj": "text_encoders/mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf",
            "vae": "vae/qwen_image_2.1_vae_bf16.safetensors",
        },
        "video": {
            "diffusion_models": "diffusion_models/MiniMax-H3_FL2VA-NVFP4.safetensors",
            "text_encoders": "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
            "video_vae": "vae/minimax_h3_video_vae_fp16.safetensors",
            "audio_vae": "vae/minimax_h3_audio_vae_fp32.safetensors",
        },
    }
    bindings = {}
    for kind, categories in names.items():
        bindings[kind] = {}
        for category, relative in categories.items():
            record = indexed[relative]
            file = (root / relative).resolve()
            if not file.is_relative_to(root) or not file.is_file() or file.stat().st_size != record["bytes"]:
                raise ValueError("Recorded model is missing or its size changed: " + relative)
            if len(record["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in record["sha256"]):
                raise ValueError("Recorded model hash is invalid")
            bindings[kind][category] = {"name": file.name, "path": str(file), "sha256": record["sha256"]}
    return bindings


def plan(runtime_file, studio_repository, studio_commit, destination, old_port, new_port):
    runtime_file, studio_repository, destination = map(lambda p: Path(p).resolve(),
                                                       (runtime_file, studio_repository, destination))
    _plain_ancestors(destination)
    if destination.exists():
        raise ValueError("Choose a new evaluation root; existing evidence is never replaced")
    if len({old_port, new_port}) != 2 or any(type(p) is not int or not 1024 <= p <= 65535 or p == 8000 for p in (old_port, new_port)):
        raise ValueError("Two distinct non-production ports are required")
    runtime = _read(runtime_file)
    host = Path(runtime["host"]["root"]).resolve()
    python = Path(runtime["host"]["python"]).resolve()
    production = (Path.home() / "Documents/ComfyUI").resolve()
    protected = [host, production, Path(runtime["weightRoot"]).resolve()]
    sources = []
    for key, expected in PINNED_SOURCES.items():
        source = runtime["sourceBaselines"][key]
        if source["commit"] != expected:
            raise ValueError("Recorded source differs from the approved migration baseline")
        repo = Path(source["path"]).resolve()
        _commit(repo, expected)
        protected.append(repo)
        sources.append({"key": key, "name": repo.name, "repository": str(repo), "commit": expected})
    if any(destination == p or destination.is_relative_to(p) or p.is_relative_to(destination) for p in protected):
        raise ValueError("Evaluation data cannot overlap protected host, model or production roots")
    if not destination.is_relative_to(studio_repository / ".local"):
        raise ValueError("Raw evaluation preparation must stay inside the new repository's ignored .local")
    _commit(studio_repository, studio_commit)
    _git(str(studio_repository), "show", studio_commit + ":__init__.py")
    build = json.loads(_git(str(studio_repository), "show", studio_commit + ":web/build-manifest.json"))
    if not build.get("sourceFingerprint") or not build.get("files"):
        raise ValueError("Studio commit has no complete frontend build identity")
    _commit(host, runtime["host"]["gitHead"])
    if _git(str(host), "rev-parse", "HEAD").decode().strip() != runtime["host"]["gitHead"]:
        raise ValueError("Live ComfyUI host HEAD differs from the fixed evaluation commit")
    if _git(str(host), "status", "--porcelain").strip():
        raise ValueError("Fixed ComfyUI host has local changes")
    if not python.is_file() or not (host / "main.py").is_file() or (host / "extra_model_paths.yaml").exists():
        raise ValueError("Host executable/layout or implicit model paths changed")
    bindings = model_bindings(runtime)
    sources.append({"key": "studio", "name": "ComfyUI-DAELab-Creative-Studio",
                    "repository": str(studio_repository), "commit": studio_commit})
    return {"schemaVersion": 1, "owner": OWNER, "destination": str(destination),
            "runtimeFile": str(runtime_file), "runtimeFileSha256": _sha(runtime_file), "host": str(host), "python": str(python),
            "hostCommit": runtime["host"]["gitHead"], "sources": sources,
            "ports": {"baseline": old_port, "studio": new_port}, "bindings": bindings,
            "modelRoot": str(Path(runtime["weightRoot"]).resolve()), "ollama": runtime["ollama"],
            "activationAllowed": False, "modelsRehashedAtPreparation": False,
            "requirementsBeforeStart": ["Review the exact Studio commit and dependency closure",
                "Establish an exclusive local GPU test window without mutating production",
                "Reverify all actual model hashes and Ollama identity at inference admission",
                "Capture native websocket execution and assert sampler nodes ran once",
                "Preserve first failures and every output; no model or cloud fallback"]}


def prepare(configuration):
    studio = next(item for item in configuration["sources"] if item["key"] == "studio")
    checked = plan(configuration["runtimeFile"], studio["repository"], studio["commit"],
                   configuration["destination"], configuration["ports"]["baseline"], configuration["ports"]["studio"])
    if checked != configuration:
        raise ValueError("Preparation configuration changed after validation")
    root = Path(configuration["destination"])
    _plain_ancestors(root)
    if root.exists():
        raise ValueError("Evaluation destination appeared; nothing was overwritten")
    root.mkdir(parents=True)
    _write_new(root / "preparation.json", configuration)
    archives = root / "archives"
    archives.mkdir()
    by_key = {item["key"]: item for item in configuration["sources"]}
    archived = {}
    for key, source in by_key.items():
        archive = archives / (source["name"] + ".zip")
        with archive.open("xb") as stream:
            result = subprocess.run(["git", "-C", source["repository"], "archive", "--format=zip", source["commit"]],
                                    stdout=stream, stderr=subprocess.PIPE)
        if result.returncode:
            raise ValueError("Git archive failed; partial preparation remains for inspection")
        archived[key] = {"archive": str(archive), "sha256": _sha(archive), "files": archive_members(archive)}
    environments = {}
    for variant, keys in (("baseline", ("canvas", "business", "ggufPlugin")), ("studio", ("studio", "ggufPlugin"))):
        environment = root / variant
        for name in ("user", "input", "output", "temp", "models", "custom_nodes", "logs", "evidence"):
            (environment / name).mkdir(parents=True)
        for key in keys:
            source, snapshot = by_key[key], archived[key]
            target = environment / "custom_nodes" / source["name"]
            extract_new(Path(snapshot["archive"]), target, snapshot["files"])
            verify_snapshot(target, snapshot["files"])
        # JSON is valid YAML and prevents path quoting/injection mistakes.
        paths = environment / "fixed-model-paths.yaml"
        _write_new(paths, {"fixed_eval": {"base_path": configuration["modelRoot"],
                                        "diffusion_models": "diffusion_models", "text_encoders": "text_encoders", "vae": "vae"}})
        command = [configuration["python"], "-s", str(Path(configuration["host"]) / "main.py"),
                   "--base-directory", str(environment), "--user-directory", str(environment / "user"),
                   "--input-directory", str(environment / "input"), "--output-directory", str(environment / "output"),
                   "--temp-directory", str(environment / "temp"), "--database-url", "sqlite:///" + (environment / "user/comfyui.db").as_posix(),
                   "--extra-model-paths-config", str(paths), "--listen", "127.0.0.1", "--port", str(configuration["ports"][variant]),
                   "--cache-none", "--offline", "--disable-auto-launch", "--disable-all-custom-nodes",
                   "--whitelist-custom-nodes", *[by_key[key]["name"] for key in keys],
                   "--feature-flag", "enable_telemetry=false"]
        environments[variant] = {"root": str(environment), "command": command, "snapshots": {key: archived[key] for key in keys},
                                 "generationRequests": 0, "samplerExecutions": 0, "cachePolicy": "none", "activationAllowed": False}
        _write_new(environment / "evaluation-host.json", environments[variant])
    _write_new(root / "prepared.json", {"configuration": configuration, "environments": environments,
                                      "status": "prepared-not-started", "modelDownloads": 0})
    return environments


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--studio-repository", required=True)
    parser.add_argument("--studio-commit", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--old-port", type=int, required=True)
    parser.add_argument("--new-port", type=int, required=True)
    args = parser.parse_args()
    config = plan(args.runtime, args.studio_repository, args.studio_commit, args.destination, args.old_port, args.new_port)
    result = prepare(config)
    print(json.dumps({"status": "prepared-not-started", "roots": {key: value["root"] for key, value in result.items()}, "activationAllowed": False}))


if __name__ == "__main__":
    main()
