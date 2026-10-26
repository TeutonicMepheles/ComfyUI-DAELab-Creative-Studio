# Runtime baseline discovery

2026-10-24. This report establishes local prerequisites and isolation boundaries.
It does not establish product acceptance, performance, model quality, or stage completion.
No generation, model download, production workflow edit, or Ollama start was performed.
Private paths, input candidates and detailed observations remain in ignored
`.local/baseline/runtime.json`.

| Component | Observed baseline |
| --- | --- |
| ComfyUI | 0.39.2, clean commit `3c1b7a17fdf239d35ce98cc777756f572d089795` |
| Frontend package | 1.53.10 |
| Python / PyTorch | 3.12.11 / 2.8.0+cu129 |
| Node / gguf | v24.14.0 / 0.19.0 |
| OS | Windows 11 Pro, build 26200 |
| CPU / memory | Ryzen 9 9950X3D / 100547211264 bytes |
| GPU / driver | RTX 5080, 16303 MiB / 591.86 |
| Additional local image node package | ComfyUI-GGUF, clean commit `373048b8403a7820620065210a691263d4da0a61` |

Production port 8000 was inspected with read-only requests. Its queue was empty,
but approximately 8397 MiB of GPU memory was occupied across the machine. An empty
ComfyUI queue does not establish an idle GPU or a matched cold/warm performance state.

The eight actual ComfyUI weight files below were rehashed during this task.
The local Ollama model and projector blobs, configuration, template, license and
parameters were also rehashed against their content-addressed names and manifest.
Weights are not distributed by this repository.

| Weight filename | SHA-256 |
| --- | --- |
| qwen_image_2.1_turbo_int8_convrot.safetensors | `8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c` |
| Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf | `f8f9f6276b726db5291f4a5343089612cb5fd08aa81e8f0791dc66d2c03d07ca` |
| mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf | `d9870a1f168db3d814596216aaf35702154147b443572c7939acca1802621ac6` |
| qwen_image_2.1_vae_bf16.safetensors | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |
| MiniMax-H3_FL2VA-NVFP4.safetensors | `1519c19084ba0387a5f5c3983fcf32aee5923045de1ef4e44c04ca2e2ba486e5` |
| qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors | `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6` |
| minimax_h3_video_vae_fp16.safetensors | `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` |
| minimax_h3_audio_vae_fp32.safetensors | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |
| Ollama qwen3.5:9b-q4_K_M model blob | `02d45dc1cf451ba2475ac33b301c2dd8f985abe4c182ce04a1f2f5bf0260278d` |
| Ollama qwen3.5 projector blob | `f836f08f921193f4d6b6a6952dba0a6fb116759d26a757bcb395d570d73976ca` |

The standard 20-step H3 stack is present. The optional H3 eight-step LoRA was not
found; the conditional six-run supplement requires it to be configured in both
versions. No substitute download or model fallback is permitted. Ollama runtime
and model files exist, but port 11434 was not listening at observation time.

## CPU isolation harness

`tools/host/prepare_isolated.py` prepares an independent base with user, input,
output, temp, model, database and log directories. It snapshots the supplied new
package under a custom-node whitelist, excludes private/test directories, and
records the file hashes and exact command in a local ownership manifest.
Credential files (`.env*`, key stores and common auth files), SQLite data, raw media
and model weights are excluded from runtime snapshots. An implicit source-host
`extra_model_paths.yaml` is rejected to prevent inherited paths from escaping the
reviewed isolation configuration. Runtime snapshots are not release packages;
release packaging still needs an explicit production allowlist.

```powershell
python tools/host/prepare_isolated.py `
  --source-host <existing-comfyui-source> `
  --python <existing-comfyui-python> `
  --environment-root <this-repository>/.local/host-new `
  --package-root <this-repository> --port 8224 --start
```

The default uses CPU, offline mode and no manager. It rejects port 8000, occupied
ports, existing unowned directories, source-host overlap, production user
workspace paths, and linked data/package directories. Reuse preserves user data;
changed package snapshots require explicit `--refresh-package` while stopped.
`--fixture-package` loads an explicitly supplied test-only package in addition to
the product; omitting it keeps fixtures out of the product menu.

Seven boundary tests passed after an initial three-error harness run exposed an
overbroad Windows Temp ancestor guard. Both attempts are recorded locally. These
tests validate the harness protections, not Creative Studio UI or M1 acceptance.
Subsequent privacy and implicit-path regression checks extend that suite to nine
tests; their logs remain under `.local/baseline/`.

The initial empty product skeleton was started successfully on isolated port
8224. Startup logs confirm CPU mode, the single permitted product package import,
and frontend 1.53.10. Its queue and history were empty and no product or test nodes
were registered at this skeleton stage. Production retained the same listening
process and an empty queue. Exact snapshot hashes, arguments, process identities
and responses are in ignored `.local/baseline/cpu-host-smoke.json`. Later package
changes invalidate that snapshot as evidence for the changed implementation.

## Required follow-up before GPU and release acceptance

- Coordinate GPU use across old, new and production hosts. The legacy admission
  lock uses the base directory, so independent bases do not share that lock.
  Polling the production queue is not atomic admission. Never interrupt or unload
  the production process to make an evaluation pass.
- Apply explicit backend provider/network controls. ComfyUI `--offline` disables
  partner nodes and constrains browser traffic; it is not a Python network firewall.
- Preserve input originals; remove old receipts and caches only in derived fixtures.
  Historical generated outputs are not current baseline runs. Preserve existing
  prompt defects as baseline findings rather than changing prompts during comparison.
- Record browser/version/viewport/DPR and perform real two-instance UI checks.
  Minimum-supported and latest-candidate host checks, PERF-01–08, real model runs,
  blind A/B scoring and end-to-end migration/rollback checks remain unexecuted.
