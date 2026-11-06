# Teammates answer «¿misma persona?» both ways — Implementation Plan (step 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the team acts as one on every "same person?" question. A pair where the viewer **or a teammate** loaded a side is listed in the viewer's «Pendientes», counted on their homepage, gets the profile bar's «Revisar», and can be answered both ways («Mantener separados» / «No es esta persona», and «Unir» / «Es la misma persona»).

**Architecture:** one pure rule, `mayAnswerPair(team, ownerA, ownerB)` (src/domain/pairAnswer.ts), case-insensitive. Every read (`loadOpenPairs`, `pendingDuplicatesByAdopter`, the «Pendientes» feed) and every write (`dismissDuplicateCandidate`, `settleNotSamePerson`, `decideDedupAction`'s gate) uses it. The team is `getTeamEmails(viewer)`, which is invite-only org membership. It fails open to [viewer] alone, so a D1 hiccup narrows to today's rule and never widens. No `IN` with bound arrays: the OR of `eq` over ≤30 emails.

**Spec:** `.agents/plans/2026-11-05-form-matches-are-duplicates.md` — «Decided after the builder check» (teammates answer both ways, everywhere) and CX addition 4 (step 2).

## Global Constraints
- D1: never inArray. Every catch is logged with context. User errors carry an errorId. i18n es/en/pt.
- No new server action: the ratchet stays at 175.
- Merge semantics (decideDedupAction with keepId, requests to a foreign owner, admins' bypass, D42/D43/D49) are unchanged. Only the "may touch this pair at all" gate widens from "loaded a side" to "the team loaded a side". That is the dupHint rule already (dupHintActions.ts:181).
- Security-adjacent: an independent review returns before production.

## Review Focus
1. A stranger (no shared org) still gets `not_yours` / `not_authorized` / no «Revisar» on every surface.
2. Case: an `added_by` stored with capitals still counts for its team (the old `===` didn't).
3. Team lookup failure → solo rule, never wider.
4. An org-mate of the owner of side A, where side B is a stranger's: «Unir» keeping B still files a request to B's owner (unchanged), and «Mantener separados» settles.
5. A teammate's «No» on household / dup-hint / import / new profile now settles (dismissed), instead of opening the pair "for the owners".

---

### Task 1: the rule
**Files:** create `src/domain/pairAnswer.ts` + `src/domain/pairAnswer.test.ts`; modify `src/domain/dedupPair.ts` (`decideDedupAction` gate) + `src/domain/dedupPair.test.ts`.
**Produces:** `mayAnswerPair(team: ReadonlySet<string>, ...owners: Array<string | null | undefined>): boolean`. True when any owner, trimmed and lower-cased, is in `team`. `team` is already normalized. `anonymous`, `''` and null never count.
- `decideDedupAction`: `if (!created(a) && !created(b))` → `if (!created(a) && !created(b) && !a.teamOwned && !b.teamOwned)`.
- Tests: teammate's side → merge/request decided (not refused); stranger → still `not_yours`; capitals in owner email.

### Task 2: reads
**Files:** `src/lib/openPairs.ts` (`viewerTeam(viewer): Promise<Set<string>>` = normalized getTeamEmails; `onViewerList` in `loadOpenPairs` and `pendingDuplicatesByAdopter` uses mayAnswerPair), `src/app/actions/duplicates.ts` `getPendingDuplicatesForUser` (`ownRows`: added_by = any team email; the flags query's `ownSide`: OR over the team).
- Test: `src/lib/openPairs.test.ts` (sqlite harness as `notSamePerson.test.ts`): a pair with a teammate's side → `onViewerList` true; a stranger's pair → false; capitals.

### Task 3: writes
**Files:** `dismissDuplicateCandidate` (team via `isOwnerOrOrgMate` on either side, or admin); `src/lib/notSamePerson.ts` (`settles`: admin || team owns adopterId || (either && team owns other)); `ownerLabel` unchanged.
- Tests: `src/lib/notSamePerson.test.ts` — a teammate of the owner settles (dismissed, not asked); `subject` + teammate of the other side's owner only → asked. `dismissDuplicateCandidate`: teammate → success; stranger → not_authorized (new `src/app/actions/dismissDuplicateCandidate.test.ts`, mocks like `notSamePerson.test.ts`).

### Task 4: e2e as a teammate
**Files:** `tests/seed.sql` (a `test-*-fixture-*` pair: side A loaded by the admin, side B by `test-seed`, pending, medium), `tests/team-same-person.spec.ts` (persona Vero, like `team-applicants.spec.ts`).
- Vero, on side A's profile: the bar shows «Revisar». It opens «Pendientes» with the pair. «Mantener separados» → the row is gone, and after a reload the bar is gone too.
- A stranger persona on side A's profile: no «Revisar».

### Task 5: clean-up
- CHANGELOG (an unreleased section for step 2). Design doc status line. Full checks: tsc, lint ≤ 125, vitest, build, ratchet 175, e2e set.
