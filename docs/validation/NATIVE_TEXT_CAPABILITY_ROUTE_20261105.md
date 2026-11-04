# Native text capability route correction — 2026-11-05

The text-node catalog probes `/daelab/prompt-optimization/capabilities`. The PE source registered the model with generation but left this adapter accepting only legacy optimization providers. The real node therefore received an unsupported-model rejection before submission.

The adapter now resolves additional local text entries from the authoritative service catalog and delegates capability inspection to the exact provider. Returned identity, modes, reference requirement and token limit come from that provider. Missing assembly, missing file and hash rejection retain the existing HTTP/error contract. The advanced table optimization provider list and budget/snapshot contract are unchanged.

Validation: configured PE with a synthetic pinned weight through the real HTTP capability handler; positive result reports local, reverse, reference required, and remains non-inference. Changed hash and missing file return provider rejection without enqueueing. Focused native-text tests pass. The same registry-based adapter supports the independently registered 27B; its discovery and submit routes are checked in the dependent follow-up.

This patch is based on `f19d27a` and can be applied to PE before 27B. No runtime was replaced and no GPU/paid task was submitted. Final host acceptance belongs to Reviewer.
