"""Injected asset library HTTP API; SQLite is the only writable catalog."""
import asyncio
import json
from importlib import import_module
from pathlib import PurePosixPath
from ...contracts.errors import ContractError, InvalidInput, MissingRecord, StorageError, Conflict
from ...contracts.validation import clean_json, identity

_IDENTITY_FIELDS = {'assetId', 'referenceId', 'contentSha256', 'byteSize'}
_SOURCE_FIELDS = {'operation', 'documentId', 'nodeId', 'tableId', 'recordId', 'fieldId', 'requestId', 'occurrenceId', 'sourceAssetId', 'sourceReferenceId'}


def asset_source(value):
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - _SOURCE_FIELDS:
        raise InvalidInput('资产来源包含未知字段')
    return {key: identity(item, 'asset source ' + key) for key, item in value.items()}


def _normalize_asset(value):
    if not isinstance(value, dict) or set(value) - {'kind', 'name', 'text', 'asset', 'source'}:
        raise InvalidInput('资产登记包含未知字段')
    clean_json(value, max_bytes=1024 * 1024)
    payload = {key: item for key, item in value.items() if key != 'source'}
    expected = {}
    if isinstance(payload.get('asset'), dict):
        expected = {key: payload['asset'][key] for key in _IDENTITY_FIELDS if key in payload['asset']}
        payload['asset'] = {key: item for key, item in payload['asset'].items() if key not in _IDENTITY_FIELDS}
    return _legacy_adapter().normalize_favorite(payload), asset_source(value.get('source')), expected


def _metadata(asset, reference=None):
    value = {'assetId': asset['asset_id'], 'kind': asset['kind'],
             'contentSha256': asset['content_sha256'], 'byteSize': asset['byte_size'], 'status': 'available'}
    if reference is not None:
        value.update(referenceId=reference['reference_id'], status=reference['status'])
    aliases={'request_id':'requestId','document_id':'documentId','source_reference_id':'sourceReferenceId'}
    sources=[]
    for provenance in asset.get('provenance',[]):
        if not isinstance(provenance.get('detail'),dict): continue
        source={aliases.get(key,key):item for key,item in provenance['detail'].items()
                if aliases.get(key,key) in _SOURCE_FIELDS and isinstance(item,str)}
        if source: sources.append({'referenceId':provenance['reference_id'],'source':source})
    value['sources']=sources
    return value


def register_asset(catalog, value):
    """Register an immutable snapshot/reference, without creating a favorite."""
    normalized, source, expected = _normalize_asset(value)
    if normalized['kind'] == 'text':
        asset = catalog.register_text(normalized['text'], provenance=source)
        return _metadata(asset)
    # Validate before inserting. A client identity is an assertion, never authority.
    if expected:
        record = catalog._file_record(normalized['root'], normalized['filename'], normalized['kind'], source)
        actual = {'assetId': record['asset_id'], 'referenceId': record['reference_id'],
                  'contentSha256': record['content_sha256'], 'byteSize': record['byte_size']}
        if any(type(actual[key]) is not type(item) or actual[key] != item for key, item in expected.items()):
            raise Conflict('原素材身份或文件内容已变化，请重新登记该来源')
    asset = catalog.register_file(normalized['root'], normalized['filename'], kind=normalized['kind'], provenance=source)
    _, relative = catalog.resolve_reference(normalized['root'], normalized['filename'])
    reference = next(ref for ref in asset['references'] if ref['root_key'] == normalized['root'] and ref['relative_path'] == relative)
    if reference['status'] != 'available':
        reference = catalog.validate_reference(reference['reference_id'])
        if not reference['usable']: raise Conflict('资产文件当前不可用，请修复原引用')
    if any(_metadata(asset, reference)[key] != item for key, item in expected.items()):
        raise Conflict('素材在登记期间变化，请重新核对原引用')
    return {**_metadata(asset, reference), 'asset': _local_reference(asset, reference, normalized['display_name'])}


def _local_reference(asset, reference, name):
    path = PurePosixPath(reference['relative_path'])
    return {'version': 1, 'kind': asset['kind'], 'name': name,
            'filename': path.name, 'subfolder': '' if str(path.parent) == '.' else str(path.parent),
            'type': reference['root_key'], **{k: v for k, v in _metadata(asset, reference).items() if k in _IDENTITY_FIELDS}}


def _legacy_adapter():
    return import_module(__package__.removesuffix('backend.integrations.comfyui') + 'compat.legacy.favorites')


def _same_origin(request):
    supplied = request.headers.get('Origin')
    expected = f'{request.scheme}://{request.host}'
    if request.headers.get('Sec-Fetch-Site') == 'cross-site' or supplied != expected:
        raise InvalidInput('跨站写入已拒绝；请从当前 ComfyUI 页面操作')


async def _body(request, *, maximum=1024 * 1024):
    _same_origin(request)
    if request.content_type != 'application/json':
        raise InvalidInput('请求需要 application/json')
    raw = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        raw.extend(chunk)
        if len(raw) > maximum:
            raise InvalidInput('请求超过大小限制')
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise InvalidInput('请求不是有效 JSON') from None
    if not isinstance(value, dict):
        raise InvalidInput('请求必须是对象')
    clean_json(value, max_bytes=maximum)
    return value


def _entry(favorite, asset=None, *, reference_id=None):
    asset = asset or favorite
    result = {'id': favorite['favorite_id'], 'assetId': favorite['asset_id'],
              'kind': asset['kind'], 'name': favorite['display_name'], 'createdAt': favorite['created_at']}
    if asset['kind'] == 'text':
        result['text'] = asset['text_snapshot']
    else:
        refs = asset.get('references', [])
        ref = next((r for r in refs if r['reference_id'] == reference_id), None) if reference_id else next((r for r in refs if r['root_key'] in ('input', 'output') and r['status'] == 'available'),
                   next((r for r in refs if r['root_key'] in ('input', 'output')), None))
        if ref is None:
            raise InvalidInput('收藏没有可访问的输入或输出文件引用')
        result.update(status=ref['status'], referenceId=ref['reference_id'], asset=_local_reference(asset, ref, favorite['display_name']))
    return result


class AssetAPI:
    def __init__(self, catalog):
        self.catalog = catalog
        prefix = '/daelab/studio/asset-library'
        self.routes = (('GET', prefix + '/favorites', self.search),
                       ('POST', prefix + '/register', self.register),
                       ('POST', prefix + '/resolve', self.resolve),
                       ('POST', prefix + '/favorites', self.favorite),
                       ('POST', prefix + '/lookup', self.lookup),
                       ('DELETE', prefix + '/favorites/{favorite_id}', self.unfavorite),
                       ('POST', prefix + '/import', self.import_legacy))

    @staticmethod
    def _failure(exc):
        from aiohttp import web
        status = 404 if isinstance(exc, MissingRecord) else 503 if isinstance(exc, StorageError) else 409 if isinstance(exc, Conflict) else 400
        return web.json_response({'error': exc.public()}, status=status)

    async def search(self, request):
        from aiohttp import web
        try:
            limit, offset = int(request.query.get('limit', '48')), int(request.query.get('offset', '0'))
            if limit > 100:
                raise InvalidInput('每页最多 100 项')
            page = await asyncio.to_thread(self.catalog.search_page, request.query.get('q', ''),
                                          kind=request.query.get('kind'), limit=limit, offset=offset)
            return web.json_response({'schemaVersion': 1, 'entries': [_entry(item) for item in page['items']],
                                      'total': page['total'], 'limit': limit, 'offset': offset, 'hasMore': page['has_more']})
        except ContractError as exc:
            return self._failure(exc)
        except ValueError:
            return self._failure(InvalidInput('分页参数需要有效整数'))

    def _favorite(self, value, *, lookup=False):
        # Package-relative import supports a renamed custom_nodes installation folder.
        normalized, source, expected = _normalize_asset(value)
        if normalized['kind'] == 'text':
            record = self.catalog._text_record(normalized['text'])
            if not lookup:
                self.catalog.register_text(normalized['text'], provenance=source)
        else:
            record = self.catalog._file_record(normalized['root'], normalized['filename'], normalized['kind'], source)
            actual = {'assetId': record['asset_id'], 'referenceId': record['reference_id'], 'contentSha256': record['content_sha256'], 'byteSize': record['byte_size']}
            if any(actual[key] != item for key, item in expected.items()):
                raise Conflict('原素材身份或文件内容已变化')
            if not lookup:
                self.catalog.register_file(normalized['root'], normalized['filename'], kind=normalized['kind'], provenance=source)
        if not lookup:
            self.catalog.favorite(record['asset_id'], display_name=normalized['display_name'])
        favorite = self.catalog.find_favorite(record['asset_id'])
        if lookup and favorite and record.get('reference_id') and not any(ref['reference_id']==record['reference_id'] for ref in favorite['asset']['references']):
            # The same content can exist at a new legacy path. A read-only
            # lookup must neither register it nor substitute another path.
            return None
        if favorite and record.get('reference_id'):
            current = next(ref for ref in favorite['asset']['references'] if ref['reference_id']==record['reference_id'])
            if current['status'] != 'available':
                checked = self.catalog.validate_reference(current['reference_id'])
                if not checked['usable']: raise Conflict('资产文件当前不可用')
                favorite = self.catalog.find_favorite(record['asset_id'])
        return _entry(favorite, favorite['asset'], reference_id=record.get('reference_id')) if favorite else None

    async def register(self, request):
        from aiohttp import web
        try:
            value = await _body(request)
            registration = await asyncio.to_thread(register_asset, self.catalog, value)
            return web.json_response({'schemaVersion': 1, 'registration': registration})
        except ContractError as exc:
            return self._failure(exc)

    def _resolve(self, value):
        if set(value) - {'assetId', 'referenceId'}:
            raise InvalidInput('资产读取包含未知字段')
        asset = self.catalog.get(identity(value.get('assetId'), 'asset ID'))
        if asset['kind'] not in ('text','image','video'):
            raise InvalidInput('当前公开素材接口不支持该类型')
        if asset['kind'] == 'text':
            if 'referenceId' in value:
                raise InvalidInput('文本快照不使用文件引用')
            return _metadata(asset)
        reference = self.catalog.validate_reference(identity(value.get('referenceId'), 'reference ID'))
        if reference['asset_id'] != asset['asset_id'] or not reference['usable'] or reference['root_key'] not in ('input', 'output'):
            raise Conflict('资产引用缺失、内容变化或不属于该资产')
        return {**_metadata(asset, reference), 'asset': _local_reference(asset, reference, PurePosixPath(reference['relative_path']).name)}

    async def resolve(self, request):
        from aiohttp import web
        try:
            value = await _body(request)
            registration = await asyncio.to_thread(self._resolve, value)
            return web.json_response({'schemaVersion': 1, 'registration': registration})
        except ContractError as exc:
            return self._failure(exc)

    async def favorite(self, request):
        from aiohttp import web
        try:
            value = await _body(request)
            entry = await asyncio.to_thread(self._favorite, value)
            return web.json_response({'schemaVersion': 1, 'entry': entry})
        except ContractError as exc:
            return self._failure(exc)

    async def lookup(self, request):
        from aiohttp import web
        try:
            value = await _body(request)
            entry = await asyncio.to_thread(self._favorite, value, lookup=True)
            return web.json_response({'schemaVersion': 1, 'entry': entry})
        except ContractError as exc:
            return self._failure(exc)

    async def unfavorite(self, request):
        from aiohttp import web
        try:
            _same_origin(request)
            result = await asyncio.to_thread(self.catalog.unfavorite, request.match_info['favorite_id'])
            return web.json_response({'schemaVersion': 1, **result})
        except ContractError as exc:
            return self._failure(exc)

    async def import_legacy(self, request):
        from aiohttp import web
        try:
            value = await _body(request, maximum=32 * 1024 * 1024)
            if set(value) != {'origin', 'document'}:
                raise InvalidInput('导入需要 origin 和 document')
            result = await asyncio.to_thread(_legacy_adapter().import_browser_favorites, self.catalog, **value)
            return web.json_response({'schemaVersion': 1, **result})
        except ContractError as exc:
            return self._failure(exc)
