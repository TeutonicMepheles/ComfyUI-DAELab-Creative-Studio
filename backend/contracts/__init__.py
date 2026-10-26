"""Host-independent contracts. These modules never import providers or ComfyUI."""

from .errors import Conflict, InvalidInput, InvalidTransition, MissingRecord, StorageError

__all__ = ["Conflict", "InvalidInput", "InvalidTransition", "MissingRecord", "StorageError"]
