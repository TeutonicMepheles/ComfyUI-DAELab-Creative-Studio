"""Bounded file hashing and explicit local /view resolution; no provider runtime."""
import hashlib
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlsplit


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class LocalMediaResolver:
    """Resolve only regular files within explicitly injected Comfy input/output/temp roots.

    A catalog may be injected so filesystem ownership remains with the asset service.
    URLs never trigger HTTP, and symlinks resolving outside a root are rejected.
    """
    KINDS = {'.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image',
             '.gif': 'image', '.bmp': 'image', '.mp4': 'video', '.webm': 'video',
             '.mov': 'video', '.mkv': 'video', '.wav': 'audio', '.mp3': 'audio',
             '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio'}

    def __init__(self, *, roots=None, catalog=None, max_file_bytes=4 * 1024**3):
        if catalog is None and not roots:
            raise ValueError('Local media requires explicit storage roots')
        self.roots = {key: Path(value).resolve() for key, value in (roots or {}).items()}
        self.catalog = catalog
        self.max_file_bytes = max_file_bytes

    def __call__(self, url):
        if not isinstance(url, str):
            raise ValueError('素材必须是 Comfy 本地文件')
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        if (parts.scheme or parts.netloc or parts.path != '/view' or parts.fragment
                or any(len(values) != 1 for values in query.values())
                or set(query) - {'filename', 'subfolder', 'type'}):
            raise ValueError('素材必须是 Comfy 本地文件')
        filename = query.get('filename', [''])[0]
        subfolder = query.get('subfolder', [''])[0]
        root_key = query.get('type', ['output'])[0]
        if (root_key not in ('input', 'output', 'temp') or not filename
                or any(c in filename for c in '/\\:\x00')
                or any(c in subfolder for c in '\\:\x00')
                or any(ord(c) < 32 for c in filename + subfolder)):
            raise ValueError('素材路径无效')
        relative = PurePosixPath(subfolder, filename)
        if relative.is_absolute() or '..' in relative.parts or filename in ('.', '..'):
            raise ValueError('素材路径超出允许目录')
        if self.catalog is not None:
            path, _ = self.catalog.resolve_reference(root_key, relative.as_posix())
            path = Path(path)
        else:
            if root_key not in self.roots:
                raise ValueError('素材目录未配置')
            root = self.roots[root_key]
            path = (root / relative).resolve()
            if not path.is_relative_to(root):
                raise ValueError('素材路径超出允许目录')
        if not path.is_file() or path.stat().st_size > self.max_file_bytes:
            raise ValueError('素材不存在或超过文件大小限制')
        kind = self.KINDS.get(path.suffix.lower())
        if kind is None:
            raise ValueError('不支持的素材文件类型')
        return {'kind': kind, 'path': str(path)}
