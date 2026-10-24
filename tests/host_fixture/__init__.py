"""Test-only fixture installed explicitly in the isolated host; excluded from releases."""
class StudioAcceptancePanel:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"default": "测试内容", "multiline": True})}}
    RETURN_TYPES = ("STRING",)
    FUNCTION = "read"
    CATEGORY = "Studio Acceptance ONLY"

    def read(self, text):
        return (text,)

NODE_CLASS_MAPPINGS = {"StudioTest.Panel": StudioAcceptancePanel}
NODE_DISPLAY_NAME_MAPPINGS = {"StudioTest.Panel": "隔离验收面板"}
WEB_DIRECTORY = "./web"


def install_generation_fixture(server):
    from .generation_fixture import assemble_generation_fixture, register_generation_fixture_routes
    from .generation_fixture_nodes import register_generation_fixture_nodes
    core = getattr(server, "_creative_studio_services", None)
    if core is None:
        raise RuntimeError("The isolated fixture requires the product's existing CoreServices; load the product first.")
    fixture = assemble_generation_fixture(core, enabled=True)
    register_generation_fixture_routes(server, fixture)
    nodes, names = register_generation_fixture_nodes(fixture)
    NODE_CLASS_MAPPINGS.update(nodes)
    NODE_DISPLAY_NAME_MAPPINGS.update(names)
    server._creative_studio_generation_fixture = fixture


from server import PromptServer
install_generation_fixture(PromptServer.instance)
from .asset_cache import install_test_asset_cache_policy
install_test_asset_cache_policy(PromptServer.instance)
