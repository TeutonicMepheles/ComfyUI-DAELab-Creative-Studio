# Direct batch input export

Task #25, F-CAN-028 / F-CAN-033. Based on the combined reference/editing build
b0dfc2f6b6d4edf47e7597aebce0fc10307c5e3e.

The timeline accepted every result from a direct generation connection, but its
export snapshot fell back to a single preview whenever there was more than one
result. Batch generation has no single preview, so export failed before POST.

Direct videos.* and images.* inputs now retain the full published collection in
the export snapshot. An empty published collection fails explicitly. Preview is
consulted only when no collection exists. Existing scalar inputs remain valid.
The renderer resolves each saved timeline file against exactly one frozen batch
member. Missing or ambiguous membership fails rather than selecting another
result. Order, duration, trimming, slot names and saved source data are preserved.

New frontend and backend regressions reproduced the original failures. Checks:
251 canvas/real export-host integration tests, 28 canvas backend and 33 media
export tests, TypeScript and 190-module architecture checks passed.

An isolated browser loaded the original failing direct-connection workflow with
a source response override. Its export action captured all four original results.
The probe intercepted POST without forwarding it. The backend then resolved that
exact captured edit_data and connections to the four existing local video files.
No generation or render was started. Raw request evidence remains agent-local in
editor-batch-export-after.json. Final built-host export, materialization and library
playback remain independent Reviewer acceptance work; this is not whole-chain pass.
