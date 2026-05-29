---
name: pii-feature-minor-version
description: "The PII access-gating feature must be released as a new minor version (2.15.0), not a build suffix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 66eb7fda-6152-4780-91e1-fd5105f5fd1a
---

The PII access-gating feature (`ENABLE_PII_ACCESS_GATING` — contact masking,
search-match grants, the request/approve/revoke workflow, admin dashboard) must
be tagged/released as a new **minor** version — `2.15.0` — not a build suffix
on the `2.14.11` line.

**Why:** The user explicitly classified it as a significant feature. Per
`.agents/workflows/deploy.md`, significant features get a minor bump and that
requires explicit user authorization — given on 2026-05-22.

**How to apply:** When committing the remaining PII work, run `npm version
2.15.0` (not `2.14.11-N`). Phases 1–3 were already committed as `v2.14.11-8`
(an intermediate build); the feature's headline release version is `2.15.0`,
and the git tag at the staging→master merge is `v2.15.0`.
