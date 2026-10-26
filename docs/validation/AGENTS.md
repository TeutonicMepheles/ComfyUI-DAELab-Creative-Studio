# Acceptance evidence

- Record candidate/source fingerprint, fixture identity, actual environment and exact scope for new observations.
- Preserve first failures and all reruns. Mark unexecuted/unavailable separately from failed and passed.
- Separate CPU checks, live UI/GPU inference and human ratings; never infer the latter from the former.
- Documentation-only rebuilds change the frontend fingerprint; do not relabel historical live evidence as collected on a newer build.
