"""Freeze publication races and Windows resolved-path namespace aliases."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path, PureWindowsPath
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend.assets import AssetCatalog
from backend.assets.catalog import _boundary_identity
from backend.contracts.errors import Conflict, InvalidInput


class FreezeConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='studio-freeze-race-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.input = self.root / 'input'
        self.input.mkdir()
        self.content = b'synthetic immutable freeze input\x00' * 4096
        (self.input / 'source.png').write_bytes(self.content)
        self.catalog = self.catalog_instance()
        asset = self.catalog.register_file('input', 'source.png', kind='image')
        self.asset_id = asset['asset_id']
        self.reference_id = asset['references'][0]['reference_id']
        self.name = hashlib.sha256(self.content).hexdigest() + '.png'

    def catalog_instance(self):
        return AssetCatalog(self.root / 'assets.sqlite3', roots={'input': self.input}, frozen_root=self.root / 'frozen')

    def test_only_equivalent_drive_and_unc_namespaces_share_a_boundary(self):
        for ordinary, extended in [
            ('C:\\store\\frozen', '\\\\?\\C:\\store\\frozen'),
            ('\\\\server\\share\\frozen', '\\\\?\\UNC\\server\\share\\frozen'),
        ]:
            root = PureWindowsPath(ordinary)
            same = _boundary_identity(PureWindowsPath(extended))
            self.assertEqual(same, root)
            self.assertEqual(_boundary_identity(PureWindowsPath(extended) / 'a.png').relative_to(root), PureWindowsPath('a.png'))
            self.assertFalse(_boundary_identity(PureWindowsPath(extended + '-outside') / 'a.png').is_relative_to(root))
        for device in ['\\\\.\\C:\\store\\frozen', '\\\\?\\Volume{synthetic}\\store\\frozen']:
            original = PureWindowsPath(device)
            self.assertEqual(_boundary_identity(original), original)
            self.assertFalse(_boundary_identity(original).is_relative_to(PureWindowsPath('C:\\store\\frozen')))

    @unittest.skipUnless(os.name == 'nt', 'The observed Win32 extended-prefix return requires Windows paths.')
    def test_same_resolved_path_with_extended_prefix_is_not_an_escape(self):
        resolve = Path.resolve
        def extended(path, *args, **kwargs):
            result = resolve(path, *args, **kwargs)
            if path.name == self.name and not str(result).startswith('\\\\?\\'):
                return Path('\\\\?\\' + str(result))
            return result
        with patch.object(Path, 'resolve', extended):
            first = self.catalog.freeze(self.reference_id)
            again = self.catalog.freeze(self.reference_id)
        self.assertEqual(first, again)
        self.assertEqual((self.root / 'frozen' / self.name).read_bytes(), self.content)
        self.assertEqual(self.catalog.validate_reference(first['reference_id'])['relative_path'], self.name)

    def test_eight_concurrent_freezes_across_two_catalogs_are_identical(self):
        catalogs = [self.catalog, self.catalog_instance()]
        barrier = threading.Barrier(8)
        def freeze(index):
            barrier.wait(timeout=10)
            return catalogs[index % 2].freeze(self.reference_id)
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(freeze, range(8)))
        self.assertTrue(all(value == results[0] for value in results))
        self.assertEqual(results[0]['sha256'], hashlib.sha256(self.content).hexdigest())
        self.assertEqual(list((self.root / 'frozen').iterdir()), [self.root / 'frozen' / self.name])
        self.assertEqual((self.root / 'frozen' / self.name).read_bytes(), self.content)
        refs = self.catalog.get(self.asset_id)['references']
        self.assertEqual(len([ref for ref in refs if ref['root_key'] == 'frozen']), 1)
        self.assertTrue(self.catalog.validate_reference(results[0]['reference_id'])['usable'])

    @unittest.skipUnless(os.name == 'nt', 'Win32 namespace comparison regression.')
    def test_extended_prefix_does_not_allow_a_resolved_path_outside_root(self):
        resolve = Path.resolve
        outside = self.root / 'outside.png'
        outside.write_bytes(self.content)
        def escape(path, *args, **kwargs):
            if path.name == self.name:
                return Path('\\\\?\\' + str(outside))
            return resolve(path, *args, **kwargs)
        with patch.object(Path, 'resolve', escape):
            with self.assertRaises(InvalidInput):
                self.catalog.freeze(self.reference_id)
        self.assertEqual(outside.read_bytes(), self.content)
        self.assertEqual(len(self.catalog.get(self.asset_id)['references']), 1)

    def test_existing_wrong_bytes_are_preserved_and_never_registered(self):
        (self.root / 'frozen').mkdir()
        path = self.root / 'frozen' / self.name
        path.write_bytes(b'conflicting frozen media')
        with self.assertRaises(Conflict):
            self.catalog.freeze(self.reference_id)
        self.assertEqual(path.read_bytes(), b'conflicting frozen media')
        self.assertEqual(len(self.catalog.get(self.asset_id)['references']), 1)


if __name__ == '__main__':
    unittest.main()
