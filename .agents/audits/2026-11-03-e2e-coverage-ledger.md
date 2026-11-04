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


## Task 8: the four chronic flakes (N3)

No test was removed, skipped or loosened. Test count unchanged (`node scripts/e2e-partition-check.mjs`: 367 tests in 17 legs).
Evidence: CI run 41632012614 (job logs, retry traces of authed-5), jobs from runs 41527928305, 41465548207 and 41256714800, plus local reproduction.
None of the four coincides with a dev-server memory restart (no "approaching the used memory threshold" line in any of those jobs).

| Test | Root cause | Fix | Coverage |
|---|---|---|---|
| `landing-pages-smoke-shared.ts:71` (`/my-animals` in `landing-pages-authed.spec.ts:51` and `landing-pages-smoke.spec.ts`) | `waitUntil: 'networkidle'` needs 500 ms with no request. The retry trace of the authed-5 job shows the page still issuing requests after paint: `/api/config` x3, `/api/notifications` poll, a `POST /my-animals` server action, `/api/my-animals` x2, and four `api.dicebear.com` avatar images that never complete (status -1 in the CI container). The quiet window sometimes never opens, so `page.goto` hits its 30 s timeout. The failing log is a goto timeout, not a 4xx/5xx. | `waitUntil: 'load'`. Nothing else changed. | Unchanged: HTTP status `< 400` (hard) and the per-route `anchor` visible (hard, auto-waits up to `timeout`) still run for every route in both smoke specs. `SmokeRoute.anchor` already existed, so no new field. The old wait guarded no content. |
| `public-api.authed.spec.ts:386` "both review surfaces list the calls" | `apiRequestContext.get: read ECONNRESET` on the test's own second request, `GET /api/admin/api-keys`, right after the page's own fetch of the same URL had succeeded (the list text was already on screen). Seen in 3 jobs (apicore), 0 restarts. A stale keep-alive socket was tested and ruled out: 26 gaps of 4.96-5.06 s against both a plain Node server and `next dev` gave 0 resets. What does reproduce locally: the same `read ECONNRESET` on a different test of the same file (`:63`, first request to the cold `/api/v1/me` route), 3 of 3 runs when the file runs right after `landing-pages-authed`, with `[Error: aborted]` in the dev-server output. So the dev server drops a request that arrives while it is compiling a cold edge route (shared cause, see below). One local pass also hung the same way on a test this task does not touch (`public-api:344`, `page.goto` ERR_ABORTED after the 120 s timeout). | The test no longer makes its own second request: it registers `page.waitForResponse` for the page's own `GET /api/admin/api-keys` before `goto` and reads the keys from that response. | Unchanged: all three `mine.last30` assertions (`activities > 3`, `voided >= 2`, the stats text equals `activities`), the list text, the calls tab and the settings assertions. The same endpoint and the same JSON are checked. |
| `wizards.spec.ts:28` "Observation card" | `page.goto('/')` in `beforeEach` never gets a response: the call log shows `navigating ... waiting until "load"` and no `navigated to` line, then the 120 s test timeout. It is always the second wizards test (never `:16`/`:43`; 7 of 11 user-3 jobs). The dev server prints `[Error: aborted]` when the previous test's page is torn down, and the next document request is lost. 0 memory restarts. | **None in the spec** (see "Shared cause"). | Unchanged (spec untouched). |
| `sheet-import-form-export.authed.spec.ts:96` ("es: «Nombre del adoptante»") | Same signature as wizards: `page.goto('/import/sheet')` with no `navigated to` line, 120 s timeout, `[Error: aborted]` in the dev-server output just before. It is always the first of the three locale tests, which follows the heavy "importing them makes ONE profile" test (3 of 3 occurrences, 0 restarts). | **None in the spec** (see "Shared cause"). | Unchanged (spec untouched). |

### Shared cause (outside these specs)

`next dev` with the edge runtime loses or resets requests that arrive while it compiles a cold route or just after a previous
request was aborted (`[Error: aborted]`). It explains `public-api:386`/`:63` (ECONNRESET), `wizards:28` and `sheet-import:96`
(document request never answered). A fix that lives in the spec (a capped `goto`, a retry loop) would only hide it, and the brief
forbids both. The shared fix belongs in the dev-server/harness tasks of this plan (for example a warm-up of the routes the suite hits
before the first test, or running the e2e against a build instead of `next dev`, which the memory notes mark as a dead end for edge
routes). Until then Playwright's own CI retry absorbs these (each costs the test timeout: 120 s for the two hangs).

Local results for the spec fixes (Node 20, both DBs restored and recovered before every run): see
`.superpowers/sdd/2026-11-03-e2e-ci-reliability/task-8-report.md`.


## Task 9: clean-ups (audit §4)

Test count (`node scripts/e2e-partition-check.mjs`): **367 -> 364** tests in 17 legs. `playwright --list` (incl. 2 setup): 369 -> 366.
Difference = -2 (mobile in `user`) -1 (duplicates: two skipped tests -> one test). Two ids were only renamed (meta-layout). Nothing else changed.

### §4.1 Tests that never ran

| Removed / changed id | Now covered by |
|---|---|
| `funcionalidades.unauthed.spec.ts:13` and `:21` (conditional skip, never ran: the unauthed project's `storageState` is `{cookies:[],origins:[]}`, truthy) | Same tests, same lines of code, now RUN: the skip condition is "a string path or an object with cookies". Ran locally in `unauthed`: 3/3 pass (`:15`, `:23`, `:32`). No id lost. |
| `[user] duplicates.spec.ts:17` "System duplicate banner appears on profile with candidates" (`test.skip`) | `[user] duplicates.spec.ts › The pending-duplicate line appears on the profile and links to the other profile` (last test of the file). The banner is gone but the behaviour exists as `profile-pending-dup` in `AdopterProfileV2.tsx` (~l.440): «Posible duplicado de <name>», name links to the other profile. Asserts the line, the text and the link's href (Ana). Passes locally. The old `phone` match-type badge assertion has no counterpart: the new line renders no match-type badges (grep `matchTypes` in the line: none). Feature removed, nothing to cover. |
| `[user] duplicates.spec.ts:35` "System duplicate banner can be dismissed" (`test.skip`) | Feature removed v2.12.1-19: the replacing line (`ProfilePromptBanner`, testid `profile-pending-dup`) has no dismiss control (grep dismiss/close/✕ in `ProfilePromptBanner.tsx`: none) — no behaviour to cover. |
| `scraper.spec.ts` (5 tests, skipped without `SCRAPER_URL`) | **Kept, no change.** External service; skips in 0 s in CI; covers the scraper when run with `SCRAPER_URL`. |

The new duplicates test is placed last in the file: placed second, the dev server dropped the `goto('/')` of the following test (`[Error: aborted]`, 3 of 3 local runs; the shared dev-server cause already in the Task 8 ledger). Baseline (11c7a358 spec) passes in the old order.

### §4.2 mobile twice

`mobile.spec.ts` asserts only mobile-size behaviour (iPhone 14: search usable at mobile width, footer visible). Added to the `user` project's `testIgnore`.

| Removed id | Now covered by |
|---|---|
| `[user] mobile.spec.ts:13` Homepage search is usable at mobile width | `[mobile] mobile.spec.ts:13` (rest leg) |
| `[user] mobile.spec.ts:41` Footer is visible at mobile width | `[mobile] mobile.spec.ts:41` (rest leg) |

Ran locally with `--project=mobile --project=user`: 2 passed, both in `mobile`.

### §4.3 rule checks (SQL assertion <-> unit test)

Rule: an e2e SQL assertion goes only if a unit test is an exact duplicate AND the e2e test still asserts the click's UI result.

Removed (households test 8, `households.user.spec.ts`):

| e2e assertion removed | UI result still asserted | Unit test (file:line) |
|---|---|---|
| D2: `adopters` row for «Borrar Uno» gone | `card(UNO)` count 0 after «Eliminar perfil» | `src/app/actions/deleteHouseholdCleanup.test.ts:53` (owner's delete: row gone) |
| D2: `household_memberships` for it gone | same | `deleteHouseholdCleanup.test.ts:53` (ordinary membership gone) |
| D1: `data_requests` row for «Pedir Dos» is `pending` / `deletion` | dialog closes (it closes only after `requestAdopterDeletion` resolved; an error leaves it open with a toast) and the card stays (count 1) | **NEW** `src/app/actions/requestAdopterDeletion.test.ts:43` (one pending deletion request); `:49` (twice -> one); `:56` (non-owner refused, nothing written) |
| Q1: «Error Tres» not among `housemates(OWN)` | `card(TRES)` count 0 | **NEW** `src/app/actions/households.test.ts:466` (membership gone) |
| Q1: no `household_corrections` row | same | `households.test.ts:466` (new); history side already at `:458` |
| Q1: the profile stays (`deleted_at IS NULL`) | same | `households.test.ts:466` (new) |

**Restored after the Task 9 review (2026-11-03):** the D1 `data_requests` poll is back in test 8. The unit test calls the action directly, so only the e2e proves the card passes the right profile id (`MemberCard.tsx:181`). Net: 5 SQL assertions moved to unit tests, not 6. The new unit tests stay.

The `data_requests` cleanup in test 8's `finally` stays. Test 8's row inserts (`adopter_history` seed for D1) stay: they are setup.

Kept (not an exact duplicate, or no UI result, or in doubt):

| e2e assertion | Why kept / nearest unit test |
|---|---|
| households 6: `housemates(PEDRO)`, `housemates(marta)==[]`, `household_corrections.corrected_by` | Outside tests 8-10. Unit: `households.test.ts:437` (correction row, membership gone) does not assert "removed from every household of Marta" (`housemates(marta)==[]`). Kept. |
| households 9: `housemates(made)` both memberships in `HH_DAD` | New person into the picked home of two: no unit test for that path (`households.test.ts:283` covers an existing profile). Sole proof of the picked home. Kept. |
| households 10: all four profiles still exist after the cancelled dialogs | A cancel guard, no rule; UI-only. Kept. |
| `merge-undo.authed.spec.ts` (mass-merge + undo; batch pair-merge; admin merge): `adopters` soft-deleted / `MERGED`, memberships restored, `duplicate_candidates` statuses, is_public, aliases | The e2e drives `/api/admin/duplicates/merge` and `/unmerge` with `page.request`: the SQL **is** the result of the call, there is no UI result left to keep. Related unit coverage: `src/lib/householdMerge.test.ts:177,190,200,233,336` (memberships, corrections), `src/lib/mergeDisputes.test.ts:202` (undo), `src/lib/mergeRequests.test.ts:110`. Not exact duplicates (they stub parts of the pipeline). All kept. |
| `one-reality.authed.spec.ts` (`merge_requests` rows, `MERGED` token, `merge_disputes`, `notifications`, `household_corrections` / `adopter_history` rows) | Same: multi-user flows where the polled rows are the cross-user effect. Unit: `mergeRequests.test.ts:110,132,144`, `mergeDisputes.test.ts:98,121,202,219`, `households.test.ts:437`. Not exact. All kept. |

### §4.4 shared setup

| Test | Before | After |
|---|---|---|
| households 10 | fixture (5 profiles, 3 households) written inside the test with ~7 wrangler spawns | written in the file's `beforeAll` batch (same batch as the other fixtures); cleaned in the existing `afterAll` (`try/finally` kept). Both viewports (390, 1280) still looped inside the one test. Id unchanged apart from the line. |
| `my-animals-meta-layout.authed.spec.ts` x2 | each width inserted its own user + animal and deleted them | one `beforeAll` / `afterAll` batch each, shared by both widths. Both width tests kept. Ids gain the describe title: `[authed] › card meta line at 390px...` -> `[authed] › Mis Animales card meta line › card meta line at 390px...` (same for 1280px). |

### §4.5 public-api

No change (audit).


### Follow-up round (Jon, 2026-11-03)

Count: **364 -> 361** (partition check, 17 legs). The three removals below are the whole difference.

| Removed id | Coverage |
|---|---|
| `[authed] public-api.authed.spec.ts › flag off → every endpoint answers 404 api_disabled` (:546) | Jon 2026-11-03: flag permanently ON — OFF path deliberately not covered |
| `[authed] public-api-docs.authed.spec.ts › flag off → every endpoint answers 404 api_disabled` (:133) | Jon 2026-11-03: flag permanently ON — OFF path deliberately not covered |
| `[user] adoption-docs.spec.ts › custom forms off → formConfig null (production: today's form)` (:130) | Jon 2026-11-03: flag permanently ON — OFF path deliberately not covered |

Kept: `flagOff()` in afterAll/afterEach (restores the seed; `flagOn`/`flagOff` helpers are still used there) and the gating-OFF step in `form-results-masking.authed.spec.ts` (setup, not an OFF-path test). No helper became unused.

Silent skips made hard failures (no id change):
- `adoption-docs.spec.ts` (two tests, formerly `:186`/`:218`): `test.skip(!flagOn, ...)` -> `expect(flagOn, 'ENABLE_CUSTOM_ADOPTION_DOCS must be on in tests/seed.sql').toBe(true)`.
- `resilience.spec.ts` "Search button text changes with language": the language selector's visibility is now `expect(...).toBeVisible({ timeout: 15000 })` (was a 3 s probe that skipped); dead else/`test.skip()` removed; every other assertion unchanged.

Local (Node 20): adoption-docs + resilience 15/15 twice; public-api-docs 5/5. vitest 3332 green, tsc clean, lint 115.
