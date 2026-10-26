# tests/unit

Portable bootstrap, diagnostics, health and frontend architecture/controller tests.

Python tests cover explicit assembly; architecture/document_controller/health_client *.test.mjs cover frontend contracts.

No model, live server or browser is needed.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
node --test tests/unit/*.test.mjs
```
