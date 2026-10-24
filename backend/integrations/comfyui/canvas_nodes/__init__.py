"""Explicit Canvas node and route assembly; importing this package registers nothing."""


def register_nodes(*, asset_catalog=None):
    """Return fresh mappings for the four retained Canvas node identities."""
    from .media_upload import MediaUpload
    from .text_input import TextInput
    from .material_group import MaterialGroup
    from .video_edit import VideoEdit
    from .asset_binding import bind_asset_catalog
    bind_asset_catalog(asset_catalog)

    mappings = {
        "DAELAB.MediaUpload": MediaUpload,
        "DAELAB.TextInput": TextInput,
        "DAELAB.MaterialGroup": MaterialGroup,
        "DAELAB.VideoEdit": VideoEdit,
    }
    names = {
        "DAELAB.MediaUpload": "上传",
        "DAELAB.TextInput": "输入文本",
        "DAELAB.MaterialGroup": "素材组",
        "DAELAB.VideoEdit": "剪辑",
    }
    return mappings, names


def register_routes(server=None, *, export_service=None, asset_catalog=None):
    """Register the owned routes once, rejecting another owner's routes first.

    The caller supplies the initialized PromptServer during product assembly.
    Omitting it resolves the normal host singleton only at this explicit call.
    """
    if server is None:
        from server import PromptServer
        server = getattr(PromptServer, "instance", None)
    if server is None or not hasattr(server, "routes"):
        raise RuntimeError("Creative Studio media routes require an initialized PromptServer")
    from .material_output_api import ROUTES as MATERIAL_ROUTES
    from .video_edit import ROUTES as EDIT_ROUTES

    definitions = MATERIAL_ROUTES + EDIT_ROUTES
    if export_service is not None:
        from .video_edit import export_routes
        definitions += export_routes(export_service, bind=False)
    existing = {(route.method, route.path): route.handler for route in server.routes
                if hasattr(route, "method") and hasattr(route, "handler")}
    for method, path, handler in definitions:
        previous = existing.get((method, path))
        if previous is not None and previous is not handler:
            raise RuntimeError(f"Creative Studio refused duplicate route ownership: {method} {path}")
    if export_service is not None:
        export_routes(export_service)
    from .material_output_api import bind_asset_catalog
    bind_asset_catalog(asset_catalog)
    added = []
    for method, path, handler in definitions:
        if (method, path) not in existing:
            server.routes.route(method, path)(handler)
            added.append(path)
    return tuple(added)
