# E2E (Playwright) CI reliability — why deploys keep getting blocked

Date: 2026-11-03 · Scope: staging + master CI runs 2026-10-16 → 2026-11-03 (60 runs, 71 attempts, 1,102 e2e job records; 191 job logs and 22 HTML reports read) · Code read at origin/staging 928ab215 (v2.58.12). Analysis only: nothing was pushed, re-run or changed.

## For Jon (product owner)

- **What you see:** a staging release took ~8 min on 23 Oct and ~34 min now. 3 of the last 6 got stuck at a 30-minute limit and needed a manual "re-run". They reached staging after 64, 93 and 93 min, counting the wait for someone to press it. Users aren't affected; fixes just reach them later.
- **What happens:**
  - The household tests added 27 Oct (13 steps that must run in order) take 7–9 min. They share one runner with ~30 other tests, so that runner went from 6 to 28 min.
  - They are slow because every bit of test data is written by starting a separate helper program (~1 s per database write). In the slowest test, 105 of its 120 s go to this.
  - The test server also restarts itself when its memory fills. That kills the test it is running at that moment, and a killed household step re-runs all 13 (+7 min).
  - CI's own automatic re-run then needs another 25 min with only ~4 left, so it is always cut off, and the error report is lost.
- **Rationalise the tests?** Only a little: fix 4 tests that fail at random and remove 9 that never run. The suite is not too big (367 tests); the cost sits in one file and one slow helper.
- **Plan and cost:**
  1. Today, ~2 h: the household tests get their own runner, and the automatic re-run is only attempted when it can finish. That should bring a release back to roughly 15 min.
  2. This week, 1.5–2.5 days: make the helper fast and fix the random failures.
  3. Later, 3–5 days: test against the real Cloudflare build, which ends the memory restarts for good.

---

## 1. What the numbers say

### 1.1 Pipeline length and re-runs (staging, since the e2e container landed in v2.56.230 on 2026-10-23)

| Run | Version | Attempts | 1st attempt | Time to finish (incl. wait for the manual re-run) | Why |
|---|---|---|---|---|---|
| 39879338952 | 2.56.230 | 1 | 8.0 min | 8.0 | baseline after the container change |
| 40356381735 | 2.57.1 | 2 | 17.0 | 33.8 | real failure in `record-edit-collab.authed.spec.ts:157` (all 3 tries), passed on manual re-run |
| 40532180531 | 2.58.0 | 1 | 16.2 | 16.2 | households spec arrives |
| 40802119504 | 2.58.6 | 1 | 28.9 | 28.9 | |
| 41256714800 | 2.58.7 | 1 | 32.4 | 32.4 | |
| **41259867423** | 2.58.8 | 2 | 30.1 (timeout) | **64.1** | user-1 hit the 30-min cap |
| 41367062406 | 2.58.9 | 1 | 34.6 | 34.6 | user-1 green at 28.8 min |
| 41465548207 | 2.58.10 | 1 | 34.4 | 34.4 | user-1 green at 28.7 min |
| **41527928305** | 2.58.11 | 2 | 30.2 (timeout) | **93.0** | user-1 cap |
| **41632012614** | 2.58.12 | 3 | 30.1 (timeout) | **93.3** | user-1 cap twice |

- 24 runs since 10-23. 4 needed a manual re-run. **3 of the last 6 (since 11-01) were blocked, all by `user-1` hitting `timeout-minutes: 30`**, which accounts for ~160 min of extra wall clock (34 + 63 + 63, including the human wait before each re-run). The fourth re-run (40356381735) was a real test failure, not the cap. The other cancellations in the window (39899865419, 39959255514, 40693750735; 1–8 min) were superseded by a newer push, which is expected (`cancel-in-progress` on staging).
- Pre-10-23 failures in the data were mostly causes that are now fixed: apt/browser install hangs at 30.3 min (39825938610, 39856548329), the container bring-up (v2.56.225–229), and an all-shard break on v2.56.217/218. They are not today's problem.
- **No master run since 2026-10-19** (39258471536). The next production release runs the same e2e matrix and will hit the same cap.

### 1.2 Which shard sets the pipeline length

Successful e2e job durations since 10-23 (29 jobs per group):

| group | median | max |
|---|---|---|
| **user-1** | 12.0 | **28.9** |
| authed-6 | 12.0 | 16.9 |
| authed-2 / authed-3 / user-2 | ~6 | 7.5 / 7.0 / 10.5 |
| everything else | 2–5 | ≤ 9.6 |

user-1, green runs only, in chronological order: 10-23: 4.2–6.2 · 10-26: 6.2–7.5 · 10-27: 9.4, 11.9, 18.2 · 10-28: 12.0–18.9 · 10-29: 13.8, 22.4 · 11-01: 26.5, 20.4 · 11-02: 28.8, 28.7, 28.9 · 11-03: 25.3. **user-1 quadrupled in eight days, with green runs at 95% of the cap.** authed-6 doubled over the same days (5.5 → 11–14).

### 1.3 Inside user-1 (report of job 125933810479, run 41632012614 attempt 3)

- 46 tests (44 listed + 2 setup). Playwright's own wall clock was 24.3 min; the sum of all test results was 15.0 min.
- `households.user.spec.ts` (13 tests, `describe.serial`) took **9.0 min**:
  - Test 3b ran into the memory restart and failed.
  - Playwright then skipped the rest of the group and re-ran **all 13** tests.
  - A clean pass of the file costs ~7.3 min plus its hooks.
  - The report's "single-pass 1.8 min" is an artefact: tests 4–10 were *skipped* on the first pass.
- Slowest tests in that pass: test 10 = 120.0 s, test 9 = 93.7 s, test 8 = 83.4 s, test 1 = 64 s over two passes.
- The other 9.3 min of non-test time is **7.3 min of gaps between tests plus ~1.5 min in the final `afterAll`**. These are `beforeAll`/`afterAll` hooks in dup-hint, flags, household-contrib and households, plus worker restarts after failures. The hooks call the same DB helpers (see 2.2).

Shard membership (from `npx playwright test --list --shard=i/3`): user 1/3 = 44 tests, 2/3 = 33, 3/3 = 31. user-1 holds admin-metrics, adopter, adoption-docs, continue-same-phone, contract-link, dup-hint, duplicates, flags, forms, household-contrib and **households**. With `fullyParallel: false` the shards fill **in file order**, so every new `d*`/`h*` user spec lands in user-1 (`playwright.config.ts:25`).

### 1.4 Memory restarts — when, where, what they kill

The restart is Next's own guard (`node_modules/next/dist/server/lib/start-server.js`). After **every request** in dev, if `used_heap_size > 0.8 × heap_size_limit` it logs "Server is approaching the used memory threshold, restarting..." and exits. In CI the limit is 7,991 MB, so the trigger is about 6.4 GB.

Restarts per job in the 3 heavy groups, by release (job logs):

| period | heap | user-1 | user-2 | authed-6 |
|---|---|---|---|---|
| 10-16 → 10-22 | 4 GB | every job, ~4–5 min in | every job, ~3–4 min | every job, ~3–4 min |
| 10-23 → 10-26 01:10 (v2.56.230 → 2.57.0) | 8 GB | **0** | **0** | **0** |
| v2.57.1 (10-26 16:09) → | 8 GB | 0 | 0 | **back, ~6.5–8 min, every job** |
| v2.58.0 (10-27) → | 8 GB | 0 | **back, ~4.4–7 min, every job** | every job |
| v2.58.7 (11-01) → | 8 GB | **back, 12.5–19 min, every job** | every job | every job |

Across the 8 latest runs (175 job logs), restarts occur **only** in user-1 (8/11 jobs), user-2 (10/11) and authed-6 (10/11). The other 13 groups had 0.

**Each restart deterministically kills one test.** The top failing tests in those 175 logs:

| times | test | group | restart in same job |
|---|---|---|---|
| 9 | `resilience.spec.ts:139` Import wizard preserves input (`page.reload: ERR_CONNECTION_REFUSED/RESET`) | user-2 | 9/9 |
| 8 | `one-reality.authed.spec.ts:115` rejected pair | authed-6 | 8/8 |
| 4 | `households.user.spec.ts` 3b / 2 / 3 (whichever is in flight at ~13–16 min) | user-1 | 4/4 |
| 7 | `wizards.spec.ts:28` Observation card (beforeEach `goto('/')` hangs 120 s) | user-3 | **0** (chronic flake) |
| 6 | `landing-pages-authed.spec.ts:51` `/my-animals` (`page.goto` `networkidle` 30 s timeout) | authed-5 | **0** (chronic flake) |
| 3 | `public-api.authed.spec.ts:386` | apicore | 0 |
| 3 | `sheet-import-form-export.authed.spec.ts:96` | authed-8 | 0 |

Alignment check (measured): in run 41632012614 attempt 3, the user-1 restart at 13:17:40 is 13.6 min into the report, which is exactly households 3b (started 13.5 min, failed after 37.6 s). The authed-6 restart at 12:08:46 is 7.97 min, during `one-reality:115` (started 7.6 min, failed, then passed on retry).

### 1.5 How a 1-test failure becomes a 30-min cancellation

Attempt 1 of run 41632012614, job 125903703449:

1. `forms.spec.ts:5` failed on its first try at the 120 s test timeout (`/form-results` text not found). Retry #1 failed with an empty share link (`u=` missing). Then the dev server restarted at 12:13:16, and retry #2 died with `ERR_EMPTY_RESPONSE`.
2. Attempt 1 finished at 25.5 min (`43 passed, 1 failed`).
3. `scripts/ci-e2e.sh` saw a restart plus a dropped connection and started the **whole shard again** at 12:26:24, 25.6 min into a 30-min job.
4. The job was cancelled at 12:30:01. The artifact upload is `if: ${{ !cancelled() }}` (ci.yml, "Upload test report"), so **attempt 1's report and traces were thrown away** as well.

**Verdict on `forms.spec.ts:5`, the test named in the brief: flake or slowness under heap pressure, unverified.**
- Its first try timed out about 3 minutes *before* the restart, while the heap was nearing the threshold. Its first retry then failed on the empty link.
- It failed in only this one of the 175 logs. In the green attempt 3 it passed in 54 s.
- After Q1 this attempt would most likely still have gone green, but only because the shard's own retry would then fit in the time limit. That is a mitigation, not a diagnosis.

In attempt 2 (job 125918645634) the shell retry never fired. A restart plus a serial-group retry pushed the first pass past 30 min. Both mechanisms come down to one fact: **user-1's baseline is ~25 min, so any retry at all overflows the cap.** The retry was designed when shards took ~6 min (`.agents/plans/e2e-shard-the-suite.md`, Phase 0, 10-15).

## 2. Root causes (separated from symptoms)

| # | Cause | Evidence | Confidence |
|---|---|---|---|
| R1 | **One shard grew to ~95% of its timeout**, because a 13-test serial spec landed in the shard already holding the other heavy `user` specs (file-order sharding). | 1.2, 1.3 | Measured |
| R2 | **Per-statement DB access through `npx wrangler d1 execute --local`** (one `execSync` subprocess per SQL statement), copy-pasted in ~35 spec files plus `tests/householdFixtures.ts:11`. `cleanupProfiles` issues ~12 statements per profile, plus 3 per household, plus lookups. | Traces (2.2) | Measured |
| R3 | **Dev-server heap growth reaches Next's 80% guard** in three shards. It came back release by release after the 8 GB heap removed it on 10-23. | 1.4 | Restarts measured. Their cause is **open**: shard composition and app code size changed in the same releases (2.3). |
| R4 | **Retry amplification:** a serial group retries as a whole; the shell retry re-runs the whole shard; Playwright `retries: 2` × 120 s test timeout. | 1.3, 1.5 | Measured |
| R5 | **No early warning:** nothing flags a leg creeping toward its cap; Playwright's "Slow test file" warning is buried in the log. | user-1 went 6 → 28 min with no alert | Measured |

Symptoms that are **not** causes: the specific tests in 1.4 that fail with `ERR_CONNECTION_*`. The 3b / 2 / 3 household "flakes" are restart victims; do not debug them as test bugs.

### 2.2 R2 measured — where the household tests spend their time

From the `trace.zip` of each retry (trace is `on-first-retry`), the largest gap between consecutive trace events, which is Node-side `execSync` time:

| test | duration | fixture setup | `finally` cleanup | DB plumbing share |
|---|---|---|---|---|
| 8 (own-household menu) | 83 s | — | 55.4 s | 67% |
| 9 (person in two homes) | 94 s | 10.0 s | 71.0 s | 86% |
| 10 (last-row ⋯ menu) | 120 s | 16.7 s | 88.7 s | 88% |

- Test 10's setup is 15 `execD1` calls (5 `insertProfile`, 3 `insertHousehold` = 10 rows) in 16.7 s, i.e. **~1.1 s per statement**. That is consistent with `npx wrangler --version` taking 1.2 s locally (process start alone, warm).
- Its cleanup (~80 statements) is consistent at the same rate.
- Heaviest other users by `execD1` call sites: merge-undo (34), pendientes-d (26), adoption-docs (22), form-results-link (21), merge-requests (21), one-reality (21). These are the files that make authed-6 (merge-undo + merge-requests + one-reality = 9.0 of its 11.3 test-minutes) the second-longest leg.
- A known side effect from earlier notes: a second process writing the same sqlite file the dev server's miniflare holds produces `SQLITE_BUSY` (memory: `project_e2e_networkidle_flaky`).

### 2.3 R3 — why the heap grows (OPEN: two causes changed together and cannot be separated without measurement)

- **Not elapsed time.**
  - Restarts happen at a fixed point in each shard: user-2 at ~5 min, authed-6 at ~7.5 min.
  - Long shards never restart: authed-5 holds the 8 admin landing pages, and authed-viewas never restarts either.
- **Shard composition changed in the same releases the restarts came back.** Verified by comparing the 10-26 reports (run 40391813564) with today's:
  - **authed-6, v2.57.1:** `one-reality.authed.spec.ts` was added on 10-26 (32ea306b) and joined authed-6.
  - **user-2, v2.58.0:** `households.user.spec.ts` (13 tests) arrived. That pushed `landing-pages-smoke.spec.ts` (5 tests that each load a different page) out of user-1 and into user-2. On 10-26, user-1 held it without restarting.
  - **user-1, 11-01:** `dup-hint.user.spec.ts` (10-29) had joined, and households had grown.
- **App code also grew a lot.**
  - `src/` diff v2.57.3 → v2.58.0: 148 files, +15.6k lines.
  - v2.56.235 → v2.58.12: 386 files, +44k lines.
  - There were **no dependency changes** (package.json/lock: version only; next 15.1.6, wrangler 4.59.2).
- **Plausible mechanism for both (inferred).**
  - `next dev` (webpack) keeps every compiled route in memory, in up to three builds: edge, node and client. 129 of 148 route files are `runtime = 'edge'`.
  - So heap grows with *how many distinct pages a shard opens* and *how heavy each page's code is*. Both rose in these releases.
- **Contributing, unverified:** Next forces `--enable-source-maps` on the dev child (`node_modules/next/dist/cli/next-dev.js:224`). Source-mapped stack traces over big dev bundles keep the maps in memory.
- `experimental.webpackMemoryOptimizations` was disabled on purpose (`next.config.ts:66–70`, RSC hydration TypeError).
- **No heap telemetry exists in CI**, so the split between "which pages a shard opens" and "how heavy the app code is" stays unknown until E1 measures it.

**Practical consequence:** moving files between shards (Q1) can also move restarts. Without households, `landing-pages-smoke` goes back to user-1 (see Q1).

### 2.4 What is still true from earlier notes

- `next build && next start` is still a dead end: 129 route files are edge (the 10-15 note said 111), and they get no DB under `next start`.
- The Cloudflare-build spike (`spike/e2e-prod-build`, c17b2397, 10-15) still exists, now **468 commits behind** staging. It measured ≤ ~730 MB and no restarts, but 20 failures were left to work through.
- `ci/user-shards-3` (0170378e, 10-11) is fully merged (the user ×3 split). Nothing further was planned on it; the follow-up was the plan's Phase 1/2.
- "Raising the heap moves the wall": confirmed. It bought 3–4 days.

## 3. Options

| # | Option | Effort | Risk | Expected effect |
|---|---|---|---|---|
| Q1 | Tag `households.user.spec.ts` `{ tag: '@leg-households' }` (same pattern as `view-as.authed.spec.ts:37`). Add `--grep-invert @leg-` to the three `user` legs (they have none today) and add a `user-households: --project=user --grep @leg-households` group. Verify counts with `--list` (108 = 95 + 13). | 30 min | Low (known pattern), but restarts may move | Simulated with `--list --grep-invert 'households as profiles'`: user-1 = 36 tests (today's minus households, **plus** `landing-pages-smoke` coming back from user-2), user-2 = 28, user-3 = 31, households leg = 13.<br>Estimate: user-1 ~9–13 min (10-26 baseline 6.7 min + dup-hint/continue-same-phone + hooks; inferred); households leg ~10–11 min.<br>Pipeline ~34 → ~15–18 min, bounded by authed-6 / user-1.<br>A restart then costs one test retry (~1–2 min), not a cancel, and the shard's retry fits in the cap. |
| Q2 | Make `scripts/ci-e2e.sh` budget-aware: skip the whole-shard retry when attempt 1 took more than ~40% of `timeout-minutes` (fail with a report instead of being cancelled). Keep evidence on timeout without relying on `if: always()` after a job-level cancel: put a **step-level `timeout-minutes: 25`** on "Run Playwright tests" under the 30-min job cap. The step then fails on its own and the upload step still has time to run. **Verify on one run.** | 1 h incl. `src/lib/ciE2eRetry.test.ts` | Low | Removes the guaranteed-timeout path; keeps evidence. |
| Q3 | CI step that warns (later fails) when a leg exceeds 50% of its timeout. | 30 min | Low | Catches the next creep before it blocks (R5). |
| N1 | One shared test-DB helper (`tests/db.ts`) replacing the ~35 copies. Step 1: batch statements, so `cleanupProfiles` sends one `--command "a; b; c"` or `--file` call instead of ~60. Step 2 (after a spike): better-sqlite3 directly on the miniflare file, as `scripts/setup-test-db.js:41` already does, with `busy_timeout`. | 1 day (step 1), +½ day spike (step 2) | Step 1 low; step 2 medium (concurrent writer on a file workerd holds; earlier WAL-corruption notes) | Households ~7.5 → ~2–3 min per pass; authed-6 −4–6 min; ~10–15 of 69 test-minutes saved suite-wide (inferred from 2.2 at ~1.1 s/statement). |
| N2 | Split the households `describe.serial` into independent tests, each with its own fixture (most already create their own rows; 1–7 share Pedro/Marta). | ½–1 day | Low–medium (the fixture-isolation rule in memory) | A restart or flake costs one test, not 13. |
| N3 | Fix the 4 chronic non-restart flakes: `wizards.spec.ts:28` beforeEach hang (7/11 user-3 jobs, 120 s each); `landing-pages-smoke-shared.ts:71` `waitUntil: 'networkidle'` → `'load'` + anchor (6/11; the "real fix" deferred since 2026-06/09); `public-api.authed.spec.ts:386`; `sheet-import-form-export.authed.spec.ts:96` (3/11 each). | ½–1 day | Low | Each occurrence wastes 2–6 min and trains people to ignore red. |
| E1 | **Measure first:** a CI step sampling `next-server` RSS/heap every 10 s (`ps`/`/proc`) alongside the test log. Try `next dev --disable-source-maps`. | ½ day + 1–2 runs | None (measurement). Note: PR runs skip e2e (`if: github.event_name == 'push'`), so experiments need a `workflow_dispatch` or a temporary trigger. | Turns R3 from inferred into measured; may halve the heap if the source-map hypothesis holds. |
| E2 | `onDemandEntries` (small `maxInactiveAge` / `pagesBufferLength`) so dev disposes compiled routes; or Turbopack dev (the webpack `async_hooks` alias needs a Turbopack `resolveAlias`). | ½ day each | Medium (recompiles slow tests; Turbopack differences) | Hypothesis only. |
| S1 | **Structural:** run e2e against the Cloudflare build (plan Phases 1–2): build once in build-and-lint, serve with `wrangler pages dev`, keep the dev path for a week as fallback. | 3–5 days (plan said 3–4; +1 for the 468-commit-stale spike) | Medium; runtime differences become real bug tickets | Ends the memory-restart class; tests become sub-second (measured in the spike); e2e tests what production runs; fewer legs needed. |
| — | More `--shard` legs | 5 min | Low | **Does not work here**: shards fill in file order and a serial file cannot be split (memory note 2026-10-17). Use tags (Q1) instead. |
| — | Raise `timeout-minutes` to 45–60 | 5 min | Medium | Hides R1/R2. A 25-min shard plus its retry is still 50 min, and a broken run then costs an hour. Not recommended except as a stop-gap of last resort. |
| — | Raise the heap again | 5 min | Medium | Rejected twice already; 16 GB runner, 8 GB already given. |

## 4. Rationalise the tests? — modest, targeted

**Inventory** (run 41632012614, all 16 reports): 367 tests in 79 spec files, **69 min of test time** (9.3 min of it retries). Projects: authed 220, user 108, unauthed 37, mobile 2, setup 2. Vitest: 266 files, ~3,000 cases (counted by `it(`/`test(`).

**Where the time is:**

| file | min/pass | tests | note |
|---|---|---|---|
| `households.user.spec.ts` | ~7.5 | 13 | 67–88% DB plumbing in its slow tests |
| `one-reality.authed.spec.ts` | ~2.6 | 3 | |
| `view-as.authed.spec.ts` | 3.6 | 5 | |
| `merge-undo.authed.spec.ts` | 3.5 | 6 | |
| `import-wizard.authed.spec.ts` | 3.5 | 22 | |
| everything else | ≤ 2.2 each | | |

Those five files are ~30% of suite time.

**Verdict:** pruning broadly would save a few runner-minutes. It would not shorten the pipeline, which is set by the slowest leg. Nor would it reliably stop the restarts: they depend on which pages a shard opens and how heavy the app code is (2.3), not on the test count. Infra fixes Q1 + N1 buy ~15–20 min of pipeline; a 20% test cut buys maybe 2–4. Do these targeted items:

1. **Delete or repair the 9 tests that never run in CI.**
   - `scraper.spec.ts` (5): skipped without `SCRAPER_URL`.
   - `duplicates.spec.ts:17,35`: `test.skip`.
   - `funcionalidades.unauthed.spec.ts:13,21`: conditional skip.
2. **Stop running `mobile.spec.ts` twice.** It runs in the `user` project at desktop size as well as in `mobile`: `user`'s `testIgnore` (`playwright.config.ts:52`) does not exclude it. Small saving.
3. **Move duplicated rule checks down a layer** (sampled, not a full mapping).
   - Households tests 8–10 assert server-side rules with SQL after clicking: D1/D2 delete-vs-request, `household_corrections` rows.
   - Those rules already have unit coverage: `src/domain/households.test.ts` (34 cases incl. `canRemoveMembership`) and `src/app/actions/households.test.ts`.
   - Keep the UI path (menu reachable, dialog, focus); drop or move the DB-state checks. Same pattern likely in merge-undo / one-reality. A full e2e ↔ vitest mapping was **not** done.
4. **Keep the layout/keyboard tests (390/1280, focus), but share their setup.** `households` test 10 loops both viewports inside one 120 s test; `my-animals-meta-layout` runs twice at ~30 s each, almost all of it setup.
5. **Optional, low value:** `public-api.authed.spec.ts` (23 tests, no browser) could become handler-level vitest, but it is fast (1.7 min). Leave it.

## 5. Recommended plan

1. **Today (≈2 h, CI/test config; needs the usual independent review before it reaches master).**
   - Q1 households leg.
   - Q2 budget-aware retry plus artifact on timeout.
   - Q3 leg-budget warning.
   - **Expected:** pipeline ~34 → ~15–18 min; user-1 timeouts gone.
   - The 3 blocked releases would likely have finished on their first attempt (inferred). In two of them that is because the shard's own retry would then fit, not because the failing test was fixed (see the `forms.spec.ts:5` verdict in 1.5).
2. **This week (1.5–2.5 days, tests only).**
   - N1 step 1: shared, batched DB helper.
   - N3: the 4 chronic flakes.
   - Clean-ups 1–2 from §4.
   - N2: if household flakes persist after N1.
   - **Expected:** −10–15 test-minutes (inferred); authed-6 and user-1 under ~10 min; fewer random reds.
3. **Next (½ day).**
   - E1: measure dev-server heap per test, and try `--disable-source-maps`.
   - **Decide** whether the dev server can be kept healthy cheaply, or S1 is needed now.
4. **Structural (3–5 days, when the release train allows).**
   - S1: e2e on the Cloudflare build.
   - This is the only option that removes the memory class rather than outrunning it.
   - The 8 GB headroom lasted 3–9 days per shard while app code grew 44k lines and specs moved between shards. Whatever E1 finds, rebalancing only buys time.

**Cost of doing nothing:** with user-1 at 25–29 min green, about half of releases need a manual re-run (+30–60 min each, plus someone watching). Shards fill alphabetically, so any new `user` spec whose name sorts early (today up to `households…`) lands in user-1 and makes it worse every release.

## Evidence index

- Runs: 41632012614 (jobs 125903703449, 125918645634, 125933810479), 41527928305 (125560365731, 125589840695), 41259867423 (124710731893, 124718454019), 40356381735 (121689860167), 39879338952 (baseline).
- Reports parsed: all 16 `playwright-report-*` of 41632012614, plus user-1 / authed-6 of 40391813564 (the 10-26 baseline).
- Code: `playwright.config.ts:25,29,52,115`; `scripts/ci-e2e.sh`; `.github/workflows/ci.yml` (e2e matrix, `timeout-minutes: 30`, upload `if: !cancelled()`); `tests/householdFixtures.ts:11–25,100–121`; `tests/households.user.spec.ts:332,387,439`; `tests/landing-pages-smoke-shared.ts:71`; `tests/wizards.spec.ts:9–14`; `node_modules/next/dist/server/lib/start-server.js` (80% heap guard); `node_modules/next/dist/cli/next-dev.js:215–224`; `next.config.ts:66–70`.
- Inferred or open, not measured: the cause of heap growth (2.3, open: shard composition vs app code size); savings estimates for N1/Q1; whether `if: always()` uploads after a job-level timeout; the vitest overlap (sampled).
