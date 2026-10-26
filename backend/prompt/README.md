# backend/prompt

Pure prompt compilation, stable field bindings and reviewed local references.

prompt_compiler.py is pure; prompt_templates.py resolves row snapshots; prompt_service.py/local_media.py perform bounded file checks; prompt_api.py exposes DTOs.

Parsing does not upload, run inference or own task history.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_business_backend -p "test_*.py" -v
```
