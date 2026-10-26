# One Shared Reality (2.57.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-user overrides with shared, attributed corrections and admin-resolved disputes (D48–D50), make household links follow merges (D51), confirm merges in place (D52), and stop local runs from emailing (D53) — on top of the linked-convivientes work (D44–D46) already on `feature/household-links`.

**Architecture:** Disputes reuse existing pieces: pre-merge disputes are `merge_requests` routed to admins (ownerEmail null) with a `dispute` marker; post-merge disputes are a new `merge_disputes` table resolved in the admin «Pedidos de combinación» page via the existing `unmergeAdopters`. Household corrections edit the host's household through the existing household write path, with `adopter_history` rows on both profiles. Rules stay pure in `src/domain/`.

**Tech Stack:** Next.js 15 (edge pages), Drizzle + D1, Resend, Vitest + migratedDb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-pendientes-d-design.md` — addendums D44–D47 (D47 withdrawn) and D48–D53.

## Global Constraints

- One shared reality: no feature may let two users see two different versions of a fact; privacy masking and personal workflow excepted.
- Layer rules (domain pure; thin `'use server'` actions; lib infrastructure); D1: no `IN (array)`; every catch logs context; user-facing errors carry an errorId; names/handles never emails for non-admins; es/en/pt for every string; theme-safe classes; ≥44px targets; 390px.
- Every merge/undo through `mergeAdopters` / `unmergeAdopters`.
- Migration `drizzle/0095_merge_disputes.sql` (hand-written, no journal). New wired actions raise `EXPECTED_ACTIONS` (163 → measured) with a log line.
- Never `git add -A`/`-u`; tracked seed DBs never committed modified.

## Review Focus

1. **A rejected pair can't be merged by one side** through any path (feed button, crafted call, admin excepted). Test in Task 1.
2. **Dispute resolution undoes exactly the disputed merge** (by audit id) and notifies both sides; resolving twice is a no-op. Test in Task 1.
3. **«No convive» edits the host's household even when it's another rescuer's profile** — only the specific linked member, with history on both profiles; nothing else on the host changes. Test in Task 2.
4. **Links survive merges both ways** (host merged, linked merged, undo). Test in Task 2.
5. **No email leaves a local run** unless explicitly allowed. Test in Task 4.

---

### Task 1: Disputes (D49, D50)

**Files:** `drizzle/0095_merge_disputes.sql`, `src/db/schema.ts`, `src/domain/dedupPair.ts` (+test), `src/lib/mergeRequests.ts`, `src/app/actions/duplicates.ts`, new `src/lib/mergeDisputes.ts` + `src/app/actions/mergeDisputes.ts`, `src/domain/notificationTemplates.ts`, `src/domain/emailCategories.ts`; tests `src/lib/mergeDisputes.test.ts`, extend `src/app/actions/mergePendingDedupPair.v2.test.ts`, `src/app/actions/pendingDedupFeed.test.ts`.

**Interfaces:**
- `merge_requests.dispute` INTEGER NOT NULL DEFAULT 0 (pre-merge dispute marker).
- `merge_disputes(id, audit_id, survivor_id, absorbed_id, raised_by, created_at, status 'open'|'kept'|'undone', resolved_by, resolved_at)` (unique open per audit_id).
- `pairChoices`: when `declinedByViewer` and the kept side is the other rescuer's, `actionByKeep[side] = 'dispute'` (new `KeepAction` value) instead of `'merge'`; `mergePendingDedupPair` for `'dispute'` files a request with `ownerEmail: null, dispute: 1` (admins notified, type `merge_request` with a dispute flag in params) → outcome `'disputed'`. Never merges.
- `raiseMergeDispute(auditId: string): Promise<{ success; error?; errorId? }>` — allowed for the owner team of the survivor or of the absorbed profile of that merge (not the merging actor's own solo merge); creates an open dispute (idempotent); notifies admins (`merge_disputed`). The `adopter_merged` notice body/url gives a way to reach it (url `/adopter/{survivorId}?dispute={auditId}`, the profile shows «¿No es la misma persona? Avisar a un administrador» when the viewer may raise it).
- `listMergeDisputesForAdmin(db)`; `resolveMergeDispute(disputeId, decision: 'undo'|'keep')` (admin only) — `undo` calls `unmergeAdopters(auditId, admin)`; both outcomes notify both owners (`merge_dispute_resolved`), compare-and-set on status.

- [ ] Failing tests: rejected pair → requester's keep-theirs click files an admin dispute request, no merge; decliner can still accept; crafted keepId can't bypass; post-merge dispute raise → admin list → undo restores both profiles + revokes grants; keep → closed; double resolve no-op; stranger can't raise.
- [ ] Implement; ratchet; run `npx vitest run`, `npx tsc --noEmit`.
- [ ] Commit.

### Task 2: «No convive» and links that follow merges (D48, D51)

**Files:** `src/lib/householdLinks.ts`, `src/domain/householdLinks.ts` (+test), `src/app/actions/householdLinks.ts` (replace `hideHouseholdLink`), `src/app/actions/householdMembers.ts`, `src/lib/adopterMerge.ts` (re-point links on merge; restore on undo via the audit undo payload), `src/domain/notificationTemplates.ts`; tests `src/app/actions/householdLinks.test.ts`.

**Interfaces:**
- `reportNotLivingTogether(linkId: string): Promise<{ success; error?; errorId? }>` — linked profile's owner team or admin; removes that member from the host's household (only it), deletes the link, writes `adopter_history` on both profiles («{actor} indicó que no conviven»), notifies the host's owner team (`household_link_removed`). Records the correction (`household_links` keeps a tombstone or a `household_link_corrections` row: host_id, linked_id, corrected_by, at).
- Re-adding a member that points at a profile whose link was corrected before → link created again, linked owner notified, **and admins notified** (`household_link_disputed`).
- `hidden_at/hidden_by` columns are no longer used; existing hidden rows are treated as live (no data migration needed beyond ignoring them).
- `mergeAdopters`: `UPDATE household_links SET host_adopter_id=survivor WHERE host_adopter_id=absorbed` and same for `linked_adopter_id`; record moved link ids in the undo payload; `unmergeAdopters` moves them back. Also re-point `profileId` inside other profiles' `household_members` that point at the absorbed id? — no: the read path already follows merged ids; only the link table moves.

- [ ] Failing tests: linked owner reports «No convive» on a host owned by another rescuer → member gone from host, link gone, history on both, host owner notified; stranger refused; re-add after correction → admins notified; merge of host / of linked profile → summaries still shown on survivor; undo → back.
- [ ] Implement; run tests + tsc.
- [ ] Commit.

### Task 3: UI (D48–D50, D52)

**Files:** `src/components/LinkedProfileSummary.tsx` / `LivesWithSection` (replace «Quitar de mi perfil» with «No convive» + ConfirmDialog explaining it changes both profiles), `src/components/PendingDedup.tsx` + `src/components/pendientes/*` (D52 confirmation row until reload + toast «Ver perfil»; D49 label «Pedir revisión a un administrador» for `actionByKeep === 'dispute'` and its outcome toast), `src/components/AdopterProfileV2.tsx` (dispute prompt when `?dispute=` and allowed), `src/components/admin/MergeRequestsPanel.tsx` + `src/app/admin/(admin-only)/merge-requests/page.tsx` (show dispute requests with a «Disputa» badge; new «Disputas» section listing `merge_disputes` with «Deshacer combinación» / «Mantener»), i18n es/en/pt.

- [ ] Implement with testids: `hh-not-living-together`, `dedup-merged-row`, `dedup-merged-view`, `merge-dispute-raise`, `merge-dispute-row`, `merge-dispute-undo`, `merge-dispute-keep`.
- [ ] Run tsc, lint, vitest; colour-class audit on touched files.
- [ ] Commit.

### Task 4: Local runs don't email (D53) + e2e + release checks

**Files:** `src/lib/notificationEmail.ts` (+test), `src/lib/emailConfig.ts`, tests `tests/pendientes-d.authed.spec.ts` / new `tests/one-reality.authed.spec.ts`.

- `isLocalRun(): boolean` = `!process.env.APP_ENVIRONMENT` (CI stamps every deployed build); `sendNotificationEmail` returns `'skipped_local'` (info log) on a local run unless `EMAIL_ALLOW_LOCAL=1`. `appBaseUrl()`/staging label unchanged for stamped builds.
- E2E (non-admin rescuers via signed cookies, fixtures stamped): rejected pair → requester's keep-theirs → «Pedir revisión» → admin dispute row; immediate merge → owner raises dispute → admin «Deshacer combinación» → both profiles back; «No convive» from the linked owner removes the link on both profiles; merge in Pendientes → confirmation row with «Ver perfil».
- Full checks: `npx vitest run`, `npx tsc --noEmit`, `npm run lint` (≤125), `npm run build` + `node scripts/check-action-surface.mjs`.
- [ ] Commit.
