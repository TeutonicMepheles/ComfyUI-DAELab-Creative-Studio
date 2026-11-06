# backend/providers

Local Qwen/Ollama and native image/video adapters plus request construction.

contracts.py distinguishes rejected/uncertain delivery; parameters.py builds graphs; native.py verifies models; qwen_binding.py verifies registry/blobs; context_copy.py checks copying.

Injected transport/queues execute; providers do not own another scheduler or ledger.

high_video.py adds independent BF16/Flex profiles with a required matching adapter,
official lcm/manual-sigma sampling and fixed strength. It preserves all old video
routes. See the [source handoff](../../docs/validation/HIGH_VIDEO_SOURCE_20261105.md)
for template provenance and the separate real inference evidence.

native_text.py adds the separate pinned `text_pe` reference-image enhancer through
the existing native queue. It never uses the Ollama blob binding or a fallback.
Only a verified complete final body becomes a reviewed text proposal; raw output
and generated-token counts remain in native history. See the
[source validation record](../../docs/validation/PE_NATIVE_TEXT_SOURCE_20261105.md).

native_27b.py uses the same owned queue/result path with an independent `text_27b`
binding and the official non-thinking template. Only that profile fixes MTP off;
PE and Ollama are unchanged. See the
[27B source record](../../docs/validation/NATIVE_27B_SOURCE_20261105.md).

Local Qwen image2image accepts one frozen image. The same image_graph stages it,
scales it to the explicit width/height without cropping, and passes image and VAE
to TextEncodeQwenImage21. Sampling uses that encoder's reference latent. Width and
height therefore also determine reference scaling; select the reference aspect
ratio to avoid stretching. Text2image retains its original graph and settings.
The reference mode is offered only when LoadImage and ImageScale are installed.

Qwen's optional `ratio` setting accepts `auto` or the capability's declared fixed
ratios. Automatic sizing uses the orientation-aware dimensions of the verified
frozen reference; without a reference it uses the model's 1024-square default.
The injected dimensions reader does not access arbitrary URLs. New tasks resolve
their aligned dimensions before freezing the prepared graph. Existing explicit
width/height settings without `ratio`, and all existing frozen requests, retain
their original interpretation. The capability's `config.imageSize` provides the
pixel presets used by the UI; `image_dimensions.py` owns the shared construction.

comfy_text.py shares GPT-6 Luna optimization between standalone and table entrypoints. Native Comfy Responses transport, login and official credit pricing are injected from integrations/comfyui. Paid POST requests never retry automatically; an available original response ID can be queried without creating a replacement. Credentials never enter frozen inputs or the ledger.

deepseek.py implements explicit DeepSeek Flash text optimization through the shared ledger. Its fixed HTTPS transport disables redirects, proxy inheritance and automatic retries. Request-scoped or host-configured credentials are resolved outside snapshots. Lost responses remain unknown; neither recovery nor lookup recreates a completion. Table requests retain protected-reference validation and require an accepted USD estimate before advance.

comfy_video.py maps frozen image/video references and mode-specific installed schemas into official Seedance and MiniMax H3 API node graphs. Host assembly explicitly enables these remote providers; credentials remain in the host queue's transient sensitive fields. No provider-owned network client or fallback is added.

comfy_image.py maps GPT Image text/reference requests into the official image node with one output per task, preserving reference order and the same authenticated queue lifecycle.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
python -m unittest discover -s tests/evals -p "test_*.py" -v
```

Capability responses expose verified binding names/hashes and sampling parameters for model notes. They omit local paths and do not load or execute a generation merely to render a note. The frontend omits unknown precision fields rather than inferring them from tier labels.
