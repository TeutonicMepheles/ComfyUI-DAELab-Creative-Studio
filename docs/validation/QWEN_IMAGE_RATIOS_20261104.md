# Qwen image automatic size and visual ratios

Task #11 implements the parameter-panel portion of user message `e62eb3ab`.
Product's rules are in commit `813635fb6c855ff690de76e516e8fb932bc5d6a3`.
Actual model timing and MiniMax two-reference task execution belong to Reviewer.
This implementation performs no inference or live task writes.

The local image capabilities publish seven fixed ratios and their actual pixel
sizes. The panel displays these as ratio shapes, labels and pixel dimensions,
plus automatic sizing. Both the node/cell panel and column-default panel use the
same picker; neither exposes width/height number fields. Existing custom sizes
such as 1920×1024 remain unchanged until the user chooses a new size mode.

The backend remains authoritative. Constraints are 256–2048 per side, a 32-pixel
step, and at most 2097152 pixels. Common-ratio presets preserve the exact ratio
on this grid and choose the legal size nearest the 1024-square pixel budget:

| Ratio | Width × height |
| --- | --- |
| 1:1 | 1024 × 1024 |
| 16:9 | 1536 × 864 |
| 9:16 | 864 × 1536 |
| 4:3 | 1152 × 864 |
| 3:4 | 864 × 1152 |
| 3:2 | 1248 × 832 |
| 2:3 | 832 × 1248 |

Automatic reference sizing reads verified frozen bytes and accounts for EXIF
orientation. Exact common aspects use the same presets; other aspects are scaled
near the default pixel budget and aligned to the 32-pixel grid. Unsupported
extreme aspects or unreadable dimensions give a clear error rather than silently
using a square. Qwen's existing one-reference image mode is unchanged. No-reference
automatic sizing uses 1024×1024. Resulting dimensions are frozen in the prepared
settings and reference-scaling graph; later edits of source files or options do
not recompute an existing task. Recovery continues to use the original graph.

Validation includes synthetic real frozen JPEG/EXIF handling, source-file changes,
exact preset limits, legacy custom settings, graph reference scaling, UI choices
without number inputs, and preservation of the existing pinned wire fixtures.
A separate software-rendered Chromium preview used the production capability
schema and panel: 16:9 selected 1536×864, automatic selected the declared mode,
the actual shape measured 20×11.25, and the panel fit a 320-pixel viewport. This is
not actual 8365 acceptance or a model-performance result.

After rebasing onto the merged capsule/reopen baseline, 144 generation backend
tests, 669 frontend business tests, TypeScript and the 193-module architecture
check passed. The existing ten pinned wire fixtures remain unchanged.

Controller must include the latest merged capsule/reopen fixes and Product's
813635f documentation when building. Reviewer must verify the final real host,
then run the authorized one-reference Qwen timing and two MiniMax rows with at
least two references each, after the latest cross-project GPU handoff and fresh
resource checks. Preserve all original requests and output; do not blindly retry
an uncertain task or update the host during execution.
