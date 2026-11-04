# Independent high BF16/Flex video profiles

Task 41, Cindy instruction e862fb72; Architect confirmation 84ba4e16.
Source preparation is separate from download, native loading and real generation.
No high-profile inference or installation is claimed by this record.

## Official execution path

The matching Flex LoRA is required, not bypassed: FL node 134 and Ref node 145
connect directly to their BasicGuider. Strength is 1.0; sampler is lcm with
SamplerCustomAdvanced and ManualSigmas:
`1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0`.
The seven sigma values describe six intervals; setting a generic scheduler to
six steps is not used as a substitute.

Sources, workflow revision `9a51089f3bcacf84ccceca3907a493027ae32bfa`:

- [FL2VA template](https://github.com/Comfy-Org/workflow_templates/blob/9a51089f3bcacf84ccceca3907a493027ae32bfa/templates/video_pika_h3_flex_fl2va.json)
- [Ref2VA template](https://github.com/Comfy-Org/workflow_templates/blob/9a51089f3bcacf84ccceca3907a493027ae32bfa/templates/video_pika_h3_flex_ref2va.json)
- [Pika's adapter documentation](https://huggingface.co/Pika-Labs/Pika-H3-Flex/blob/main/comfy/README.md)

The generic video_minimax_h3 templates contain different Turbo adapters and do not
establish this path. The attachment requests BF16 base weights and FP16 video VAE;
that explicit precision combination replaces the dedicated templates' default int8
components while preserving their Flex/sampling/conditioning path. Its actual
loading, memory use and outputs still require independent measurement.

## Integration

- Independent `video_high` / `video_reference_high` families and
  `local-h3-high` / `local-h3-reference-high` providers.
- Labels `MiniMax H3 FL 高配（本地）` / `MiniMax H3 Ref 高配（本地）`.
  Existing defaults, low profiles, old FL/Ref bindings and saved task choices stay
  separate. Existing video controls and local source badge are reused.
- Both profiles require diffusion_models, text_encoders, video_vae, audio_vae and
  the matching loras binding. File names are checked against the precise variant;
  every declared file is verified by the existing SHA256 inventory before execution.
  Missing adapter/files/hash errors fail, with no base/Turbo/low fallback.
- Required Flex loading is explicit in the graph. Legacy `turbo:true` cannot choose
  the old accelerated graph. No Turbo/LoRA user control is added or advertised.
- Existing frame/reference ordering and immutable request IDs remain in use. Video
  decode uses the dedicated template's VAEDecode; audio decode/CreateVideo/SaveVideo
  preserve the plugin's owned output path. Ref conditioning includes audio_vae.
- Metadata reports BF16, Flex strength, sampler/sigmas, six NFE and 24fps. Existing
  integer duration UI and saved fractional duration interpretation are retained.

## Verification and handoff

Synthetic tests cover full configuration -> assembly -> authoritative catalog ->
capability -> frozen graph, required/mismatched adapters, file hash changes, forced
non-Turbo sampling and ordered two-image references. The installed SDK's ManualSigmas
CPU execution returned seven expected values and its sampler list includes lcm;
no weights were loaded. Complete npm check, Python generation 147 and unit 16 passed.

Reviewer must wait for Architect's complete fixed-SHA files, then test exact loading,
one node submission and two-row table queue per profile, source/ownership/preview,
save/reopen and failure presentation. File readiness and graph validation alone
do not pass high-profile generation or establish performance on the 16GB GPU.
