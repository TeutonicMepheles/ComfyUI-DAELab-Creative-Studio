# backend/integrations/comfyui/generation_nodes

Native result-reading node and ComfyUI queue adapter.

node.py reads verified output; native_host.py validates/enqueues owned prompts and queries/cancels matching work.

native_text.py is the internal reference-text output node. It delegates generation
to the installed TextGenerate implementation and records raw/final text plus actual
output-token count. The queue rejects incomplete or limit-reaching text results.

DAELAB.LibTV.VideoGenerate retains its named legacy inputs and five outputs, with optional Autogrow text/image/video/group inputs for the generation panel. The historical name does not enable old LibTV execution.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
