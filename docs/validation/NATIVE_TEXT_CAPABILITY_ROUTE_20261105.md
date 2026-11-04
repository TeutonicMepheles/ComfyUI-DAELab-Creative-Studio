# Native text capability route correction — 2026-11-05

The text-node catalog probes `/daelab/prompt-optimization/capabilities`. The PE source registered the model with generation but left this adapter accepting only legacy optimization providers. The real node therefore received an unsupported-model rejection before submission.

The adapter now resolves additional local text entries from the authoritative service catalog and delegates capability inspection to the exact provider. Returned identity, modes, reference requirement and token limit come from that provider. Missing assembly, missing file and hash rejection retain the existing HTTP/error contract. The advanced table optimization provider list and budget/snapshot contract are unchanged.

Validation: configured PE with a synthetic pinned weight through the real HTTP capability handler; positive result reports local, reverse, reference required, and remains non-inference. Changed hash and missing file return provider rejection without enqueueing. Focused native-text tests pass. The same registry-based adapter supports the independently registered 27B; its discovery and submit routes are checked in the dependent follow-up.

This patch is based on `f19d27a` and can be applied to PE before 27B. No runtime was replaced and no GPU/paid task was submitted. Final host acceptance belongs to Reviewer.

## PE and 27B dependent route regression

The 27B source's native-model generation-probe exception is removed. Both local text definitions now use the same optimization capability endpoint as the text node's real discovery path.

Configured 27B tests call the real HTTP capability handler and verify local/polish/no-reference, then exercise the HTTP polish adapter with captured preparation and the actual native provider graph builder. PE has equivalent reference-bearing submission routing coverage. Synthetic preparation/results stand in for execution; these tests do not claim inference, durable ledger or host acceptance.

Frontend discovery tests require both native definitions to call optimization capabilities, and the actual `optimizeRow` adapter routes PE reference enhancement and 27B polishing through optimization polish with exact model/request identities. No cloud fallback is installed. Missing binding/file/hash cases preserve provider rejection.

Validation: full generation suite 150 passed, focused PE route suite 4 passed, full frontend/business check passed (448 frontend pass / 3 existing skips, 677 business pass). Apply this dependent regression patch only after PE's route correction `0b16033` and 27B source `4bd0872`.
