# E2E CI reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Releases stop getting blocked by the e2e job (staging pipeline ~34 → ≤ ~18 min, no 30-min cancellations), with zero loss of test coverage.

**Architecture:** Four phases, each shipped to staging as its own version. A: re-partition the CI matrix (households leg), a budget-aware retry and a step timeout, a leg-budget warning, and a permanent partition guard that proves every test runs in exactly one leg. B: one shared, batched test-DB helper; fix the chronic flakes; the audit's §4 clean-ups. C: measure the dev server's heap in CI. D: run e2e against the Cloudflare build.

**Tech Stack:** GitHub Actions (`.github/workflows/ci.yml`), bash (`scripts/ci-e2e.sh`), Playwright 1.58 (`playwright.config.ts`, `tests/`), vitest (`src/**/*.test.ts`), wrangler 4.59 (`d1 execute --local`, `pages dev`), Next 15.1.6 dev server, `@cloudflare/next-on-pages`.

**Spec:** `.agents/audits/2026-11-03-e2e-ci-reliability.md` (§3 options Q1–Q3, N1–N3, E1, S1; §4 clean-ups 1–5; §5 order). Prior structural plan: `.agents/plans/e2e-shard-the-suite.md`. Spike: branch `spike/e2e-prod-build` (c17b2397; 4 files — rebuild from its diff, never rebase it).

## Global Constraints

- **No test-coverage loss (Jon, 2026-11-03).** Every test in `npx playwright test --list` (all projects) before a task must still exist and still run in CI after it, or have a written mapping in `.agents/audits/2026-11-03-e2e-coverage-ledger.md` to the test (`file:line`) that now covers the same behaviour. No new `test.skip` / `test.fixme` / `.only`, no raised `retries`, no weakened assertion (a removed `expect` needs a ledger line naming its replacement).
- **Every test runs in exactly one CI leg** — enforced by `scripts/e2e-partition-check.mjs` (Task A1), run after every task.
- Work in worktree `/Users/jurfalino/Developer/Personal/verazadoptantes2-e2e`, branch `ci/e2e-reliability` (from origin/staging 928ab215). Never in the main checkout.
- Never `git add -A` / `-u` / `commit -a`; never commit `local.db`, `.wrangler/**`, `.env.local`, `playwright.local.config.ts`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each phase ships to staging as one version: `npm version <x.y.z> --no-git-tag-version` above origin/staging's version (re-read it right before pushing), CHANGELOG entry, `git push origin HEAD:staging`, watch the run and confirm the deploy job. Never push to master.
- Lint warnings ≤ 125. `npx tsc --noEmit` clean. `npx vitest run` green.
- Local e2e harness: Node 20 (`export PATH="/opt/homebrew/opt/node@20/bin:$PATH"`), `playwright.local.config.ts` (port 3131, untracked). Before a local run: `git checkout -- local.db .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`, delete the `-wal`/`-shm` files by literal path.
- CI-config changes (Phase A, C, D) need an independent review before master (memory: review before production).
- Experiments must never reach a deploy job: deploy jobs keep `if: github.ref == 'refs/heads/<branch>' && github.event_name == 'push'`.

## Review Focus

1. A spec gets a `@leg-*` tag (or a new user spec sorts early) and silently runs in no leg, or in two → the partition check fails the build (A1 test: a fake matrix with a tagged spec that no leg greps).
2. The budget-aware retry skips a retry that would have fit, or retries one that cannot → A2 tests at the boundary (elapsed exactly at the limit, one second over).
3. A batched cleanup stops at its first failing statement and leaves rows behind → B1 test: a batch with a bad statement throws and names it (never returns as if done).
4. A flake "fix" that only loosens a wait → B3: each fixed test keeps an assertion on the same content the old wait guarded (reviewer checks the diff for removed `expect`).
5. The CF-build leg passes because a test was skipped or a route returns a static fallback → D3: the partition check covers the CF leg too, and the leg's test count equals the dev leg's.

---

## Phase A — unblock releases (one version)

### Task A0: Coverage baseline

**Files:** Create `.agents/audits/2026-11-03-e2e-coverage-ledger.md`; scratch `baseline/` (untracked).

- [ ] Save `npx playwright test --list --reporter=list` for each project (`setup`, `user`, `authed`, `unauthed`, `mobile`) to `baseline/<project>.txt`, and one listing per current `ci.yml` e2e matrix leg using that leg's exact `projects` args to `baseline/leg-<group>.txt`.
- [ ] Record totals (expect 367 incl. setup; audit §4) and the vitest count in the ledger header, plus one section per later task for mappings. Commit the ledger.

### Task A1: Partition guard

**Files:** Create `scripts/e2e-partition-check.mjs`, `src/lib/e2ePartitionCheck.test.ts`; modify `.github/workflows/ci.yml` (build-and-lint job).

**Interfaces — Produces:** `node scripts/e2e-partition-check.mjs` → exit 0 and prints `partition OK: <n> tests in <k> legs`; exit 1 and lists each test id (`[project] › file:line › title`) that is missing from every leg or present in more than one. Pure core exported for tests: `checkPartition(all: string[], legs: Record<string, string[]>): { missing: string[]; duplicated: Array<{ id: string; legs: string[] }> }`.

- [ ] Tests: a test in no leg → `missing`; a test in two legs → `duplicated` naming both; `[setup]` tests are ignored (they run as a dependency in every leg); identical inputs → both empty.
- [ ] Implement: parse the e2e matrix `group`/`projects` pairs from `ci.yml` (use the `yaml` package if already a dependency, else a narrow parser for the `- group:` / `projects:` lines), run `npx playwright test --list <args>` per leg and once for all non-setup projects, normalise ids, call `checkPartition`.
- [ ] Run it on the unchanged config: expect OK (today's matrix is a partition). Add a build-and-lint step "E2E partition: every test runs in exactly one leg" after Lint.
- [ ] Commit.

### Task A2: Households leg (Q1)

**Files:** Modify `tests/households.user.spec.ts:56`, `.github/workflows/ci.yml` (user legs + new group).

- [ ] Tag the `describe.serial` with `{ tag: '@leg-households' }` (pattern: `tests/view-as.authed.spec.ts:37`).
- [ ] user-1/2/3 legs gain `--grep-invert @leg-`; add group `user-households: --project=user --grep @leg-households` next to them, with a comment in the style of the `authed-viewas` one (why it runs alone).
- [ ] Confirm the deploy jobs' `needs: [..., e2e]` covers the new matrix entry (it does by construction — note it in the commit) and that no branch-protection required check names a specific leg (`gh api repos/:owner/:repo/branches/staging/protection` — read-only; a 404 means none).
- [ ] Partition check OK; `--list` counts: user legs + households = 108 user tests (audit Q1).
- [ ] Commit.

### Task A3: Budget-aware retry, step timeout, leg-budget warning (Q2 + Q3)

**Files:** Modify `scripts/ci-e2e.sh`, `src/lib/ciE2eRetry.test.ts`, `.github/workflows/ci.yml` (Run Playwright tests step).

**Interfaces:** the script reads `E2E_STEP_BUDGET_SEC` (default 1500) and `E2E_WARN_AT_SEC` (default 900); time comes from `date +%s` (tests put a fake `date` on PATH).

- [ ] Tests (extend the existing fake-`npx` harness with a fake `date`): retry still happens when attempt 1 took ≤ `(budget − 60) / 2` s; no retry when it took one second more, and the step exits 1 with `::warning::e2e: no time left for a re-run (attempt 1 took Ns of a Ms budget)`; a green run over `E2E_WARN_AT_SEC` prints `::warning::e2e leg used Ns of its 1800s job limit`; a green run under it prints nothing; every existing test still passes.
- [ ] Implement in the script.
- [ ] Workflow: the step gets `timeout-minutes: 25` and env `E2E_STEP_BUDGET_SEC: 1500`, `E2E_WARN_AT_SEC: 900`; keep the job's `timeout-minutes: 30`; the upload step's `if: ${{ !cancelled() }}` stays (a step timeout fails the step, it does not cancel the job — verify on the staging run and say so if unverified).
- [ ] Commit.

### Task A4: Ship Phase A

- [ ] vitest, tsc, lint, partition check. Bump version, CHANGELOG ("CI: households tests run in their own leg; a re-run is only tried when it can finish; legs near their limit warn; a build check proves every test runs exactly once"). Push to staging, watch, record per-leg durations in the ledger. Expected: no leg near 25 min.

## Phase B — faster, steadier tests (one version)

### Task B1: One shared, batched test-DB helper (N1 step 1)

**Files:** Create `tests/db.ts`; modify `tests/householdFixtures.ts` and the 33 specs with a private `execD1` (list: `grep -ln "function execD1" tests/`).

**Interfaces — Produces (`tests/db.ts`):** `execD1(sql: string): string` (unchanged behaviour), `rows(sql: string): Array<Record<string, unknown>>`, `execD1Batch(statements: string[]): void` — writes the statements to a temp `.sql` file and runs one `npx wrangler d1 execute DB --local --file=<tmp> --json`; on failure throws an Error that includes wrangler's stderr (never returns silently); empty array → no call. `isDbNull` and `sqlJson` move here too.

- [ ] Before replacing, diff every private `execD1`/`rows` copy against `householdFixtures.ts:11–25`; a copy that differs (escaping, cwd, error handling) keeps its difference as an option or stays local with a comment — record it in the ledger.
- [ ] Tests (a node-run Playwright-free check is enough: `tests/db.check.mjs` run in A1's style, or a vitest file under `src/lib/` that mocks `execSync`): a batch of 3 statements → exactly one `execSync` call using `--file`; a failing batch throws with the stderr text; an empty batch makes no call.
- [ ] Replace the copies with imports. Convert to `execD1Batch` the multi-statement setup/cleanup in `householdFixtures.ts` (`cleanupProfiles`, insert helpers) and in merge-undo, pendientes-d, adoption-docs, form-results-link, merge-requests, one-reality (audit §2.2). Per-table `try/catch` "table absent on an older seed" guards go: the CI seed has every table — a missing one must fail loudly.
- [ ] Local e2e: run every spec that imports `tests/db.ts` on the local harness; record before/after durations of `households.user.spec.ts` in the ledger. Partition check OK.
- [ ] Commit.

### Task B2: Direct-sqlite spike (N1 step 2) — evidence only

- [ ] On a throwaway branch, swap `execD1Batch` for better-sqlite3 on the miniflare file with `busy_timeout` (as `scripts/setup-test-db.js:41`), run the households + one-reality specs 3× locally. Ship only if all 3 runs are green with no `SQLITE_BUSY`/WAL errors and it saves ≥ 30% more than B1; otherwise record the result in the ledger and drop it.

### Task B3: Fix the chronic flakes (N3)

**Files:** `tests/wizards.spec.ts:9–28`, `tests/landing-pages-smoke-shared.ts:71`, `tests/public-api.authed.spec.ts:386`, `tests/sheet-import-form-export.authed.spec.ts:96`.

- [ ] Per test: root cause from the CI artifacts/logs of run 41632012614 and the audit's §1.4 table (superpowers:systematic-debugging), one fix, write the cause in the ledger.
- [ ] `networkidle` → `waitUntil: 'load'` plus an anchor assertion on the route's own content (the `SmokeRoute` gains `anchor: string | RegExp` or reuses an existing per-route expectation); every current hard assertion stays.
- [ ] No skip/fixme, no extra retries, no longer timeouts as the fix. Run each fixed spec 3× locally green.
- [ ] Commit.

### Task B4: Clean-ups (audit §4)

- [ ] **§4.1 tests that never run.**
  - `funcionalidades.unauthed.spec.ts:11` skips when `storageState` is truthy, but the unauthed project's `storageState` is `{ cookies: [], origins: [] }` (truthy), so it never runs: change the condition to "has cookies", run it, fix what fails.
  - `duplicates.spec.ts:17,35` (banner removed in v2.12.1-19): if the same behaviour exists today in another component, repoint the tests at it; if the feature does not exist, delete them and write the ledger line «feature removed v2.12.1-19 — no behaviour to cover».
  - `scraper.spec.ts`: keep (external service; skips in 0 s in CI; covers the scraper when run with `SCRAPER_URL`). Ledger note, no change.
- [ ] **§4.2 mobile twice:** confirm `mobile.spec.ts` only asserts mobile-size behaviour; then add it to the `user` project's `testIgnore` (`playwright.config.ts:52`). It keeps running in `mobile` (rest leg). Ledger: `[user] mobile.spec.ts:*` → `[mobile] mobile.spec.ts:*`.
- [ ] **§4.3 rule checks:** for households tests 8–10 (and merge-undo / one-reality), list each SQL assertion and its unit test (`file:line`). Add any missing unit test. Remove an e2e SQL assertion only when the unit test is an exact duplicate *and* the e2e test still asserts the UI result of the click; otherwise keep it. Ledger every pair.
- [ ] **§4.4 shared setup:** households test 10 and `my-animals-meta-layout` keep both viewport checks (390 and 1280) but create their fixture once per file (`beforeAll`), not per viewport.
- [ ] **§4.5** public-api stays as is (audit). No change.
- [ ] Partition check: the only removals are ledger-mapped. Commit.

### Task B5: N2 decision, then ship Phase B

- [ ] After B1 lands on staging, count households-file failures that were not a memory restart over that run and the next ones. If any: split the `describe.serial` into independent tests, each with its own `test-hh-fixture-*` rows; otherwise ledger "N2 not needed: <evidence>".
- [ ] Ship Phase B (version, CHANGELOG, push, watch, durations in the ledger).

## Phase C — measure the dev server (E1)

### Task C1: Heap sampler and source-map experiment

**Files:** `.github/workflows/ci.yml`, `scripts/e2e-heap-sampler.sh` (new), `playwright.config.ts` webServer command.

- [ ] Sampler: background loop every 10 s writing `epoch rss_kb heap_used_mb` for the `next-server` process to `e2e-heap.log`; started before, stopped after the test step; the log goes into the report artifact.
- [ ] `workflow_dispatch` trigger with input `next_dev_args` (default empty) → env `E2E_NEXT_DEV_ARGS` appended to `npx next dev` in `playwright.config.ts`. The `e2e` job's `if` accepts `workflow_dispatch`; confirm migrate/deploy jobs stay push-only (dispatch on `ci/e2e-reliability` must never deploy or migrate).
- [ ] Dispatch twice on the branch (default, then `--disable-source-maps` if Next 15.1.6 accepts it — check `next dev --help`). Ledger: peak heap per leg, restarts, durations, verdict (keep the flag or not). If kept, it becomes the default in the config.
- [ ] Ships with Phase D's or its own version (whichever comes first).

## Phase D — e2e on the Cloudflare build (S1)

### Task D1: CF-build leg alongside (non-gating)

- [ ] Rebuild the spike on this branch from its diff (`git diff $(git merge-base origin/staging spike/e2e-prod-build) spike/e2e-prod-build`) as `playwright.cf.config.ts`: no absolute paths, `wrangler pages dev .vercel/output/static`, local D1 seeded by `scripts/setup-test-db.js`, `APP_BUILD_ID=e2e-build` at build so the deploy-skew guard matches (tests/deploy-skew.authed.spec.ts).
- [ ] No product-code env backdoor: the spike's `E2E_LOCAL_DB` changes to `src/lib/db.ts` / `emailOtp.ts` are not carried (the CF build has the D1 binding; email OTP tests seed the code row — find the CF-compatible way, e.g. a test-only Resend stub key, and ask before any production-code change).
- [ ] CI: build-and-lint uploads the next-on-pages output; a separate job `e2e-cf` (same matrix groups) runs the suite against it. It is **not** in any deploy job's `needs` while non-gating — never `continue-on-error` (ci.yml removed it on purpose: it masks failures).

### Task D2: Make the CF leg green — fix, never skip

- [ ] Inventory every test that fails only on the CF build (the spike left ~20). Each gets a root cause in the ledger and one of: a test fix that keeps its assertion, a real bug ticket/fix in the app (ask Jon when it changes product behaviour), or it stays on the dev path (listed).

### Task D3: Switch the gate

- [ ] After 3 consecutive green CF runs with test counts equal to the dev legs (partition check extended to the CF matrix), the CF matrix becomes the deploy gate; the dev-server matrix stays one week as non-gating fallback, then is removed in its own version. Ship, watch, ledger.

## Final

- [ ] Whole-branch review (most capable model) of every CI/config/test change, then the independent review before master. Report to Jon in plain language.
