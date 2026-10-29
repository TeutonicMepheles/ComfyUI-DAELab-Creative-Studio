from pathlib import Path
import tempfile
import unittest

from PIL import Image

from backend.generation.media import freeze_reference, read_frozen, stage_native_input
from backend.integrations.comfyui.comfy_video import stage_seedance_input
from backend.integrations.comfyui.services import CoreServices


class SeedanceImageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.core = CoreServices(self.root / 'user', self.root / 'input', self.root / 'output')

    def freeze(self, size, *, orientation=None):
        file = self.root / 'input' / 'reference.png'
        file.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new('RGB', size, 'red')
        exif = Image.Exif()
        if orientation is not None:
            exif[274] = orientation
        image.save(file, exif=exif)
        return file, freeze_reference(self.core.assets, {'url': '/view?filename=reference.png&type=input', 'kind': 'image'})

    def test_out_of_range_images_fit_official_bounds_without_cropping_or_changing_original(self):
        for size in [(300, 1000), (1000, 300), (120, 240), (6100, 300), (300, 6100), (1, 1000)]:
            with self.subTest(size=size):
                source, frozen = self.freeze(size)
                original = source.read_bytes()
                relative = stage_seedance_input(self.core.assets, frozen)
                self.assertEqual(relative, stage_seedance_input(self.core.assets, frozen))
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(read_frozen(self.core.assets, frozen), original)
                with Image.open(self.root / 'input' / relative) as prepared:
                    self.assertGreaterEqual(min(prepared.size), 300)
                    self.assertLessEqual(max(prepared.size), 6000)
                    self.assertGreaterEqual(prepared.width / prepared.height, 0.4)
                    self.assertLessEqual(prepared.width / prepared.height, 2.5)
                    self.assertEqual(prepared.getpixel(((prepared.width - 1) // 2, (prepared.height - 1) // 2)), (255, 0, 0))
                    if size == (300, 1000):
                        self.assertEqual(prepared.size, (400, 1000))
                        self.assertEqual(prepared.getpixel((0, 500)), (0, 0, 0))
                        self.assertEqual(prepared.getpixel((50, 0)), (255, 0, 0))
                        self.assertEqual(prepared.getpixel((349, 999)), (255, 0, 0))

    def test_valid_images_remain_byte_identical_including_ratio_boundaries(self):
        for size in [(300, 300), (400, 1000), (1000, 400)]:
            source, frozen = self.freeze(size)
            relative = stage_seedance_input(self.core.assets, frozen)
            self.assertEqual((self.root / 'input' / relative).read_bytes(), source.read_bytes())
            self.assertEqual(relative, stage_native_input(self.core.assets, frozen))

    def test_orientation_is_applied_before_preparation(self):
        _, frozen = self.freeze((300, 1000), orientation=6)
        relative = stage_seedance_input(self.core.assets, frozen)
        with Image.open(self.root / 'input' / relative) as prepared:
            self.assertEqual(prepared.size, (1000, 400))
            self.assertIsNone(prepared.getexif().get(274))

    def test_video_uses_unchanged_native_staging(self):
        source = self.root / 'input' / 'reference.mp4'
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b'synthetic video bytes for opaque file staging')
        frozen = freeze_reference(self.core.assets, {'url': '/view?filename=reference.mp4&type=input', 'kind': 'video'})
        relative = stage_seedance_input(self.core.assets, frozen)
        self.assertEqual(relative, stage_native_input(self.core.assets, frozen))
        self.assertEqual((self.root / 'input' / relative).read_bytes(), source.read_bytes())
