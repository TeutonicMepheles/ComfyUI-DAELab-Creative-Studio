"""Rooted references and content-addressed staging through the asset catalog."""
import base64
import hashlib
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit, parse_qs

from ..contracts.errors import InvalidInput, Conflict


def freeze_reference(assets, item):
    if not isinstance(item, dict):
        raise InvalidInput('A media reference must be an object.')
    reference_id = item.get('reference_id')
    if reference_id is None:
        url = urlsplit(item.get('url', ''))
        query = parse_qs(url.query, keep_blank_values=True)
        if url.scheme or url.netloc or url.path not in ('/view', '/api/view') or url.fragment:
            raise InvalidInput('Only local Comfy media references can enter a task.')
        if any(len(values) != 1 for values in query.values()) or not query.get('filename'):
            raise InvalidInput('Ambiguous media reference parameters.')
        root, name = query.get('type', ['input'])[0], query['filename'][0]
        relative = '/'.join(part for part in (query.get('subfolder', [''])[0], name) if part)
        kind = item.get('kind') or ('image' if Path(name).suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp') else 'video')
        _file, relative = assets.resolve_reference(root, relative)
        asset = assets.register_file(root, relative, kind=kind, provenance={'origin': 'generation-input'})
        reference_id = next(r['reference_id'] for r in asset['references'] if r['root_key'] == root and r['relative_path'] == relative)
    frozen = assets.freeze(reference_id)
    return {**frozen, 'kind': assets.get(frozen['asset_id'])['kind']}


def _publish(assets, relative, content, *, kind, provenance):
    target, relative = assets.resolve_reference('input', relative, must_exist=False)
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = hashlib.sha256(content).hexdigest()
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise Conflict('A staged immutable input changed; preserve it and repair storage.')
    else:
        fd, temporary = tempfile.mkstemp(prefix='.stage-', dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                    raise Conflict('Concurrent input staging produced different content.')
        finally:
            Path(temporary).unlink(missing_ok=True)
    asset = assets.register_file('input', relative, kind=kind, provenance=provenance)
    return next(r for r in asset['references'] if r['root_key'] == 'input' and r['relative_path'] == relative)


def image_data_reference(assets, value):
    if not isinstance(value, str) or len(value) > 12 * 1024 * 1024:
        raise InvalidInput('Reference image data exceeds its limit.')
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)', value)
    if not match:
        raise InvalidInput('Only PNG, JPEG and WebP reference data is accepted.')
    try:
        content = base64.b64decode(match[2], validate=True)
    except ValueError:
        raise InvalidInput('Invalid reference image encoding.') from None
    # Check decoded dimensions before making a durable input reference.
    from ..providers.qwen import image_payload
    image_payload(content)
    suffix = '.jpg' if match[1] == 'jpeg' else '.' + match[1]
    relative = 'daelab/creative-studio/source/' + hashlib.sha256(content).hexdigest() + suffix
    return {'reference_id': _publish(assets, relative, content, kind='image', provenance={'origin': 'canvas-reference'})['reference_id']}


def read_frozen(assets, item):
    checked = assets.validate_reference(item['reference_id'])
    if not checked['usable'] or checked['root_key'] != 'frozen' or checked['content_sha256'] != item['sha256']:
        raise Conflict('Frozen task input changed or disappeared.')
    file, _ = assets.resolve_reference('frozen', checked['relative_path'])
    return file.read_bytes()


def stage_native_input(assets, item):
    content = read_frozen(assets, item)
    name = 'daelab/creative-studio/frozen/' + item['filename']
    return _publish(assets, name, content, kind=item['kind'], provenance={'source_reference_id': item['reference_id']})['relative_path']
