"""Explicit dependency composition; importing or constructing never starts a model."""
from .service import GenerationService
from .admission import LocalAdmission
from .media import read_frozen, stage_native_input, frozen_image_dimensions
from ..providers.native import NativeProvider, ModelInventory
from ..providers.qwen import QwenProvider, LoopbackOllama
from ..providers.native_text import NativeTextProvider
from ..providers.native_27b import Native27BProvider
from ..providers.high_video import HighVideoProvider


def assemble_generation(core, *, native_queue=None, model_bindings=None, node_types=None,
                        resolve_model=None, qwen_binding=None, lock_path=None, release_native_models=None, enable_local=False, ollama_transport=None):
    providers, admission = {}, None
    if enable_local:
        if native_queue is None or node_types is None or resolve_model is None or lock_path is None:
            raise ValueError('Local generation requires explicit native queue, inventory and resource lock.')
        transport = ollama_transport if ollama_transport is not None else LoopbackOllama()
        admission = LocalAdmission(lock_path, native_busy=native_queue.busy,
                                   ensure_unloaded=transport.ensure_unloaded, release_native_models=release_native_models)
        providers['local-qwen-text'] = QwenProvider(transport=transport, binding=qwen_binding, read_frozen=lambda item: read_frozen(core.assets, item))
        if 'text_pe' in (model_bindings or {}):
            provider = NativeTextProvider(inventory=ModelInventory(model_bindings['text_pe'], node_types, resolve_model),
                                          queue=native_queue, media_input=lambda item: stage_native_input(core.assets, item))
            providers[provider.id] = provider
        if 'text_27b' in (model_bindings or {}):
            provider = Native27BProvider(inventory=ModelInventory(model_bindings['text_27b'], node_types, resolve_model),
                                         queue=native_queue, media_input=lambda item: stage_native_input(core.assets, item))
            providers[provider.id] = provider
        for family in ('video_high', 'video_reference_high'):
            if family not in (model_bindings or {}):
                continue
            provider = HighVideoProvider(reference=family == 'video_reference_high',
                inventory=ModelInventory(model_bindings[family], node_types, resolve_model), queue=native_queue,
                media_input=lambda item: stage_native_input(core.assets, item))
            providers[provider.id] = provider
        profiles = {
            'image': ('image', False, 'turbo', 'turbo'),
            'image_base': ('image', False, 'base', 'turbo'),
            'video': ('video', False, 'turbo', 'turbo'),
            'video_reference': ('video', True, 'turbo', 'turbo'),
            'video_base': ('video', False, 'turbo', 'base'),
            'video_reference_base': ('video', True, 'turbo', 'base'),
        }
        for binding_kind, (kind, reference, image_profile, video_profile) in profiles.items():
            if binding_kind.endswith('_base') and binding_kind not in (model_bindings or {}):
                continue
            inventory = ModelInventory((model_bindings or {}).get(binding_kind, {}), node_types, resolve_model)
            provider = NativeProvider(kind, inventory=inventory, queue=native_queue,
                                      media_input=lambda item: stage_native_input(core.assets, item), reference=reference,
                                      image_dimensions=lambda item: frozen_image_dimensions(core.assets, item), image_profile=image_profile, video_profile=video_profile)
            providers[provider.id] = provider
    return GenerationService(core.jobs, core.assets, providers=providers, admission=admission, resources=core.resources)
