# E2E coverage ledger (2026-11-03)

Hard requirement: no test coverage may be lost while the CI e2e legs are reworked
(see `2026-11-03-e2e-ci-reliability.md`). Baseline taken from `npx playwright test --list`
on the unchanged config (branch `ci/e2e-reliability`, before any change).

## Baseline

| Project | Listed (incl. `[setup]` dependency) | Own tests |
|---|---|---|
| setup | 2 | 2 |
| user | 110 | 108 |
| authed | 222 | 220 |
| unauthed | 37 | 37 |
| mobile | 4 | 2 |

**Total own tests, excluding the 2 `[setup]` tests: 367** (369 with setup). The
audit's "367" is the count excluding setup.

Vitest at baseline: **3305** tests, 266 files (3310 / 267 after the partition-guard test was added).

Per leg (listed / excluding setup), all 16 legs sum to 367 non-setup:

| Leg | Listed | Own |
|---|---|---|
| user-1 | 46 | 44 |
| user-2 | 35 | 33 |
| user-3 | 33 | 31 |
| authed-1 | 25 | 23 |
| authed-2 | 25 | 23 |
| authed-3 | 27 | 25 |
| authed-4 | 36 | 34 |
| authed-5 | 18 | 16 |
| authed-6 | 19 | 17 |
| authed-7 | 27 | 25 |
| authed-8 | 23 | 21 |
| authed-viewas | 7 | 5 |
| authed-apicore | 25 | 23 |
| authed-apidocs | 8 | 6 |
| authed-apidev | 4 | 2 |
| rest | 41 | 39 |

Full listings live in untracked `baseline/` (`<project>.txt`, `leg-<group>.txt`).
`node scripts/e2e-partition-check.mjs` (CI: build-and-lint) enforces that every
test is in exactly one leg: `partition OK: 367 tests in 16 legs`.

## Mappings per later task

(Each later task records here: tests moved/removed/renamed, old id -> new id, and the
re-run partition result.)

### Task 3+
_none yet_
