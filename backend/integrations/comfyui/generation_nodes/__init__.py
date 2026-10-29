"""Explicit generation node/route assembly. No provider is loaded at import."""


def register_nodes(service=None):
    from .node import make_node, NODE_ID
    return {NODE_ID: make_node(service)}, {NODE_ID: 'DAELAB · 生成节点'}


def register_routes(server, service):
    from ....generation.http import routes
    from ..comfy_video import authenticated_submission
    definitions = routes(service)
    existing = {(r.method, r.path): r.handler for r in server.routes if hasattr(r, 'handler')}
    owned = getattr(server, '_creative_studio_generation_routes', {})
    for method, path, _handler in definitions:
        key = method, path
        if key in existing and (key not in owned or owned[key][0] is not service or owned[key][1] is not existing[key]):
            raise RuntimeError('Creative Studio generation route already has an owner: ' + path)
    added = []
    for method, path, handler in definitions:
        key = method, path
        if key not in existing:
            if path == '/daelab/studio/generation/submit':
                handler = authenticated_submission(handler)
            server.routes.route(method, path)(handler)
            owned[key] = service, handler
            added.append(path)
    server._creative_studio_generation_routes = owned
    return tuple(added)
