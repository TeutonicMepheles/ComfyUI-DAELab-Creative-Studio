"""Bounded DTO readers and explicit route ownership, independent of PromptServer."""
import json


async def json_body(request):
    body = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        body.extend(chunk)
        if len(body) > 8 * 1024**2:
            raise ValueError('请求超过 8 MiB')
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError('请求必须是对象')
    return value


async def document_body(request, maximum):
    reader = await request.multipart()
    while True:
        part = await reader.next()
        if part is None:
            raise ValueError('请选择文档文件')
        if part.name == 'file':
            break
    if not part.filename:
        raise ValueError('请选择文档文件')
    body = bytearray()
    while True:
        chunk = await part.read_chunk(65536)
        if not chunk:
            break
        body.extend(chunk)
        if len(body) > maximum:
            raise ValueError('文档超过 20 MiB')
    return bytes(body), part.filename


def register_definitions(server, services, definitions):
    """Preflight every route before mutation; same services can register idempotently."""
    if server is None or not hasattr(server, 'routes'):
        raise RuntimeError('Business routes require an initialized server')
    existing = {(r.method, r.path): r.handler for r in server.routes
                if hasattr(r, 'method') and hasattr(r, 'handler')}
    owned = getattr(server, '_creative_studio_business_routes', {})
    for method, path, handler in definitions:
        key = method, path
        if key in existing and (key not in owned or owned[key][0] is not services
                                or owned[key][1] is not existing[key]):
            raise RuntimeError(f'Creative Studio refused duplicate route ownership: {method} {path}')
    added = []
    for method, path, handler in definitions:
        key = method, path
        if key not in existing:
            server.routes.route(method, path)(handler)
            owned[key] = services, handler
            added.append(path)
    server._creative_studio_business_routes = owned
    return tuple(added)
