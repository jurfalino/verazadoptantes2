# Audit — post-deploy recovery ("deployment skew"), v2.56.59 → v2.56.66

**Date:** 2026-09-19 · **Scope:** everything shipped to keep browser tabs working across a
deploy: chunk-load recovery, the middleware skew guard, the reload guard, the error-path
changes. · **Method:** code read by an independent reviewer (no access to the authors'
conclusions), every finding re-verified against the code, plus production evidence and the
release history.

## Verdict

**The core mechanism is correct; the edges are not production-grade yet.** The diagnosis
was rigorous and the central idea — compare the tab's build id in middleware, reject a
mismatch, let Next turn the rejection into a reload — reads Next's runtime correctly and is
proven live. But the recovery reaches only part of the app, one of its recoveries throws away
unsaved input, nothing tells us whether it is working, and none of its tests gate a deploy.

**Recommendation:** freeze deploys that touch this area. Do not ship 2.56.66 on its own. Land
the P0 items below with it as one release, because every deploy is itself what makes open
tabs stale.

## Status — addressed in v2.56.67 (same day)

| Item | Resolution |
|---|---|
| P0-1 reload wipes input | `resolveErrorId` no longer reloads. Saves raise a persistent "Hay una versión nueva · Recargar" notice (`StaleDeployWatcher`), and their error toasts are dropped. Reads (search) still reload by themselves. Proven on a real build switch: a stale save kept the typed text, did not reload, and did not write; a stale search reloaded. |
| P0-2 raw sentinel / uncovered handlers | `StaleDeployWatcher` recognises the 409 from the response itself (`x-deployment-skew` header), for every request made through `window.fetch`, which is how Next sends actions and page data. So coverage no longer depends on catch blocks. 25 `err.message` sites go through `userFacingMessage` / `handledAsStale`. `ClientErrorReporter` and both error boundaries recognise skew. The adopter form's main save and its inline field saves are handled. |
| P0-3 search | 2.56.66, included. |
| P1-1 silent dead guard | The deploy build fails when `APP_BUILD_ID` is empty. A post-deploy step asserts the live 409, marker header and server build id. It was dry-run against production (correctly fails there until this release adds the header) and against the new code (passes). Stale-tab events are now reported to Axiom at `warn`, source `deployment-skew`, with both build ids. Middleware logging was not added: whether Axiom flushes from the edge middleware is unproven, and the client report covers the need. |
| P1-2 untested | `npm test` is back in CI (rolldown binding unpacked from the lockfile version; config renamed `.mts` for Node 20.18), proven on a throwaway PR before shipping. New e2e `tests/deploy-skew.authed.spec.ts` (build id pinned to `e2e-build` via playwright config) covers a stale save and a stale search. Mutation-checked: it fails with the fix removed. |
| P2-1 SW cache growth | `cacheKeyFor` drops `dpl` on both match and put; `CACHE_VERSION` v8 evicts what already accumulated. Unit-tested against the real `sw.js`. |
| P2-2 content-type coupling | `src/middleware.test.ts` pins the exact `text/plain`. The watcher keys on the header, not the text. |
| P2-3 declined reload unlogged | Partly. When a read's reload is declined, the tab is marked stale and the watcher reports that event. The declined reload itself is not logged as such. |
| PR-4 flag drift | `scripts/check-flag-parity.mjs`, non-blocking CI step. **First run: 13 differences.** 9 flags are ON in production and OFF in e2e, including `ENABLE_PII_ACCESS_GATING` and `ENABLE_PUBLIC_PROFILES`; 4 are the other way round. Aligning the seed is a separate decision. |
| PR-5 undocumented | `CLAUDE.md` (Deployment) and `.agents/workflows/deploy.md`. |
| Remaining | Catch blocks that swallow errors into a generic message still show that message next to the notice. It is harmless, but noisy. |

## What shipped, and when

| Version | Change | Production |
|---|---|---|
| 2.56.59 | Chunk-load reload in React error boundaries; opaque "Script error." no longer toasts | PR #86, 09-18 |
| 2.56.60 | Adoption edit form: no crash, no false "saved" on an empty action result | PR #86 |
| 2.56.61 | `deploymentId` + middleware 409 on build mismatch; recovery in `resolveErrorId` | PR #86 |
| 2.56.62–65 | Unrelated fixes and a flag, but each release re-staled every open tab | PR #87, #88 |
| 2.56.66 | Search path recovery, reload window, sentinel no longer shown as a code | **not pushed** |

Three production releases in about 18 hours (PRs #86–#88, 09-18 19:58 → 09-19 14:03),
against a previous rhythm of one every two to five days.

## What went well

- **Root cause by evidence, not inference.** Minified stack frames were resolved against the
  exact bundle, recovered from an old Pages deployment. The stale-action behaviour was
  proven by POSTing stale and fabricated action ids to staging, then by reading Next's
  `fetchServerAction`.
- **Verified in production.** A bogus build id gets 409 on buenadoptante.org, and asset URLs
  carry the deployed sha.
- **Pure logic is in the domain layer, test-first:** `classifyWindowError`,
  `isChunkLoadError`, `didPersist`, `isDeploymentSkewError`.
- **2.56.66 was proven against a real build switch** locally: a tab on build A, the server
  replaced by build B, then a search reloads onto B.
- The changelogs and notes are thorough enough for someone else to pick this up.

## Findings — technical

Verified against the code unless marked.

**P0-1 · The automatic reload destroys unsaved input on save paths.**
`AdoptionFormEditV2.tsx:386` calls `resolveErrorId`, and on skew that calls
`location.reload()` (read and verified). The typed form and any `pendingImages` `File`
objects are gone, and the save never ran, because the 409 is returned before the action
executes. This is the form whose lost edit (errorId 3d84fc1c) started this work. Before
2.56.61 the user at least got a toast and could copy their text.
A pattern scan finds **28 more** handlers that call `resolveErrorId` after a mutation. They
include the adoption wizard (`AdoptionFormWizard.tsx:617`), new-animal creation
(`app/my-animals/new/page.tsx:242,479,544`), contact entries
(`ContactEntriesSection.tsx:530,571`) and image uploads (`ImageGallery.tsx:186,302`). The
scan is a heuristic; confirm each before changing it.
*Fix, for mutations only:* never reload unprompted. Show a toast with a "Recargar" action.
**Reads keep the automatic reload.** Search is a read, and 2.56.66's automatic recovery,
proven by a build switch, must stay as it is.

**P0-2 · The raw sentinel "DEPLOYMENT_SKEW" is shown to users.** Since 2.56.61 a stale
action throws instead of resolving empty, and several handlers print `err.message`:
- `ImportWizard.tsx:645` (`setError`)
- `AdopterForm.tsx:460` (`alert`)
- `AdopterForm.tsx:647`, the main save toast, which also offers a retry that will fail again

A per-handler scan found **26 error handlers** that show UI after awaiting a server call but
never go through `resolveErrorId` or `notifyRequestError`, mostly admin panels, the import
wizards and the adopter form. The three above were read and verified; the rest come from the
scan. A skew error that escapes a handler reaches `ClientErrorReporter` and the error
boundaries, which don't recognise skew either. The result is "Algo salió mal", and
"Reintentar" hits the same 409.
*Fix:* recognise skew in `ClientErrorReporter` (both handlers) and in both boundaries, then
sweep the handlers that print `err.message`. Or decide on the server-side
`x-action-redirect` alternative, which covers every caller at once but hands callers an
empty result first.

**P0-3 · Search was not covered.** The 2.56.61 recovery lived in `resolveErrorId`, but search
reports through `notifyRequestError`. This became a production incident on 09-19: a stale
tab got "Búsqueda fallida". It is fixed in 2.56.66, which is not yet deployed.

**P1-1 · The guard can go dead silently, and a dead guard looks the same as a working one.**
Today it is alive. `APP_BUILD_ID` reaching the deployed middleware was **not** checked by
inspecting the `@cloudflare/next-on-pages` output (only a plain `next build` was inspected).
It is established by behaviour: production answers a bogus id with 409, and its asset URLs
carry the deployed sha.
If `APP_BUILD_ID` is empty, for example on a manual deploy without `GITHUB_SHA`, no header is
sent and nothing is compared. By design no skew event is logged: the middleware 409 is
silent, and both client helpers return before reporting. We cannot tell how often skew
happens or whether recovery works.
*Fix:* add a post-deploy CI step that curls the deployed URL with a bogus `x-deployment-id`
and asserts 409, and fail the deploy build when `APP_BUILD_ID` is empty. Log 409s in
middleware (sampled, with both ids) and report client-side recoveries at `info`.

**P1-2 · None of this is tested before deploy.**
- Unit tests are not run in CI. They were pulled in 2.56.21 because of a rolldown native
  binary problem (`ci.yml` comment), so the domain tests written for this work never gate
  a deploy.
- The end-to-end suite never exercises the 409. In CI, `GITHUB_SHA` is set, so the ids
  always match. The 2.56.61 changelog's claim that the guard is "inert in the e2e suite" is
  true locally and false in CI.

*Fix:* restore `npm test` in CI. Add a Playwright spec that sends a mismatched
`x-deployment-id` action POST and asserts a reload or a toast.

**P2-1 · The service worker cache grows by one bundle per deploy.** `cacheFirst`
(`public/sw.js`) keys on the full URL. `deploymentId` adds `?dpl=<sha>` to every
`/_next/static` asset, so every deploy stores a fresh copy of every visited asset, including
unchanged chunks, and nothing evicts the old ones until `CACHE_VERSION` is bumped by hand.
*Fix:* strip `dpl` from the cache key, or prune entries whose `dpl` differs, on activate.

**P2-2 · Fragile coupling to Next's error text.** Recognition depends on Next reading a
`text/plain` body verbatim. It does today, as production returns exactly `text/plain`. A
charset suffix added upstream would turn skew into a generic error with a code.
*Fix:* a test that asserts the exact response header, or match the status as well.

**P2-3 · The reload guard is bounded but can repeat.** One reload per 5 minutes per tab.
That is acceptable, but a persistently stale page (old HTML served offline) reloads on user
action every 5 minutes. When `sessionStorage` is blocked it declines, with no log.

**Fine as is:** excluding `/api` from the matcher (external callers never send the header),
RSC navigations and prefetches falling back to a full navigation, no double-write because
the 409 precedes execution, and `didPersist` as a backstop.

## Findings — process

**PR-1 · Coverage was claimed without an inventory, twice.** "No stale interaction ends in a
crash or silent no-op" (after 2.56.61) and "every catch calls `resolveErrorId`" were stated
without enumerating the call sites. The first inventory happened after a production
incident, and it found about 80 catch blocks outside the covered path.
*Rule going forward:* a coverage claim requires the enumeration, and the enumeration goes in
the PR.

**PR-2 · The verification proved the mechanism exists, not that users recover.** The
production check after 2.56.61 was a curl showing the guard returns 409. That says nothing
about what a stale tab shows. The only test that answers the real question, a stale tab
across a real build switch, was first run for 2.56.66.
*Rule:* the two-build switch test is the acceptance test for any change here. Automate it
(P1-2).

**PR-3 · Release cadence worked against the fix.** Each deploy stales every open tab, so
four releases in ~40h created the exposure the work was trying to remove, and the
09-19 incident was triggered by a release unrelated to it. Batching was a stated team norm
and was not held.
*Rule:* while a deploy-time fix is incomplete, batch releases and deploy at low-traffic times.

**PR-4 · Test environments drift from production config.** The e2e seed lacked
`ENABLE_HOUSEHOLD_MEMBERS`, which is on in production, so the family-text bug (16 records
hidden) shipped unseen. CI also runs `next dev`, not a production build.
*Fix:* derive the seed's flags from production's `app_config` periodically, or assert parity.

**PR-5 · Undocumented operational dependency.** `APP_BUILD_ID` is required for the guard,
but it is mentioned only in code comments and the changelog: not in `CLAUDE.md`, not in
`.agents/workflows/deploy.md`.
*Fix:* document it where people editing CI will read it.

## User impact during the work

- **errorId 3d84fc1c:** an adoption edit was lost (stale tab, save silently never ran).
- **16 records' family text** was hidden on profiles. 3 of them came through the create
  form after the household flag went on.
- **Search failed on stale tabs** after the 09-19 release.

Each was diagnosed with evidence. None caused data corruption.

## Prioritised plan

| # | Item | Effort |
|---|---|---|
| P0 | No automatic reload on mutations: toast with a "Recargar" action (P0-1) | S |
| P0 | Recognise skew in `ClientErrorReporter` and both boundaries; stop printing `err.message` for skew (P0-2) | S–M |
| P0 | Ship with 2.56.66 as **one** release, at a quiet hour | — |
| P1 | Post-deploy 409 smoke check; fail the build when `APP_BUILD_ID` is empty (P1-1) | S |
| P1 | Middleware 409 logging, sampled; client recovery reported at `info` (P1-1) | S |
| P1 | Restore `npm test` in CI; e2e skew spec (P1-2) | M |
| P2 | Service worker: strip `dpl` from cache keys (P2-1) | S |
| P2 | Document `APP_BUILD_ID` in `CLAUDE.md` and `deploy.md` (PR-5) | XS |
| P2 | Seed/production flag parity check (PR-4) | S |
| Decide | Sweep the remaining handlers, or adopt the server-side redirect | owner's call |
