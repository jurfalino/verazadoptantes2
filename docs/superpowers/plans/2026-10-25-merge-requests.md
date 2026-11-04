# Merge Requests + Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rescuer merge or request-to-merge a duplicate pair with another rescuer's profile (owner/teammates accept or decline, admins decide any time), show who created the other profile, and send every notification by email with per-category switches in Configuración.

**Architecture:** Who-may-do-what lives in pure functions in `src/domain/` (`dedupPair.ts` extended, new `emailCategories.ts`). A new `merge_requests` table holds requests; `mergePendingDedupPair` either merges (as today) or files a request. Email rides on the existing `createNotification` (one place every notification passes through), sent after the response via `runAfterResponse`, gated by per-user prefs stored on `user_profiles`.

**Tech Stack:** Next.js 15 App Router (edge runtime pages), Drizzle + Cloudflare D1, Resend over HTTP (`src/lib/email.ts`), Vitest with `migratedDb`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-merge-requests-design.md` (decisions D1–D20).

## Global Constraints

- Layer rules: decisions in `src/domain/` (no DB/server imports); server actions fetch then call domain; lib holds infrastructure.
- Migration `drizzle/0092_merge_requests_and_email_prefs.sql`, hand-written (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`); no journal entry. Picked up automatically by `scripts/setup-test-db.js` and `src/test-utils/migratedDb.ts`.
- D1: never `inArray()` / `IN (array)`; fan out with `Promise.all`.
- Every catch logs with the operation's context (`adopterId`, `requestId`, `actor`); no silent swallow. User-facing errors carry an errorId.
- Identity shown to non-admins = display name, else `emailHandle(email)` (`src/lib/userDisplay.ts`); never an email. Admin pages show full email.
- New UI strings in **es, en and pt** (`src/i18n/locales/{es,en,pt}.ts`); client uses `t('key') || 'fallback'`. Email bodies are Spanish, built server-side in `src/lib/email.ts` (no stored per-user locale).
- Colors only from classes remapped in `src/app/globals.css` for both themes; layout must work at 390px.
- New wired server actions: raise `EXPECTED_ACTIONS` in `scripts/check-action-surface.mjs` (155 → 159) in the commit that adds them, with a log line. `npm run build` before pushing.
- Merges only through `mergeAdopters` (keeps the audit row, undo and the merged-profile redirect working).
- Background side effects (email) only via `runAfterResponse(name, task, context)` from `src/lib/background.ts`.
- Never `git add -A`/`-u`; tracked `local.db` and `.wrangler/**.sqlite` are e2e seeds.

## Review Focus

1. **Two people act on one request at once** (owner accepts while an admin approves, or a double click): the merge must run exactly once. Status changes are compare-and-set (`UPDATE … WHERE id=? AND status IN (…)`, then check rows affected). Test in Task 7.
2. **A profile is merged or deleted elsewhere while a request is open**: the request closes itself (`closed`), shows nowhere, and accept/approve refuse without merging. Test in Task 7.
3. **Bursts of notifications** (`notifyOrgMembers` fan-out, admin mass merge with "notify owners"): one recipient gets at most one email per category per 10 minutes; the bell is unaffected; `merge_request` is never throttled, and `pii_access_request` (always on, but filed in bursts by bulk imports) is throttled per type (final-review ruling F1). Test in Task 5.
4. **Recipients with odd data**: no `user` row, no `user_profiles` row, malformed `email_prefs` JSON, `added_by` = `'anonymous'`/null. Defaults to on, never throws; anonymous owners route to admins (D15). Tests in Tasks 3, 6.
5. **Unsubscribe links opened by mail scanners or tampered**: GET never changes anything; only POST with a valid signature turns a category off; the always-on category can't be turned off. Test in Task 4.

---

### Task 1: Email categories (pure)

**Files:**
- Create: `src/domain/emailCategories.ts`
- Test: `src/domain/emailCategories.test.ts`

**Interfaces:**
- Produces:
  - `type EmailCategory = 'requests' | 'forms' | 'merges' | 'contact_access' | 'profile_changes' | 'api' | 'other'`
  - `EMAIL_CATEGORIES: readonly EmailCategory[]` (display order as listed)
  - `ALWAYS_ON_CATEGORIES: ReadonlySet<EmailCategory>` = `{'requests'}`
  - `categoryForType(type: string): EmailCategory`
  - `type EmailPrefs = Partial<Record<EmailCategory, boolean>>`
  - `parseEmailPrefs(raw: string | null | undefined): EmailPrefs` (malformed → `{}`)
  - `isEmailEnabled(prefs: EmailPrefs, category: EmailCategory): boolean` (always-on → true; missing → true, D20)
  - `visibleCategories(hasApiKey: boolean): EmailCategory[]` (drops `'api'` without a key, D19)

Type → category map (spec table, plus types found in code):
- requests: `merge_request`, `pii_access_request`
- forms: `form_submission`, `form_result`, `contract_result`, `form_attached`, `contract_attached`
- merges: `adopter_merged`, `merge_request_resolved`, `duplicate_candidate`
- contact_access: `pii_access_approved`, `pii_access_denied`, `pii_access_revoked`
- profile_changes: `ownership_transferred`, `contact_entry_added`
- api: `api_record`, `api_access`
- anything else → `other`

- [ ] **Step 1: Write the failing tests**: `categoryForType('merge_request') === 'requests'`, `('form_attached') === 'forms'`, `('pii_access_revoked') === 'contact_access'`, `('member_joined') === 'other'`; `isEmailEnabled({}, 'forms') === true`; `isEmailEnabled({ forms: false }, 'forms') === false`; `isEmailEnabled({ requests: false }, 'requests') === true`; `parseEmailPrefs('{bad') ` → `{}`; `parseEmailPrefs('{"forms":false,"bogus":false}')` → `{ forms: false }`; `visibleCategories(false)` excludes `'api'`, `visibleCategories(true)` includes it.
- [ ] **Step 2: Run** `npx vitest run src/domain/emailCategories.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the exports above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/domain/emailCategories.ts src/domain/emailCategories.test.ts && git commit -m "feat: email notification categories"`

### Task 2: Schema + migration

**Files:**
- Create: `drizzle/0092_merge_requests_and_email_prefs.sql`
- Modify: `src/db/schema.ts` (add `mergeRequests` table near `piiAccessRequests` ~l.440; `emailPrefs` on `userProfiles` ~l.571; `emailedAt` on `notifications` ~l.661)
- Test: `src/db/mergeRequests.schema.test.ts`

**Interfaces:**
- Produces (Drizzle names → SQL columns):
  - `mergeRequests` / `merge_requests`: `id` text PK; `primaryId` `primary_id` text not null (older side, survives); `secondaryId` `secondary_id` text not null (newer side, absorbed); `candidateId` `candidate_id` text null; `flagId` `flag_id` text null; `requesterEmail` `requester_email` text not null; `ownerEmail` `owner_email` text null (null = no real owner → admins, D15); `status` text not null default `'pending'` (`pending|accepted|declined|cancelled|admin_approved|admin_declined|closed`); `resolvedByEmail` `resolved_by_email`; `resolvedAt` `resolved_at` ts; `createdAt` `created_at` ts default now. Indexes `idx_merge_req_status_created(status, created_at)`, `idx_merge_req_requester(requester_email, status)`, `idx_merge_req_owner(owner_email, status)`, `idx_merge_req_pair(primary_id, secondary_id, status)`.
  - `userProfiles.emailPrefs` → `email_prefs` text null (JSON `EmailPrefs`).
  - `notifications.emailedAt` → `emailed_at` integer ts null.

- [ ] **Step 1: Write the failing test**: with `migratedDb()`, insert a `merge_requests` row with only required columns and read back `status === 'pending'`; `PRAGMA table_info(user_profiles)` includes `email_prefs`; `PRAGMA table_info(notifications)` includes `emailed_at`.
- [ ] **Step 2: Run** `npx vitest run src/db/mergeRequests.schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the SQL file and schema entries** (header comment naming the spec).
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** the three files.

### Task 3: Email preferences in Configuración

**Files:**
- Modify: `src/app/actions/settings.ts` (add two actions)
- Create: `src/components/EmailNotificationsSection.tsx`
- Modify: `src/app/settings/page.tsx` (render the section after `<FollowupSettingsSection />`)
- Modify: `src/i18n/locales/{es,en,pt}.ts` (`settings.email_*` keys)
- Modify: `scripts/check-action-surface.mjs` (155 → 157, log line)
- Test: `src/app/actions/emailPrefs.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseEmailPrefs`, `visibleCategories`, `ALWAYS_ON_CATEGORIES`), Task 2 (`user_profiles.email_prefs`).
- Produces:
  - `getEmailPrefs(): Promise<{ prefs: EmailPrefs; hasApiKey: boolean } | null>` (null = no session)
  - `saveEmailPref(category: EmailCategory, enabled: boolean): Promise<{ success: boolean; errorId?: string }>`. Refuses always-on categories and unknown values. Upsert pattern copied from `saveFollowupSettings` (`INSERT … ON CONFLICT(user_id) DO UPDATE`), merging into the existing JSON, plus `logAudit`.
  - `hasApiKey` = any `api_keys` row with `owner_email = me AND revoked_at IS NULL`.

UI: a card in the same style as the other settings sections, title "✉️ Avisos por email", one row per `visibleCategories(hasApiKey)`: label + one-line description + switch; the requests row shows "Siempre activo" instead of a switch. Optimistic toggle; on failure revert and toast with errorId.

Copy (es; translate for en/pt): requests "Pedidos que necesitan tu respuesta" / "Pedidos de combinación de perfiles y de acceso a datos de contacto."; forms "Formularios y contratos"; merges "Duplicados y combinaciones"; contact_access "Acceso a datos de contacto"; profile_changes "Cambios en tus perfiles"; api "API"; other "Otros avisos".

- [ ] **Step 1: Write the failing tests**: no profile row → `getEmailPrefs()` returns `{ prefs: {}, hasApiKey: false }`; after `saveEmailPref('forms', false)`, `prefs.forms === false` and a second category saved keeps the first; `saveEmailPref('requests', false)` → `success: false`; a revoked key → `hasApiKey: false`, a live key → `true`; malformed stored JSON → treated as `{}` and the save overwrites it cleanly.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/emailPrefs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the actions, the section and the i18n keys; raise the ratchet.
- [ ] **Step 4: Run** the tests, `npx tsc --noEmit`, `npm run lint` (≤125 warnings). Expected: PASS.
- [ ] **Step 5: Commit** the listed files.

### Task 4: Signed unsubscribe link

**Files:**
- Create: `src/lib/emailUnsubscribe.ts`, `src/app/email/unsubscribe/page.tsx` (edge), `src/app/api/email/unsubscribe/route.ts` (edge, POST)
- Test: `src/lib/emailUnsubscribe.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2; `hashOtpCode(code, secret)` and `resolveAuthSecret()` from `src/lib/otp.ts`.
- Produces:
  - `signUnsubscribe(email: string, category: EmailCategory, secret: string): Promise<string>`: HMAC-SHA-256 over `` `unsub:v1:${email.toLowerCase()}:${category}` ``, hex.
  - `verifyUnsubscribe(email: string, category: string, sig: string, secret: string): Promise<boolean>`: constant-time compare; false for always-on or unknown categories.
  - `unsubscribeUrl(baseUrl: string, email: string, category: EmailCategory, secret: string): Promise<string>` → `${baseUrl}/email/unsubscribe?e=…&c=…&s=…`.
  - Page (GET): shows "¿Dejar de recibir «{category}» por email?" + a form POSTing `e,c,s` to the route; changes nothing itself. Route (POST): verify, then set that category false (same merge-into-JSON write as Task 3, looked up by email), then redirect to the page with `?done=1` ("Listo. Podés volver a activarlo en Configuración."). Invalid signature → same page with a neutral "Este enlace no es válido." and no write.

- [ ] **Step 1: Write the failing tests**: sign → verify true; another email, another category or a flipped hex char → false; `verifyUnsubscribe(e, 'requests', sig, secret)` → false even with a matching HMAC; email case-insensitive.
- [ ] **Step 2: Run** `npx vitest run src/lib/emailUnsubscribe.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, page and route.
- [ ] **Step 4: Run** the tests + `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Email every notification

**Files:**
- Create: `src/lib/emailConfig.ts` (move the resolver out of `src/app/actions/emailOtp.ts:112-122`; `emailOtp.ts` imports it)
- Create: `src/lib/notificationEmail.ts`
- Modify: `src/lib/email.ts` (add `buildNotificationEmail`)
- Modify: `src/app/actions/notifications.ts:82-84` (replace the commented hook)
- Test: `src/lib/notificationEmail.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4; `sendEmailViaResend` (`src/lib/email.ts:29`); `runAfterResponse`.
- Produces:
  - `resolveEmailConfig(db): Promise<{ apiKey: string | null; from: string }>` (appConfig row first, then env `RESEND_API_KEY` / `EMAIL_FROM`, default `'BuenAdoptante <noreply@buenadoptante.org>'`). Same precedence as today's OTP code.
  - `buildNotificationEmail(n: { title: string; body: string; url: string | null }, links: { appBaseUrl: string; unsubscribeUrl: string | null }): { subject: string; html: string; text: string }`. Subject = title; body + "Ver en BuenAdoptante" button to `appBaseUrl + url`; footer link "Configurar avisos por email" → `/settings`; plus "Dejar de recibir estos avisos" when `unsubscribeUrl` is set. HTML-escape title and body.
  - `sendNotificationEmail(n: { id: string; userId: string; type: string; title: string; body: string; url?: string | null }): Promise<'sent' | 'skipped_disabled' | 'skipped_no_account' | 'skipped_pref' | 'skipped_throttle' | 'skipped_config' | 'failed'>` (`skipped_disabled` / `skipped_no_account` added by the final review, F5 / F4):
    0. Feature flag `ENABLE_NOTIFICATION_EMAIL` (default on, Admin-togglable emergency off switch) off → `skipped_disabled`, checked first.
    0b. No `user` row for the recipient email (matched case-insensitively) → `skipped_no_account`, logged at info: they cannot manage the switches and the unsubscribe link would fail.
    1. category = `categoryForType(type)`; prefs from `user` ⋈ `user_profiles` by email (missing → `{}`); off → `skipped_pref`.
    2. Unless the type is `merge_request`: if any `notifications` row for the same `user_id` with the same throttle key (`emailThrottleKey`: the category, or the type itself for `pii_access_request`) has `emailed_at` within the last **10 minutes** → `skipped_throttle`.
    3. No API key → `skipped_config` (logged at info outside production, warn in production).
    4. Send; on ok set `notifications.emailed_at = now` for `n.id`; on failure log warn with `{ notificationId, type, errorId }` → `failed`.
  - `appBaseUrl(): string` in `src/lib/emailConfig.ts`: `'https://buenadoptante.org'` when `process.env.APP_ENVIRONMENT === 'production'` (the CI-stamped flag `src/lib/api/keys.ts:43` already trusts), else `'https://staging.buenadoptante.org'`; so staging emails never link to production. Unsubscribe signatures use `resolveAuthSecret()`.
  - `createNotification` calls `await runAfterResponse('notification.email', () => sendNotificationEmail({...}), { type, notificationId })` after the insert succeeds. Bell behavior unchanged; email failures never change its return.
  - Out of scope (unchanged): `workers/followup-cron` (`follow_up_due`), which already emails on its own.

- [ ] **Step 1: Write the failing tests** (mock `sendEmailViaResend`, real `migratedDb`): pref `forms:false` → `skipped_pref` and no send; `requests` type with prefs `{requests:false}` stored → still sent; two `form_submission` notifications 1 minute apart → first `sent`, second `skipped_throttle`; a `merge_request` right after → `sent` (not throttled); no `user` row → `skipped_no_account` (was "→ `sent`"; changed by the final review, F4); a `user` row with no `user_profiles` row → `sent`; malformed `email_prefs` → `sent`; send failure → `failed` and `emailed_at` stays null; `buildNotificationEmail` escapes `<script>` in the body and omits the unsubscribe line when `unsubscribeUrl` is null.
- [ ] **Step 2: Run** `npx vitest run src/lib/notificationEmail.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; keep `emailOtp.ts` behavior identical (its existing tests stay green).
- [ ] **Step 4: Run** `npx vitest run src/lib src/app/actions` + `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Merge-or-request decision (pure)

**Files:**
- Modify: `src/domain/dedupPair.ts`
- Test: `src/domain/dedupPair.test.ts` (extend)

**Interfaces:**
- Produces:
  - `type DedupAction = { kind: 'merge'; primaryId: string; secondaryId: string; notifyOwner: string | null } | { kind: 'request'; primaryId: string; secondaryId: string; ownerEmail: string | null } | { kind: 'refuse'; reason: DedupRefusal }`
  - `decideDedupAction(actor, a: DedupSide, b: DedupSide, source: 'detected' | 'flag'): DedupAction`:
    - unauthenticated / not_found / not_yours: as `decideDedupMerge` today.
    - Older side = primary (survives), newer = secondary, ties as today.
    - Both sides team-owned → `merge`, `notifyOwner: null`.
    - `flag` and not both team-owned → `request`, `ownerEmail` = the non-team side's `addedBy` (D14).
    - `detected`, newer team-owned, older not → `merge`, `notifyOwner` = older's `addedBy` (D2).
    - `detected`, newer not team-owned → `request`, `ownerEmail` = newer's `addedBy` (D3).
    - `ownerEmail`/`notifyOwner` normalized to `null` for null, `''` or `'anonymous'` (D15).
  - `type MergeRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'admin_approved' | 'admin_declined' | 'closed'`
  - `decideMergeRequestAnswer(input: { status: MergeRequestStatus; actorIsRequester: boolean; actorOnOwnerTeam: boolean; actorIsAdmin: boolean; decision: 'accept' | 'decline' | 'cancel' }): { ok: true; nextStatus: MergeRequestStatus; merges: boolean } | { ok: false; reason: 'not_allowed' | 'not_open' }`:
    - cancel: requester only, from `pending` → `cancelled`.
    - owner team (not the requester): from `pending`: accept → `accepted` (merges), decline → `declined`.
    - admin: from `pending` or `declined`: accept → `admin_approved` (merges); from `pending`: decline → `admin_declined`.
    - an admin who is also on the owner team acts as owner while pending.
    - anything else → `not_open` if the status is closed for that actor's options, else `not_allowed`.
  - Keep `decideDedupMerge` exported (delegate to the new function) so existing callers/tests stay valid.

- [ ] **Step 1: Write the failing tests** covering each bullet above, including: flag across rescuers where the actor's profile is newer → `request` (not merge); detected, mine newer, theirs older → `merge` with `notifyOwner` = their email; detected, mine older → `request` to their email; their `addedBy='anonymous'` → `request` with `ownerEmail: null`; requester cannot accept their own request; admin approves after `declined` → `admin_approved`; anyone acting on `accepted`/`cancelled`/`closed` → `not_open`.
- [ ] **Step 2: Run** `npx vitest run src/domain/dedupPair.test.ts`. Expected: new tests FAIL, old ones PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: all PASS.
- [ ] **Step 5: Commit.**

### Task 7: Requests on the server

**Files:**
- Create: `src/lib/mergeRequests.ts` (not `'use server'`)
- Create: `src/app/actions/mergeRequests.ts` (`'use server'`, thin)
- Modify: `src/app/actions/duplicates.ts` (`mergePendingDedupPair` ~l.458)
- Modify: `src/domain/dedupPair.ts` (`KEPT_SEPARATE_FLAG_DETAILS_PREFIX = 'Kept separate: '`; `isOpenDuplicateFlag` treats it as closed)
- Modify: `src/lib/adopterMerge.ts` (call `closeRequestsForAdopter` for both ids after a successful merge, best-effort + logged)
- Modify: `scripts/check-action-surface.mjs` (157 → 159)
- Test: `src/lib/mergeRequests.test.ts`, extend `src/app/actions/keepNewAndMetrics.access.test.ts` or a new `src/app/actions/mergePendingDedupPair.request.test.ts`

**Interfaces:**
- Consumes: Task 6; `mergeAdopters` (`src/lib/adopterMerge.ts`); `isOwnerOrOrgMate`, `getOrgMemberEmailsFor` (`src/lib/orgMembership.ts`); `isAdminAsync`; `createNotification`, `notifyAdmins`, `resolveDisplayName` (`src/app/actions/notifications.ts`).
- Produces:
  - `mergePendingDedupPair(candidateId)` now returns `{ success: true; outcome: 'merged' | 'requested' } | { success: false; error: string; errorId?: string }`. `merge` → `mergeAdopters`, then if `notifyOwner`, `createNotification({ type: 'adopter_merged', userId: notifyOwner, title: 'Se unieron dos perfiles: {secundario} → {principal}', body: '{requester} combinó su perfil con el tuyo porque son la misma persona. Todo quedó en tu perfil.', url: '/adopter/{primaryId}', icon: '🔗' })`. `request` → `createMergeRequest`.
  - `createMergeRequest(db, input: { primaryId; secondaryId; candidateId: string | null; flagId: string | null; requesterEmail; ownerEmail: string | null }): Promise<{ id: string; created: boolean }>`: returns the existing open request for the same pair instead of a second one. Notifies, type `merge_request`, url `/my-adopters`: owner + teammates (`getOrgMemberEmailsFor(ownerEmail)`, minus the requester), title "{requester} pidió combinar dos perfiles", body names both profiles. With `ownerEmail: null` → `notifyAdmins` instead (D15).
  - `answerMergeRequest(db, requestId, actor, decision: 'accept' | 'decline' | 'cancel'): Promise<{ ok: true; status: MergeRequestStatus } | { ok: false; reason: 'not_found' | 'not_allowed' | 'not_open' | 'profiles_changed' | 'merge_failed' }>`:
    - load the row; if either profile is deleted, set `closed` and return `profiles_changed` (Review Focus 2);
    - `decideMergeRequestAnswer`; compare-and-set `UPDATE merge_requests SET status=?, resolved_by_email=?, resolved_at=? WHERE id=? AND status=?` and require 1 row affected, else `not_open` (Review Focus 1);
    - when it merges, run `mergeAdopters(primaryId, secondaryId, actor)`. On failure, put the status back with a second compare-and-set and return `merge_failed`;
    - decline/admin_decline: candidate → `status='dismissed', resolved_by=actor`; flag → `details = KEPT_SEPARATE_FLAG_DETAILS_PREFIX + actor` (D4b);
    - notify the requester (type `merge_request_resolved`), and the owner too when an admin decided; never the actor.
  - `closeRequestsForAdopter(db, adopterId)`: sets open requests naming that id to `closed`. Called at the end of `mergeAdopters`, for both ids, so any merge closes stale requests.
  - `listMergeRequestsForAdmin(db): Promise<MergeRequestAdminRow[]>`: `pending` and `declined`, pending first, oldest first; row = `{ id, status, createdAt, primary: { id, name }, secondary: { id, name }, requesterEmail, ownerEmail }`.
  - Actions in `src/app/actions/mergeRequests.ts`: `resolveMergeRequest(requestId: string, decision: 'accept' | 'decline'): Promise<{ success: boolean; error?: string; errorId?: string }>`, `cancelMergeRequest(requestId: string)`: same result shape. Each gets the session, calls `answerMergeRequest`, logs refusals at warn with `{ requestId, actor, reason }`.

- [ ] **Step 1: Write the failing tests**: detected pair, mine older → `outcome:'requested'`, one row, notifications to owner and a teammate, none to the requester; asking twice → still one row; owner accepts → merged (secondary has `token_hash='MERGED'`), requester notified; owner declines → candidate `dismissed`, requester notified; admin approves after decline → merged; concurrent accept + admin approve (run both, `Promise.all`) → `mergeAdopters` called once, one call gets `not_open`; secondary merged elsewhere before accept → `profiles_changed`, status `closed`, no merge; `mergeAdopters` fails → status back to `pending`; anonymous owner → `ownerEmail` null, admins notified; mine newer + theirs older → `outcome:'merged'` + `adopter_merged` sent to the other owner; cross-rescuer flag → request, decline annotates the flag and it disappears from `isOpenDuplicateFlag`.
- [ ] **Step 2: Run** `npx vitest run src/lib/mergeRequests.test.ts src/app/actions/mergePendingDedupPair.request.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; raise the ratchet.
- [ ] **Step 4: Run** `npx vitest run src/lib src/app/actions src/domain` + `npx tsc --noEmit`. Expected: PASS (existing `mergePendingDedupPair.test.ts` updated only for the new success shape).
- [ ] **Step 5: Commit.**

### Task 8: Feed carries owners and request state

**Files:**
- Modify: `src/app/actions/duplicates.ts` (`PendingDedupPair` ~l.403, `buildPairSide` ~l.351, `getPendingDuplicatesForUser` ~l.518)
- Test: `src/app/actions/pendingDedupFeed.test.ts`

**Interfaces:**
- Consumes: Task 7 (`merge_requests` rows).
- Produces (additions to `PendingDedupPair`):
  - on each side: `createdByName: string | null`, set only when the side's creator is not the viewer (display name, else `emailHandle`; `'anonymous'`/null → `null` plus `createdByAnonymous: true`).
  - `request: null | { id: string; direction: 'sent' | 'received'; createdAt: number /*epoch s*/; counterpartName: string | null; toAdmins: boolean }`.
  - Pairs where the viewer is on the asked owner's team appear even if the viewer created neither side (D16): add open requests whose `owner_email` is the viewer or a teammate (`getTeamEmails(viewer)`, one query per email, D1-safe) to the candidate list before ranking. Pairs with an open request sort first.
  - A pair whose request was declined no longer appears (Task 7 dismisses it).

- [ ] **Step 1: Write the failing tests**: viewer is OWNER, other side by STRANGER → that side has `createdByName` = STRANGER's handle, own side null; open request by OWNER → `request.direction === 'sent'`, counterpart = STRANGER's name; MATE (OWNER's teammate) sees a request addressed to OWNER with `direction: 'received'` even though MATE created neither profile; anonymous other side → `createdByAnonymous: true`, `request.toAdmins: true` after requesting.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/pendingDedupFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus the existing duplicates tests. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: "Pendientes de revisar" card

**Files:**
- Modify: `src/components/PendingDedup.tsx` (`AdopterCard` ~l.111, `handleMerge` ~l.204, buttons ~l.326-346)
- Modify: `src/i18n/locales/{es,en,pt}.ts` (`myAdopters.pending_dedup_*`)

**Interfaces:**
- Consumes: Task 7 actions (`mergePendingDedupPair` new result, `resolveMergeRequest`, `cancelMergeRequest`), Task 8 fields.

Behavior (spec "Who sees what"):
- Side card: "Cargado por {name}" when `createdByName`; "Cargado por un usuario anónimo" when `createdByAnonymous`.
- No request: "Combinar perfiles" (all cases). `outcome:'merged'` → current success toast; `outcome:'requested'` → toast "Pedido enviado a {name}" (or "Pedido enviado a un administrador") and reload.
- `request.direction === 'sent'`: line "Pedido enviado {hace N días} · esperando a {name}" (or "a un administrador") and a "Cancelar pedido" button instead of Combinar.
- `request.direction === 'received'`: line "{name} pidió combinar estos perfiles · {hace N días}" and "Aceptar" (primary) / "Rechazar" buttons.
- "Mantener separados" unchanged. Relative time uses the app's existing relative-date helper (find it in `src/lib/dates.ts`; don't add a new one).
- Remove the now-unreachable `errors.merge_other_owner` / `merge_flag_cross_owner` toast mapping (keep the i18n keys: grep `tests/` first).

- [ ] **Step 1: Implement** and add the i18n keys in all three locales.
- [ ] **Step 2: Run** `npx tsc --noEmit`, `npm run lint`, and the class audit (every color class on touched lines has a `[data-theme="dark"]` rule in `globals.css`). Expected: clean.
- [ ] **Step 3: Verify in the browser** (Task 11 covers it end to end).
- [ ] **Step 4: Commit.**

### Task 10: Admin "Pedidos de combinación"

**Files:**
- Create: `src/app/admin/merge-requests/page.tsx` (server, edge; admin-only like `/api/admin/duplicates/*`)
- Create: `src/components/admin/MergeRequestsPanel.tsx` (client)
- Modify: `src/components/AdminSidebar.tsx` (~l.25, section `nav_sect_requests`): `{ href: '/admin/merge-requests', labelKey: 'nav_merge_requests', icon: '🔗', minRole: 'admin', countKey: 'mergeRequests' }`
- Modify: `src/lib/adminCounts.ts` (`mergeRequests` = pending count)
- Modify: `src/i18n/locales/{es,en,pt}.ts` (`admin.nav_merge_requests` = "Pedidos de combinación")

**Interfaces:**
- Consumes: `listMergeRequestsForAdmin` (Task 7), `resolveMergeRequest` (Task 7).

Rows: both names linking to `/adopter/{id}`, requester and owner full emails ("sin dueño" when null), status, "Pedido el {fecha} · hace {N días}" (D6), Aprobar / Rechazar for pending, "Aprobar igual" for declined. Resolved rows leave the list with a toast. Modeled on `PiiAccessRequestPanel`.

- [ ] **Step 1: Write the failing test** for `getAdminCounts()` including `mergeRequests` (count of `pending` only).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the page, panel, sidebar entry and count.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: End-to-end + release checks

**Files:**
- Create: `tests/merge-requests.authed.spec.ts` (fixtures `test-mergereq-fixture-*`, own `execD1`/`parseD1Rows` like `tests/merge-undo.authed.spec.ts:30-45`)

- [ ] **Step 1: Write the spec**, admin session as requester:
  - seed A (admin's, older) and B (`added_by='testuser@example.com'`, newer) plus a pending candidate; open `/my-adopters`, expand "Pendientes de revisar"; B's card shows "Cargado por"; click Combinar → "Pedido enviado"; DB has one `pending` `merge_requests` row and a `merge_request` notification for testuser;
  - "Cancelar pedido" → row `cancelled`, button back;
  - request again, then approve from `/admin/merge-requests` → B has `token_hash='MERGED'`, `/adopter/B` redirects to A;
  - `/settings` shows "Avisos por email" with the requests row reading "Siempre activo" and no API row (admin fixture has no key).
  - Locale-agnostic selectors (Chromium renders English): use `data-testid`s added in Tasks 3, 9, 10.
- [ ] **Step 2: Run** locally: `npx playwright test tests/merge-requests.authed.spec.ts --config=playwright.local.config.ts --project=authed --workers=1 --no-deps` (Node 20, own port, DBs recovered first). Expected: PASS.
- [ ] **Step 3: Full checks**: `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (≤125), `npm run build` then `node scripts/check-action-surface.mjs` (159). Expected: all pass.
- [ ] **Step 4: Restore** `local.db` and the `.wrangler` sqlite (`git checkout --`), commit the spec.
