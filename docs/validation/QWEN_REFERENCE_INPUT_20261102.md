# Local Qwen reference input

Task #23, F-BIZ-027 / F-BIZ-029. A connected image previously remained unused
when the selected mode was text2image. That mode intentionally freezes no media.

The local provider now advertises image2image with exactly one image. Existing
frontend reference collection and asset freezing supply its identity; the provider
stages that frozen media into the existing image_graph. LoadImage and ImageScale
feed TextEncodeQwenImage21 image/VAE inputs, and KSampler uses encoder latent 2.
Explicit width/height control reference scaling and output geometry. No crop is
applied; differing aspect ratios stretch the reference. Text2image stays unchanged.
No model, service, download, scheduler or recovery path is added.

The new regression first failed on the old image2image rejection. Offline checks
cover mode/count/type rejection, staged asset identity, encoder and sampler links,
output dimensions, capability node availability and no capability submission.
The ten original request captures remain unchanged.

Reviewer separately ran the native graph using picture 8 and the already deployed
approved weights: prompt 5c037e7a-1f2a-4e48-b406-4095c8d4ae8a completed successfully.
Raw prompt/history/output stay in Reviewer's ignored night-e2e evidence directory.
This proves the native path; the built product still requires independent entry
validation: select reference mode, freeze picture 8, run, inspect frozen assets and
native graph, then return the new image to the table and repeat affected steps.
The complete nightly chain is not yet accepted by this change.
