"""Shared pinned-file verification: one hash per identity, failures never cached."""
import hashlib
import os
import pathlib
import tempfile
import threading
import unittest
from collections import Counter
from pathlib import Path

from backend.providers import native
from backend.providers.contracts import ProviderUnavailable
from backend.providers.native import ModelInventory

_real_open = pathlib.Path.open
_counts = Counter()


class _Stream:
    def __init__(self, stream, key):
        self._stream, self._key = stream, key

    def write(self, data):
        return self._stream.write(data)

    def read(self, size=-1):
        data = self._stream.read(size)
        _counts[self._key] += len(data)
        return data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._stream.close()
        return False


def _counting_open(self, *args, **kwargs):
    return _Stream(_real_open(self, *args, **kwargs), str(self.resolve()))


class SharedVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-verify-share-')
        self.root = Path(self.temp.name)
        self.file = self.root / 'shared.safetensors'
        self.file.write_bytes(b'a' * (1024 * 1024))
        self.digest = hashlib.sha256(self.file.read_bytes()).hexdigest()
        native._VERIFIED_OK.clear()
        native._VERIFY_INFLIGHT.clear()
        self._original = pathlib.Path.open
        pathlib.Path.open = _counting_open
        _counts.clear()

    def tearDown(self):
        pathlib.Path.open = self._original
        native._VERIFIED_OK.clear()
        native._VERIFY_INFLIGHT.clear()
        self.temp.cleanup()

    def inventory(self):
        binding = {'diffusion_models': {'name': self.file.name, 'path': str(self.file), 'sha256': self.digest}}
        return ModelInventory(binding, lambda: ['UNETLoader'])

    def models(self):
        return {'diffusion_models': {'name': self.file.name, 'sha256': self.digest}}

    def graph(self):
        return {'model': {'class_type': 'UNETLoader'}}

    def test_two_providers_share_one_verification_of_the_same_file(self):
        first, second = self.inventory(), self.inventory()
        first.verify(self.models(), self.graph())
        second.verify(self.models(), self.graph())
        self.assertEqual(_counts[str(self.file.resolve())], 1024 * 1024)

    def test_concurrent_verification_of_one_file_reads_it_once(self):
        inventory = self.inventory()
        threads = [threading.Thread(target=inventory.verify, args=(self.models(), self.graph())) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(_counts[str(self.file.resolve())], 1024 * 1024)

    def test_changed_file_is_verified_again_and_a_new_hash_is_needed(self):
        self.inventory().verify(self.models(), self.graph())
        self.file.write_bytes(b'b' * (1024 * 1024))
        os.utime(self.file, (1, 1))
        _counts.clear()
        with self.assertRaises(ProviderUnavailable):
            self.inventory().verify(self.models(), self.graph())
        self.assertEqual(_counts[str(self.file.resolve())], 1024 * 1024)
        updated = hashlib.sha256(self.file.read_bytes()).hexdigest()
        binding = {'diffusion_models': {'name': self.file.name, 'path': str(self.file), 'sha256': updated}}
        ModelInventory(binding, lambda: ['UNETLoader']).verify(
            {'diffusion_models': {'name': self.file.name, 'sha256': updated}}, self.graph())

    def test_wrong_hash_fails_and_is_never_cached_as_success(self):
        binding = {'diffusion_models': {'name': self.file.name, 'path': str(self.file), 'sha256': 'f' * 64}}
        wrong = {'diffusion_models': {'name': self.file.name, 'sha256': 'f' * 64}}
        for _ in range(2):
            with self.assertRaises(ProviderUnavailable):
                ModelInventory(binding, lambda: ['UNETLoader']).verify(wrong, self.graph())
        self.assertNotIn((str(self.file.resolve()), 1024 * 1024, self.file.stat().st_mtime_ns, 'f' * 64), native._VERIFIED_OK)


if __name__ == '__main__':
    unittest.main()
