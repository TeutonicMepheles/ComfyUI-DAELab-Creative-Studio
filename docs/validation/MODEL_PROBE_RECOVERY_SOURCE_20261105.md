# Model probe recovery source handoff — 2026-11-05

Base: `9b7f02aaef3f5d40452f7590925240b3311d1164`.
Branch: `codex/probe-recovery`; worktree: `ComfyUI-DAELab-Creative-Studio-probe-recovery`.

## Behavior

- The real generation request timeout aborts with `probe_timeout`. Explicit external cancellation preserves its separate reason. Error names alone never determine timeout versus lifecycle cancellation.
- Timeout, transport failure and unknown exceptions remain unknown, with distinct public codes. Explicit backend configuration/component rejection remains unavailable. None of these paths submits generation.
- A model query has one in-flight promise. Force/manual retry joins that promise. Consumers supply lifetime guards; a result can publish only to its original model binding with a live consumer. Replacement/close discards old results. A shared page-owned discovery can finish independently of a closed panel.
- Unknown results receive at most two automatic rechecks (2s, 5s), then stay unknown. Closing the last consumer prevents scheduled rechecks. Manual retry starts a fresh bounded detection cycle.
- Existing generation model choices, generation configuration panels and text nodes expose a visible retry action. Unknown model choices perform detection without selecting the model. Status, pending indicator and retry visibility follow the catalog. Automatic recovery refreshes configuration without generating or changing saved model selection.
- Sidebar cleanup invalidates its consumer explicitly, even while DOM cleanup is in progress. No lifecycle completion reopens a closed panel.

## Validation

`npm run check`: typecheck, generated build, architecture/assets checks, frontend tests and business tests passed (455 pass / 3 existing skips; 680 business pass).

Added coverage includes actual API timer-triggered abort and explicit external close; shared in-flight identity; late completion after close/provider replacement; closure during retry delay; bounded retry budget; classification; and visible retry control disposal. Existing real text-panel native JSON/history tests also pass.

No GPU generation, live host replacement or paid request was made. Reviewer still validates final combined build in the actual host, including timeout → retry/recovery and imported low-video two-row execution.

## Integration

Apply this source commit on top of the existing low-video/shared-verification branch, then merge/rebase current main as previously agreed. The requested base predates current main's text DeepSeek retirement and table recovery. Preserve those current-main changes and new model definitions during conflicts; this patch does not intentionally change the model list/defaults. Shared backend hash verification is untouched. Generated `web` files are deliberately excluded; rebuild them in integration.
