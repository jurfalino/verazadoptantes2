# Error Logging & Error-ID Audit

**Date:** 2026-05-06
**Scope:** Verify that ALL errors (frontend + backend) are logged to Axiom with a stable error ID surfaced to the user.
**Standard (per user requirement):** every error must (a) emit one log line in Axiom, (b) display an ID to the user, (c) keep that ID stable so it matches the log line — the ID must not change unless a *new* log line is written.

---

## Headline findings

### F1 — Client-side error boundaries don't ship to Axiom (HIGH)
`src/app/error.tsx` and `src/app/global-error.tsx` only call `console.error`. Pure client-side crashes (render errors, hydration failures, async errors thrown outside a `try/catch`) never reach Axiom. The user sees an Error ID, but **that ID corresponds to no log line** — there is nothing for an admin to look up.

This is the largest gap. Server-thrown errors *do* reach Axiom because the server action calls `logger.error` before throwing, and the client recovers the same ID via `extractErrorId(error.message)`. But anything that never crossed the network is dark.

### F2 — Error ID is non-stable in the boundary fallback path (HIGH)
- `src/app/error.tsx:14` — `crypto.randomUUID().slice(0, 8)` runs **inline on every render** when neither `extractErrorId(error)` nor `error.digest` is available.
- `src/app/global-error.tsx:46` — same antipattern.

If React re-renders the boundary (e.g., the user clicks "Reintentar", state updates, a parent rerenders), the displayed ID changes, contradicting the user's spec. Even when stable across a single mount, it never matches an Axiom row because nothing was logged (see F1).

**Fix:** wrap the fallback ID in `useState(() => crypto.randomUUID().slice(0,8))` — and pair with F1 by POSTing the error to a new logging endpoint on first render.

### F3 — No global window-level handlers (MEDIUM)
`grep -rn "onunhandledrejection\|window.onerror" src` returns zero hits. Async errors not awaited (e.g., `fireAndForget()` rejecting in a useEffect) bypass `error.tsx` entirely and produce no toast, no boundary, no log.

**Fix:** install `window.addEventListener('error', …)` and `window.addEventListener('unhandledrejection', …)` in a top-level client component that POSTs to a new `/api/log-client-error` endpoint.

### F4 — API routes return `[]` on error, hiding the failure from clients (MEDIUM)
Five routes do this — server logs an error but the client gets a body indistinguishable from an empty result (status 500 alone is not enough; many clients only check the body):

| File | Line |
|---|---|
| `src/app/api/my-animals/route.ts` | 24, 111 |
| `src/app/api/my-adopters/route.ts` | 20 |
| `src/app/api/my-adoptions/route.ts` | 24 |
| `src/app/api/my-form-submissions/unlinked/route.ts` | 18 |

In every case, the route should return `{ error: 'message', errorId }` matching the established `audit/route.ts` and `import/route.ts` pattern, and the calling component should surface that ID via `toast.error(...)`. The current code: `logger.error` *was* called (good), but the user can't see or report the ID, so the log is unactionable.

This was the proximate cause of the prod `/my-animals` `getTime` crash being hard to triage in the previous session — the error never produced a toast for the user, just a render crash later.

---

## Backend audit

### Server actions — pattern is correct ✅
All server actions in `src/app/actions/` that mutate data follow the canonical pattern:

```ts
const errorId = logger.error('Op failed', error, { context });
throw new Error(`Failed to op (Error ID: ${errorId})`);
```

Verified files: `admin.ts`, `adopters.ts`, `adoptions.ts`, `images.ts`, `flags.ts`, `findAdopters.ts`. No gaps.

### API routes
| Route | Status |
|---|---|
| `api/admin/audit/route.ts` | ✅ logs + returns `{ errorId }` |
| `api/admin/import/route.ts` | ✅ |
| `api/admin/organizations/*` | ✅ |
| `api/my-animals/route.ts` | ⚠️ logs but returns `[]` — see F4 |
| `api/my-adopters/route.ts` | ⚠️ same |
| `api/my-adoptions/route.ts` | ⚠️ same |
| `api/my-form-submissions/unlinked/route.ts` | ⚠️ same |
| `api/health/route.ts`, `api/ready/route.ts` | ✅ intentionally silent (probe contract) |

19 of 48 API routes never reference `logger.*`. Most are read-only or proxy routes (`guide-content`, `qr`, `share-target`, `keystatic`); spot-checking did not reveal silent failures, but a comprehensive sweep is recommended as a follow-up.

### Bare `} catch {}` swallows

#### Acceptable per CLAUDE.md (auth/SSR/probe contracts)
- `src/auth.ts:35,55,90,93` — auth/D1 unavailable fallbacks, documented
- `src/app/global-error.tsx:54` — SSR-safe localStorage read
- `src/app/api/health/route.ts:94,105,129` — health probe by design
- `src/app/api/admin/health/route.ts:96,137,182` — admin health probe
- `src/app/actions/adopters.ts:20` — `try { user = await getUser() } catch { /* anonymous */ }` — public-search path
- `src/app/actions/findAdopters.ts:676` — same pattern, public search
- `src/app/page.tsx:59` — homepage public stat fetch
- `src/app/admin/users/page.tsx:14` — admin role lookup fallback (acceptable since `getIsAdmin` is the gate, but should still log at `debug`)

#### Real swallows that violate the rule (need fix)
| File:line | What it swallows | Recommended action |
|---|---|---|
| `src/app/actions/formSubmission.ts:128` | Notes-extraction parse failure | `logger.warn('formSubmission: notes parse failed', { submissionId, error })` |
| `src/app/actions/formSubmission.ts:139` | **Whole `getFormSubmissionPrefill` failure → returns null** | Log at `error` with errorId; null is fine for callers but the failure must be visible |
| `src/app/actions/notifications.ts:304,344` | Notification dispatch failures | `logger.warn` with notification type + recipient |
| `src/app/actions/organizations.ts:313` | Org-list path | `logger.warn` with actor email |
| `src/app/admin/notifications/page.tsx:71` | Admin-notification page load | `logger.warn` |
| `src/app/api/dashboard/milestone/route.ts:25` | Milestone fetch | log + return `{ errorId }` |
| `src/app/api/facebook/fetch-post/route.ts:289` | FB scrape inner failure | log + propagate |
| `src/app/api/form/[userId]/route.ts:37` | Form fetch | log + return `{ errorId }` |
| `src/app/admin/audit/page.tsx:101` | Per-row JSON.parse — `console.warn` only | acceptable but should use `logger.warn` for Axiom visibility |
| `src/app/admin/config/page.tsx:90` | Social-proof JSON parse | OK for this feature, optional `logger.debug` |
| `src/app/actions/notifications.ts:43` | Already calls `logger.warn` ✅ |

#### Silent `.catch(() => {})` (fire-and-forget)
| File:line | Notes |
|---|---|
| `src/app/actions/flags.ts:58` | Notification dispatch — should `.catch(e => logger.warn(...))` |
| `src/app/actions/organizations.ts:280` | Same |
| `src/app/api/contract/[id]/submit/route.ts:313` | Same |
| `src/app/api/form/[userId]/submit/route.ts:232` | Same |
| `src/components/AdopterFlagging.tsx:96` | `getDuplicateCandidates` — best-effort, OK to swallow but log at debug |
| `src/components/MilestoneBadge.tsx:22` | Milestone fetch — log at debug |
| `src/components/UserMenu.tsx:55` | Best-effort, OK |

### Logger.error blocks missing operation context (CLAUDE.md rule #1)
Spot-checked: `api/my-animals/route.ts:110` logs `('API my-animals error', error)` with no `userEmail` or `view` even though both are in scope. Should be:
```ts
logger.error('API my-animals error', error, { userEmail, view });
```
Sweep recommended across all routes/actions for parity with happy-path log fields.

---

## Frontend audit

### Toast pattern — correct where used ✅
`src/components/ui/Toast.tsx:45` accepts `errorId`. The `error()` convenience method threads it through to the rendered toast (with copy-to-clipboard). Where components call `toast.error(title, message, extractErrorId(err))`, the user receives an actionable ID.

### `toast.error` calls **without** `extractErrorId(err)` — user sees no ID
These are catch-block sites that throw away the error context. Listed by file:

| File | Line(s) | Context |
|---|---|---|
| `src/app/admin/config/page.tsx` | 114, 118, 135, 139, 159, 163, 205, 209 | All admin-config save paths |
| `src/app/settings/page.tsx` | 55, 69 | Settings save |
| `src/app/organizations/page.tsx` | 63, 244, 264, 297 | Org CRUD (uses `result.error` shape but no ID) |
| `src/components/AdminAdopterList.tsx` | 129, 133 | Bulk action failures |
| `src/components/AdopterFlagging.tsx` | 174, 205, 208, 225 | Flag/dismiss flows |
| `src/components/AdopterProfileV2.tsx` | 56, 69, 81 | Delete + delete-request |
| `src/components/AdopterForm.tsx` | 140, 294 | Upload + save adopter |
| `src/components/AdoptionFormEditV2.tsx` | (validate) | Some paths use `extractErrorId`, others don't — audit by site |
| `src/components/SearchSection.tsx` | 162 | Search failure |
| `src/components/DeleteAdopterButton.tsx` | 36 | API-shape error path (`data.error`) |
| `src/components/FormResultMatchCard.tsx` | 86, 91 | Link/match flow |

These are all reachable from real user flows — they should be updated to `toast.error(title, message, extractErrorId(err))` so the user can report the ID.

The validation-only toasts (`'Please choose an image file'`, `'Maximum video size is 50MB'`) correctly do **not** have an ID — they're not errors, they're validation messages. Don't change those.

### Client error boundaries
- `src/app/error.tsx`, `src/app/global-error.tsx` — see F1, F2.
- No `componentDidCatch` / class-based `ErrorBoundary` exists in the codebase. Next.js's `error.tsx` is the only render-error boundary.
- No `window.onerror` / `unhandledrejection` listener exists. See F3.

---

## Recommendations (prioritized)

### P0 — Fix the headline gaps
1. **Make boundary IDs stable.** Move the fallback `crypto.randomUUID()` into `useState(() => …)` in both `error.tsx` and `global-error.tsx`.
2. **Ship boundary errors to Axiom.** Add a new `POST /api/log-client-error` route (edge runtime) that calls `logger.error` and **returns the resulting errorId in the response**. The boundary `useEffect` calls it on mount and `setState`s the returned ID — that becomes the canonical ID shown to the user. Same ID, same Axiom row, by construction.
3. **Install global handlers.** A top-level `<ClientErrorReporter />` client component (mounted in `app/layout.tsx`) registers `window.addEventListener('error', ...)` and `unhandledrejection` and POSTs to `/api/log-client-error`. Show a small "Error ID: xxxx — copy to report" toast on failure (use the existing `useShowToast.error`).

### P1 — Stop hiding API errors as empty arrays
Update the five `return NextResponse.json([], { status: 500 })` sites to:
```ts
const errorId = logger.error('Op failed', error, { ...context });
return NextResponse.json({ error: 'human message', errorId }, { status: 500 });
```
Update each consumer (e.g., `useEffect` fetchers in `my-animals/page.tsx`) to detect `response.ok === false`, parse the body, and `toast.error(title, msg, body.errorId)`.

### P2 — Convert silent swallows to logged warnings
The 7 sites in the "Real swallows" table above. Each is a one-line change to `} catch (e) { logger.warn(...) }`. None require a fix elsewhere.

### P3 — Add `extractErrorId` to all `toast.error` callers
Mechanical pass through the table in the Frontend audit — safe to do in one PR.

### P4 — Sweep for `logger.error` calls missing operation context
Per CLAUDE.md rule #1: re-emit the same fields the happy path logs. `api/my-animals/route.ts:110` is the example I confirmed; a full sweep is a half-day of grep + read.

---

## Out of scope (called out, not audited)
- Whether Axiom dashboards / alerts cover the most common error messages.
- Sampling / rate-limiting on the new `/api/log-client-error` endpoint (a misconfigured browser extension could spam it; recommend adding a `requestId` dedup cache or a per-IP rate limit when implementing P0.3).
- Whether the existing logger correctly attaches `userId` / session context — the current impl does not enrich entries with the authenticated user's email; it only fills branch/env. Worth a follow-up.
