# backend/integrations/comfyui/generation_nodes

Native result-reading node and ComfyUI queue adapter.

node.py reads verified output; native_host.py validates/enqueues owned prompts and queries/cancels matching work.

DAELAB.LibTV.VideoGenerate retains 17 inputs/5 outputs; the historical name does not enable old LibTV execution.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
