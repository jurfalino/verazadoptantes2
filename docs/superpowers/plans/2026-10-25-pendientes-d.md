# «Pendientes de revisar» v2 (layout D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild «Pendientes de revisar» as layout D (inbox rows + «Qué coincide y qué no»), let rescuers choose which profile stays, keep declined pairs with «Escribirle», ask «¿Es la misma persona?» for different names, keep access after a fold, send notifications in each person's language, and carry the audit fixes.

**Architecture:** Who-may-do-what stays pure in `src/domain/` (`dedupPair.ts`, `matchBreakdown.ts`, new `notificationTemplates.ts`). Server actions stay thin over `src/lib/mergeRequests.ts` and `src/app/actions/duplicates.ts`. Notifications store a template key + params in `metadata`; the bell and emails render them in the viewer's/recipient's locale, falling back to the stored Spanish title/body. The UI reuses `MatchCompare` (bare) inside each opened row.

**Tech Stack:** Next.js 15 App Router (edge pages), Drizzle + Cloudflare D1, Resend HTTP API, Tailwind v4 with `[data-theme]` remaps, Vitest + `migratedDb`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-pendientes-d-design.md` (D21–D43), building on `docs/superpowers/specs/2026-10-25-merge-requests-design.md` (D1–D20). Prototype for layout D: branch `prototype/pendientes-cards`, `src/components/prototype/PendingDedupPrototype.tsx` (`VariantC` with `compare`, `CExpanded`, `DHead`, `DCompare`, `rowLine`, `pairAction`, `ConfirmDialog`, `WriteBox`) — reference only; never import it.

## Global Constraints

- Layer rules: decisions in `src/domain/` (no DB/server imports); server actions fetch then call domain; `src/lib/` holds infrastructure. Never make lib helpers `'use server'`.
- D1: never `inArray()` / `IN (array)`; fan out with `Promise.all`.
- Every catch logs with context (`adopterId`, `requestId`, `actor`); user-facing errors carry an errorId; never `.catch(() => [])` silently.
- Non-admins see names / `emailHandle()` only, never an email. Admin pages show full emails.
- New UI strings in **es, en and pt**; client uses `t('key') || 'fallback'`.
- Only colour classes with `[data-theme="dark"]` rules in `src/app/globals.css` (or CSS variables); works at 390px with no horizontal scroll; tap targets ≥ 44px.
- «Qué coincide y qué no» decisions stay binding: two blocks, label+icon per value (no value highlight), admin-only gauge (`AdminScore`, `MatchCompare.tsx:245`), «También: Marcado manualmente», masking with lock + lock note.
- Every merge goes through `mergeAdopters` (audit row, undo, redirect, `closeRequestsForAdopter` on the absorbed id).
- Side effects (email) only via `runAfterResponse`.
- Migration `drizzle/0093_pendientes_d.sql`, hand-written, no journal entry.
- New wired server actions raise `EXPECTED_ACTIONS` in `scripts/check-action-surface.mjs` (159 → **162**: `sendPairMessage`, `hidePendingPair`, `saveMyLocale`) in the commit that adds them, with a log line.
- Never `git add -A`/`-u`; tracked `local.db` / `.wrangler/**.sqlite` are e2e seeds.

## Review Focus

1. **The server never trusts the client's choice of survivor or label.** A crafted `keepId` (not in the pair, or keeping the other's profile where that absorbs it) must be re-decided by `decideDedupAction`; a request comes out where consent is needed. Test in Task 3.
2. **Two people act on one request at once** (owner flips while requester cancels or admin approves): merges at most once; compare-and-set on status. Test in Task 3.
3. **Unknown / missing locale or template**: the bell and the email fall back to the stored Spanish title/body, never a raw key or an empty subject. Test in Task 6.
4. **«Escribirle» privacy**: the sender never receives the recipient's email in any response, notification or log; reply-to is the sender; recipients without an account are skipped. Test in Task 4.
5. **Declined pairs**: the requester cannot re-ask the same owner; «Quitar de la lista» hides only for that viewer; the decliner accepting later re-checks both profiles are live. Test in Tasks 3 and 5.

---

### Task 1: Domain rules v2 (pure)

**Files:**
- Modify: `src/domain/dedupPair.ts`
- Modify: `src/domain/matchBreakdown.ts`
- Create: `src/domain/identityChoice.ts`
- Test: `src/domain/dedupPair.test.ts`, `src/domain/matchBreakdown.test.ts`, `src/domain/identityChoice.test.ts`

**Interfaces:**
- Produces:
  - `decideDedupAction(actor, a: DedupSide, b: DedupSide, source: 'detected'|'flag', keepId?: string): DedupAction` — `keepId` defaults to the older side (today's behaviour). Rules (D24, D41, D42): both team-owned → `merge` with chosen survivor, `notifyOwner: null`; keeping the **other rescuer's** side (viewer's side absorbed) → `merge`, `notifyOwner` = other's real owner (flag or detected alike, D41); keeping the **viewer's** side while the other is another rescuer's → `request` (`ownerEmail` = other's real owner); other side has no real owner (`realOwner` null) → keeping it is not allowed (`refuse`, reason `'keep_not_allowed'`), keeping yours → `request` with `ownerEmail: null` (admins, D15/D42). `keepId` not in the pair → `refuse` `'not_found'`. Add `'keep_not_allowed'` to `DedupRefusal`.
  - `keepOptions(actor, a, b): { a: boolean; b: boolean }` — which sides the viewer may choose to keep (D42).
  - `decideMergeRequestAnswer(input & { decision: 'accept'|'decline'|'cancel'|'flip' })`: add `flip` (owner team or admin, from `pending` → `accepted` with `merges: true, swap: true`); from `declined` the owner team may now `accept` → `accepted` (D43); requester cancel unchanged. Return type gains `swap?: boolean`.
  - `canRequestAgain(previous: Array<{ requesterEmail: string; status: MergeRequestStatus }>, requester: string): boolean` — false when the same requester has a `declined` request for this pair (D43).
  - `summarizeBreakdown(rows: BreakdownRow[]): { same: BreakdownField[]; diff: BreakdownField[] }` in `matchBreakdown.ts` — the data behind «Coinciden: … · Distinto: …» (extracted from `MatchCompare.tsx:100-120`; `MatchCompare` uses it).
  - `needsIdentityChoice(input: { matchTypes: string[]; nameA: string; nameB: string }): boolean` in `identityChoice.ts` — true when not matched on name and `aliasForMerge(nameA, nameB)` is non-null (same test as `ImportWizard.tsx:1229`; `ImportWizard` switches to it).

- [ ] **Step 1: Write failing tests**: keeping other's profile (detected) → `merge` + notifyOwner = other; keeping mine vs other rescuer's → `request`; flag + keep other's → `merge` (D41); anonymous other + keep it → `refuse 'keep_not_allowed'`, keep mine → `request ownerEmail null`; same team, keep newer → `merge` survivor = newer; `keepId` foreign → `not_found`; `keepOptions` anonymous → `{mine:true, anon:false}`; `flip` by owner team from pending → `accepted, swap:true`; requester `flip` → `not_allowed`; owner `accept` from `declined` → `accepted`; `canRequestAgain` false after own decline, true after someone else's; `summarizeBreakdown` on mixed rows; `needsIdentityChoice` true for «Ana Pérez»/«Lucía Pérez» matched on phone, false when matched on `name_full`. Existing tests keep passing (default `keepId` = older).
- [ ] **Step 2: Run** `npx vitest run src/domain`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**; switch `MatchCompare` and `ImportWizard` to the extracted helpers without behaviour change.
- [ ] **Step 4: Run** `npx vitest run src/domain src/components` + `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 2: Schema, locale persistence, staging label

**Files:**
- Create: `drizzle/0093_pendientes_d.sql`
- Modify: `src/db/schema.ts` (`userProfiles.locale` text null; new table `pendingPairHidden`)
- Modify: `src/context/LanguageContext.tsx` (`setLocale` also calls `saveMyLocale`; on sign-in, push the stored locale once)
- Modify: `src/app/actions/settings.ts` (add `saveMyLocale`)
- Modify: `src/lib/email.ts` (`buildNotificationEmail` gains `locale` and `staging` options; chrome strings in es/en/pt; staging banner + «[Staging]» subject prefix, D37)
- Modify: `src/lib/emailConfig.ts` (`isStagingEnvironment(): boolean` = `APP_ENVIRONMENT !== 'production'`)
- Modify: `scripts/check-action-surface.mjs` (159 → 160)
- Test: `src/app/actions/locale.test.ts`, `src/lib/email.test.ts` (extend or create)

**Interfaces:**
- Produces:
  - `user_profiles.locale` ('es'|'en'|'pt'|null); `pending_pair_hidden(viewer_email TEXT, pair_key TEXT, created_at INTEGER, PRIMARY KEY(viewer_email, pair_key))`; Drizzle `pendingPairHidden`.
  - `saveMyLocale(locale: 'es'|'en'|'pt'): Promise<{ success: boolean; errorId?: string }>`; `getLocaleForEmail(db, email): Promise<'es'|'en'|'pt'>` in `src/lib/emailPrefs.ts` (null/unknown → 'es').
  - `pairKey(aId: string, bId: string): string` (sorted, `a|b`) in `src/domain/dedupPair.ts`.
  - `buildNotificationEmail(n, links, opts: { locale: EmailLocale; staging: boolean })`.

- [ ] **Step 1: Failing tests**: `saveMyLocale('pt')` then `getLocaleForEmail` → 'pt'; unknown value refused; no profile row → 'es'; staging email subject starts «[Staging]» and html contains the banner; production has neither; en chrome reads «View on BuenAdoptante».
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**; ratchet 160 with log line.
- [ ] **Step 4: Run** tests + `npx tsc --noEmit` + `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Merge, request and answer on the server (chosen survivor, flip, decline rules, identity, access)

**Files:**
- Modify: `src/app/actions/duplicates.ts` (`mergePendingDedupPair`)
- Modify: `src/lib/mergeRequests.ts` (`createMergeRequest`, `answerMergeRequest`, `keepSeparate`, notifications)
- Modify: `src/app/actions/mergeRequests.ts` (`resolveMergeRequest` accepts `'flip'`)
- Create: `src/lib/mergeAccess.ts`
- Modify: `src/lib/householdMembers.ts` (`HouseholdMember.profileId?: string`, preserved by (de)serialize and merge helpers)
- Test: `src/app/actions/mergePendingDedupPair.v2.test.ts`, `src/lib/mergeRequests.test.ts` (extend), `src/lib/mergeAccess.test.ts`

**Interfaces:**
- Consumes: Task 1 (`decideDedupAction(..., keepId)`, `decideMergeRequestAnswer` with `flip`, `canRequestAgain`, `needsIdentityChoice`), Task 2 (`pairKey`).
- Produces:
  - `mergePendingDedupPair(candidateId: string, opts?: { keepId?: string; identity?: 'same'|'household' })` → existing union plus `{ success: true; outcome: 'household' }` and errors `'identity_required'` (names differ, `needsIdentityChoice`, no `identity` given), `'keep_not_allowed'`, `'declined_before'` (D43). `identity: 'household'` → no merge: add the other person (name only, `relationship: 'unknown'`, `profileId` = other id) to each side the viewer can edit (own/team; reuse the `addHouseholdMember` internals — not another rescuer's profile), then resolve the pair as kept-separate; `outcome: 'household'`.
  - `grantAccessAfterFold(db, input: { survivorId: string; absorbedOwnerEmail: string | null; actor: string }): Promise<number>` in `mergeAccess.ts` — when the absorbed profile's owner differs from the survivor's owner, insert `pii_access_grants` rows `scope 'all_contact'`, `origin 'merge'` on the survivor for that owner and each `getTeamEmails(owner)` email (D40); best-effort + logged. Called after every successful merge in `mergePendingDedupPair` and `answerMergeRequest`.
  - `createMergeRequest` stores the chosen survivor/absorbed as `primaryId`/`secondaryId`; refuses with `'declined_before'` when `canRequestAgain` is false.
  - `answerMergeRequest(db, requestId, actor, decision: 'accept'|'decline'|'cancel'|'flip')` — `flip` merges with survivor and absorbed swapped; from `declined`, owner-team `accept` merges (D43); notifications: requester notified when the owner flips or accepts; owner notified when a teammate answers (D26). Keep compare-and-set + restore-on-failure.
  - Notification texts here switch to template keys from Task 6 only in Task 6; until then keep current Spanish strings but use the word «rechazó» (D30) and drop «Un administrador todavía puede revisarlo» (`mergeRequests.ts:292`); decline url → `/my-adopters#pendientes`.

- [ ] **Step 1: Failing tests** (migratedDb, real `mergeAdopters`):
  - keep other's profile → merged, survivor = other, `adopter_merged` to other owner, access grant for the viewer (and teammate);
  - keep mine vs foreign → request with my survivor stored; owner `flip` → survivor = owner's profile, requester gets access grant + notice;
  - crafted `keepId` (foreign profile id not in pair) → `not_found`; keep anonymous side → `keep_not_allowed`;
  - names differ + phone match, no identity → `identity_required`; `household` → no merge, member with `profileId` added on my profile only, pair resolved, other rescuer's profile untouched;
  - decline → requester asks again → `declined_before`; owner later `accept` from declined → merged;
  - flip and admin approve concurrently → one merge (`Promise.all`), other `not_open`.
- [ ] **Step 2: Run** `npx vitest run src/lib src/app/actions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: «Escribirle» (relay message with reply-to)

**Files:**
- Modify: `src/lib/email.ts` (`SendEmailOptions.replyTo?: string` → Resend `reply_to`)
- Modify: `src/lib/notificationEmail.ts` (`replyTo` from the notification's `metadata.replyTo` for type `pair_message` only)
- Modify: `src/domain/emailCategories.ts` (`pair_message` → `merges`)
- Create: `src/app/actions/pairMessages.ts` (`'use server'`)
- Modify: `scripts/check-action-surface.mjs` (160 → 161)
- Test: `src/app/actions/pairMessages.test.ts`, `src/lib/notificationEmail.test.ts` (extend)

**Interfaces:**
- Produces: `sendPairMessage(requestId: string, text: string): Promise<{ success: boolean; error?: string; errorId?: string }>` — allowed only when the request is `declined` or `pending` and the actor is the requester or on the owner team (D28); recipients = the other side (owner + teammates, or the requester); text trimmed, 1–1000 chars; notification type `pair_message`, title «{sender} te escribió sobre «{name}»», body = text, url `/my-adopters#pendientes`, `metadata: { requestId, replyTo: senderEmail, fromName }`. Never returns recipient emails. No rate limit (Jon).

- [ ] **Step 1: Failing tests**: requester on a declined request → recipients notified, none is the sender, response contains no '@'; stranger → refused; plain possible duplicate (no request) → refused; email sent with `reply_to` = sender (mock `sendEmailViaResend`, assert payload); recipient without a `user` row skipped.
- [ ] **Step 2–4:** run → implement → run (+ tsc, lint). Ratchet 161 with log line.
- [ ] **Step 5: Commit.**

### Task 5: Feed v2 for layout D

**Files:**
- Modify: `src/app/actions/duplicates.ts` (`PendingDedupPair`, `getPendingDuplicatesForUser`, new action `hidePendingPair`)
- Modify: `scripts/check-action-surface.mjs` (161 → 162)
- Test: `src/app/actions/pendingDedupFeed.test.ts` (extend)

**Interfaces:**
- Produces (additions to `PendingDedupPair`):
  - `group: 'received'|'sent'|'declined'|'pair'` (ordering D21: received → sent → declined → pair; stable within group by detection/request time).
  - `summary: { same: BreakdownField[]; diff: BreakdownField[]; flagged: boolean }` (server-computed with `matchBreakdown` + `summarizeBreakdown` from what the viewer may see; flagged pairs set `flagged`).
  - `adminScore: number | null` — only for admins (`isAdminAsync`), and `null` for flagged pairs and pairs rebuilt from a request (D34); `confidencePercent` is no longer sent to non-admins.
  - per side `isMine: boolean`; pair `keepOptions: { new: boolean; existing: boolean }`; `identityChoice: boolean`.
  - `request` gains `status: 'pending'|'declined'` and `canMessage: boolean`; declined requests appear for both sides (D27) until hidden.
  - `hidePendingPair(pairKey: string): Promise<{ success: boolean; errorId?: string }>` — writes `pending_pair_hidden` for the viewer only; the feed skips hidden keys (D27 «Quitar de la lista»).
- Keep: paging (10), `lowHidden`, team visibility, liveness checks, bounded fan-out.

- [ ] **Step 1: Failing tests**: groups and order with one of each kind; non-admin pair has no `confidencePercent`/`adminScore`, admin has `adminScore`; flagged → `adminScore null`, `summary.flagged true`; declined request shows for requester and owner with `status 'declined'`; `hidePendingPair` hides for that viewer only; anonymous other side → `keepOptions` only mine; different names + phone match → `identityChoice true`.
- [ ] **Step 2–4:** run → implement → run (+ tsc). Ratchet 162 with log line.
- [ ] **Step 5: Commit.**

### Task 6: Notifications in the reader's language

**Files:**
- Create: `src/domain/notificationTemplates.ts` (+ test)
- Modify: `src/app/actions/notifications.ts` (`createNotification` accepts `template?: { key: NotificationTemplateKey; params: Record<string, string> }` → stored in `metadata.template`; title/body still stored as the Spanish render)
- Modify: every call site listed below to pass a template
- Modify: `src/lib/notificationEmail.ts` (render subject/body from the template in `getLocaleForEmail(recipient)`; fall back to stored title/body)
- Modify: `src/components/NotificationBell.tsx:369-372`, `src/app/notificaciones/page.tsx:444-465` (render from the template in the current locale; fall back to stored title/body)

**Interfaces:**
- Produces: `renderNotification(template: { key; params }, locale: 'es'|'en'|'pt'): { title: string; body: string } | null` (null for unknown key → caller falls back). One key per call site's message: `member_joined`, `contact_entry_added`, `ownership_transferred`, `pii_access_approved`, `pii_access_denied`, `pii_access_revoked`, `deletion_request`, `adopter_flagged`, `contract_attached`, `adopter_merged_by_rescuer`, `adopter_merged_by_admin`, `form_attached`, `form_submission_owner`, `form_submission_teammate`, `contract_result_*` (one per variant at `api/contract/[id]/submit/route.ts:346,372,395`), `api_access`, `api_record`, `api_access_requested`, `merge_request`, `merge_request_accepted`, `merge_request_flipped`, `merge_request_declined`, `merge_request_answered_by_teammate`, `pair_message`. Spanish templates must reproduce today's strings (except D30 wording); en/pt are translations. Same-name pairs (D31): merge templates include each profile's owner and date («Julieta Paz (de María, 22 oct 2026)»).
- Call sites (from recon): `organizations.ts:359`, `addContactEntry.ts:270`, `admin.ts:810`, `piiAccess.ts:146,197`, `adopters.ts:801`, `flags.ts:54`, `duplicates.ts:135,667`, `formSubmission.ts:420`, `api/form/[userId]/submit/route.ts:314,338,376`, `api/contract/[id]/submit/route.ts:346,372,395`, `api/admin/api-people/[email]/route.ts:62`, `lib/mergeRequests.ts` (all), `lib/adopterMerge.ts:691`, `lib/piiAccessRequest.ts:116`, `lib/api/records.ts:197-198`, `lib/api/accessNotify.ts:12`, `pairMessages.ts`.

- [ ] **Step 1: Failing tests**: every key renders non-empty title/body in es/en/pt; es output equals the current string for 3 sample sites; unknown key → null; `sendNotificationEmail` for a pt recipient sends the pt subject; a notification without template still emails its stored Spanish text; bell component test (or unit on its formatter) renders en when locale en.
- [ ] **Step 2–4:** run → implement → run (`npx vitest run`, tsc, lint).
- [ ] **Step 5: Commit** (may be 2 commits: templates+renderer, then call sites).

### Task 7: «Pendientes de revisar» UI (layout D)

**Files:**
- Modify: `src/components/PendingDedup.tsx` (rebuild as layout D; keep `SECTION_ID = 'pendientes'`, auto-open, paging)
- Create: `src/components/pendientes/PairRow.tsx`, `src/components/pendientes/ConfirmCombine.tsx`, `src/components/pendientes/IdentityChoice.tsx`, `src/components/pendientes/WriteMessage.tsx`
- Modify: `src/components/MatchCompare.tsx` (block head slot already exists; no prototype `has` option)
- Modify: `src/i18n/locales/{es,en,pt}.ts` (`myAdopters.pending_d_*`)

**Interfaces:**
- Consumes: Task 5 feed fields; Task 3 `mergePendingDedupPair(candidateId, { keepId, identity })`, `resolveMergeRequest(id, 'accept'|'decline'|'flip')`, `cancelMergeRequest`; Task 4 `sendPairMessage`; Task 5 `hidePendingPair`.

Behaviour (spec D21–D33, D35, D40, D43; prototype `VariantC` + `compare` is the visual reference):
- One card; group headers «Necesitan tu respuesta · n», «Enviados · n», «Rechazados · n», «Posibles duplicados · n». Rows ≥ 64px: state icon, names («A ×2» when equal, «A / B» otherwise), state line, summary line «Coinciden: … · Distinto: …» (or «Marcado manualmente»); admins see `AdminScore` on the row when `adminScore` is set. Needs-your-answer rows use the warning tone and a «Responder» pill (desktop); sent rows grey; declined rows error tone.
- One row open at a time; the first received row opens on load. Open row: header keeps the state line, no names (D23). Possible duplicates: «¿Cuál se conserva?» radiogroup from `keepOptions` (default older). Then `<MatchCompare bare …>` with heads showing «Se conserva» / «Se suma al otro», «Ver perfil ↗» (new tab), «Tuyo» / «Cargado por X», source, date, «Pedir acceso a quien lo cargó» when `!canSeeContact`; kept block outlined teal. Then the explanation line, then buttons:
  - received: Rechazar · «Conservar el mío» (flip) · Aceptar
  - sent: Cancelar pedido · Escribirle (when `canMessage`)
  - declined: Quitar de la lista · Escribirle; requester side also «Combinar conservando el de X» (no consent needed); decliner side «Aceptar ahora»
  - possible duplicates: Mantener separados · «Combinar perfiles» / «Pedir combinar» from the chosen survivor
- `ConfirmCombine` whenever the viewer's adopter moves to another rescuer's list: «Este adoptante pasará a la lista de {X}. Se conserva {perfil}. Vas a seguir viendo sus datos.» Combinar / Cancelar (D25, D40).
- `IdentityChoice` before combining when `identityChoice`: «¿Es la misma persona?» → «Sí, la misma persona» / «No, es alguien de su hogar» (D35).
- `WriteMessage`: textarea + warning «{X} verá tu email para responderte» (D28).
- Secondary buttons outlined, ≥ 44px, theme-safe (D29); all wording «Rechazado / rechazó» (D30).
- Testids kept: `dedup-created-by`, `dedup-request-status`, `dedup-merge`, `dedup-cancel-request`, `dedup-accept-request`, `dedup-decline-request`, `pending-dedup-list`; new: `dedup-row`, `dedup-keep-<new|existing>`, `dedup-flip`, `dedup-write`, `dedup-hide`, `dedup-confirm`, `dedup-identity-same`, `dedup-identity-household`.

- [ ] **Step 1: Implement** with i18n keys in es/en/pt.
- [ ] **Step 2: Run** `npx tsc --noEmit`, `npm run lint`, the colour-class audit on touched files, and existing tests referencing the section (`tests/pending-dedup-merge.spec.ts`, `tests/merge-requests.authed.spec.ts` — update selectors to the new testids).
- [ ] **Step 3: Commit.**

### Task 8: Admin list, profile note, anchors, form failure, household link

**Files:**
- Modify: `src/lib/mergeRequests.ts` (`MergeRequestAdminRow` sides gain `ownerEmail`, `createdAt`) and `src/components/admin/MergeRequestsPanel.tsx` (each side: owner, date, «se conserva» / «se absorbe»; «Rechazado por el dueño» → «Rechazado»; D30–D31)
- Modify: `src/app/adopter/[id]/page.tsx` (redirect adds `merged=<oldId>`) + `src/components/AdopterProfileV2.tsx` (note «Este perfil se combinó con otro» when `merged` is present, D32)
- Modify: `src/app/my-adopters/page.tsx:536,649` and `src/components/AdopterProfileV2.tsx:374` (`#pending-dedup` → `#pendientes`, D34)
- Modify: `src/components/AdopterForm.tsx:512-513` (failure → `reportClientError` with errorId + inline «No pudimos buscar duplicados ahora · Reintentar», D36)
- Modify: `src/components/HouseholdSection.tsx:285` (name links to `/adopter/{profileId}` when set, D35)
- Test: extend `src/app/adopter` redirect e2e in `tests/merge-undo.authed.spec.ts` (assert `merged=` param + note), `src/lib/mergeRequests.test.ts` (admin row fields)

- [ ] **Step 1: Failing tests** for the admin row fields and the redirect param.
- [ ] **Step 2–4:** run → implement → run (+ tsc, lint, colour audit).
- [ ] **Step 5: Commit.**

### Task 9: End-to-end + release checks

**Files:**
- Modify: `tests/merge-requests.authed.spec.ts` (layout D flows)
- Create: `tests/pendientes-d.authed.spec.ts` if the above grows too large

- [ ] **Step 1: E2E** (admin session, fixtures `test-pendd-fixture-*`, own `execD1`): a possible duplicate where the admin keeps the other rescuer's profile → confirm dialog → merged + access grant row; keep mine → «Pedir combinar» → request row with chosen survivor; decline as owner (DB-driven) → row «Rechazado» for requester → «Escribirle» sends (notification row with `reply` metadata) → «Quitar de la lista» hides it; identity choice on different names → «alguien de su hogar» → household member with `profileId`; `/my-adopters#pendientes` opens the section; old link of an absorbed profile shows the merged note. Locale-agnostic selectors (testids).
- [ ] **Step 2: Run locally** (Node 20, port 3101, repaired seeds, `playwright.local.config.ts` untracked) together with `tests/merge-undo.authed.spec.ts`, `tests/pending-dedup-merge.spec.ts`, `tests/form-results-*.authed.spec.ts`. Expected: PASS.
- [ ] **Step 3: Full checks**: `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (≤125), `npm run build` + `node scripts/check-action-surface.mjs` (162).
- [ ] **Step 4:** restore seeds, commit.
