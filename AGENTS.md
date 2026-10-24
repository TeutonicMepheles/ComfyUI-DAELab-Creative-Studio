# Creative Studio ownership

This repository owns the single ComfyUI Creative Studio product: shared design/UI,
canvas, assets, tables/storyboards, prompts, generation, tasks and editing/export.
The migration specification and decisions are in docs/migration-blueprint/.

- Preserve stable node IDs, native slot indices, material JSON,
  daelabCreativeCanvasV1, clipboard and public adapter v1 contracts.
- The native workflow owns editing data. Application document controllers apply
  edits through the host history bridge. SQLite owns task facts; undo never changes
  those facts. View sessions own transient focus/hover/playback state.
- New frontend core and interfaces use strict TypeScript. Reuse mature ESM and
  shared controls. Do not rewrite the UI framework or duplicate component state.
- Read relevant sections of docs/architecture/FRONTEND_INTERACTION.md and linked
  contracts before frontend changes. Inspect actual isolated ComfyUI with two
  instances, overflow/focus, modes, save/reload and affected zoom/viewports.
- ComfyTV is optional read-only upstream. Never bundle or modify its source.
- No badge, exhibition, segmentation, old LibTV execution, or prototype panel
  registrations. Compatibility preserves raw unknown data and visible reports.
- Never enable old and new implementations together or depend on load order.
- Real model tests ONLY use local qwen3.5:9b-q4_K_M, local Qwen-Image-2.1 Turbo,
  and local MiniMax H3 FL. No cloud calls, fallback models or substitute downloads.
  Use isolated user/input/output/temp and do not change the user's port 8000 graph.
- Track task -> F -> AC -> UC -> TC -> EV -> evidence. Unimplemented/unexecuted/
  unavailable is not pass. Gates use applicable cumulative P0/P1 by TC.phase.
  Preserve first failures and invalidate evidence when relevant fingerprints change.
- Raw evidence, user workflows, credentials, model weights and outputs stay under
  ignored .local/ or user data. Only public synthetic/sanitized fixtures are committed.
- Preserve upstream copyright and asset licenses. Neither source has a repository
  code LICENSE at the pinned baseline; do not invent or change a code license.
- Use codex/ branches and stage commits. Only release after all M6 gates pass.

