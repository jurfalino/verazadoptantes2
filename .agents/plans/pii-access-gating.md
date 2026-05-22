# Plan: PII access gating — "you only see the contact info you already have"

> **Status (2026-05-22):** Steps 1–5 implemented behind `ENABLE_PII_ACCESS_GATING`
> (default off) — edit gate, schema, masking, search-match grants, the
> request/approve/revoke workflow, the admin dashboard, and the owner "who has
> access" disclosure. Released as minor `2.15.0`. Remaining pre-rollout: the
> first-run explainer banner (Resolution #9) and step 5.5.

## Context

BuenAdoptante is a vetting platform: any logged-in rescuer can currently open
any adopter profile and see **all** of that person's contact PII — every phone,
email, social handle, ID number, address. That is more exposure than the job
needs. A rescuer checking whether an adopter is safe needs to *confirm* the
contact details they already hold, not harvest the ones they don't.

This feature flips the default to least-exposure: a non-owner viewer sees only
the contact data they can demonstrably *already have* — the field(s) their
search matched — and everything else is masked behind an explicit, approvable
**access request**. It builds directly on v2.14.11's structured `contactEntries`
model (typed phone/email/social/id entries), which is what makes per-field
reveal possible.

This is a deliberate behavior change, so it ships **behind a feature flag**
(default off) for controlled rollout.

### Decisions locked with the user
- **Masked scope:** contact identifiers (phone, email, social, ID) + address. Family members and observation notes stay visible (notes are the vetting content the platform exists to share).
- **Search-match reveal:** persistent — a match records a grant; the viewer keeps seeing that field on future visits.
- **Request granularity:** whole-adopter — one request unlocks all of an adopter's contact info.
- **Grant lifetime:** permanent until explicitly revoked.

## Visibility model

For a given (viewer, adopter) pair, the viewer falls into one tier:

1. **Full visibility** (no masking) — computed, no grant rows needed:
   - Owner: `adopters.addedBy === viewer`.
   - Editor: `viewer ∈ DISTINCT adopter_history.changedBy` for that adopter.
   - Admin: `isAdminAsync(viewer)` (`src/config/admins.ts`).
   - Sentinel values (`anonymous`, `contract-submission`, `form-submission`) never match a real viewer — fine, they just grant nobody.
2. **Partial visibility** — masked by default; specific fields unlocked by:
   - **Search-match grant** (`origin='search_match'`): a query matched a specific contact entry → that entry is unlocked, persistently.
   - **All-contact grant** (`origin='request'`): an approved request unlocks every contact field for that adopter.
3. **No access** — everything masked; can submit a request.

Unauthenticated users are out of scope of the new flow — they keep the existing
heavy masking in `findAdopters` discovery and still can't open profiles (the
`/adopter/[id]` page redirects to login). The new gating targets **authenticated
non-owner/non-editor/non-admin** viewers.

## Contribution model — two surfaces, two rules

A clarification that resolves the edit-ACL risk and is the backbone of the
request flow: there are **two distinct ways to contribute to an adopter**, and
they get opposite rules.

- **Activities** (`adoptions` table — adoption, adoption_request, observation,
  follow_up, returned_pet…) stay **open to every authenticated user**. Logging
  "this adopter returned a pet" is the platform's whole purpose; it must never
  be gated. Activities do NOT write `adopter_history`, so contributing one does
  NOT make you an editor and does NOT auto-grant visibility — it produces a
  *reviewable access request* instead (see workflow below).
- **Core-record edits** (`saveAdopter` — the adopter's name, contact entries,
  address) are **owner + admin only**. Step 1 gates `saveAdopter`'s update path
  to owner+admin; `appendToExistingAdopter` already gates the same way (both
  use `isAdminAsync`). Once gated, the editor set reduces to {owner, admins}
  and "editor ⇒ full visibility" is sound.

Net model: **contributing activities is open; editing the core record is
owner/admin; PII access is *earned* by a reviewed contribution** — not by
editing.

## Data model — two new tables

`drizzle/0044_add_pii_access.sql` (hand-written — this repo hand-writes
migrations; `drizzle-kit generate` is not used) + matching definitions in
`src/db/schema.ts`. **Done in step 1.**

**`pii_access_requests`** — mirrors the `duplicate_candidates` status pattern:
- `id` PK · `adopterId` · `requesterEmail` · `justification` (nullable)
- `activityId` (nullable) — the `adoptions` row that triggered the request, when activity-driven
- `status` — `pending` | `approved` | `denied`
- `resolvedByEmail` (nullable) · `resolvedAt` (nullable) · `resolutionNote` (nullable)
- `createdAt` · indexes on `(adopterId, status)` and `(requesterEmail, status)`

**`pii_access_grants`** — the access facts:
- `id` PK · `adopterId` · `granteeEmail`
- `scope` — `all_contact` (request-approved) | `entry` (search-match)
- `entryRef` (nullable) — for `scope='entry'`: a **hash of the normalized
  matched value** (so the grants table never stores raw PII; re-matched at
  render time by hashing each entry's normalized value)
- `origin` — `search_match` | `request` · `requestId` (nullable, links the request)
- `grantedByEmail` · `createdAt`
- `revokedAt` (nullable) · `revokedByEmail` (nullable)
- index on `(granteeEmail, adopterId)`

## Server-side enforcement (mask at the data layer, never the UI)

A prior audit caught a leak from masking only in the UI — enforcement lives in
the server actions that return adopter rows. New module **`src/lib/piiAccess.ts`**
(pure where possible):
- `maskAdopterContact(adopter, visibility)` → returns the adopter with
  `contactEntries` values masked (`••••••`, type/icon preserved so the UI still
  shows "📞 Phone — hidden"), `addressInfo` masked, and the derived `contactInfo`
  blob masked. Each returned entry carries a display-only `masked: boolean`.
- `resolveVisibility({ viewerEmail, adopter, isAdmin, editors, grants })` →
  `{ tier, unlockedEntryHashes: Set, hasAllContactGrant }`.
- Masking helpers reuse the spirit of the existing unauth mask in
  `findAdopters.ts` and `maskEmail` (`src/lib/dates.ts`).

The viewer's edited-adopter set is one cheap query —
`SELECT DISTINCT adopterId FROM adopter_history WHERE changedBy = ?` — fetched
once per request and cached, so the full owner+editor+admin+grants check runs
on **every** surface (no list-vs-profile masking asymmetry).

Enforcement points (all gated by the feature flag; flag off = today's behavior):
- **`getAdopter(id)`** (`src/app/actions/adopters.ts`) — the profile page's data
  source. Returns masked adopter + a `piiAccess` summary
  (`{ tier, requestStatus, maskedFieldCount }`).
- **`findAdopters` discovery** (`src/app/actions/findAdopters.ts`) — masks each
  result's `contactEntries` / `addressInfo` / `contactInfo`. **Also scrub
  `matchSnippet`**: the snippet is a text window cut from the multi-line
  `contactInfo` blob, so a phone match can pull adjacent `Email:` / `IG:` lines
  into view — for a partial-access viewer, reduce the snippet to the matched
  entry's own text or clear it.
- **`getHistory(id)`** — the profile's change log renders
  `adopter_history.changes`, which stores old/new values of edited contact
  fields. For non-privileged viewers, **redact the `from`/`to` values of
  contact-field deltas** (or omit those history rows) so the log isn't a
  back-channel to every value the record ever held.
- **`/api/adopters` GET** (`src/app/api/adopters/route.ts`) — ImportWizard's
  duplicate-check. The matched value is something the rescuer *typed*, so
  showing it is consistent; mask the matched adopter's **other** contact fields.
- `getMyAdopters()` — the user owns those rows → full visibility; apply masking
  defensively anyway.

The flag is read **server-side only**; the client renders purely off the masked
data shape (`entry.masked` + the `piiAccess` summary), so it is deliberately NOT
added to `PUBLIC_FLAG_KEYS`.

## Search-match reveal mechanic

`runDiscoveryMode` already knows a query hit the contact field (via
`matchSnippet`) but not *which* `contactEntry`. New step: for each result, parse
`contactEntries` and find entries whose normalized value contains the
normalized query (digit-string compare for phones — the v2.14.11 6-digit
minimum already guarantees a phone match means ≥6 known digits).

For each newly matched entry, if the authenticated viewer has no grant yet,
INSERT a `pii_access_grants` row (`origin='search_match'`, `scope='entry'`,
`entryRef`=hash, `granteeEmail`=viewer, `grantedBy`=viewer) and `logAudit`. The
masking applied to that result then unlocks matched + previously-granted entries.

**Entry mutation:** if the owner later edits that phone, the stored hash no
longer matches any current `contactEntries` value — the grant goes inert and
the viewer is re-masked until they search the new value. This is intended
(the grant proves you knew *that* value); the grant is not "followed" to the
new value.

## Request / approve / revoke workflow

> Superseded in part by Resolution #3 — the request is an **explicit opt-in**,
> never auto-fired by an activity.

A request is created two ways, both producing one `pii_access_requests` row:
1. **Activity-linked opt-in.** When a not-yet-privileged user logs an activity
   (`adoptions` row), the activity form carries an explicit "I also need this
   adopter's contact info" checkbox. Ticking it creates a request with
   `activityId` set; the reviewer sees the concrete activity as context. Not
   ticking it ⇒ no request (the activity still posts and still notifies
   owner/editors that something was added — a separate, existing concern).
2. **Explicit (fallback).** A plain "request access" with an optional
   justification, for needing contact before there's an activity to log;
   `activityId` null.

New server actions in **`src/app/actions/piiAccess.ts`** (validated via
`src/app/actions/validation.ts` schemas):
- `getAdopterApprovers(adopterId)` → `{ owner, editors[] }`. **Filter sentinel values** (`anonymous`, `form-submission`, `contract-submission`) out of `addedBy` / `changedBy` before they reach the notify list. If the resulting real-email set is empty, approvers = admins only.
- `requestPiiAccess(adopterId, { activityId?, justification? })` — guards: flag on, viewer authenticated, viewer not already full-visibility or holding an `all_contact` grant, no existing pending request (dedupe → return existing), not inside a denial cooldown (Resolution #4). Inserts request (`pending`), `createNotification` (type `pii_access_request`) to the owner + editors (NOT all admins — Resolution #4), excluding the requester. `logAudit`.
- `resolvePiiAccessRequest(requestId, 'approved'|'denied', note?)` — guards: actor is an approver/admin for that adopter and is **not** the requester; request still `pending`. Updates request; on approval inserts an `all_contact` grant. Notifies the requester (`pii_access_approved` / `pii_access_denied`). `logAudit`.
- `revokePiiAccessGrant(grantId)` — guard: actor is owner/editor/admin. Sets `revokedAt`/`revokedByEmail`. Notifies the grantee (Resolution #6). `logAudit`.
- `getPiiAccessRequestsForApprover(email)` — pending requests the caller can act on (admins: all; others: on adopters they own/edited) — powers the approver panel + admin dashboard.

## Experience design (CX)

### Viewer — adopter profile (primary surface, `AdopterForm` view mode)
- **Explainer banner** when partially/fully masked. Suppressed when there is no
  contact info to mask (Resolution #8). First-run expanded state (Resolution #9).
- Contact section renders typed chips (reuse `ContactEntriesDisplay`):
  - Unlocked entry → full value (inline "matched your search" marker on search-revealed ones — Resolution #7, not a hover tooltip).
  - Masked entry → type icon + `••••••`, muted, with an `aria-label` (Resolution #8).
- **Primary path to access:** log an activity with the explicit opt-in checkbox.
- **Fallback:** a low-emphasis *"Request access"* link → `RequestPiiAccessModal`.
- Request state: *Pending* pill (with age); *Denied* → *"Request not approved"* +
  approver note, with the re-request CTA showing the cooldown unlock date
  (Resolution #4); *Granted* → banner gone, all contact visible.
- Owner/editor/admin → no banner; plus a **"who has access"** disclosure that
  splits approved-request grantees (listed, revocable) from search-match
  grantees (aggregate count — Resolution #2).

### Approver — on the profile + notification
- In-app notification deep-linking to the profile.
- The profile shows approvers a **`PiiAccessRequestPanel`**: requester, the
  linked activity rendered inline (or the justification), age, **Approve** /
  **Deny** (deny offers an optional note). The access decision **never blocks or
  alters the activity**.

### Admin — dashboard
- An `/admin` section listing **all pending PII requests** across adopters,
  sorted oldest-first, with approve/deny (pull surface — admins are not
  per-request-notified; Resolution #4). Admins can also revoke grants.

### Edge cases handled
- **Request rot** → a request pending > 7 days escalates to admins (Resolution #4); admin dashboard surfaces age.
- **No real owner/editor** (imported / `anonymous` rows) → approver set falls back to admins.
- **Duplicate request** → deduped to the existing pending one.
- **Re-request after denial** → allowed after a 14-day cooldown (Resolution #4).
- **New contact added after an `all_contact` grant** → covered (grant is whole-adopter, evaluated live).
- **Revocation** → forward-looking; grantee is notified (Resolution #6).
- **Editing to gain access** → closed: core-record edits are owner+admin only.
- **Junk activity to trigger a request** → the reviewer sees the activity inline and judges it.

## Notifications

New types `pii_access_request`, `pii_access_approved`, `pii_access_denied`,
`pii_access_revoked` via the existing `createNotification`
(`src/app/actions/notifications.ts`) — one row per recipient, in-app.
Add them to `TYPE_LABELS` in `src/app/notificaciones/page.tsx`.

## Anti-fishing, audit, security

Reveal-on-match means guessing 6 phone digits reveals the full number — the
intended trade-off. Residual risk + mitigations:
- Search already enforces ≥6 digits (v2.14.11).
- A single 6-digit query can fan-grant across every adopter whose phone
  contains those digits — makes a per-user search rate-limit an **important**
  follow-up.
- **Every** search-match grant, request, approval, denial and revoke is
  `logAudit`-ed — brute-forcing is visible.

## Suggested build order (phase-2 implementation)

1. ✅ **Edit ACL fix + schema + flag** — `saveAdopter` gated owner+admin;
   `appendToExistingAdopter` upgraded to `isAdminAsync`; `pii_access_requests`
   + `pii_access_grants` tables; `0044`; `ENABLE_PII_ACCESS_GATING` (off).
2. ✅ **Masking core** — `piiAccess.ts` masking + unit tests; wired into
   `getAdopter`, `getHistory`, `findAdopters` discovery (incl. `matchSnippet`
   scrub, also `adoption`-field), `/api/adopters` GET — behind the flag.
3. ✅ **Search-match grants** — `matchSearchEntries` per-entry detection +
   `pii_access_grants` writes (`origin=search_match`) + audit.
4. ✅ **Request/approve workflow** — explicit opt-in on the activity form + the
   standalone request modal; push notifications to owners/editors; denial
   cooldown; the approver panel. (7-day admin escalation deferred — admins use
   the dashboard pull instead.)
5. **Admin dashboard + grant revocation + owner disclosure** — ✅ admin
   dashboard (`/admin/pii-requests`), ✅ grant revocation + grantee
   notification, ✅ owner "who has access" disclosure (scope-split). ⏳ Deferred
   to pre-rollout: the first-run explainer banner (Resolution #9) — needs
   migration `0045` (a `user_profiles` dismissal column).
5.5. **Legacy sentinel-owned records + write-path audit.** Before flipping the
   flag, audit the `adopters.added_by` distribution. Rows owned by sentinels
   become admin-only-editable once the flag is on. Backfill a real owner where
   derivable. Also grep every other `adopters` write path (`mergeAdopters`,
   admin tools, contract intake) for gate bypasses.
6. Roll out: flip the flag in staging, pilot, then production.

## Resolutions — UX review (2026-05-22)

Loose ends found in a UX-expert review, resolved with the user. Where they
conflict with earlier prose, these win.

1. **Search-result card.** A partially-masked result card shows the matched
   entry in full with an inline "matched your search" marker; other entries
   collapse to type icon + `••••••`; one summary line + a CTA into the profile.
2. **Grant-disclosure split.** The owner "who has access" UI separates
   `scope='all_contact'` grants (listed, revocable) from `scope='entry'` grants
   (aggregate count, not individually revocable).
3. **PII request is an explicit opt-in, never auto-fired.** A request row is
   created only when the contributor ticks an explicit checkbox on the activity
   form, or via the standalone request fallback.
4. **Notification routing + denial cooldown.** A request notifies owner +
   editors (push); admins see requests via the dashboard (pull). Pending > 7
   days escalates to admins. A denial starts a 14-day cooldown (tunable) before
   re-request; computed from the latest denied request's `resolved_at`.
5. **Intake ownership — no sentinel owners.** Contract submissions set the
   created adopter's `addedBy` to the receiving rescuer; principle: a real
   owner, never a sentinel.
6. **Revocation notifies the grantee.**
7. **"matched your search" is a persistent inline marker, not a hover tooltip.**
8. **Degenerate + a11y states.** Suppress the banner when `maskedFieldCount ===
   0`. Masked chips carry an `aria-label`.
9. **Rollout explainer.** The standard protection banner has a one-time
   expanded state with a "Got it" dismiss; dismissal persists per-user
   (a `user_profiles` boolean).

## Out of scope (future)

- Email delivery of notifications (system-wide Phase-2).
- Time-limited / expiring grants (decided permanent-until-revoked for v1).
- Per-field-type requests (decided whole-adopter).
- Search rate-limiting + anomaly dashboards (recommended follow-up).
