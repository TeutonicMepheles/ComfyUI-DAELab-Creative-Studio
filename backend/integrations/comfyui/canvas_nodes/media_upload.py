"""Local media source; no upstream imports or generation services."""
import json
from pathlib import Path
from urllib.parse import urlencode

import folder_paths
from comfy_api.latest import io, InputImpl
from .asset_binding import asset_catalog, consume_source
from ..asset_api import register_asset


def resolve_asset(raw):
    asset = json.loads(raw)
    if not isinstance(asset, dict):
        raise ValueError("素材引用格式无效")
    roots = {'input': folder_paths.get_input_directory(), 'output': folder_paths.get_output_directory()}
    source_type = asset.get('type', 'input')
    if source_type not in roots:
        raise ValueError('素材目录类型无效')
    root = Path(roots[source_type]).resolve()
    path = (root / asset.get('subfolder', '') / asset.get('filename', '')).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('素材文件不存在或超出允许目录，请重新添加')
    kind = 'image' if path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp') else 'video' if path.suffix.lower() in ('.mp4', '.webm', '.mov') else None
    if kind is None or asset.get('kind') != kind:
        raise ValueError('不支持的素材格式')
    reference = dict(version=1,kind=kind,name=asset.get('name') or path.name,filename=path.name,
                     subfolder=path.parent.relative_to(root).as_posix() if path.parent != root else '',type=source_type)
    for key in ('assetId','referenceId','contentSha256','byteSize'):
        if key in asset: reference[key]=asset[key]
    source=consume_source('native-media-consume')
    if 'nodeId' in asset: source['nodeId']=str(asset['nodeId'])
    register_asset(asset_catalog(),{'kind':kind,'name':reference['name'],'asset':reference,'source':source})
    url = '/view?' + urlencode(dict(filename=path.name, subfolder=path.parent.relative_to(root).as_posix(), type=source_type))
    return path, kind, url


class MediaUpload(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.MediaUpload', display_name='上传', category='DAELab/素材',
            inputs=[io.String.Input('asset_data', default='{}', multiline=True)],
            outputs=[io.Custom('COMFYTV_IMAGE').Output('image_ref'), io.Custom('COMFYTV_IMAGES').Output('image_refs'),
                     io.Custom('COMFYTV_VIDEO').Output('video_ref'), io.Image.Output('image'), io.Video.Output('video')])

    @classmethod
    def execute(cls, asset_data):
        path, kind, url = resolve_asset(asset_data)
        if kind == 'video':
            return io.NodeOutput(None, [], url, None, InputImpl.VideoFromFile(str(path)))
        import numpy as np
        import torch
        from PIL import Image, ImageOps
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
            tensor = torch.from_numpy(np.asarray(image).astype(np.float32) / 255.0).unsqueeze(0)
        return io.NodeOutput(url, json.dumps({'images': [{'image_url': url}]}), None, tensor, None)


NODE_CLASS_MAPPINGS = {'DAELAB.MediaUpload': MediaUpload}
NODE_DISPLAY_NAME_MAPPINGS = {'DAELAB.MediaUpload': '上传'}
