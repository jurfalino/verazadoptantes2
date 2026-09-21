# Audit — v2.56.70 → v2.56.73, the notifications and access-request batch

**Date:** 2026-09-21 · **Scope:** `f333e37..19264ce` — the fix for notifications and
automatic access requests that never ran in production, plus the admin notifications
page (recipient, seen-state, delete). **In production since 2026-09-19**, merges #92
(2.56.70/.71) and #93 (2.56.72/.73). · **Method:** read the diff and the live files;
mutation-tested each new guard; queried production D1 and Axiom; probed the live
endpoint; commissioned an independent reviewer and re-verified its two most serious
findings by hand.

## Verdict

**The shipped code is correct and the release process finally held. The tests that are
supposed to protect it do not, and the central claim is still unproven.**

The design is right. `ctx.waitUntil` is the platform's guarantee, all eight call sites
use it and every one is awaited, no bare fire-and-forget notification call remains
anywhere in server code, and moving the request filer out of the `'use server'` file
closes a real impersonation path rather than a theoretical one. Delete is enforced on
the server, confirmed live. The admin page's date bug is genuinely fixed and the
parameter chunking is correct at every boundary.

What does not hold up is the verification. Three of the batch's four new guards pass
with the exact bug they name reintroduced. Two days on, not one of the eight trigger
paths has run in production, so nothing confirms or refutes the fix. And the review
surfaced two pre-existing holes on this exact surface that are more serious than
anything in the diff.

## Production status — unverified, not verified

| | |
|---|---|
| `notifications` rows since deploy | **0** (8 total, all `ownership_transferred`, all 2026-06-08) |
| `pii_access_requests` rows | **0 ever** — the table has never held a row |
| `contact_entry_added` since deploy | **0** (last 2026-09-19 20:23 UTC, before the deploy) |
| Any of the eight trigger events | **0** — all eight checked |
| New log lines in Axiom | none — the paths did not execute |

Production since the deploy saw one adopter created, one adoption, one search, one
profile view and two search-match grants. None of those notify anyone. The single
`adopter_flags` row in the window is not a counter-example: the import endpoint wrote
it (`src/app/api/adopters/route.ts:412`, `flagged_by = 'system'`, reason
`import_high`), and that path never calls `notifyAdmins`. Organization joins, form
submissions, contract invitations and deletion requests are all at zero.

So this is "not yet exercised", not "exercised and still broken". That is the better
of the two answers, and it is not evidence of a fix.

**The diagnosis is also broader than the evidence supports.**
`transferAdopterOwnership` used the *identical* bare
`import('@/app/actions/notifications').then(...)` pattern
(`git show f333e37:src/app/actions/admin.ts:793`) and produced 8 notification rows in
June. So "a bare fire-and-forget never completes on Cloudflare" is an
over-generalization: it is a race that is sometimes won, which is exactly why the bug
stayed invisible. And roughly half the "0 rows" cited in the 2.56.70 commit message is
expected behaviour, not the bug — three of the six contributions in the record were to
a record the contributor owns, where zero recipients and a `has_access` no-op are
correct. The narrower true claim is that contributions to *other people's* records on
2026-09-18 should have notified a real approver and produced nothing.

## Findings

### HIGH

**F1 · The regression guard passes with the bug reintroduced.**
`src/lib/background.test.ts:69-95`. *Verified by mutation, twice independently.*
Its pattern is `/^\s*(notify\w+|createNotification|requestPiiAccess)\([^;]*$/`. The
`[^;]*$` means it only ever matches a call whose first line contains no semicolon —
that is, the multi-line shape that happened to be in the file.

| how the bug comes back | guard |
|---|---|
| one-line bare call ending in `;` | **passes, undetected** |
| one-line `.catch(e => logger.warn(...))` | **passes, undetected** |
| bare `fileAccessRequestFor(...)` | **passes, undetected** |
| `void notifyAdmins(...)` | **passes, undetected** |
| the original multi-line `.then(...)` form | fails — caught |

`fileAccessRequestFor` is not in the vocabulary at all, although after this refactor it
is the function that does the work. The scan also walks only `src/app/actions` and
`src/app/api`, so `src/lib/piiAccessRequest.ts`, the new home of the logic, is never
looked at. The test's own comment says "the bug was not one bad line but a pattern,"
which is the right intent and not what it implements.
*Fix:* add `fileAccessRequestFor|notifyApprovers` to the alternation, drop `[^;]*$` in
favour of a statement-start check that also rejects `void`, walk `src/lib`, and keep
the five mutations above as fixtures so the guard is itself guarded.
*Residual risk either way:* the guard only knows notification function names. The real
bug class is any un-awaited promise in a server action on Workers.

**F2 · The impersonation guard does not guard the attack it names.**
`src/lib/piiAccessRequest.test.ts:14-18`. *Verified by mutation.*
The test asserts that *that file* contains no `'use server'`. It does not check
re-exports. Appending one line to `src/app/actions/piiAccess.ts`, which is already
`'use server'` and already imports the symbol:

```ts
export { fileAccessRequestFor } from '@/lib/piiAccessRequest';
```

leaves all 15 tests green. That single line turns `fileAccessRequestFor(viewer,
adopterId)` into a browser-callable server action with an attacker-chosen `viewer`:
any authenticated user could file PII access requests in someone else's name, burn
their denial cooldown, and spray notifications at record owners under a forged
requester. This is precisely the scenario 2.56.71's commit message says the design
prevents. The design does prevent it *today* — nothing re-exports it — but the test
that is supposed to keep it that way is inert.
*Fix:* scan every `'use server'` file for the symbol in an export position.

**F3 · `createNotification` is an unauthenticated server action.**
`src/app/actions/notifications.ts:1` is `'use server'`; the file contains no `auth()`,
`getUser()` or admin check anywhere. *Verified in code; not probed live, because a
probe would write a row in production.* **Pre-existing, not introduced here.**
`createNotification({ userId, title, body, url })` therefore accepts an
attacker-chosen recipient, title, body and click-through URL — a phishing primitive
inside the product's own notification bell, wearing the product's own chrome.
`resolveDisplayNames(emails[])` in the same file is an email-to-real-name oracle for
arbitrary addresses. This batch did not create either hole, but it built the new admin
page on top of `resolveDisplayNames`, which makes this the moment to close them.
*Fix:* an owner-or-admin check in `createNotification`; an auth check in
`resolveDisplayNames`.

**F4 · Nothing will tell anyone if it is still broken.**
The batch added success log lines "so a silent zero shows up next time." A log line is
not a signal; it needs someone to go and look, which is exactly what did not happen for
four months. No alert exists in the repository, and the available Axiom key cannot read
monitors, so I could not confirm one exists outside it.
*Fix:* one scheduled check that fails loudly — a daily query asserting that a
`contact_entry_added` in the last 24 hours implies a matching
`addContactEntry.autoAccessRequest` log line.

### MEDIUM

**F5 · A banned `inArray()` feeds three of the eight sites.**
`src/app/actions/organizations.ts:435` (also `:404`, `:140`, `:146`).
**Pre-existing.** `getOrgMemberEmailsFor()` is what `notifyOrgMembers()` calls, so it
computes the recipient set for `contract_result`, `form_submission` and
`member_joined`. Per the project's own D1 rule, for a user in two or more
organizations this silently returns the wrong member set. Single-org users happen to
work, which is why it has never been noticed. The consequence of this batch is that
three of the eight sites may now reliably *run* and notify the wrong people.

**F6 · `runAfterResponse`'s error logging can never fire for five of the eight sites.**
`src/app/actions/notifications.ts:422-425, 460-463`. *Verified.*
`notifyAdmins` and `notifyOrgMembers` wrap everything in `try { } catch { logger.warn(
'… non-critical') }` and return void. A total fan-out failure therefore reaches
`runAfterResponse` as a success, so `background task failed: …` never logs and the new
`… sent` line is skipped without an error. The observability this batch exists to
provide is absent on exactly the sites where the question is "did it run?".

**F7 · A decisive production test was available and was not run.**
*Verified in code.* `addContactEntry` runs both background tasks whenever a new entry
is written (`addContactEntry.ts:164-192`), regardless of who owns the record, and
2.56.70 added a log line that fires even with nobody to tell (`:262`, `recipients: 0`).
So **adding a contact detail to a record you own yourself** exercises the exact path on
a real Cloudflare worker, notifies no one, writes no notification and no access
request, and produces two Axiom lines within seconds. If the teardown race still bites,
those lines are absent — the original symptom exactly. One minute, no blast radius.
*Not a substitute:* flagging a fixture adopter, because `notifyAdmins` excludes the
actor (`notifications.ts:41`) and would notify the other real admins.

### LOW

- **`logAudit` is not awaited inside the background task** (`piiAccessRequest.ts:127`).
  It registers its own nested `ctx.waitUntil`; if that throws post-response it falls
  back to a bare insert nothing holds, so the parent can settle first. It also begins
  with `await headers()`, which after the response is caught and ignored, so
  auto-contribution audit rows will carry a null IP and device. One-word fix.
- **A dead export with a green test.** `summariseSeen` has no caller in `src/`; its
  test at `notificationState.test.ts:24-29` therefore protects nothing. Delete both, or
  use it for the per-type header.
- **The `form_submission` delete warning is overstated.** The answers live in
  `form_submissions` and survive; only the match report dies, and the results page
  degrades to a zero match count rather than breaking. `contract_result` is correct —
  that page is rendered entirely from the notification row. Over-warning is the safe
  direction; the wording just claims more than is true for one of the two.
- **`recipientName` is effectively never null** (`notifications.ts:331` seeds the email
  handle for every input), so a user with no name row renders as `handle
  (handle@domain.com)`. Compare against the seeded fallback, not against the id.
- **`knownTypes` still lists `form_result`**, which nothing produces, so the page
  renders a permanently empty card. Pre-existing.
- **Two flagged privacy items are still live, as intended.**
  `src/app/api/form/[userId]/submit/route.ts:224` puts a full rescuer email in a body
  sent to organization mates, and line 225 points them at `/form-results/{id}`, which
  the team's own changelog calls owner-only. Disclosed in the 2.56.71 changelog rather
  than fixed. Recorded here so they are a decision with an owner.

## What is solid (verified)

- **`fileAccessRequestFor` is genuinely unreachable from the browser as shipped.** Two
  importers, both `'use server'`, neither re-exporting it; `src/app/actions/index.ts`
  is not `'use server'`, uses explicit named exports with no `export *`, and exports
  nothing from either module.
- **Delete authorization.** `auth()` then `isAdminAsync` before any database work; 401
  anonymous, 403 non-admin, 404 unknown id, 400 malformed. Confirmed live against
  production: both `GET` and `DELETE` answer 401 without a session. The body is
  deliberately not written to the audit log. No injection, no IDOR, no CORS exposure.
- **All eight sites** use `await runAfterResponse(...)`, and a full sweep of
  `createNotification` / `notify*` call sites found no bare fire-and-forget left in
  `src`. The unwrapped ones are awaited inline, which is slower but correct.
- **`runAfterResponse` mechanics.** The task starts eagerly, never rejects into the
  caller, logs failures with name and context, and falls back to awaiting the work when
  there is no request context. `getRequestContext` is backed by async-local storage, so
  the database binding still resolves inside the `waitUntil` callback.
- **Dates and chunking.** Epoch seconds are promoted correctly everywhere on the admin
  page; the 21/1/1970 bug is really fixed. The 90-parameter chunking is correct at 0,
  90, 91 and 180, and returns before building an empty `IN ()`.
- **No new D1 violations** in the diff.
- **The strongest test in the batch** is `admin-notifications-delete.authed.spec.ts`:
  it fails if the server-side admin check, the anonymous check, the 404/400 branches,
  the audit row or the recipient and seen chips are removed.
- **Release discipline held.** 2.56.70's review returned before production and its
  fixes shipped alongside it in merge #92; the same for 2.56.72/.73 in #93. This is the
  standing rule from audits 1 and 2 being followed for the first time.

## Assessment of the engineering

| | |
|---|---|
| **Diagnosis** | Good, and overstated. The zero was real and the mechanism correctly identified, but "never completes" is contradicted by 8 rows written through the same pattern in June, and half the cited evidence is expected behaviour. |
| **Design** | Correct. The platform primitive is the right answer and the extraction closes a real hole. |
| **Verification** | The weak point, for the third audit running. Three of four new guards pass with their own bug reintroduced, the end-to-end test cannot reproduce the failure mode and says so, and there is no production evidence two days on. |
| **Release discipline** | Good. Reviews returned before production in both releases. Three releases in nine hours is high cadence, but each carried its review. |
| **Honesty of reporting** | Good. The commit messages state plainly what the tests cannot prove and which problems were left open. |

## Recommendation

1. **Run F7 today.** One contact detail on a record you own settles whether four months
   of silence is over. Until then "fixed" is a prediction.
2. **Fix F1 and F2 as one release.** Both are guards that do not guard. F2 is the more
   urgent of the two: it is one line away from an impersonation hole.
3. **Close F3 in the same release.** An unauthenticated notification-injection action is
   more serious than anything this batch introduced, and the batch now builds on it.
4. **Add F4's alert.** A silent zero must page someone.
5. **F5 and F6 next.** Notifying the wrong organization members, and a failure path that
   cannot report failure.
6. The LOW items are backlog, except the two privacy items, which need a product
   decision rather than a patch.

---

## Follow-up — what was done, same day

**Fixed and on staging (2.56.74, 2.56.75), green through the full pipeline.**

- **F3, the unauthenticated notification surface.** Closed by taking
  `src/app/actions/notifications.ts` off the wire entirely rather than adding a
  check, because the public contract and form routes call it without a session
  on purpose. The audit understated the exposure: all **thirteen** exports were
  endpoints, and the read side (`getNotifications` and friends, which return any
  named user's bell, whose `metadata` carries an adopter's name, phone, email,
  DNI and address) is the worse half. Built both ways to confirm: 148 endpoints
  now, 161 with the module back on the wire.
- **F5, the banned array parameter.** All four queries in `organizations.ts` now
  fan out per id. Two further findings from the pre-production review were taken
  with it: the per-id fallbacks are gone from the two functions that choose
  notification recipients, because a half-built recipient list silently answers
  with the wrong people, and the id list is deduplicated.

**And a lesson that belongs in this audit, because it is the audit's own
finding happening again.** The guards shipped with the first of those releases
had the same defect F1 describes. The surface test read only the first ten lines
of a file for the `'use server'` directive, and the twenty-line comment that
release added to the module was enough to hide it: the directive on line 21 put
all thirteen endpoints back with both tests green. The array-parameter guard
matched only the spelling used in CLAUDE.md and missed the parenthesised form
everyone writes, an aliased import, and multi-line templates. The independent
pre-production review caught both before production; 2.56.75 fixes them, with
every mutation run against the guard before and after.

The structural conclusion is that a source-scanning guard tends to encode the
shape of the bug that prompted it. Two things help: mutate the bug back in
several syntactic shapes before believing the guard, and prefer a check on
compiled output where one exists. `scripts/check-action-surface.mjs` now counts
the browser-callable endpoints in the built manifest during CI, which is immune
to how the directive is written and is the only check that notices a new action
wrapping a trusted helper under a different name.

**Still open from this audit:** F1 (the un-awaited-call guard still catches one
of five shapes), F2 (the impersonation guard — its re-export path is now covered
by `serverActionSurface.test.ts`, the rest is not), F4 (no alert), F6 (five of
eight sites cannot report failure), F7 (the batch is still unverified in
production) and the LOW items.
