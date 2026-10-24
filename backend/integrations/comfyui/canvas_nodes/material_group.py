"""Ordered local media collections; consumers own any table or generation mapping."""
import json
from comfy_api.latest import io
from .media_upload import resolve_asset
from .asset_binding import asset_catalog, consume_source


class MaterialGroup(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.MaterialGroup', display_name='素材组', category='DAELab/素材',
            inputs=[io.String.Input('collection_data', default='{"version":1,"assets":[]}', multiline=True)],
            outputs=[io.Custom('DAELAB_ASSETS').Output('assets')])

    @classmethod
    def execute(cls, collection_data):
        collection = json.loads(collection_data)
        if not isinstance(collection, dict) or collection.get('version') != 1 or not isinstance(collection.get('assets'), list):
            raise ValueError('素材组数据格式不正确')
        catalog = asset_catalog()
        if collection.get('ready') is False:
            raise ValueError('素材组包含未就绪来源，请先修复')
        texts = collection.get('texts', [])
        if not isinstance(texts, list) or any(not isinstance(text, str) for text in texts):
            raise ValueError('素材组文本快照格式不正确')
        sources = collection.get('textSources', [])
        if not isinstance(sources,list) or sources and (len(sources)!=len(texts) or any(not isinstance(item,str) for item in sources)):
            raise ValueError('素材组文本来源格式不正确')
        for index,text in enumerate(texts):
            source = consume_source('native-group-text-consume')
            if sources: source['nodeId']=sources[index]
            if text: catalog.register_text(text, provenance=source)
        assets = []
        for asset in collection['assets']:
            if not isinstance(asset, dict) or asset.get('missing'):
                raise ValueError('素材组有缺失素材，请先修复')
            _, kind, url = resolve_asset(json.dumps(asset))
            assets.append({**asset, 'kind': kind, 'url': url})
        return io.NodeOutput({'version': 1, 'assets': assets, **({'texts':texts} if 'texts' in collection else {})})
