# Household Contributions (D54–D55) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any signed-in rescuer can add household members (and contacts to members) on any profile, credited and protected like contact details (D54); a linked conviviente's card adds contacts to that person's own profile (D55).

**Architecture:** The household actions stop requiring owner/team/admin for *adds* and switch to per-item permission for edits/removes (privileged, or `addedBy === actor`) — the same split `ContactEntriesSection` uses (`canEditAll` + `canEditEntry`). Contribution side effects reuse `addContactEntry`'s helpers (contribution history, `insertContributionGrant`, approver notice, auto access request). The UI gets the same split. D55 reuses `addContactEntry` against the linked profile id.

**Tech Stack:** Next.js 15, Drizzle + D1, Vitest + migratedDb, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-pendientes-d-design.md` — addendum D54–D55 (and the one-shared-reality principle above it).

## Global Constraints

- One shared reality: contributions change the shared record, credited; never a per-user copy.
- Privacy unchanged for everyone else: household contacts keep the profile's visibility (`maskHouseholdMembers`); a contributor sees only what they typed (entry grants) plus the names of members they added.
- Layer rules; D1 no `IN (array)`; every catch logs context; user-facing errors carry an errorId; es/en/pt for every string; theme-safe classes; ≥44px targets; 390px.
- `privileged` = owner ∨ org-mate of owner ∨ admin (same as today's `loadEditable`).
- No new server actions unless unavoidable (if one is added, raise `EXPECTED_ACTIONS` in `scripts/check-action-surface.mjs` in the same commit).
- Never `git add -A`/`-u`; tracked seed DBs never committed.

## Review Focus

1. **A contributor can't touch others' data**: editing/removing a member or contact they didn't add is refused server-side, including legacy items with no `addedBy`. Test in Task 1.
2. **A contributor never sees more than before**: other contributors' contacts on the same member stay masked for them; adding a contact whose value already exists on the member grants only that entry (same as `addContactEntry`'s `unlocked_existing`). Test in Task 1.
3. **Owners hear about it** exactly once per contribution (not for their own or their team's adds). Test in Task 1.
4. **D55 never writes the host**: «Agregar dato de contacto» on a linked card changes only the linked profile. Test in Task 2.
5. **A non-owner sees the add button and only their own edit/delete icons** (390px too). Test in Task 2 (e2e).

---

### Task 1: Server — open household contributions (D54)

**Files:** `src/app/actions/householdMembers.ts` (+ `src/lib/householdMembers.test.ts` or a new `src/app/actions/householdMembers.contrib.test.ts`), `src/app/actions/addContactEntry.ts` (export/share the contribution helpers rather than duplicating them), `src/lib/piiAccess.ts` (`maskHouseholdMembers` gets `options.viewerEmail` → a member whose `addedBy` equals the viewer keeps its name unmasked), its caller(s) passing the viewer.

**Interfaces:**
- `addHouseholdMember`, `addMemberContactEntry`: any real actor on a live profile. When the actor is not privileged: history `kind='contribution'`; an entry grant per contact typed (`insertContributionGrant`); approvers notified after response (`notifyApprovers` pattern, `runAfterResponse`); auto access request as `addContactEntry` does. Return shapes unchanged.
- `updateHouseholdMember`, `removeHouseholdMember`: privileged, or the member's `addedBy === actor`. `updateMemberContactEntry`, `removeMemberContactEntry`: privileged, or the entry's `addedBy === actor`. Otherwise `{ ok:false, error:'Not authorized to edit this household.' }` (existing string), logged with context.
- `profileId` on add stays as is (only the D35 path sets it).

- [ ] Failing tests: stranger adds a member with a phone → saved with `addedBy`, contribution history, entry grant, owner notified, member name + phone unmasked for the stranger and masked for a second stranger; stranger edits/removes own member ✓, another's member ✗, legacy member (no addedBy) ✗; stranger adds a contact to the owner's member ✓, edits the owner's contact ✗; org-mate add → no contribution history/notice (editor path as today).
- [ ] Implement; run `npx vitest run`, `npx tsc --noEmit`.
- [ ] Commit.

### Task 2: UI — per-item permissions and linked-card contacts (D54, D55)

**Files:** `src/components/HouseholdSection.tsx` (replace `canEdit` with `canEditAll` + `currentUser`; add button for any signed-in viewer; edit/delete/add-contact per item like `ContactEntriesSection.canEditEntry`), `src/components/AdopterForm.tsx` (pass `canEditAll = isOwner || isAdmin || isOrgMateOfOwner`, `currentUser`), `src/components/LinkedProfileSummary.tsx` (an «Agregar dato de contacto» composer on the linked summary and the «Convive con» row → `addContactEntry({ adopterId: summary.profileId, … })`, hint «Se agrega al perfil de {nombre}», `router.refresh()` after success; reuse the existing contact composer UI from `ContactEntriesSection`/`HouseholdSection` rather than a new one), i18n es/en/pt, `tests/one-reality.authed.spec.ts` or a new `tests/household-contrib.user.spec.ts` (non-admin rescuer via the `user` project).

- [ ] Implement with testids `household-add-member` (existing), `linked-add-contact`.
- [ ] E2E: a non-owner adds a member with a phone on another rescuer's profile and sees it; sees no edit/delete on the owner's member; adds a phone from a linked card → appears on the linked profile, host's own contacts unchanged.
- [ ] Run tsc, lint (≤125), vitest, build, action surface; colour-class audit on touched files.
- [ ] Commit.
