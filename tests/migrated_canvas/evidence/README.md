# tests/migrated_canvas/evidence

Historical explanations of observed canvas regressions.

history-keyboard.md records the duplicate-undo cause, pinned host behavior and targeted rule coverage.

The following command reproduces controlled tests, not the original browser session.

Focused checks, from the repository root:

```powershell
node --test tests/migrated_canvas/history_keyboard.test.mjs tests/migrated_canvas/history_workflow_lease.test.mjs
```
