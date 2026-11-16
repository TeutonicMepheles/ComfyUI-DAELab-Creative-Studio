# 逻辑模型目录

`model_catalog.mjs` owns the page-wide logical model identity catalog and availability state machine. Its static definitions cover image, video and text models; `replaceDefinitions()` can replace that set while retaining unchanged provider capability snapshots. Generation, table and LLM controls share the singleton. `invalidate()` and `markUnavailable()` are host-level actions and are not scoped to one table instance. A catalog entry does not prove installation or successful inference.

States are `checking`, `available`, `unverified` and `unavailable`. `unverified` remains selectable but is never reported as available; submission still performs provider preflight. `model_catalog_ui.mjs` owns the shared option presentation: loading ring, disabled semantics and generic accessible labels. Raw probe failures are logged as structured provider/model/stage/code events and never enter user-facing model menus, nodes or toasts.

There is no `model_catalog_discovery.mjs` in the current source tree. Do not describe automatic startup/reconnect discovery as delivered. DeepSeek's independent key channel is retired. Four-kind configuration including 3D, unified input/parameters/output schemas and open/closed/environment restrictions remains pending under AIGC-1113-02; see the [current task register](../../../docs/validation/WORKFLOW_BUGS_20261116.md).

`model_notes.ts` renders hover/focus notes from the latest capability snapshot only. Weight precision comes from verified binding names, sampling from the validated workflow, and image counts from mode ranges. Notes use a bounded, non-interactive popup outside the whole menu without resizing options; unknown fields stay omitted. Tier labels never imply speed or image quality.
