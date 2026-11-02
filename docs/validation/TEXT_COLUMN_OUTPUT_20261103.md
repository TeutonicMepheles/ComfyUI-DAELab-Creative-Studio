# Text column output eligibility

Task #30, F-BIZ-046 / P-M07. The column output picker disabled its action when
assets was empty, even with valid texts. It now uses the same texts-or-assets
eligibility as outputMaterials. Empty and explicitly unready snapshots remain
disabled. Output construction, group lineage and history are unchanged.

The four-text picker regression failed before the fix. Four focused cases and
253 canvas tests pass, along with TypeScript and 190-module architecture checks.
An isolated actual ComfyUI browser with a source response override clicked the
scene column output on the existing parser workflow and created four text nodes
in one group, in row order with exact original text and column source metadata.
No inference or shared host update occurred. Agent-local evidence is
text-column-output-after.json/png. Independent final-build verification remains
required before the user's delivery.
