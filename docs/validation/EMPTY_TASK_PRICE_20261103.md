# Current task credit estimate

Task #41 / AC-BIZ-026-003. The previous panel estimated whenever a task row and
a Comfy model existed. A newly created blank row therefore displayed a model
price as the current task estimate.

The panel now uses the same strict `generationInput` validation as submission,
requires nonempty prompt text, and requires reference media for reference modes.
Local models, inactive nodes, unavailable documents and invalid upstream inputs
hide and clear the estimate. Model pricing itself remains unchanged.

The cache key includes the full frozen generation input, including task identity,
prompt, media and configuration. A sequence token also invalidates a quote when
content changes away and returns to the same value. Both successful and failed
late responses check the current input and disposal state before updating UI.

Four focused tests execute the production closures with real input validation and
controlled estimator promises. Browser evidence in the agent workspace,
`empty-task-price-check.mjs` and `empty-task-price-{before,after}.json/png`, first
reproduces the blank-task failure, then verifies blank/valid/cleared/local/missing
reference/changed inputs, late responses and existing-result display. Estimates
are mocked; no generation request was submitted and no credits were spent.

Type checking, architecture checks, 259 canvas tests and 643 business tests pass.
Final build/CI and independent deployed checks remain with Controller/Reviewer.
