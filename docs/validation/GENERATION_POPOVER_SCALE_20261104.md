# Generation popover scaling

Task #29 addresses the three user screenshots in thread 727ee4f2. Previously the
model menu scaled its text and icons while keeping a fixed screen-space box,
padding and row geometry. Large zoom caused wrapping; small zoom left a large
box around tiny text.

Node popovers now apply one transform to the complete panel. Model text and icons
keep their logical trigger sizes. Width, padding, row height, badges and text
share the transform. Upward placement uses displayed dimensions; viewport limits
are converted back to logical dimensions for scrolling. Frame pickers follow
canvas layout events and their nested reference menu converts viewport positions
inside the transformed parent. Independent asset-library overlays are unchanged.

Source checks passed: TypeScript, 677 business tests, and the focused 15-test
popover suite. A new regression checks complete-box scaling and logical height
limits when zoom changes. The first cumulative run exposed a test-host event
target mismatch; frame listeners now use the existing window lifecycle.

A temporary Chromium fixture loaded the actual source modules using intercepted
local responses, without a server or generation requests. At 20%, 50%, 100%, and
200%, a 340px logical menu displayed at 68, 170, 340, and 680px. Model labels stayed
on one line. Changing zoom while open updated the complete box. The upper-edge
case remained above its anchor and scrollable. A 200% reference submenu stayed
inside the viewport and could be hit-tested. There were no script errors.

Raw browser evidence is in `.local-scale-*` in the task worktree. These source
fixture checks do not replace independent testing in the final ComfyUI build.
No task configuration, model output or existing request was changed.
