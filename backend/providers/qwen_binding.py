"""Read-only fixed Ollama registry binding. Construction performs no IO."""
import hashlib
import json
from pathlib import Path
import re

from .contracts import ProviderUnavailable
from .parameters import QWEN_MODEL

_SHA = re.compile(r'^[a-f0-9]{64}$')
_ROLES = {'model', 'projector', 'config', 'template', 'license', 'params'}


class QwenModelBinding:
    def __init__(self, *, manifest_path, installed_manifest_path, blobs_root, expected_manifest_sha256, expected_blobs):
        self.manifest_path = Path(manifest_path)
        self.installed_manifest_path = Path(installed_manifest_path)
        self.blobs_root = Path(blobs_root)
        self.expected_manifest_sha256 = expected_manifest_sha256
        self.expected_blobs = [dict(item) for item in expected_blobs]
        self._verified = {}

    def _blob(self, path, expected_hash, expected_bytes):
        try:
            before = path.stat()
            stamp = (str(path.resolve()), before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_ino, expected_hash)
            if before.st_size != expected_bytes:
                raise ProviderUnavailable('Pinned Qwen blob size changed.')
            if self._verified.get(str(path)) == stamp:
                return
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            after = path.stat()
            if digest.hexdigest() != expected_hash or (before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_ino):
                raise ProviderUnavailable('Pinned Qwen blob hash changed during inspection.')
            self._verified[str(path)] = stamp
        except OSError:
            raise ProviderUnavailable('Pinned Qwen blob is missing or unreadable.') from None

    def verify(self):
        if not isinstance(self.expected_manifest_sha256, str) or not _SHA.fullmatch(self.expected_manifest_sha256):
            raise ProviderUnavailable('Qwen requires a fixed manifest SHA256.')
        expected = {}
        for item in self.expected_blobs:
            role, sha, size = item.get('role'), item.get('sha256'), item.get('bytes')
            if role not in _ROLES or role in expected or not isinstance(sha, str) or not _SHA.fullmatch(sha) or type(size) is not int or size <= 0:
                raise ProviderUnavailable('Qwen requires the complete fixed six-blob binding.')
            expected[role] = {'sha256': sha, 'bytes': size}
        if set(expected) != _ROLES:
            raise ProviderUnavailable('Qwen requires model, projector, config, template, license and params hashes.')
        try:
            with self.manifest_path.open('rb') as stream:
                raw = stream.read(1024 * 1024 + 1)
            with self.installed_manifest_path.open('rb') as stream:
                installed = stream.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024 or hashlib.sha256(raw).hexdigest() != self.expected_manifest_sha256 or installed != raw:
                raise ProviderUnavailable('Qwen registry/installed manifest differs from the fixed binding.')
            manifest = json.loads(raw)
            entries = [('config', manifest['config'])] + [(entry['mediaType'].removeprefix('application/vnd.ollama.image.'), entry) for entry in manifest['layers']]
            found = {}
            for role, entry in entries:
                if role in found or role not in expected or entry.get('digest') != 'sha256:' + expected[role]['sha256'] or entry.get('size') != expected[role]['bytes']:
                    raise ProviderUnavailable('Qwen manifest blob membership differs from the fixed binding.')
                found[role] = expected[role]
            if manifest.get('schemaVersion') != 2 or set(found) != _ROLES:
                raise ProviderUnavailable('Qwen manifest contract changed.')
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            raise ProviderUnavailable('Pinned Qwen registry manifest is unavailable or malformed.') from None
        root = self.blobs_root.resolve()
        for info in found.values():
            path = (root / ('sha256-' + info['sha256'])).resolve()
            if not path.is_relative_to(root):
                raise ProviderUnavailable('Qwen blob resolved outside its explicitly bound registry.')
            self._blob(path, info['sha256'], info['bytes'])
        return {'model': QWEN_MODEL, 'manifestSha256': self.expected_manifest_sha256,
                'registryDigest': 'sha256:' + self.expected_manifest_sha256,
                'blobs': [{'role': role, **found[role]} for role in sorted(found)]}
