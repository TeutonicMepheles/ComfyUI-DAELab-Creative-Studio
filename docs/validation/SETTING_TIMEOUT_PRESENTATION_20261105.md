# Setting popover timeout explanation — 2026-11-05

Base `5ad41e74cfa4d8314033b00282ea0e229517b97f`; branch `codex/probe-timeout-presentation`.

The setting loader catch overwrote the catalog's unknown explanation with a generic failure after capability timeout. Retry was visible but the initial text did not identify an unknown result. The patch reads the existing catalog presentation when status is unknown; other catch branches, task/configuration logic and retries remain unchanged.

The added Chromium regression opens the production per-row setting popover, uses the actual generation API AbortController with an accelerated timeout and a pending synthetic service, then reads the first visible text. Before the fix it failed with `无法读取当前模型的生成方式，请重试。` instead of `结果未知`. It now immediately shows the existing timeout/unknown explanation and retry entry. The test also verifies unchanged field configuration and no POST requests. It does not wait for a later automatic recheck to repair the text.

The initial test locator targeted settings absent from the material-table fixture; it was corrected to mount a normal production table with the same setting controller. An initial polling text assertion could also pass after automatic recheck, so the final regression captures immediate text. The corrected pre-fix failure is retained in `.local-timeout-repro-exact.log` and `.local-timeout-first-failure` (trace/screenshot).

Validation: full `npm run check` passed (456 frontend, 3 existing skips; 680 business). Full independent Chromium browser suite passed 10/10 (19.3s), including the new timeout regression and existing configuration/remount protections. No live host, shared environment, model generation or task submission was touched. Generated web files remain excluded from the source handoff; integration rebuilds them. Reviewer only needs the affected popover replay.
