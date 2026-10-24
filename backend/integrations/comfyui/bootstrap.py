"""Fail closed on duplicate installations before registering nodes or routes."""
from pathlib import Path
import sqlite3

LEGACY_PACKAGES = frozenset({
    "ComfyUI-DAELab-Creative-Canvas", "ComfyUI-DAELab-Custom-Nodes-Library",
})


def detect_conflicts(package_root: Path, custom_node_roots: list[Path]) -> list[Path]:
    current = package_root.resolve()
    conflicts = []
    for root in custom_node_roots:
        if not root.is_dir():
            continue
        for child in root.iterdir():
            if not child.is_dir() or child.resolve() == current:
                continue
            if child.name.endswith('.disabled'):
                continue
            if child.name in LEGACY_PACKAGES and (child / "__init__.py").is_file():
                conflicts.append(child.resolve())
            elif (child / "pyproject.toml").is_file():
                import tomllib
                try:
                    project = tomllib.loads((child / "pyproject.toml").read_text("utf-8"))
                except (ValueError, OSError):
                    continue
                if project.get("project", {}).get("name") in {
                    "comfyui-daelab-creative-studio", "comfyui-daelab-creative-canvas",
                    "comfyui-daelab-custom-nodes-library",
                }:
                    conflicts.append(child.resolve())
            entry = child / "__init__.py"
            if entry.is_file():
                text = entry.read_text("utf-8", errors="replace")
                if "from .nodes.daelab_comfytv_storyboard import" in text and "LIBTV_NODES" in text:
                    conflicts.append(child.resolve())
    return sorted(set(conflicts))


def assemble(entry_file: str):
    import folder_paths
    root = Path(entry_file).resolve().parent
    conflicts = detect_conflicts(root, [Path(p) for p in folder_paths.get_folder_paths("custom_nodes")])
    if conflicts:
        paths = "; ".join(map(str, conflicts))
        raise RuntimeError(f"Creative Studio refused duplicate ownership of DAELAB.MediaUpload, DAELAB.TextInput, DAELAB.MaterialGroup, DAELAB.VideoEdit and/or business node IDs. Disable conflicting packages first: {paths}")
    from server import PromptServer
    from .diagnostics import register_diagnostics
    register_diagnostics(PromptServer.instance, root)
    from .services import register_core_services
    from ...contracts.errors import StorageError
    services = None
    try:
        services = register_core_services(PromptServer.instance,
                                         user_directory=folder_paths.get_user_directory(),
                                         input_directory=folder_paths.get_input_directory(),
                                         output_directory=folder_paths.get_output_directory(),
                                         temp_directory=folder_paths.get_temp_directory())
    except (OSError, sqlite3.Error, StorageError) as error:
        # Core diagnostics stay available even when persistent storage is unavailable.
        PromptServer.instance._creative_studio_storage_error = f"Persistent storage unavailable ({type(error).__name__}); repair user-directory access before editing assets or submitting jobs."
    from . import canvas_nodes, business_nodes, generation_nodes
    canvas_mappings, canvas_names = canvas_nodes.register_nodes(asset_catalog=services.assets if services else None)
    business_mappings, business_names = business_nodes.register_nodes()
    if canvas_mappings.keys() & business_mappings.keys():
        raise RuntimeError("Creative Studio internal node ownership overlaps")
    integrated = {"canvas", "table", "editor"}
    generation = None
    media_exports = None
    if services is not None:
        from ...storyboard.services import StoryboardServices
        from ...prompt.local_media import LocalMediaResolver
        documents = StoryboardServices(
            cache_directory=Path(folder_paths.get_user_directory()) / "daelab" / "creative-studio" / "documents",
            input_directory=folder_paths.get_input_directory(),
            local_media=LocalMediaResolver(catalog=services.assets),
            asset_catalog=services.assets,
        )
        business_nodes.register_routes(PromptServer.instance, documents)
        PromptServer.instance._creative_studio_documents = documents
        integrated.update(("storyboard", "prompt-configuration"))
        from ...generation.assembly import assemble_generation
        from .local_generation import assemble_host_generation, create_host_queue
        from ...media.export_service import ExportService
        native_queue = create_host_queue(PromptServer.instance)
        media_exports = ExportService(services.jobs, services.assets, native_queue=native_queue, resources=services.resources)
        PromptServer.instance._creative_studio_media_exports = media_exports
        # The shared ledger and HTTP surface are present independently of model readiness.
        # Local providers require a separate explicit, verified host configuration.
        try:
            generation = assemble_host_generation(PromptServer.instance, services, folder_paths, native_queue=native_queue)
        except (OSError, ValueError, TypeError):
            generation = assemble_generation(services)
            PromptServer.instance._creative_studio_generation_configuration_error = (
                "local-generation.json is invalid or unreadable; repair the explicit local model configuration and restart ComfyUI. No provider was activated.")
        generation_nodes.register_routes(PromptServer.instance, generation)
        PromptServer.instance._creative_studio_generation = generation
        integrated.update(("prompt", "generation"))
    canvas_nodes.register_routes(PromptServer.instance, export_service=media_exports,
                                 asset_catalog=services.assets if services else None)
    generation_mappings, generation_names = generation_nodes.register_nodes(generation)
    if generation_mappings.keys() & (canvas_mappings.keys() | business_mappings.keys()):
        raise RuntimeError("Creative Studio internal generation node ownership overlaps")
    from ....compat.workflows import readonly_node_mappings
    compatibility_mappings = readonly_node_mappings()
    if compatibility_mappings.keys() & (canvas_mappings.keys() | business_mappings.keys() | generation_mappings.keys()):
        raise RuntimeError("Creative Studio internal compatibility node ownership overlaps")
    compatibility_names = {key: key.rsplit('.', 1)[-1] + ' · 历史只读' for key in compatibility_mappings}
    PromptServer.instance._creative_studio_integrated = frozenset(integrated)
    # The acceptance fixture is installed only by the isolated host harness.
    # No provider transport, worker, model process or generation is started here.
    return {**canvas_mappings, **business_mappings, **generation_mappings, **compatibility_mappings}, {**canvas_names, **business_names, **generation_names, **compatibility_names}
