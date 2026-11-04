"""Explicit generation node/route assembly. No provider is loaded at import."""


def register_nodes(service=None):
    from .node import make_node, NODE_ID
    names = {NODE_ID: 'DAELAB · 生成节点', 'DAELAB.ImageGenerate': '图片生成', 'DAELAB.VideoGenerate': '视频生成'}
    kinds = {'DAELAB.ImageGenerate': 'image', 'DAELAB.VideoGenerate': 'video'}
    return {key: make_node(service, key, name, kinds.get(key)) for key, name in names.items()}, names


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
            if path == '/daelab/studio/generation/submit' or path.startswith('/daelab/prompt-optimization/'):
                handler = authenticated_submission(handler)
            server.routes.route(method, path)(handler)
            owned[key] = service, handler
            added.append(path)
    server._creative_studio_generation_routes = owned
    return tuple(added)
