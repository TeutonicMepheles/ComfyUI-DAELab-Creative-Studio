# Generation sequence stop and execution facts

Scope: F-BIZ-048 / AC-BIZ-048-001–003. The user's latest instruction in
`#Comfy-Canvas-Studio:6f70352f` supersedes the earlier pause/resume design.

- Generation's bottom-right action becomes a stop icon while active. It selects
  active requests and additional draw attempts belonging to this node's rows,
  handles pending requests before submitted requests, and preserves completed
  outputs. Table controls also stop rather than resume tasks.
- Repeated interruption of a terminal request is harmless, so a completion race
  does not abort interruption of the remaining sequence.
- Comfy API generation shares the existing ownership-checked local interrupt
  adapter. Queued removal is confirmed non-submission; stopping a running local
  API polling node never proves the billed remote operation was cancelled.
- Both `execution_interrupted` and an `execution_error` whose exception type is
  `ProcessingInterrupted` establish a local interruption. Cloud observation
  remains unknown with a specific reason, preserved through the ledger.
- Cancellation intent no longer overwrites recovery, uncertain, legacy-owner or
  preparation-barrier presentation. Node, table and output placeholders translate
  the original reason into Chinese while preserving the durable error code.

Validation completed without paid generation or changes to the running host:

- TypeScript check; architecture check: 192 modules.
- Frontend business suite: 658 passed.
- Backend controls: 13 passed; native/ownership/admission: 14 passed.
- Cancellation/receipt race checks: 4 passed.
- Full generation Python suite: 141 passed.

The previous native queue fixture lacked a scoped interruption method. The first
full Python run exposed that compatibility case; queue-only deletion remains the
fallback when no scoped interrupt exists. The first output-label regression also
failed on the intentional Chinese label change, then passed with assertions for
the unknown remote result and interrupted placeholder.

Independent final-build acceptance remains with Reviewer: verify the original
request's existing native history through normal recovery, single and multiple
tasks/draws stopping, Comfy-list interruption, success races, other-node isolation,
saved results, reload, and final visible stop icon. Do not resubmit, cancel or mark
the user's original request successful based on an older image. Controller owns
generated web files, CI and merge; Reviewer owns any 8365 update after a fresh
execution-state check.
