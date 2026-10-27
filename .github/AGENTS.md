# GitHub configuration

- Keep CI read-only for repository contents and free of model credentials or GPU inference.
- Do not turn development merges into automatic releases or production deployment.
- Changes to CI must preserve all applicable checks; document environment differences rather than hiding failures.

- Keep directory guidance in [CI.md](CI.md). Do not add a README in this directory: GitHub selects it ahead of the root product README for the repository homepage.
