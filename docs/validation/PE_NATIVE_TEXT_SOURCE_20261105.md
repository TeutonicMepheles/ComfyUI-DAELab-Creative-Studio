# Reference-image PE source handoff

Scope: existing standalone text node, reference-image mode, explicit reviewed application.
The default Qwen/Ollama provider, saved choices and other model bindings remain separate.
PE is excluded from the text-only table optimization menu. No new styles are added.

## Execution contract

- Logical model `qwen-image-2.1-pe`, provider `local-qwen-pe-text`, binding family
  `text_pe` containing only pinned `text_encoders` (absolute path, name, SHA256).
- Configuration parser, assembly, authoritative catalog, capability check and request
  routing all use the same identity. Missing bindings/files/hash mismatches fail
  without fallback. Capability checks hash files and validate the native graph;
  they do not load weights or start inference.
- Native `CLIPLoader(type=qwen_image)` and the installed `TextGenerate` implementation
  use the default model template, non-thinking mode, sampling off, max 2048 tokens.
  One frozen reference image is staged through the existing asset boundary.
- Internal output node `DAELAB.NativeText` records actual generated-ID count,
  maximum, limit reached, raw decoded output and cleaned final body in native history.
  Reasoning preceding `</think>` is excluded. Meaningful line breaks are preserved.
  An unfinished reasoning block, empty body, unexpected control token or output
  reaching the limit fails; it never creates an applicable completed proposal.
- The shared queue checks original ownership and terminal execution before accepting
  the text receipt. Existing confirmation and source-signature checks own application.
  Failed/truncated results remain unapplied; the frontend explains incomplete output.

## Evidence and remaining verification

Synthetic checks cover configuration -> assembly -> catalog/capability -> frozen
reference graph, hash mutation rejection, raw/final separation, actual token counting,
and complete/incomplete history receipts. A CPU-only contract check exercises the
installed TextGenerate class using a synthetic CLIP port; it performs no model run.

The first broad Python run hit the existing two-second optimization-fence timeout
and subsequent temporary SQLite cleanup error under concurrent machine load.
The failure is retained in `.local-pe-python.log`; targeted rerun is recorded separately.
The first frontend check exposed an obsolete catalog expectation and one unrelated
timing-sensitive media export check. The expectation was updated; both focused
checks then passed. No test timeout was relaxed.

Real PE output completeness, reference identity, source switching, confirmation,
save/reopen and missing-component presentation remain for Reviewer on the final
integrated build. This document does not claim real inference or product acceptance.
Original 256-token truncated PE evidence remains unchanged in Reviewer's gap-review.

27B is not included in this source change. Its original and template-only garbled
outputs are retained; the next single-variable MTP-off diagnostic is separately owned.

Final local checks: `npm run check` passed (448 frontend tests, 3 existing skips;
676 business tests). Python unit 16 passed; native text tests 4 passed; installed
SDK metadata tests 2 passed; the optimization-fence rerun passed all 7 tests.
The CPU-only installed TextGenerate contract printed `REAL_TEXTGENERATE_CONTRACT_OK`.
