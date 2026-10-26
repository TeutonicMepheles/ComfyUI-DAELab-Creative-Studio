# backend/providers

Local Qwen/Ollama and native image/video adapters plus request construction.

contracts.py distinguishes rejected/uncertain delivery; parameters.py builds graphs; native.py verifies models; qwen_binding.py verifies registry/blobs; context_copy.py checks copying.

Injected transport/queues execute; providers do not own another scheduler or ledger.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
