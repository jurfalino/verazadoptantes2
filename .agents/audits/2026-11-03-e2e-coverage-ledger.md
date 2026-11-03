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

### Task 6 (B1): shared batched test-DB helper `tests/db.ts`

No test added, removed, renamed, skipped or retagged; no `expect` removed or loosened.
`playwright test --list` is unchanged (user 108, authed 220, unauthed 37, mobile 2, plus the
2 setup tests each dependent project lists) and `partition OK: 367 tests in 17 legs`.

**Copy inventory** (33 private `execD1` + 1 inline `queryD1` in team-applicants + householdFixtures)
all ran the same command (`npx wrangler d1 execute DB --local --command="..." --json`). Differences, and what
the shared helper does about each:

| Difference | Where | Shared helper |
|---|---|---|
| `cwd: process.cwd()` and `stdio: ['pipe',...]` vs no cwd and `stdio: ['ignore',...]` | ~15 copies vs ~18 | cwd + pipe for all (cwd is already process.cwd() by default; stdin is never read) |
| Retry on `SQLITE_BUSY` / "database is locked" (up to 6 tries, 500 ms backoff) | `contribution-access-flow` only | now in every `execD1` (a retry cannot hide a wrong result; non-busy errors still throw) |
| Row parsing swallowed parse failures and returned `[]` | `householdFixtures.rows`, `parseD1Rows` in adopter, adoption-docs, contract-link, merge-undo, merge-requests, one-reality, pendientes-d, `pending-dedup-merge.rows`, `team-applicants.queryD1` | `rows`/`parseD1Rows` **throw** on unparseable output or a missing result set. A failed query (non-zero exit) already threw in every copy, because `execD1` ran outside the old `try`. No call site relied on `[]` for a missing table: wrangler exits non-zero for a missing table, which threw before and still throws. |
| Row parsing threw (`JSON.parse(..)[0].results`) | contact-entry-edit, contract-storage, duplicate-scan (`rows<T>`), deploy-skew, household-question, admin-notifications-delete, form-results-* | unchanged in behaviour (those keep their local one-liners over the shared `execD1`, or use `rows`) |
| `one()` returning `{}` when empty / `expect(...).toHaveLength(1)` | record-edit-collab, adoption-docs-collab, form-results-link/masking | kept local (they assert; not DB plumbing) |
| per-table `try { DELETE } catch { /* table absent on an older seed */ }` | `householdFixtures.cleanupProfiles` | removed: one `execD1Batch`, so a missing table fails loudly (all 9 tables exist in the seed: verified by the local households run) |

Batched (one wrangler spawn per scenario instead of one per statement): `cleanupProfiles`,
`insertHousehold`, `rescuerContext` (setup and close), and the seed/cleanup blocks in households,
household-contrib, merge-undo (6 tests), pendientes-d, adoption-docs, form-results-link,
merge-requests, one-reality. A batch is a single transaction (verified: a bad statement applies none of
the batch), so cleanup can no longer stop half-way and leave rows behind.

`cleanupProfiles` now reads housemates / households with two `IN (...)` SELECTs (local sqlite; no D1
array-binding involved) instead of one query per profile; same set of profiles and tables deleted.

**households.user.spec.ts, local, same machine, same DB prep (13 tests, all pass before and after):**
6.1 min -> 2.6 min wall (tests 8/9/10: 1.4 m / 1.7 m / 2.2 m -> 29 s / 17 s / 23 s).

**Local run of every spec that now imports `tests/db.ts`** (35 spec files; Node 20, `--workers=1`, DBs restored + recovered before each run):
user project 36/38 first pass, authed project 124/128 first pass (1 more did not run behind a failed serial test).
Every failure passed on re-run or is a known local-only flake; none involves the new helper:
- `adopter.spec` "Create new adopter" (`page.goto` ERR_ABORTED in beforeEach) and `my-animals.spec` "adopted tab shows the available count": pass on re-run (12/12).
- `merge-requests.authed` "#pendientes opens the section", `public-api-developers.authed` "/developers ...": pass on re-run.
- `merge-undo.authed` "admin merge: the panel shows who registered each profile" and `record-edit-collab.authed` "two teammates on the same animal", "adopter profile in two tabs": pass when the two files run together (10/10), but fail after `merge-requests` in the same run. The same 4-file sequence on origin/staging code (verazadoptantes2-identity, 928ab215) fails the same `merge-undo` "admin merge" test (14/15), so that one is a local ordering flake that predates this task; the two `record-edit-collab` failures in the 4-file sequence did not reproduce on staging code or in isolation here and look like dev-server timing (one took 3.8 min).

