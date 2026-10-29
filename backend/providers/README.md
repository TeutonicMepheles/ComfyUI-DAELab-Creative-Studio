# backend/providers

Local Qwen/Ollama and native image/video adapters plus request construction.

contracts.py distinguishes rejected/uncertain delivery; parameters.py builds graphs; native.py verifies models; qwen_binding.py verifies registry/blobs; context_copy.py checks copying.

Injected transport/queues execute; providers do not own another scheduler or ledger.

comfy_video.py maps frozen image/video references and mode-specific installed schemas into official Seedance and MiniMax H3 API node graphs. Host assembly explicitly enables these remote providers; credentials remain in the host queue's transient sensitive fields. No provider-owned network client or fallback is added.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
