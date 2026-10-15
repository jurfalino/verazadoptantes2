# Shard the e2e suite

> Status: IMPLEMENTED (v2.56.131, file-level shards: `user` ×2, `authed` ×4,
> `rest` ×1). 2026-10-11: `user` raised to ×3 — user-1 (~36 tests, ~9 min)
> still reached the memory ceiling and failed four pipelines in a row on the
> same test. If a leg starts restarting again, split that leg further; the
> sections below are the original proposal, kept for the reasoning.

> **2026-10-15 — splitting is no longer the strategy.** 6→7 `authed` legs held
> one day. 12 of 40 staging pipelines (10 days) needed a manual re-run or failed.
> Plan:
> - **Phase 0 (v2.56.185):** `scripts/ci-e2e.sh` — when a shard fails AND its log
>   shows BOTH the memory restart and a dropped connection, re-run the WHOLE
>   shard once on a fresh server; attempt 1's log and report are kept.
>   v2.56.183 used `--last-failed` — the review reproduced it going green with
>   tests that never ran (serial specs, failed beforeAll/setup): never use it
>   here. The restart alone is no gate: 7 of 11 shards log one even when green.
>   Residual risk, same as a manual re-run: a real bug that only fails
>   sometimes can pass on the second attempt.
> - **Phase 1 (2–3 days):** make the full suite pass on the **Cloudflare build**
>   (`npx @cloudflare/next-on-pages` + `wrangler pages dev --persist-to
>   <repo>/.wrangler/state`). Spike (branch `spike/e2e-prod-build`, local):
>   memory ≤ ~730 MB, no restarts, tests sub-second; 138 passed / 20 failed of
>   158 reached. Failures to work through: email-OTP (test shortcut off), two
>   15-min hangs (resilience language switch, wizards observation card), and
>   photos / catalogue / import / contact editing (unexplained — real runtime
>   differences become bug tickets, not test patches). Wrangler reads secrets
>   only from `.dev.vars`: generate a test one.
> - **Phase 2 (1 day):** build once in build-and-lint, share the output with
>   every shard and the deploy job; prove on a non-deploying branch; keep the
>   dev-server path one week as fallback. Done = <5% pipelines re-run over two
>   weeks, no slower than today.
> - **Ruled out:** `next build && next start` — not because of db.ts: 111 routes
>   are `runtime = 'edge'` and get no database at all under `next start`.

## The problem, measured

`.github/workflows/ci.yml`'s e2e job runs **149 tests in one `next dev`
process**, ~25 minutes. Next dev compiles routes on demand and its heap grows
with each one, so partway through it reaches `--max-old-space-size=4096` and
restarts itself rather than be OOM-killed:

```
⚠ Server is approaching the used memory threshold, restarting...   ×6
```

Each restart is a window of several seconds in which every request fails.
Whatever test is in flight dies with `ERR_CONNECTION_REFUSED`,
`ERR_CONNECTION_RESET`, `ERR_EMPTY_RESPONSE`, or an assertion that times out
waiting for a page that will never load. A different test each time, which is
why it reads as flakiness rather than as one cause.

**Evidence** (run `37135478653`, v2.56.128): three consecutive e2e failures on
an unchanged commit, 153–155 of ~158 passing each time, zero overlap in which
test failed, six restarts in the log. Meanwhile `37131071190` (v2.56.127)
failed once on the same symptom and passed on rerun.

**It is getting worse, not holding steady.** One genuine e2e failure across
the releases of 1–2 Oct; three on one commit on 3 Oct. The suite grew ~12% that
day (4 new spec files). Every feature adds tests, every test adds server
lifetime, and server lifetime is the variable that breaks this.

**Cost today:** a clean pipeline is ~25 min; at the current failure rate the
expected cost per deploy is ~45 min plus someone watching it.

## Why not the obvious fixes

**Raise `--max-old-space-size`.** Dev memory grows without bound, so a higher
ceiling moves the wall rather than removing it — and on a 7 GB runner already
carrying 4 GB of heap plus Chromium, it trades Next's *graceful* restart for
the kernel's OOM killer. Strictly worse.

**Serve a production build (`next build && next start`).** Removes the
compiler, and with it the memory growth — this was tried on 2026-10-03 and
reverted. It does not work as a one-liner: `src/lib/db.ts:29` only falls back
to the local SQLite database when `NODE_ENV !== 'production'`, so a built
server has no database at all, `/api/ready` never returns 200, and the suite
never starts. Making it work means widening that guard behind an e2e-only env
var — a change to the line that decides whether the app talks to a real
database, which deserves review on its own terms and not as a means to a CI
end. It also changes how `runtime = 'edge'` routes are served, which the
homepage uses.

**More retries.** Playwright retries immediately, and a restart plus recompile
is tens of seconds — all three attempts can land inside one window. Already at
`retries: 2` and still failing.

## The proposal

Split the suite across parallel CI jobs with Playwright's built-in sharding.
No server lives long enough to reach the ceiling, so the memory problem
disappears as a consequence rather than being managed.

```yaml
  e2e:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - run: npx playwright test --shard=${{ matrix.shard }}/4
```

- **Wall clock:** ~25 min → under 10.
- **Runner minutes:** ~45% more (4 × ~9 min including setup, vs 1 × ~25).
  Cheap next to an engineer waiting on a release.
- **No product code changes. No guard weakened.**

Each shard needs its own seeded database — `scripts/setup-test-db.js` already
runs per `webServer`, so this is automatic, and it is also the source of the
risk below.

## The risk, which is the real work

Each shard gets a **fresh** database. Any test that quietly depends on another
test's leftovers will break the moment they land in different shards.

That coupling exists and has bitten before. `tests/contract-link.spec.ts`'s own
history is a fix for exactly this:

> *v2.14.7-17: … now uses a dedicated fixture adopter as the merge target
> instead of seed adopter María, so the merge no longer pollutes shared
> contactInfo and break unrelated assertions in search.spec.ts*

Expect sharding to surface more of the same. **Finding it is the deliverable**,
not a side effect: it is a class of flakiness that will keep costing deploys
whatever we do about memory.

Mitigations, in order of preference:

1. Set `fullyParallel: false` so Playwright shards at **file** granularity and
   a spec file's tests stay together. Removes intra-file coupling from the
   problem; cross-file coupling remains.
2. Give every mutating test its own `test-*-fixture-*` rows (the established
   convention — see `tests/seed.sql`). This is the durable fix.
3. Where a test must mutate a shared row, restore it in the test, as
   `catalogue.authed.spec.ts` does when it flips `listed` back.

## Steps

1. Shard to **2** first, not 4. Half the parallelism, half the coupling surface,
   and it proves the memory theory before the full change. Keep it for a few
   releases.
2. Record which tests fail only under sharding. That list is the coupling
   inventory — fix each by giving it its own fixture.
3. Go to 4 shards once the list is empty.
4. Drop `--max-old-space-size` back to the default once restarts are gone, and
   confirm no restart lines appear in a full run.

## Definition of done

- No `approaching the used memory threshold` line in a complete e2e run.
- Three consecutive green pipelines on unchanged commits.
- e2e wall clock under 10 minutes.
- Every mutating spec owns its fixtures; none depends on another file's writes.

## Estimate

Half a day for the sharding itself; up to a full day including the coupling it
exposes. The upper half of that range is the part that pays off permanently.
