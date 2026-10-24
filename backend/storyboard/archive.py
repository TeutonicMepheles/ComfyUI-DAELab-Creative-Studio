"""Validate in-memory Office packages before any document reader opens them."""
from pathlib import PurePosixPath
import re
import stat


def validate_archive(archive):
    infos = archive.infolist()
    if len(infos) > 10000 or sum(info.file_size for info in infos) > 128 * 1024**2:
        raise ValueError('文档压缩包超过安全限制')
    seen = set()
    for info in infos:
        name = info.filename
        path = PurePosixPath(name)
        key = name.casefold().rstrip('/')
        if (name != info.orig_filename or '\\' in name or path.is_absolute()
                or any(part in ('', '.', '..') for part in name.rstrip('/').split('/'))
                or re.search(r'[:\x00-\x1f]', name) or key in seen
                or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1):
            raise ValueError('文档压缩包包含重复、加密或不安全路径')
        seen.add(key)
