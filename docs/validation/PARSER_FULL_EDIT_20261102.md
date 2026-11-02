# Parser result table editing

Task #26. User clarification 658f2f4d supersedes the permanent four-column
restriction: four columns, scene prompt source and ten-row pagination are import
defaults. Materialized tables use the standard editor and 500-row/64-column limits.

ScriptParser keeps its node type, native slots, row/field identities, import
metadata and history. Existing saved parser tables gain the same controls without
conversion. Shared table controls now provide column changes, prompt reassignment,
row/column/cell material input, text extraction and material output. Parser and
generic adapters share the complete material-target and fill implementation.
Cell output keys use the standard row/column identity parser.

Frontend and backend both accept edited layouts and capacity. The compatibility
storyboard projection reads the current prompt source rather than assuming the
initial scene column. Reimport preserves added/reordered/deleted fields, manual
rows, prompt designation and edited values. Changed source fields produce conflicts
instead of restoring deleted columns. New imported pages use the initial layout.
Generation receipt and active-task guards remain in place.

Pointer context menus do not focus an item on opening. AI optimization is an
ordinary menu item without primary fill. Keyboard opening retains focused menu
navigation and focus-visible styling. Import issue notices and their handling are
unchanged; the separate proposed issue workflow awaits user review.

Validation: business 639, canvas 249, backend storyboard 25, TypeScript and
190-module architecture checks passed. Pure regressions cover edited layout and
reimport, input growth above ten rows, output descriptors and pointer/keyboard focus.

An isolated actual ComfyUI browser used source response overrides with the saved
nightly parser workflow. It reassigned the prompt to notes, added a fifth column,
grew to eleven rows, extracted text and materialized cell output, undid/redid the
output transaction, reloaded the serialized graph and retained edits/source data.
The pointer menu had no focused item or primary optimization styling; Shift+F10
focused the menu. A peer parser instance remained unchanged by edits to the first.
No inference ran and the shared host was not changed. Raw JSON/screenshot evidence
is agent-local in parser-full-edit-after.json/png. Final built-host independent
verification, viewport comparison and the user's manual run remain separate.
