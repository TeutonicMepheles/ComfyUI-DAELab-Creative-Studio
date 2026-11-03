# Original task recovery availability

Follow-up to the user's error in `#Comfy-Canvas-Studio:6f70352f`, message
`69fefaf9`. Task #4 preserves Product's message `50e1e3e1`: an explicit original
task check still consumes the existing three-attempt recovery budget. Ordinary
status reads consume nothing. No counters are reset and the limit is not increased.

- Unknown observed again as unknown is idempotent. A newer specific observation
  may refine its reason without inventing a needs-recovery transition. An empty
  in-memory native history after restart cannot erase a previously proven local
  interruption or imply the user cleared history.
- Public reports expose recovery availability, a bounded attempt count and a
  Chinese unavailable reason. The service enforces the same limit before querying.
  Exhaustion is not task failure, cancellation or permission to resubmit.
- Generation node and table check actions are disabled when unavailable. A fresh
  status check in the shared task controller also prevents an unavailable recover
  request. Existing task facts and output remain readable. Transient query errors
  produce separate Chinese feedback without overwriting the proven task reason.
- A task whose remote result remains unknown does not gain a new-generation path.
  Original-task checking never creates a new request; a confirmed terminal task's
  explicit regenerate entry retains the existing new-request behavior.

Validation without host changes or live generation:

- 141 generation backend tests; 15 control tests; 21 ledger/asset tests passed.
- 660 frontend business tests, TypeScript and 192-module architecture checks passed.
- New regressions cover repeated unknown observations, exhaustion before provider
  IO, status reads without counter changes, transient query failures preserving
  interruption facts, and the frontend task controller receiving exhausted availability
  issuing only status, with no recover or submit request.

Reviewer must independently verify the original exhausted request, disabled node
and table entries, Chinese feedback, reload, original IDs/attempts/results, direct
API enforcement and genuine new-request behavior for a confirmed stopped task.
The existing actual user request remains untouched by the implementer. Controller
owns generated web files and CI; Reviewer owns 8365 updates after checking current
execution state.
