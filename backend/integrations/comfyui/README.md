# backend/integrations/comfyui

ComfyUI assembly, duplicate-install protection, diagnostics and local-model configuration.

bootstrap.py checks ownership; services.py composes catalog/ledger; local_generation.py reads explicit configuration; asset_api.py exposes catalog operations.

The host retains its native queue and lifecycle. Old/new packages cannot overlap registrations.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
python -m unittest discover -s tests/host -p "test_*.py" -v
```
