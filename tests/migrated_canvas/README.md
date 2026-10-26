# tests/migrated_canvas

Canvas, controls, slots, groups, native history and optional adapter regressions.

canvas_host/production_boundary check integration; history_* checks undo ordering; panel_* and creative_* cover focus, lifecycle and geometry.

Controlled tests are separate from actual viewport/zoom, overflow, modes and save/reload inspection.

Focused checks, from the repository root:

```powershell
node --test tests/migrated_canvas/*.test.mjs
```
