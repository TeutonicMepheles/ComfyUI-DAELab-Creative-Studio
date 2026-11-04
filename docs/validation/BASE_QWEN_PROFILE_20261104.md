# Base Qwen image profile

Task #41, first delivery: `Qwen-Image-2.1（本地）` is a separate image model identity
and provider (`local-qwen-image-base`). Its optional `modelBindings.image_base`
contains diffusion_models, text_encoders and vae bindings with name/path/SHA256.
It does not accept a GGUF projector. The existing Turbo identity and configuration
remain separate.

The base graph uses native CLIPLoader(type=qwen_image), QwenImage21Cache and the
existing TextEncodeQwenImage21 reference path, with 25 steps / CFG 1 / euler / simple
from the official Comfy template supplied by Architect. Turbo keeps CLIPLoaderGGUF,
its mmproj binding and 8 steps. Prepared graphs retain their own file identities,
model IDs, settings and deterministic native request IDs.

The model appears through the existing image selector, source badge and visual
ratio/automatic-size controls. No new style or component was introduced. Missing
bindings report unavailable; there is no fallback to Turbo or automatic download.

The exact three-file configuration fragment is provided separately as
`base-image-bindings.json` in Implementer's workspace, generated from Architect's
fixed-revision manifest. Reviewer merges its `image_base` object into the existing
isolated host configuration's modelBindings, retaining every other binding and
resource lock. This source commit does not edit any running host configuration.

Source validation: 3 new profile tests cover native loader/25 steps/no projector,
legacy Turbo separation/frozen graph identity, and reference conditioning. Strict
TypeScript, 677 business tests, frontend 448 passed / 3 existing skips, and Python
unit 16 passed. Full generation tests and final build are recorded in handoff.

Weights being present and source tests passing do not prove loading or inference.
Reviewer must validate the exact BF16 base model, int8 encoder and BF16 VAE, then
run single and two-row generation with resource measurements. PE, 27B and additional
MiniMax profiles are subsequent deliveries, not claimed complete here.
