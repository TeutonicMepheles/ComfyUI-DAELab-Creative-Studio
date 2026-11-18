# backend/integrations/comfyui

ComfyUI assembly, duplicate-install protection, diagnostics and local-model configuration.

bootstrap.py checks ownership; services.py composes catalog/ledger; local_generation.py reads explicit configuration; asset_api.py exposes catalog operations.

The host retains its native queue and lifecycle. To load Creative Canvas alongside Studio, authorize `ComfyUI-DAELab-Creative-Canvas` in `user/daelab/coexistence.json` and set `layerOwners.canvas` to `studio`. The updated Canvas package yields its canvas registrations to Studio. Studio checks the four canvas node owners and the single material-output handler after all packages load.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/unit -p "test_*.py" -v
python -m unittest discover -s tests/host -p "test_*.py" -v
```
