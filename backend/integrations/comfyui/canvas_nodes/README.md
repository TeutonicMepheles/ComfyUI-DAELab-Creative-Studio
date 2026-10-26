# backend/integrations/comfyui/canvas_nodes

Native uploads, text, material groups, material-output routes and editing/export.

media_upload.py/text_input.py/material_group.py preserve material JSON; video_edit.py delegates exports; asset_binding.py bridges catalog identities.

Asset facts belong to assets/; rendering and export transactions belong to media/.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_canvas_backend -p "test_*.py" -v
python -m unittest discover -s tests/media_export -p "test_*.py" -v
```
