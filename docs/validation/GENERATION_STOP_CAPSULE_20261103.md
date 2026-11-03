# Generation stop capsule

Task #8 follows user message `4ec16eaa` in `#Comfy-Canvas-Studio`. Reviewer
independently confirmed the original local request has native interruption
history and public `cancelled / interrupted` facts. This change performs no
execution, recovery or cancellation requests.

- The business snapshot maps a confirmed stopped execution to the existing
  public `cancelled` presentation state with an `已中止` detail. It no longer maps
  `interrupted` to `paused`.
- While interruption is requested or the sequence still has pending/running
  remainder, its capsule says `中止中`. Unknown outcomes and unsupported old
  phase markers remain recovery views. A cancellation diagnostic on a confirmed
  stopped request is not counted as a separate unresolved error.
- Mixed completed/stopped rows retain the number of actual successes. A success
  racing interruption remains success. Unknown remote outcomes retain their
  Chinese explanation without being labelled confirmed stopped.
- The public cancelled marker uses the bundled stop square. Existing paused
  consumers retain their pause marker; optimization controls are unchanged.
- The existing terminal-notification contract applies: a newly observed stop
  receives one runtime timestamp and fades after four seconds. A saved historical
  stop does not become a new notification on reload. Node/output status remains.

Verification:

- First failing regressions captured the old `启动中` detail during interruption
  and `paused` aggregation after confirmed interruption.
- 13 focused task snapshot/protocol checks, 663 frontend business checks,
  TypeScript and the 192-module architecture check passed.
- A separate headless Chromium preview used the production snapshot function,
  completion tracker, capsule renderer and CSS. It showed `已中止`, the stop
  square loaded with HTTP 200, and the text retained a truthful 0/1 success count.
  This preview is not final 8365 acceptance.

Controller builds the final source. Reviewer must rerun the original captured
receipt and final host UI, including requested/unknown/confirmed states, terminal
fade, reload, node/output consistency and the resource request. Preserve existing
tasks and output; no new generation is needed.

## Reopen follow-up

Reviewer subsequently reproduced a host lifecycle gap: an unverified saved
reference appeared before the first status response, then the old stopped result
incorrectly received a new notification timestamp. The first implementation's
terminal-first cold-start test did not cover this sequence.

The generation snapshot now supplies ephemeral request-group notification
identity and activity eligibility. Only a request prepared in this owner or an
active request actually observed in this owner arms a new terminal notification.
Loading an unverified reference cannot arm one. Request groups cannot inherit
each other's timestamps; an armed live request can retain its notification
eligibility through an intermediate recovery view. None of these hints are saved
to the workflow or task ledger. Consumers without these generation hints retain
their existing behavior.

The exact reference-first/status-later lifecycle now has a task-controller test,
alongside cancelled/success historical results and stopping a new local request
before its first active response. Sixteen focused tests and 666 business tests,
TypeScript and the architecture check passed. Reviewer must repeat the saved
original request in the final host; the running task and output remain untouched.
