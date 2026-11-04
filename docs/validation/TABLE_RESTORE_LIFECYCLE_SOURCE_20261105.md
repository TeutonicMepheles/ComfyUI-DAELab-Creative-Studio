# Restored table panel installation

Task 45; original failure evidence: Reviewer's `task39-fl-batch-ready.json`,
`task39-fl-table-diagnostic.json` and `task39-fl-batch-real.json` in gap-review.
Native handleFile import failed before any video submission. The later tracker
had captureCanvasState, but the earlier table installation had already failed.

The table entry used a microtask-only installer. During asynchronous native graph
loading, creating its generation controls invokes syncFrameTags -> editor.change
-> native history.begin before the native workflow tracker becomes active.
Generation nodes already use the shared workflow lifecycle that defers installation
until native loading and its caller's continuation have settled.

The table entry now uses that same lifecycle. Creation/add/configure coalesce;
removed nodes cancel pending installation. No history check is bypassed, no editor
is fabricated, and no saved table/row/reference/task identity is replaced.
Actual missing host history capabilities still produce their existing error.

The regression uses the production table extension registration and shared lifecycle,
with synthetic panel assembly exercising the native history boundary. It verifies
that no edit occurs during restore without a tracker, and that one installation
uses configured saved data after tracker activation. Existing shared lifecycle
tests cover failed/overlapping loads, removed/replaced nodes and missing capabilities.

Actual re-import of the original file, first-frame selection, saved/reopened panels
and the two-row flow remain for Reviewer on the final integrated build. New-table
video results are separate evidence and do not close the original import failure.
