# Empty parser selection visibility

Task #42 / AC-CAN-011-001. The current build contained the selection code.
The newly square empty parser exposed a different path: its internal selection
surface fills a workbench with `overflow:auto`, which clips the outside outline.
The imported table's natural-height path did not exhibit this failure.

The parser adapter now returns no internal selection surface while the panel is
empty. The canvas therefore uses its existing outer-card ring, beyond the
scrolling workbench. Once the table appears, it returns the table surface again.
No second selection state or new ring style is introduced.

Workspace `empty-parser-selection-check.mjs` and
`empty-parser-selection-{before,after}.json/png` reproduce the old empty-state
failure and verify actual menu creation, click, marquee, mixed selection,
movement, parsed-table transition, undo to empty and zoom. The paired `*-click.png`
screenshots were visually inspected: the old outline shows only corner glints;
the new outside ring is continuous on all four sides. CSS numeric width alone
is insufficient evidence because the clipped ring also reported a nonzero width.

Type checks, architecture checks, 259 canvas tests and 644 business tests pass.
Final build/CI and independent screenshot/pixel verification remain with
Controller/Reviewer. The base includes the square parser, display name, import
title protection and current-task price fixes; host settings were not changed.
