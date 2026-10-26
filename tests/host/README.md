# tests/host

Pinned baseline archives, isolated-host preparation and optional ComfyTV boundaries.

test_baseline_isolation, test_gpu_evaluation_preparation and test_host_isolation test refusal/reuse; test_optional_comfytv covers optional upstream layout.

Temporary preparation tests do not authorize changes to daily ComfyUI or prove model readiness.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/host -p "test_*.py" -v
```
