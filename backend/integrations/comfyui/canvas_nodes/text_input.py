from comfy_api.latest import io
from .asset_binding import asset_catalog, consume_source


class TextInput(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.TextInput', display_name='输入文本', category='DAELab/素材',
                         inputs=[io.String.Input('text', default='', multiline=True)],
                         outputs=[io.String.Output('text')])

    @classmethod
    def execute(cls, text=''):
        catalog = asset_catalog()
        if text:
            catalog.register_text(text, provenance=consume_source('native-text-consume'))
        return io.NodeOutput(text)
