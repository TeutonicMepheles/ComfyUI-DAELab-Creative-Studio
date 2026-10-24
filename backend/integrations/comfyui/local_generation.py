"""Explicit host-local model configuration. No discovery, model startup or download."""
from __future__ import annotations

import json
from pathlib import Path
import re

from ...generation.assembly import assemble_generation
from ...generation.admission import complete_blocking
from ...providers.qwen_binding import QwenModelBinding

SHA = re.compile(r"^[a-f0-9]{64}$")


def _path(value):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError("Model configuration requires explicit absolute local paths")
    return str(Path(value).resolve())


def read_configuration(user_directory):
    file = Path(user_directory).resolve() / "daelab/creative-studio/local-generation.json"
    if not file.is_file():
        return None
    with file.open("rb") as stream:
        raw = stream.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError("Local model configuration exceeds the supported size")
    config = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(config, dict) or set(config) - {"schemaVersion", "enabled", "modelBindings", "qwenBinding", "resourceLock"}:
        raise ValueError("Unsupported local model configuration fields")
    if type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1 or type(config.get("enabled")) is not bool:
        raise ValueError("Local model configuration version or enabled flag is invalid")
    if not config["enabled"]:
        return None
    lock = _path(config.get("resourceLock"))
    if Path(lock).suffix != '.lock' or Path(lock).is_dir():
        raise ValueError("Use a dedicated .lock file for shared local resource admission")
    bindings = config.get("modelBindings", {})
    if not isinstance(bindings, dict) or set(bindings) - {"image", "video"}:
        raise ValueError("Only the fixed local image and video model families are supported")
    permitted = {"image": {"diffusion_models", "text_encoders", "mmproj", "vae"},
                 "video": {"diffusion_models", "text_encoders", "video_vae", "audio_vae", "loras"}}
    normalized = {}
    for kind, categories in bindings.items():
        if not isinstance(categories, dict) or set(categories) - permitted[kind]:
            raise ValueError("Unknown model category in the explicit local binding")
        normalized[kind] = {}
        for category, item in categories.items():
            if not isinstance(item, dict) or set(item) != {"name", "path", "sha256"}:
                raise ValueError("Each fixed model requires only name, path and SHA256")
            if not isinstance(item["name"], str) or not item["name"].strip() or not isinstance(item["sha256"], str) or not SHA.fullmatch(item["sha256"]):
                raise ValueError("Fixed model name or SHA256 is invalid")
            normalized[kind][category] = {**item, "path": _path(item["path"])}
    qwen = config.get("qwenBinding")
    if qwen is not None:
        keys = {"manifestPath", "installedManifestPath", "blobsRoot", "manifestSha256", "blobs"}
        if not isinstance(qwen, dict) or set(qwen) != keys:
            raise ValueError("Local Qwen requires an explicit registry manifest and blob binding")
        if not isinstance(qwen["manifestSha256"], str) or not SHA.fullmatch(qwen["manifestSha256"]) or not isinstance(qwen["blobs"], list):
            raise ValueError("Local Qwen manifest hash or blob list is invalid")
        roles = set()
        for item in qwen["blobs"]:
            if not isinstance(item, dict) or set(item) != {"role", "bytes", "sha256"}:
                raise ValueError("Each Qwen blob requires only role, bytes and SHA256")
            if item["role"] not in {"model", "projector", "config", "template", "license", "params"} or item["role"] in roles or type(item["bytes"]) is not int or item["bytes"] <= 0 or not isinstance(item["sha256"], str) or not SHA.fullmatch(item["sha256"]):
                raise ValueError("Qwen blob identity, size or hash is invalid")
            roles.add(item["role"])
        if len(roles) != 6:
            raise ValueError("All six fixed Qwen blobs must be declared")
        # The provider checks exact roles, sizes, manifest membership and all bytes
        # off the event loop at admission. Parsing never loads the model files.
        qwen = {**qwen, **{key: _path(qwen[key]) for key in ("manifestPath", "installedManifestPath", "blobsRoot")}}
    return {"resourceLock": lock, "modelBindings": normalized, "qwenBinding": qwen}


def compose_configured_generation(core, config, *, native_queue, node_types, resolve_model, release_native_models):
    """The host supplies execution capabilities; parsing cannot provide executable code."""
    if config is None:
        return assemble_generation(core)
    qwen = config["qwenBinding"]
    binding = QwenModelBinding(manifest_path=qwen["manifestPath"], installed_manifest_path=qwen["installedManifestPath"],
                               blobs_root=qwen["blobsRoot"], expected_manifest_sha256=qwen["manifestSha256"],
                               expected_blobs=qwen["blobs"]) if qwen is not None else None
    return assemble_generation(core, enable_local=True, native_queue=native_queue, node_types=node_types,
                               resolve_model=resolve_model, qwen_binding=binding,
                               model_bindings=config["modelBindings"], lock_path=config["resourceLock"],
                               release_native_models=release_native_models)


def create_host_queue(server):
    """One host-owned native queue port shared by generation and media export."""
    import execution
    import comfy.model_management as model_management
    from .generation_nodes.native_host import ComfyNativeQueue, owned_native_interrupt
    return ComfyNativeQueue(server, execution.validate_prompt,
                            interrupt_owned=owned_native_interrupt(server.prompt_queue, model_management.interrupt_current_processing))


def assemble_host_generation(server, core, folder_paths, *, native_queue=None):
    config = read_configuration(folder_paths.get_user_directory())
    if config is None:
        return assemble_generation(core)
    import nodes
    from .generation_nodes.native_host import install_native_admission
    async def release_native_models():
        # Model disposal can synchronously wait for GPU work and collect memory.
        # The physical lease and native-queue busy checks already exclude inference.
        def release():
            import comfy.model_management as model_management
            model_management.unload_all_models()
            model_management.soft_empty_cache()
        await complete_blocking(release)
    queue = native_queue if native_queue is not None else create_host_queue(server)
    generation = compose_configured_generation(core, config, native_queue=queue,
                                               node_types=lambda: nodes.NODE_CLASS_MAPPINGS,
                                               resolve_model=folder_paths.get_full_path,
                                               release_native_models=release_native_models)
    install_native_admission(server, generation.admission)
    return generation
