# backend/media

Native-queue CPU exports, rooted media resolution and complete-media validation.

EXPORT_CONTRACT.md defines DTOs/ownership; export_service.py manages facts; video_edit_media.py renders; validation.py decodes.

HTTP recovery/status never start a second render; exports share the product ledger and catalog.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/media_export -p "test_*.py" -v
python -m unittest discover -s tests/review_backend -p "test_*.py" -v
```
