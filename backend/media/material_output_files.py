"""Resolve local generated media references without copying their files."""
import uuid
from pathlib import Path
from urllib.parse import urlsplit, parse_qs


def import_materials(assets, input_root, output_root, *, register=None):
    if not isinstance(assets, list) or not 1 <= len(assets) <= 500:
        raise ValueError('请选择 1–500 个有效素材')
    roots = {'input':Path(input_root).resolve(), 'output':Path(output_root).resolve()}
    result=[]
    for asset in assets:
        if not isinstance(asset,dict): raise ValueError('素材格式无效')
        parsed=urlsplit(asset.get('url',''))
        if parsed.scheme or parsed.netloc or parsed.path != '/view':
            raise ValueError('只支持本地 /view 素材')
        q=parse_qs(parsed.query)
        if any(len(q.get(k,[]))!=1 for k in ('filename','type')) or len(q.get('subfolder',[]))>1:
            raise ValueError('素材地址无效')
        root=roots.get(q['type'][0])
        if root is None: raise ValueError('素材目录无效')
        path=(root/q.get('subfolder',[''])[0]/q['filename'][0]).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('素材文件不存在或超出允许目录')
        kind='image' if path.suffix.lower() in ('.png','.jpg','.jpeg','.webp') else 'video' if path.suffix.lower() in ('.mp4','.webm','.mov') else None
        if kind is None or asset.get('kind')!=kind: raise ValueError('素材类型不匹配')
        subfolder=path.parent.relative_to(root).as_posix()
        reference=f"{q['type'][0]}/{subfolder}/{path.name}"
        item=dict(version=1,id=asset.get('id') or uuid.uuid5(uuid.NAMESPACE_URL,reference).hex,kind=kind,
            name=asset.get('name') or path.name,filename=path.name,
            subfolder=subfolder,type=q['type'][0],size=path.stat().st_size,
            provenance=asset.get('provenance',{}))
        if register is not None:
            # Preserve occurrence ID/provenance; the catalog supplies content identity.
            local={key:item[key] for key in ('version','kind','name','filename','subfolder','type')}
            for key in ('assetId','referenceId','contentSha256','byteSize'):
                if key in asset: local[key]=asset[key]
            provenance=asset.get('provenance') if isinstance(asset.get('provenance'),dict) else {}
            source={key:provenance[key] for key in ('documentId','tableId','recordId','fieldId','requestId') if isinstance(provenance.get(key),str) and provenance[key]}
            occurrence=provenance.get('materialId',provenance.get('assetId',asset.get('id')))
            if isinstance(occurrence,str) and occurrence: source['occurrenceId']=occurrence
            registration=register({'kind':kind,'name':item['name'],'asset':local,'source':source})
            item.update(registration['asset'])
            item['size']=registration['byteSize']
        result.append(item)
    return result
