"""Test package-only diagnostics node; its execution never dispatches work."""
import json

NODE_ID = 'StudioTest.GenerationFixture'


def register_generation_fixture_nodes(controller):
    class GenerationFixtureControl:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'label': ('STRING', {'default': 'Explicit isolated test controls'})}}
        RETURN_TYPES = ('STRING',)
        FUNCTION = 'read'
        CATEGORY = 'Studio Acceptance ONLY'
        OUTPUT_NODE = True

        def read(self, label):
            return (json.dumps(controller.info(), ensure_ascii=False),)

    return {NODE_ID: GenerationFixtureControl}, {NODE_ID: '生成故障夹具（仅隔离验收）'}
