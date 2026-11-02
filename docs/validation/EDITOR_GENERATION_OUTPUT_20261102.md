# Generated video to editing and material output

Task #24, F-CAN-028 / F-CAN-034 / UC-CAN-008.

Generated assets expose a local URL, while the editor previously resolved only
explicit filename/subfolder/type fields on objects. URL objects now use the same
local /view parser as strings. Explicit file fields must agree with the URL;
duplicate locators, remote URLs and root escapes remain rejected. Source objects
are not mutated. Existing rooted asset objects remain compatible.

Exported-video snapshots may omit the optional text collection. Material output
now initializes absent collections before grouping. Only table sources require
the table_json lineage connection; exported edit results retain their asset and
export provenance without attempting a nonexistent table output slot.

Both regressions failed before the change: output URL resolution rejected a real
output reference, and materialization threw on the missing texts array. An actual
isolated browser run then exposed the additional table-only connection attempt;
the final run created the video material with asset/reference IDs and original
export request provenance. It used the existing exported workflow and result,
with a browser source response override, without another generation or export.
Raw workflow, screenshots and output identity remain in agent-local evidence.

Validation: canvas 247, migrated canvas backend 27, media export 33, TypeScript
and 190-module architecture checks passed. Read-only inspection of existing host
output videos also resolved URL objects as output with correct video metadata.
Built-host direct generation-to-editor drag, favorite/reopen playback and the full
nightly chain still require Reviewer's independent verification.
