# Every «No es esta persona» saved the same way — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** apply the design's «Consistency rule» (2026-11-06): any «no, it's not this person» about a specific existing profile is saved as a dismissed pair as soon as both profiles exist. Only the person who loaded either profile, or an admin, settles it. Anyone else's «No» opens the pair for the owners, and they are told.

**Architecture:** one data-access core, `settleNotSamePerson` (src/lib/notSamePerson.ts), used by the household add (server) and by a new server action `answerNotSamePerson`. That action serves the contact window, the post import and the new-profile form. The server re-runs the duplicate search and only accepts ids it would itself offer (keepOffered), so a forged id writes nothing.

**Spec:** `.agents/plans/2026-11-05-form-matches-are-duplicates.md`, section «Consistency rule».

## Global Constraints
- Same as step 1's plan: D1 without inArray, logged catches, errorIds on user errors, i18n es/en/pt, ≥44px, no `git add -A`.
- One new server action (`answerNotSamePerson`): raise EXPECTED_ACTIONS 174 → 175 in the same commit, after checking that every argument is safe for a stranger to choose. An independent review is required before production.
- Owner label in messages: the owner's org name, else their display name (`pickAttributionOrg` → `resolveDisplayName`).

## Review Focus
1. A forged `rejectedIds` (a profile the search would never offer) writes nothing.
2. A non-owner's «No» never writes `dismissed`. It opens a pending pair (medium confidence, so it shows in «Pendientes») only when no row exists yet.
3. An already-settled pair (dismissed/merged) is left untouched by anyone's «No».
4. Import / new-profile: the «No» is saved only after the profile exists. Abandoning the flow saves nothing.
5. The contact window: answering before the contact is saved still uses the typed value as the search input.

---

### Task 1: core `settleNotSamePerson`
**Files:** create `src/lib/notSamePerson.ts`; test `src/lib/notSamePerson.test.ts` (sqlite harness like `householdNoAnswer.test.ts`).
**Produces:** `settleNotSamePerson(db, { actor, adopterId, rejectedIds, offered: Array<{ adopterId: string; matchTypes?: string[] }>, ctx }): Promise<{ recorded: string[]; asked: Array<{ otherId: string; otherName: string; ownerLabels: string[] }>; dropped: number }>`
- keepOffered(rejectedIds, offered ids) → kept.
- Per kept id: admin, OR the actor owns `adopterId`, OR the actor owns that id → recordSeparatePairs. Otherwise, if no pair row exists, insert a sorted `pending` row (`confidence: 'medium'`, `matchTypes` from offered, `score: 30`) and add it to `asked`, with owner labels for both profiles. If a row already exists, leave it alone and don't ask.
- Tests: owner → dismissed; stranger → one pending row, asked with labels, no dismissed; forged → dropped 1, no row; settled dismissed row + stranger → untouched, not asked.

### Task 2: household uses the core and tells the helper
**Files:** `src/app/actions/households.ts` (replace the inline rule), `src/components/household/PersonForms.tsx` (toast), i18n `adopter.hh_asked_owners` es/en/pt: «Le preguntamos a {owners} si {name} es la misma persona que {other}.» Test: extend `src/lib/householdNoAnswer.test.ts` («contributor»: now one pending pair, result has `asked`).
**Produces:** `AddHouseholdPersonResult` ok-branch gains `asked?: Array<{ otherName: string; ownerLabels: string[] }>`.

### Task 3: server action `answerNotSamePerson`
**Files:** `src/app/actions/notSamePerson.ts` ('use server'); `scripts/check-action-surface.mjs` 175; test `src/app/actions/notSamePerson.test.ts`.
**Produces:** `answerNotSamePerson(input: { adopterId: string; rejectedIds: string[]; typed?: { type: 'phone'|'email'|'social'|'id'; value: string } }): Promise<{ ok: true; recorded: number; asked: Array<{ otherName: string; ownerLabels: string[] }> } | { ok: false; error: 'not_authenticated'|'invalid'|'not_found'|'failed'; errorId?: string }>`
- Session required. `adopterId` must be a live profile. Ids go through id64; at most 10, deduped, never `adopterId` itself.
- Offered = `searchFormDuplicates`: with `typed`, that one contact (allowContactOnly). Otherwise the profile's stored name and typed contact entries. The profile itself is excluded. Limit 20.
- Then `settleNotSamePerson`.
- Tests: owner records; forged dropped; stranger asked; dead profile → not_found; no session → not_authenticated.

### Task 4: the contact window («Ya está en otro perfil»)
**Files:** `src/components/DuplicateHint.tsx` (`handleNotThis`: the call, a toast for `asked` (`adopter.dup_hint_asked_owners`), and the analytics event); `tests/dup-hint.user.spec.ts:108-114` (now asserts a dismissed pair between the two profiles).

### Task 5: post import
**Files:** `src/components/ImportWizard.tsx` (keep `rejectedMatchIds`, reset with `personMatches`; after a successful create, call the action for the new id); e2e in `tests/import-wizard.authed.spec.ts` duplicates block: «No» on the match, create new → a dismissed pair between the new profile and the match.

### Task 6: new-profile form
**Files:** `src/components/AdopterForm.tsx` (after a successful save of a NEW profile, call the action with `dismissedStrongIds`, before navigating, and don't block the navigation on a failure, which is logged and toasted with its errorId); e2e `tests/continue-same-phone.user.spec.ts` (new test: «No es esta persona», «Crear», → a dismissed pair).

### Task 7: analytics + clean-up
- `SamePersonSurface` gains `'dup_hint' | 'import' | 'new_profile'`. Fire the event on each saved «No».
- The CHANGELOG 2.58.30 entry is updated (unreleased).
- Full checks: tsc, lint ≤ 125, vitest, build, ratchet 175, e2e set.
