# Generation and material feedback

Task #44 follows F-BIZ-026/042, F-BIZ-025, P-M07 and F-CAN-005/015.
Base: `63fe814d026899d8b7df5dc305e992a140e3db5f`.

## Submitted image receipt

`ComfyVideoQueue.enqueue` queued the native execution but returned no ID. The
provider therefore returned `Observation('submitted', None)`, which the durable
ledger rejected as `submission_observation_invalid`. Returning the original task
ID fixes acknowledgement without adding another queue operation. The existing
ledger test now asserts that the ID is durable before any recovery; it fails
with the old code (`None != native task ID`) and passes with the fix. A GPT Image
test also checks the real queue/provider boundary using a fake native queue.

Reviewer independently recovered the user's already completed original request
through the existing recovery API. The original PNG hash matched, task/attempt
counts did not increase, and the earlier cancellation intent remained recorded.
No source change bypasses that recovery or rewrites ledger facts. Another user
task was subsequently running: Reviewer must inspect current native/ledger state
before any host update. This source handoff does not authorize an interruption.

## Interaction changes

- Image size values retain their exact provider IDs. Buttons show a proportional
  shape and aspect ratio, with pixels in a smaller secondary line. Automatic and
  custom options, plus background choices, display Chinese labels.
- Ready paid-task estimates display the number/range with the yellow Lucide coins
  graphic used beside the host account balance. Empty, local,
  incomplete and pending estimates remain hidden. Accessible text and the tooltip
  retain the estimate meaning and actual-billing qualification.
- A cell snapshot containing one text/media item creates that standalone node.
  Provenance is retained. Multiple items and column output retain their existing
  grouping behavior and ordering; nothing is dropped.
- The upload file chooser accepts multiple files. The current node receives the
  first supported file, with subsequent files in separate nodes spaced along the
  same row. No group is created. Existing single-file replacement and per-node
  upload cancellation/history remain in use.

## Validation

Workspace `generation-material-feedback-check.mjs` uses browser-local overrides,
the actual file chooser with three supplied PNGs, the actual table cell context
menu for an image and text, save/reload, production setting controls and mocked
price responses. It verifies separate ordered nodes, no groups, source identity,
shape choices/raw saved values, Chinese backgrounds, numeric credits and the
platform badge. Screenshots were inspected at a 340-pixel setting-panel width.
No generation POST occurred. Raw evidence stays in the agent workspace.

Type checking, architecture checks, 260 canvas tests, 644 business tests and 139
generation backend tests pass. Controller owns final build/CI; Reviewer owns
independent deployed verification and the live-task update boundary.

## Account icon correction

Independent review found that the initial four-diamond graphic came from native
node price badges and differed from the user's account-balance screenshot. The
CSS now inlines the installed host's `lucide--coins` SVG as a yellow mask. It
needs no host icon font/class, and keeps the number/range and visibility rules.
The reference screenshot and candidate glyph were visually compared. Final
independent verification must use this corrected account icon.
