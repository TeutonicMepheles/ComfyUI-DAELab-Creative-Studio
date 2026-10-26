"""Read-only adapter for Creative Canvas v1 browser favorites.

The full original entry is retained in the origin ledger; this module never
changes browser storage and never adopts arbitrary filesystem paths.
"""
from pathlib import PurePosixPath
from urllib.parse import urlsplit

if __package__ == 'compat.legacy':  # Standalone pure tests, without importing the host entrypoint.
    from backend.contracts.errors import ContractError, InvalidInput
    from backend.contracts.validation import clean_json, identity, safe_label
else:
    from ...backend.contracts.errors import ContractError, InvalidInput
    from ...backend.contracts.validation import clean_json, identity, safe_label


def normalize_favorite(value, *, legacy=False):
    if not isinstance(value, dict):
        raise InvalidInput('收藏需要对象')
    clean_json(value, max_bytes=1024 * 1024)
    if not legacy and set(value) - {'kind', 'name', 'text', 'asset'}:
        raise InvalidInput('收藏包含未知字段')
    name = safe_label(value.get('name', '未命名素材'), limit=240).strip() or '未命名素材'
    kind = value.get('kind')
    if kind == 'text':
        text = value.get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 100000:
            raise InvalidInput('文本为空或超过 100000 字符')
        result = {'kind': kind, 'display_name': name, 'text': text}
    else:
        asset = value.get('asset', value if legacy else None)
        if not isinstance(asset, dict):
            raise InvalidInput('收藏缺少本地素材引用')
        if not legacy and set(asset) - {'version', 'kind', 'name', 'filename', 'subfolder', 'type'}:
            raise InvalidInput('素材引用包含未知字段')
        filename, subfolder, root = asset.get('filename'), asset.get('subfolder', ''), asset.get('type', 'input')
        if (not isinstance(filename, str) or not filename or len(filename) > 512
                or any(c in filename for c in '/\\:\x00') or filename in ('.', '..')
                or not isinstance(subfolder, str) or len(subfolder) > 1024
                or subfolder.startswith('/') or any(c in subfolder for c in '\\:\x00')
                or '..' in subfolder.split('/') or root not in ('input', 'output')):
            raise InvalidInput('素材引用必须是当前 ComfyUI 输入或输出目录内的相对文件')
        suffix = PurePosixPath(filename).suffix.lower()
        expected = 'image' if suffix in ('.png', '.jpg', '.jpeg', '.webp') else 'video' if suffix in ('.mp4', '.webm', '.mov') else None
        if expected is None or kind != expected or asset.get('kind') != kind:
            raise InvalidInput('素材格式与类型不匹配')
        result = {'kind': kind, 'display_name': name, 'root': root,
                  'filename': str(PurePosixPath(subfolder, filename))}
    if legacy:
        result.update(legacy_id=identity(value.get('id'), 'legacy favorite ID'), legacy_raw=value)
    return result


def import_browser_favorites(catalog, *, origin, document):
    url = urlsplit(origin if isinstance(origin, str) else '')
    if url.scheme not in ('http', 'https') or not url.netloc or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise InvalidInput('请提供旧收藏的服务 origin，例如 http://127.0.0.1:8000')
    origin = url.scheme + '://' + url.netloc
    if not isinstance(document, dict) or document.get('version') != 1 or not isinstance(document.get('entries'), list):
        raise InvalidInput('旧收藏目录版本不兼容；原数据保留')
    if len(document['entries']) > 2000:
        raise InvalidInput('旧收藏目录超过 2000 项；原数据保留')
    clean_json(document, max_bytes=32 * 1024 * 1024)
    report = []
    seen = set()
    for index, value in enumerate(document['entries']):
        try:
            normalized = normalize_favorite(value, legacy=True)
            if normalized['legacy_id'] in seen:
                raise InvalidInput('旧收藏 ID 重复；请核对原目录')
            seen.add(normalized['legacy_id'])
            result = catalog.import_legacy_favorites(origin=origin, entries=[normalized])[0]
            report.append({'index': index, **result})
        except ContractError as exc:
            report.append({'index': index, 'status': 'rejected', 'error': exc.public()})
    return {'origin': origin, 'source_preserved': True, 'report': report,
            'accepted': sum(r['status'] != 'rejected' for r in report),
            'rejected': sum(r['status'] == 'rejected' for r in report)}
