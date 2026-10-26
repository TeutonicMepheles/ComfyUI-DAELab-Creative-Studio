"""Single ComfyUI package entry. All registration is owned by the assembly layer."""
from .backend.integrations.comfyui.bootstrap import assemble

NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = assemble(__file__)
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
