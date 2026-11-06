# 逻辑模型目录

`model_catalog.mjs` owns the page-wide logical model identity catalog and availability state machine. Source identities and display labels come from the backend generation `models` endpoint; local static definitions are only the bootstrap fallback until that read succeeds. Reconnects and forced refreshes replace the complete definition set, while unchanged provider bindings retain their last capability snapshot. Generation, table and LLM controls share the singleton deliberately, while `invalidate()` and `markUnavailable()` are host-level actions and are not scoped to one table instance.

States are `checking`, `available`, `unverified` and `unavailable`. `unverified` remains selectable but is never reported as available; submission still performs provider preflight. `model_catalog_ui.mjs` owns the shared option presentation: loading ring, disabled semantics and generic accessible labels. Raw probe failures are logged as structured provider/model/stage/code events and never enter user-facing model menus, nodes or toasts.

`model_catalog_discovery.mjs` reads the backend catalog, performs one non-inference discovery, and refreshes it on host reconnect events, page visibility, DeepSeek key changes and explicit model rechecks. It does not start Ollama, load weights, call a cloud model or submit a generation request.

`model_notes.ts` renders hover/focus notes from the latest capability snapshot only. Weight precision comes from verified binding names, sampling from the validated workflow, and image counts from mode ranges. Notes use a bounded, non-interactive popup outside the whole menu without resizing options; unknown fields stay omitted. Tier labels never imply speed or image quality.
