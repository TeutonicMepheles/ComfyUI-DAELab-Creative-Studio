# Probe retry visibility correction — 2026-11-05

Base `3bdd04153c0168ad2deaee8f633d94611c79f874`; branch `codex/probe-retry-visibility`.

Reviewer reproduced a hidden retry button rendered by node button `display:flex` rules. The patch adds one theme selector restricted to `[data-model-retry][hidden]` inside Creative Studio surfaces, forcing `display:none!important`. No global hidden rule, model state, retry, task or layout behavior changes.

Real Chromium regression used the actual retry binding and complete theme stylesheet with later competing `display:flex` rules in generation-form and text-node containers. Both contexts rendered checking/unavailable/available with hidden=true, display none and width 0; unknown rendered hidden=false, display flex and width 277. An unrelated hidden button retained its previous display behavior, confirming the selector is scoped to retries. Evidence `.local-retry-visibility.json`, runner `.local-retry-render.mjs`. Earlier browser-navigation smoke attempts timed out; the final isolated render check completed successfully. This is a browser rendering regression, not live-host acceptance.

Full `npm run check` passed: 455 frontend, 3 existing skips; 679 business. Provenance updated. No runtime replacement or generation request. Integration must rebuild generated web output and Reviewer replays the original visibility failure; existing generation requests/results remain unchanged.
