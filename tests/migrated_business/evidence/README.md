# Business frontend extraction evidence

This directory records rule and contract verification, not ComfyUI product acceptance or a passed M3 gate. No provider or model was invoked. Deterministic services exist only in test injection.

The authoritative command is:

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/*.test.mjs
```

The final rule run passed 322 tests. The eight production extension entrypoints import without reading an uninitialized graph or starting timers. Node registration, adapter menus, legacy hook exclusion and B's native slot order are checked at runtime. All 81 JavaScript/ESM source files pass `node --check`; strict TypeScript and the repository architecture check also passed. These checks do not substitute for two-instance, focus/overflow, modes, save/reload or zoom inspection.

## Preserved failures

- `first-failing-run.tap`: 314 tests, 278 pass / 36 fail. Initial copied tests still assumed duplicate button behavior, global native auth/fetch, all historical node ownership, and global LiteGraph access. Production now uses the shared controls and explicitly bound ports; adapted tests exercise those real boundaries without weakening substantive assertions.
- `second-run.tap`: 313 tests, 301 pass / 12 fail. A separate panel DOM fixture lacked `getAttribute`. The count changed because two overlapping historical node-ownership assertions became one exact five-formal-types assertion.
- `third-run.tap`: 319 tests, 318 pass / one module failure. Removing an unused table export helper broke its retained source contract test. The helper was restored with an explicit real-provider requirement; the product simulator and implicit mock provider remain removed.
- `final-rule-run.tap`: 322 tests, all pass. The additional nine contract tests cover absent services, the six-route HTTP assembly, stale binding disposal, old native workflow defaults, multi-material cell append/500-row/64-column limits, scene/reference-image separation, explicit LLM apply/undo and entrypoint isolation.
- Initial architecture checking also found an old absolute shared-controls import left by line-ending differences. It was replaced with the single-package `ui` imports before the successful 123-module dependency check. This failure was observed in command output; it is described here because no separate raw file was captured.

Logs replace local checkout paths with `<studio>`. Literal API-key strings in source tests are synthetic test data, never credentials.

## Product integration handoff

The eight entrypoints are `business_bootstrap.js`, `app_mode_bypass.js`, `creative_canvas_adapter.js`, `daelab_comfytv_storyboard.js`, `libtv_panel.js`, `llm_style_preview.js`, `prompt_optimization_lifecycle.js`, and `script_parser.js`, under `frontend/src/integrations/comfyui/business/`. They preserve the source extension lifecycle and work with the same-path, no-bundle build. Importing feature helpers alone does not register product nodes.

`business_bootstrap.setup` installs the typed BusinessHostPort and `bindBusinessHttp`. It binds only `/daelab/storyboard/import_document`, `/daelab/storyboard/parse-prompts`, `/daelab/script-parser/document`, `/daelab/script-parser/normalize`, `/daelab/script-parser/classify` and `/daelab/script-parser/ai-status`, using the existing backend DTOs. Query and method allowlists reject arbitrary routes. A missing classifier remains the backend's explicit 503 response. Optimization, auth and generation stay unbound; they reject with `BusinessCapabilityUnavailable` before submitting work. There is no old LibTV route or provider fallback.

Only Table, StoryboardImport, ScriptParser, LLMStylePreviewB and LibTV.VideoGenerate receive normal business adapters or executable hooks. A/C/D/E, GPTImageStoryboardStage, the old LibTV batch and unknown node payloads do not receive these hooks. Read-only compatibility and migration remain owned by the separate compatibility implementation; this evidence does not claim their full product acceptance.

The current default table is compared against the public synthetic workflow saved from the isolated old ComfyUI host. It remains 图片/视频、提示词、生成 with 任务1–3, local Qwen-Image-2.1 Turbo, 1024×1024 and text2image. Only generated IDs are normalized in that comparison. ScriptParser keeps `scene` as longtext and gives images a separate content column; repeated image occurrences retain independent identities and source provenance.

Root owns backend/bootstrap composition, package scripts, final build and live ComfyUI verification. Add this suite's loader/command to CI after integration. Root also owns further DocumentController convergence and actual generation ledger/provider assembly; this extraction does not establish those later gates.
