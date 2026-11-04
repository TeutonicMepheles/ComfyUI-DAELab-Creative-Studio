# Independent table browser expectation correction — 2026-11-05

Base `f6a1516ce808db6a717cbd9787ca2848ada52849`; branch `codex/probe-browser-regression`.

The original browser test was reproduced without source changes. The actual failure is `dev/table/tests/editor.spec.mjs:98`: expected `模型不可用，请重新检测`, observed `检测结果未知，可重新检测`. The earlier basic-mode notice and remount/late-completion assertions had passed. The CI failure log shows the same line and value.

The simulated error response carries the fixture-specific code `preview-unavailable`. It is not an authoritative component/configuration/hash rejection. The catalog therefore retains an unknown result and offers retry, matching the accepted three-state contract (Cindy11826889 and Product98d21ae7). Production model state classification and fixture behavior are unchanged.

The patch updates that one text expectation. It also replaces the weak recovery assertion (old text absent) with polling the selected model's actual `data-model-status=available` and verifying the retry control is hidden. Original cross-instance configuration snapshots and the empty generation result after late completion/remount are retained.

Validation: focused original test passed (11.2s); complete independent Chromium table browser suite passed, 9/9 (21.1s). No frontend/backend product source changes, runtime replacement, paid request or model generation. First failure log `.local-probe-browser-first.log` and trace/screenshot copy `.local-probe-browser-first-artifacts` remain in this tree; final log `.local-probe-browser-full.log`, standard Playwright JSON `.local/modularity/T3-browser.json`.

Integration should rerun the same browser CI gate. This test-only correction does not invalidate the existing model generation evidence or require another inference run.
