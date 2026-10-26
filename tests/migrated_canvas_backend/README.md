# tests/migrated_canvas_backend

Native canvas registration, media processing and material-output import checks.

test_registration.py checks node mapping; test_media.py checks media/editing; test_material_output_import.py checks rooted references.

Tests use synthetic inputs and injected services without business generation.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_canvas_backend -p "test_*.py" -v
```
