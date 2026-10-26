# tests/migrated_business_backend

Pure document/table contracts and backend source-provenance verification.

test_storyboard.py checks parsing/projection; test_boundaries.py checks no retired runtime imports and pinned source identity.

Importing services must not require a live ComfyUI host or provider transport.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_business_backend -p "test_*.py" -v
```
