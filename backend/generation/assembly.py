"""Explicit dependency composition; importing or constructing never starts a model."""
from .service import GenerationService
from .admission import LocalAdmission
from .media import read_frozen, stage_native_input
from ..providers.native import NativeProvider, ModelInventory
from ..providers.qwen import QwenProvider, LoopbackOllama


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
        for kind in ('image', 'video'):
            inventory = ModelInventory((model_bindings or {}).get(kind, {}), node_types, resolve_model)
            provider = NativeProvider(kind, inventory=inventory, queue=native_queue,
                                      media_input=lambda item: stage_native_input(core.assets, item))
            providers[provider.id] = provider
    return GenerationService(core.jobs, core.assets, providers=providers, admission=admission)
