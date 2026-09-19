# Audit 2 — v2.56.67, the fix for audit 1

**Date:** 2026-09-19 · **Scope:** commit `0a92fd9` (v2.56.67), which addressed every item of
`2026-09-19-deploy-skew-audit.md`. · **Method:** the same as audit 1. An independent
reviewer read the commit without the author's conclusions, and its top findings were
re-verified in the code. CI evidence comes from staging run 35451595878 and production run
35452660026.

## Verdict

**The design is now right. Two defects remain on the save path, and the new end-to-end test
is weaker than it was presented.** Recognising a stale tab from the response header, never
reloading on a save, and proving the guard live after every deploy are the correct
architecture, and the reviewer found no bug in that core. But a stale save can still leave a
user believing something was saved, and a dismissed notice leaves later saves failing with no
explanation. Both are smaller than what production ran before (a reload that wiped the form),
which is why the release was not pulled.

**Process verdict: the release went to production before this review came back.** The owner
had said "critical, fix now", staging was green, and the new CI checks passed, so it was a
defensible call. But audit 1's central process finding was *claims made before verification*,
and shipping ahead of the independent review repeats it. The review took five minutes.

## Production status

v2.56.67 is live (PR #90, run 35452660026, every job green). The new post-deploy step ran
against the production deployment: `stale request -> 409, x-deployment-skew=1`, server build
equal to the master merge sha, `normal request -> 200`. An independent curl against
buenadoptante.org confirms the same, and the service worker is serving cache v8.

## What is solid (verified)

- **The fetch wrapper is transparent.** It works with streaming bodies, `Request` objects,
  `AbortSignal` and thrown errors. Next calls the global `fetch` at call time, so server
  actions and page data do go through it. A window flag prevents double-wrapping.
- **No reload loops.** The error boundaries reload at most once per five minutes, and not at
  all without sessionStorage.
- **The 25 rewritten catch sites behave correctly.** The remaining raw `.message` sites are
  `/api` calls, which the middleware never rejects.
- **Dropping the toast cannot hide a real error.** Only a stale-tab rejection produces the
  id that gets dropped.
- **CI works.** `shell: bash` runs with `pipefail`, so `tee` does not mask a failed deploy.
  On a real staging run: `rolldown binding 1.0.2 OK`, 56 test files passed,
  `stale request -> 409, x-deployment-skew=1`, `normal request -> 200`.
- The stale-tab report to Axiom is not itself rejected, because `/api` is outside the
  middleware.

## Findings

**F1 · MED-HIGH · A stale inline save can look saved.** `AdopterForm.tsx` `saveField`,
`InlineEditField.tsx:61`. *Verified.*
`saveField` updates the form state optimistically. On a stale tab it returns early
**without reverting**. The field's value is now the unsaved text, so when the user presses
Guardar again the editor sees "no change" and closes, and the profile shows the new value as
if saved. A reload silently loses it. The end-to-end test's "typed text survives" assertion
passes *because of* this unreverted state.
*Fix:* revert `prevData` before returning. The typed draft lives in the editor's own state,
so nothing is lost.

**F2 · MED · After the notice is dismissed, saves fail silently.** `Toast.tsx`,
`StaleDeployWatcher.tsx:45`, `staleDeploy.ts:74`. *Verified.*
The notice has a close button, and both the "shown" and "marked" flags are one-shot. Once the
notice is dismissed, every later save is rejected with no toast, no notice and nothing
written, across the ~50 sites whose error toast is now dropped.
*Fix:* make this one notice non-dismissible, or re-show it on every rejected save when it is
not on screen.

**F3 · MED · The search end-to-end test can pass with the guard dead.**
`tests/deploy-skew.authed.spec.ts:76`. *Code verified; the Playwright behaviour is the
reviewer's knowledge and was not run.*
The test waits for `framenavigated`, and a successful search calls `history.replaceState`
(`SearchSection.tsx:322`), which fires that event for same-document navigations. There is a
second route to the same false pass: the helper stales only the first action POST, so an
earlier action on the page uses it up.
*Fix:* wait for the 409 response and a real `load`, and assert that a `window` sentinel set
before the search is gone.

**F4 · MED-LOW · The save test does not isolate a mechanism.**
In `saveField`, both `handledAsStale` and the fetch wrapper raise the notice, so removing
either still passes, and the wrapper has no test of its own. There is no assertion that an
error toast is absent, the navigation count is read too early, and the main create-form
save is untested. The author's "mutation check" removed **both** mechanisms at once, which
proved less than was claimed.
*Fix:* add a case that triggers a bare 409 via `page.evaluate(fetch)`, assert no "Error ID"
toast, and re-check navigations after a delay.

**F5 · LOW · Some sites show an error next to the notice.** The `userFacingMessage` sites
still set their fallback text, for example `ImportWizard.tsx:1024` "Failed to save", in
English on a Spanish UI. It is harmless, but it contradicts "the notice is the one message".
*Fix:* use `handledAsStale` at the sites that are saves.

**F6 · LOW · Expect more stale-tab events than the changelog implies.** The wrapper also
fires on background requests (page prefetches, notification polling), so an idle stale tab
raises the notice unprompted. That is arguably good, since the user hears before they type.
Each such tab sends one Axiom warning per deploy. Volume is bounded at one per tab load.

**F7 · LOW · The post-deploy check reports, but does not gate.** It runs after the new
build is live, so a failure means a red run with the new build already serving. Under
`-e`, a `grep` with no match aborts the step before its `::error::` line prints, so the
failure message would be missing.
*Fix:* add `|| true` on the greps. Document that a red check means "roll back", not
"blocked".

**F8 · LOW · Service worker.** `/_next/image` URLs also carry `?dpl=` but are not matched as
static assets, so they still accumulate per deploy (one file uses `next/image`). Page-data
entries grow until a version bump, but that predates this work.

**F9 · LOW (suspicion) · The rolldown workaround** uses `npm pack`, which does not check the
lockfile's integrity hash.

## Assessment of the engineering

| | |
|---|---|
| **Diagnosis** | Strong. Every root cause was proven with evidence. |
| **Design** | Strong after audit 1. Response-based recognition removed the per-handler whack-a-mole that caused the 09-19 search incident. |
| **Verification** | Improved but uneven. The real two-build switch test was run and passed. But the automated test meant to protect it has a false-pass path (F3) and does not isolate the mechanism (F4). "Mutation-checked" was claimed more strongly than it was earned. |
| **Release discipline** | Better, since there is one batched release this time. Still, this release went to production before its own review returned, and there were five production releases in about 20 hours in total. |
| **Honesty of reporting** | Good. Earlier overclaims were corrected openly. This audit records the author's own premature release. |

## Recommendation

1. **Fix F1 and F2 next, as one small release.** They are the only paths left where a user
   can lose work or be left without an explanation. Tabs loaded on 2.56.67 handle that
   deploy gracefully, so its cost is low now.
2. **Tighten the test (F3, F4) in the same release.** Otherwise the protection for this
   whole area rests on a test that can pass when it is broken.
3. **Make independent review blocking** for changes to deploy recovery, error handling,
   middleware and CI: no merge to master until the review has returned. Five minutes of
   waiting would have caught F1 and F2 before production.
4. F5 to F9 go to the backlog.
