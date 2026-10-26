# Source migration audit

This audit records source facts at Canvas `3176b5a67dbcd0b66f795976e5a81bcdfe346093`
and business library `7ff56cb51ef6f7fc3bcf5707792d655037c61b30`.
It is not evidence of product acceptance. Source repositories were read without
modification. The authoritative decisions remain `docs/migration-blueprint/catalog/`.

## Registration ownership

| Stable type | Production source | Target responsibility |
| --- | --- | --- |
| DAELAB.MediaUpload | canvas:nodes/media_upload.py | Assets and host registration |
| DAELAB.TextInput | canvas:nodes/text_input.py | Text assets and host registration |
| DAELAB.MaterialGroup | canvas:nodes/material_group.py | Ordered groups and host registration |
| DAELAB.VideoEdit | canvas:nodes/video_edit.py | Editor and media services |
| DAELAB.Table | business:nodes/daelab_comfytv_storyboard/table_node.py | Table document |
| DAELAB.ScriptParser | business:nodes/daelab_comfytv_storyboard/script_node.py | Storyboard document |
| DAELAB.StoryboardImport | business:nodes/daelab_comfytv_storyboard/import_node.py | Import compatibility and table document |
| DAELAB.LibTV.VideoGenerate | business:nodes/libtv_bridge/node.py | Generation result outputs; retain ID and slot ordering |
| DAELAB.LLMStylePreviewB | business:nodes/prompt_optimization/approved_result.py and web/llm_style_preview.js | Approved prompt results |

The six read-only compatibility types are
`DAELAB.ComfyTV.GPTImageStoryboardStage`, `DAELAB.LibTV.StoryboardBatch`, and
`DAELAB.LLMStylePreviewA/C/D/E`. Their schemas, raw data, connections and saved
results must be preserved. They are not production creation menu entries.
The GPT storyboard source still executes cloud generation at this baseline;
read-only compatibility is a migration decision, not a description of that code.

## Selective backend extraction

Canvas production files are `media_upload.py`, `text_input.py`, `material_group.py`,
`material_output_files.py`, `material_output_api.py`, `video_edit.py`, and
`video_edit_media.py`. Rebuild registration explicitly instead of copying root
registration modules.

Under business `nodes/daelab_comfytv_storyboard/`, the reusable closure is:

```text
document_import.py import_node.py prompt_api.py prompt_compiler.py
prompt_service.py prompt_templates.py script_ai.py script_api.py
script_contract.py script_document.py script_node.py table_adapter.py
table_node.py table_source.py video_references.py
```

Under business `nodes/prompt_optimization/`, the reusable closure is:

```text
api.py approved_result.py canvas.py context_copy.py deepseek.py instructions.py
local_qwen.py pricing.py qwen.py service.py transport.py
```

The prompt service's private SQLite ledger and canvas request state must join the
single jobs service. Cloud adapters may remain, but only protocol simulations are
authorized for this migration. Optional AI document classification must also obey
the local-only evaluation policy.

Under business `nodes/libtv_bridge/`, review and rehome:

```text
node.py media_snapshot.py table_comfy_image.py table_comfy_video.py
table_generation_api.py table_local_execution.py table_local_image.py
table_local_models.py table_local_video.py
```

These are not safe for unmodified package copying. The current 40-file Python
closure includes retired execution through these edges:

- `table_generation_api -> connection_api -> connection -> runtime.CLI`.
- `table_generation_api -> table_generation.ColumnBridge -> runtime.Bridge`.
- `table_generation_api -> node -> runtime.Bridge/MODELS`.
- `prompt_service -> libtv_bridge.runtime.digest_file`.
- `prompt_api` imports `libtv_bridge.node.local_media` inside its handler.
- `table_local_execution.enqueue` imports `prompt_optimization.local_qwen.native_admission`.

Extract only `digest_file`, `atomic_json`, and `job_lock` from the old runtime;
old error interpretation belongs in compat. Extract `StructuredPrompt` and
`compile_segments` from table_generation, not `ColumnBridge`. Extract
`local_request` from connection_api, not its Connection dependency. Legacy URL
responses may remain as explicit retired responses. Never import legacy Bridge,
CLI, login, batch or transport code merely to reuse one helper.

Required host APIs include `folder_paths`, `PromptServer`, `execution`, `nodes`,
`comfy_api.latest`, and `comfy.model_management`. Media uses aiohttp, PyAV,
NumPy, Torch and Pillow; optional document readers use python-docx, openpyxl and
pdfplumber. `comfy_api_nodes.*` imports must stay capability-gated so a missing
cloud provider cannot prevent the base canvas from loading.

## Frontend production extraction

The exact migrated Canvas files and both source/destination SHA-256 values are in
[canvas-files.json](canvas-files.json). Mature ESM, controls, semantic CSS and
unmodified third-party assets are retained. The build preserves the directory
structure under `web/`; no bundler-specific asset resolution is assumed.

| Source group | Single destination owner |
| --- | --- |
| Theme and original vendor assets | frontend/src/design |
| Button, field, panel context and active-state binding | frontend/src/ui |
| Projection, navigation, selection, Slot, connections, material exchange and public API | frontend/src/canvas |
| Native registrations, host history and optional upstream adapter | frontend/src/integrations/comfyui/canvas |
| Upload, text, favorites and asset library | frontend/src/features/assets |
| Group data and interactions | frontend/src/features/groups |
| Editing model, panel and styling | frontend/src/features/editor |
| Read-only task capsules | frontend/src/features/tasks |

Host `/scripts/app.js` and `/scripts/api.js` imports are confined to integration
entrypoints. Relative imports, CSS imports and runtime asset URLs resolve within
the same package, including when its installation folder is renamed.
The integration entrypoint creates the existing history bridge and injects it
into canvas/group controllers; those controllers do not import host internals.
The mature inputSnapshot implementation now lives with the adapter registry in
creative_contract. creative_input_exchange re-exports that same function and
retains its compatibility publication helper, removing the former two-module
cycle without creating a second registry or changing the v1 API.

The test-only `creative_field_gallery.mjs` and its production view hook are
excluded. Unknown `graph.extra` fields are not erased. The former implicit
`migrateGroups` load hook removed prototype inputs and links; that hook and its
destructive converter are excluded from production. An explicit compat migration
must preserve originals and report conversions before that legacy behavior can
be offered. The old test expecting silent deletion is not a new product contract.

Business frontend migration has not been performed by this extraction. Its seven
roots are `app_mode_bypass.js`, `creative_canvas_adapter.js`,
`daelab_comfytv_storyboard.js`, `libtv_panel.js`, `llm_style_preview.js`,
`prompt_optimization_lifecycle.js`, and `script_parser.js`. Their existing closure
contains 84 JS/MJS files, with these required exclusions/extractions:

- `badge_image_drop_87.mjs` supplies only two generic local `/view` drag parsers;
  extract those into assets without any badge panel.
- `libtv_panel.js` has a current `installVideoTasks` branch and dead/legacy
  connection and batch UI. Extract the current branch; isolate historic results.
  `libtv_connection.mjs`, `libtv_batch_panel.mjs`, `libtv_canvas_result.mjs` and
  `libtv_task_snapshots.mjs` must not become the new generation dependency chain.
- `libtv_canvas_result.mjs` requires a ComfyTV loader. Basic result reuse must use
  the product's material-output API; upstream ComfyTV stays optional and read-only.
- `llm_style_preview.js` registers A through E. Separate production B from the
  four read-only prototypes.
- `data_table_nodes.mjs` treats GPTImageStoryboardStage as an ordinary table;
  split its compatibility presentation from normal generation controls.
- `prompt_preset.js` is exhibition-specific despite its generic filename. Exclude
  it, prompt_preset_model, thumbnail_selector, styles.json and exhibition thumbs.
- Narrow app_mode_bypass's historical 74-type table to product-owned types.

`table_controls.mjs` and `llm_style_preview_panel.mjs` contain absolute imports
from the old Canvas package. Convert these to package-relative shared controls.
Business `creative_theme.css` is a forwarding stub, not the owning theme. Do not
copy the duplicate `vendor/prompt-optimization-shared` theme/font bundle. Merge
needed original icons into the single design resource owner with their licenses.

The business CSS closure comprises table_ui, prompt_optimization,
prompt_optimization_composer, llm_style_preview, script_parser and video_tasks.
Model icons comprise bytedance, minimax, qwen, deepseek and libtv; retain separate
brand provenance instead of claiming one license covers all five.

## License and runtime concerns

Neither pinned source has a repository-level code LICENSE. Canvas README already
states that public visibility is not relicensing. No new code license is inferred.
Alibaba original WOFF2 files retain their notice and SHA-256 manifest. Remix icons
retain their bundled license. Lobe model icons retain their MIT notice; the LibTV
brand mark has separate provenance and is not covered by that MIT license.

`local_qwen.py` computes its GPU admission lock from
`folder_paths.base_path/user/local-qwen35-9b`, not `get_user_directory()`. Merely
passing an isolated user directory does not isolate that lock. Preserve intentional
cross-process GPU coordination without sharing task/user data. The same code
adds a native /prompt middleware and can unload Ollama; never run its destructive
acceptance against the user's active server or assume startup is side-effect free.

Automatic regression results and actual host acceptance must be reported
separately. This extraction does not establish M1/M2/M5 completion, local model
quality, or save/reload and two-instance product acceptance.

## Extraction validation record

`node --test tests/migrated_canvas/*.test.mjs` runs 45 migrated rule cases and six
package-boundary checks. All 51 pass with Node 24.14.0. The first boundary test run
failed to parse because of an extra closing parenthesis in its two source loops;
that test authoring defect was corrected before the successful run. After the
history injection change, the complete 50-case set passed again; the additional
shared snapshot identity case passes after removing the contract/exchange cycle. These are local
rule checks, not TC or stage acceptance evidence. Actual isolated ComfyUI visual,
two-instance, mode-switching and save/reload checks remain pending.
