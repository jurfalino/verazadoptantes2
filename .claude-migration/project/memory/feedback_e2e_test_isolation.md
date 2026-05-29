---
name: E2E tests for destructive operations need dedicated fixtures
description: When writing Playwright tests that mutate shared data (merges, deletes, soft-deletes), do not target seed adopters. Use fresh fixture rows so other test specs' assertions on those seed rows aren't broken
type: feedback
originSessionId: f67b0d31-bbc2-47fc-b0c8-9785c546d8b5
---
When I shipped a Playwright test for the contract-results merge flow (`tests/contract-link.spec.ts` in v2.14.7-15 / v2.14.7-16), I targeted seed adopter María García López as the merge destination. The test passed in isolation, but the merge appended the contract's contactInfo into María's row, doubling her phone number. Downstream tests like `tests/search.spec.ts:66` use strict-mode `getByText(/555-1234/)` to assert "exactly one phone link visible" — the duplicated phone broke that assertion and turned the staging deploy red.

**Rule:** e2e tests for destructive operations (merges, soft-deletes, hard-deletes, anything that mutates shared rows) must:
- Create a dedicated fixture row keyed off a stable test-only ID (e.g. `test-contract-fixture-target`).
- Use `INSERT OR REPLACE` on the fixture so re-runs reset state.
- Pick fixture identity values (name, phone, email, social) that are unique enough to fuzzy-match only the fixture, not any seed adopters.
- Never use seed adopters (`test-adopter-1` through `test-adopter-5`, María/Carlos/Ana/Roberto/Nueva) as merge or delete targets.

**How to apply:** when adding a Playwright test that touches the merge / soft-delete / hard-delete code paths, the very first thing to write is the fixture seed (INSERT OR REPLACE adopters + duplicate_tokens with stable IDs). Build the test against the fixture, never against seed rows. Document the fixture ID in a top-of-file `const` so the next maintainer can find it.

The cost of getting this wrong is a green test that breaks an unrelated assertion several specs later — and the failure mode looks like "search test broke for no reason" rather than "the merge test polluted state." Time-to-diagnose is high.
