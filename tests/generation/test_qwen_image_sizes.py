"""Real frozen image dimensions and pure graph checks; no model execution."""
import copy
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from backend.contracts.errors import InvalidInput
from backend.generation.media import freeze_reference, frozen_image_dimensions
from backend.integrations.comfyui.services import CoreServices
from backend.providers.image_dimensions import image_dimensions, image_size_schema
from backend.providers.native import NativeProvider
from backend.providers.parameters import IMAGE_MODEL, IMAGE_FILES, settings_for


class QwenImageSizeTests(unittest.TestCase):
    def test_presets_match_actual_limits_and_have_the_declared_aspect(self):
        for preset in image_size_schema()['presets']:
            width, height = preset['width'], preset['height']
            a, b = map(int, preset['ratio'].split(':'))
            self.assertEqual(width * b, height * a)
            self.assertTrue(all(256 <= value <= 2048 and value % 32 == 0 for value in (width, height)))
            self.assertLessEqual(width * height, 2097152)
        self.assertEqual(image_dimensions('1:1'), (1024, 1024))
        self.assertEqual(image_dimensions('16:9'), (1536, 864))
        self.assertEqual(image_dimensions('9:16'), (864, 1536))

    def test_auto_reference_and_no_reference_and_legacy_custom_dimensions(self):
        self.assertEqual(image_dimensions('auto'), (1024, 1024))
        self.assertEqual(image_dimensions('auto', (1600, 900)), (1536, 864))
        size = image_dimensions('auto', (1333, 1000))
        self.assertLess(abs(size[0] / size[1] - 1.333), .03)
        old = settings_for('image', 'image2image', {'width': 1920, 'height': 1024, 'seed': 42}, [{'kind': 'image'}])
        self.assertEqual((old['width'], old['height']), (1920, 1024))
        for ratio, reference in [('unsupported', None), ('auto', (0, 100)), ('auto', (10000, 1))]:
            with self.subTest(ratio=ratio, reference=reference), self.assertRaises(InvalidInput):
                image_dimensions(ratio, reference)
        with self.assertRaises(InvalidInput):
            settings_for('image', 'image2image', {'ratio': 'auto'}, [{'kind': 'image'}])

    def test_auto_reads_frozen_orientation_and_pins_reference_scaling(self):
        with tempfile.TemporaryDirectory(prefix='qwen-size-') as folder:
            root = Path(folder)
            (root / 'input').mkdir()
            (root / 'output').mkdir()
            exif = Image.Exif();exif[274] = 6
            Image.new('RGB', (1500, 1000), 'red').save(root / 'input/ref.jpg', exif=exif)
            core = CoreServices(root / 'user', root / 'input', root / 'output')
            frozen = freeze_reference(core.assets, {'url': '/view?filename=ref.jpg&type=input', 'kind': 'image'})
            self.assertEqual(frozen_image_dimensions(core.assets, frozen), (1000, 1500))
            class Inventory:
                def descriptions(self, keys):
                    return {key: {'name': IMAGE_FILES[key], 'sha256': 'fixed'} for key in keys}
            provider = NativeProvider('image', inventory=Inventory(), queue=None, media_input=lambda item: 'staged/ref.jpg',
                                      image_dimensions=lambda item: frozen_image_dimensions(core.assets, item))
            original = {'config': {'model': IMAGE_MODEL, 'kind': 'image', 'mode': 'image2image', 'settings': {'ratio': 'auto', 'seed': 42}},
                        'segments': [{'type': 'asset', 'index': 0}]}
            before = copy.deepcopy(original)
            prepared = provider.build(original, [frozen], 'frozen-auto')
            self.assertEqual(original, before)
            self.assertEqual((prepared['settings']['width'], prepared['settings']['height']), (832, 1248))
            scale = prepared['graph']['reference_size']['inputs']
            self.assertEqual((scale['width'], scale['height']), (832, 1248))
            self.assertEqual(prepared['graph']['sample']['inputs']['latent_image'], ['condition', 2])
            # A later source edit cannot change the prepared task dimensions.
            Image.new('RGB', (1600, 900), 'blue').save(root / 'input/ref.jpg')
            self.assertEqual(frozen_image_dimensions(core.assets, frozen), (1000, 1500))
            self.assertEqual((prepared['settings']['width'], prepared['settings']['height']), (832, 1248))
