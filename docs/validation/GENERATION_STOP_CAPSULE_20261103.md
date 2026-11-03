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
