import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("studio_bootstrap", Path(__file__).parents[2] / "backend/integrations/comfyui/bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class ConflictTests(unittest.TestCase):
    def test_old_active_package_prevents_any_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / "Studio"
            current.mkdir()
            old = root / "ComfyUI-DAELab-Creative-Canvas"
            old.mkdir()
            (old / "__init__.py").write_text("", encoding="utf-8")
            self.assertEqual(bootstrap.detect_conflicts(current, [root]), [old.resolve()])

    def test_disabled_directory_is_not_an_active_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "ComfyUI-DAELab-Creative-Canvas.disabled"
            old.mkdir()
            (old / "__init__.py").write_text("", encoding="utf-8")
            self.assertEqual(bootstrap.detect_conflicts(root / "Studio", [root]), [])

    def test_second_studio_copy_detected_even_when_renamed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy = root / "renamed-copy"
            copy.mkdir()
            (copy / "pyproject.toml").write_text('[project]\nname="comfyui-daelab-creative-studio"\n', encoding="utf-8")
            self.assertEqual(bootstrap.detect_conflicts(root / "Studio", [root]), [copy.resolve()])


if __name__ == "__main__":
    unittest.main()
