# backend/integrations

Boundary between portable services and host runtime APIs.

comfyui/ is the supported host adapter; this container has no startup work.

Host lifecycle and registration belong here, not in core services.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
```
