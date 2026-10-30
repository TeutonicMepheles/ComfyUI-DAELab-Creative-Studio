# backend/providers

Local Qwen/Ollama and native image/video adapters plus request construction.

contracts.py distinguishes rejected/uncertain delivery; parameters.py builds graphs; native.py verifies models; qwen_binding.py verifies registry/blobs; context_copy.py checks copying.

Injected transport/queues execute; providers do not own another scheduler or ledger.

comfy_text.py shares GPT-6 Luna optimization between standalone and table entrypoints. Native Comfy Responses transport, login and official credit pricing are injected from integrations/comfyui. Paid POST requests never retry automatically; an available original response ID can be queried without creating a replacement. Credentials never enter frozen inputs or the ledger.

deepseek.py implements explicit DeepSeek Flash text optimization through the shared ledger. Its fixed HTTPS transport disables redirects, proxy inheritance and automatic retries. Request-scoped or host-configured credentials are resolved outside snapshots. Lost responses remain unknown; neither recovery nor lookup recreates a completion. Table requests retain protected-reference validation and require an accepted USD estimate before advance.

comfy_video.py maps frozen image/video references and mode-specific installed schemas into official Seedance and MiniMax H3 API node graphs. Host assembly explicitly enables these remote providers; credentials remain in the host queue's transient sensitive fields. No provider-owned network client or fallback is added.

comfy_image.py maps GPT Image text/reference requests into the official image node with one output per task, preserving reference order and the same authenticated queue lifecycle.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
