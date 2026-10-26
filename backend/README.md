# backend

Python services for assets, durable jobs, prompts, local providers and media export.

contracts/ owns storage/error interfaces; integrations/comfyui/ owns host wiring; generation/, providers/ and media/ own application concerns.

Native workflows own editing data. SQLite owns task/asset facts; this package does not create another execution engine.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
python -m unittest discover -s tests/backend -p "test_*.py" -v
```
