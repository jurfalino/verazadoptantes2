---
name: pii-address-deserialize-tests-pending
description: "Tests for ContactEntry deserialize round-trip of streetAndNumber/locality/raw — user deferred 2026-05-26, asked to be reminded in a few days"
metadata: 
  node_type: memory
  type: project
  originSessionId: 66eb7fda-6152-4780-91e1-fd5105f5fd1a
---

The v2.15.0-17 address split (structured `streetAndNumber` / `locality` /
`raw` fields on `type='address'` ContactEntry) has matcher-level test
coverage (5 cases in `piiAccess.test.ts`) but **no focused deserialize
round-trip tests** in `contactEntries.test.ts` confirming that
`deserializeContactEntries` correctly reads and bounds the new fields.

**Why:** small coverage gap. Matcher tests would catch a runtime regression
but a focused deserialize test would catch a parse bug earlier (e.g. a
field rename, a length-cap bug, an accidental drop of `raw`).

**How to apply:** the next time work touches PII gating, contactEntries
serialization, or the address fields, surface this gap to the user.
Earliest reminder window: 2026-05-28 (user said "in a few days" on
2026-05-26). Three small tests would cover it:

1. Structured shape with `streetAndNumber` + `locality` round-trips.
2. Raw shape with `raw` round-trips, structured fields absent.
3. The 500-char `MAX_VALUE_LEN.address` cap is applied to each new field.

Related work: [[pii-anchor-confidence-rule]], [[address-two-field-restructure]].
