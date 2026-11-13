# Formularios generales as people + reversible «Sumar a un animal» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** General adoption forms show as people in «Mis adoptantes» (home card + «Pendientes de revisar»), leave «Mis animales», open alone, and «Proponer» becomes a gender-neutral, reversible «Sumar a un animal».

**Architecture:** One new canonical link for a request (`/my-adopters?solicitud=<id>#pendientes`), served by the existing `HomeApplicantsPanel` narrowed to one application (`single` mode of `ApplicantDetailPanel`). Two new server actions undo/move a proposal by deleting the untouched, team-internal candidacy and reopening the general application. Home data gains a list of general requests; «Mis animales» data drops them.

**Tech Stack:** Next.js 15 (App Router, server actions), Drizzle on Cloudflare D1, vitest (real-SQL `migratedDb`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-general-requests-as-people-design.md` (decisions + exact es copy). Prototype: https://claude.ai/artifact/SvpUVvaNDDA52nTpmopw8R

## Global Constraints

- Branch `feature/general-requests` from staging 2.59.12 (`94379a22`), worktree `/Users/jurfalino/Developer/Personal/vz-share-form`. Node 20: `export PATH=/opt/homebrew/opt/node@20/bin:$PATH`.
- Every new i18n key in `src/i18n/locales/es.ts`, `en.ts` and `pt.ts`; es text exactly as the spec's copy table; pt-BR uses «você». No gendered word about the applicant (the form does not ask gender).
- D1: never `inArray` / array `IN`; fan out with `Promise.all`.
- Every catch logs with the operation's context; user-visible errors carry an errorId (`resolveErrorId` / `logger.error`); stale tabs via `handledAsStale`.
- Domain rules are pure functions in `src/domain/`; server actions orchestrate.
- New `'use server'` exports raise `EXPECTED_ACTIONS` in `scripts/check-action-surface.mjs` with a per-action stranger sign-off (190→191 was the last; this plan ends at **193**). Run `npm run build && node scripts/check-action-surface.mjs`.
- Tap targets ≥ 44px; themed classes only (the app's existing stone/teal/amber classes and `var(--…)` tokens).
- Never `git add -A`/`-u`; never stage `local.db` or `.wrangler/`.
- Canonical request link: `requestHref(applicationId) = /my-adopters?solicitud=${encodeURIComponent(id)}#pendientes`.

## Review Focus

1. Undo after the animal's side moved (a contract link was ever issued for that person + animal, the candidacy was declined, the animal was adopted) — must refuse with `already_acted` and change nothing. → Task 2 tests.
2. Two teammates acting at once: one quits while the other sends a contract on the candidacy — exactly one wins; no orphan general application stuck in `proposed` pointing at a deleted row. → Task 2 test «quit races a contract».
3. Old links in sent notifications/emails (`/my-animals?view=solicitudes&animal=general&solicitud=X`) must land on the request, not on an empty tab. → Task 6 test.
4. A rescuer with 0 animals and a request: home shows the request row in «Mis adoptantes» and no «Mis animales» card row for it; the sheet shows the empty «Cargar un animal» state. → Task 5 unit test + Task 8 e2e.
5. An account with hundreds of duplicate pairs (production has one with ~1,869): the requests group is first and complete, never cut by the pairs' pagination. → Task 4 test.

---

### Task 1: Links, rules and copy

**Files:**
- Modify: `src/domain/applications.ts` (`generalRequestHref`, `formNoticeUrl`, new `requestHref`, `proposalUndoable`)
- Modify: `src/i18n/locales/{es,en,pt}.ts`
- Test: `src/domain/applications.test.ts`, `src/components/evaluation/evaluation.test.tsx` (copy assertions)

**Interfaces:**
- Produces: `requestHref(applicationId: string): string`; `generalRequestHref` now returns `requestHref(id)` (kept as an alias so callers don't change); `formNoticeUrl` returns `requestHref(applicationId)` when `animalId` is null; `proposalUndoable(f: { candidacyState: string; invitationsEver: number }): boolean` (true iff `candidacyState === 'open' && invitationsEver === 0`).
- Produces i18n keys (es values from the spec table): `evaluation.general_title` → «Formulario general»; `evaluation.propose` → «Sumar a un animal»; `evaluation.propose_title` → «¿A qué animal sumás a {name}?»; new `evaluation.propose_note`; `propose_empty_load`, `propose_empty_all_proposed`, `propose_load_other_desc`, `propose_new_note`, `propose_new_submit`, `propose_new_done` reworded; `status_proposed` → «En los candidatos de {animal}»; `status_proposed_hidden` → «En los candidatos de otro animal»; new `evaluation.proposed_hidden_note` («{name} no se entera.»), `undo_change`, `undo_quit`, `undo_confirm_title`, `undo_confirm_body`, `undo_confirm_button`, `undo_refused`, `added_by_line` («Sumó {proposer} · formulario general»), `request_line_general` («Formulario general · por evaluar»), `request_line_general_when` («Formulario general · {when}»), `request_more_one`/`request_more_many`, `requests_group` («Formularios generales»), `request_action` («Evaluar»); `myAdopters.pending_dedup_subtitle` reworded; `samePerson.gate_hint_propose` → «Para sumar a {name} a un animal, primero respondé si es la misma persona.» (now takes `{name}`; update its two callers).

- [ ] **Step 1: Failing tests** in `src/domain/applications.test.ts`:
  - `requestHref('app-1') === '/my-adopters?solicitud=app-1#pendientes'`; `generalRequestHref('app-1')` equals it.
  - `formNoticeUrl({ submissionId: 's', applicationId: 'app-1', animalId: null, animalInTeam: false, animalsOn: true }) === requestHref('app-1')`; with an animal it is unchanged (`/my-animals?view=solicitudes&animal=<id>&solicitud=app-1`).
  - `proposalUndoable({ candidacyState: 'open', invitationsEver: 0 }) === true`; `'open', 1` → false; `'declined', 0` → false; `'adopted', 0` → false.
  Update the existing «Cargar un animal» test that expects `/my-animals?view=…animal=general…` to expect `requestHref`.
- [ ] **Step 2: Run** `npx vitest run src/domain/applications.test.ts` → FAIL (`requestHref` not defined).
- [ ] **Step 3: Implement** the three functions in `src/domain/applications.ts` and the keys in all three locales (es exact; update every existing caller of a reworded key whose placeholders changed — `rg "gate_hint_propose|propose_title|propose_empty|propose_new_" src`).
- [ ] **Step 4: Run** `npx vitest run src/domain src/components/evaluation src/i18n` → PASS (copy tests in `evaluation.test.tsx` updated to the new strings).
- [ ] **Step 5: Commit** `git add src/domain/applications.ts src/domain/applications.test.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts src/components/evaluation/evaluation.test.tsx <callers>` — «General requests: one request link, undo rule, «Sumar a un animal» copy».

### Task 2: Undo and change a proposal (server)

**Files:**
- Modify: `src/app/actions/_applications.ts` (new `loadProposal`, `withdrawProposalAuthorized`)
- Modify: `src/app/actions/applications.ts` (new actions)
- Modify: `scripts/check-action-surface.mjs` (191 → 193, sign-off)
- Test: `src/app/actions/applications.test.ts`, `src/app/actions/applications.access.test.ts`

**Interfaces:**
- Consumes: `proposalUndoable` (Task 1); existing `loadAuthorizedApplication`, `proposeAuthorized`, `clearFormNotices`.
- Produces:
  - `withdrawProposal(generalApplicationId: string): Promise<{ ok: true } | Fail>` — errors `'unauthorized' | 'invalid' | 'not_found' | 'not_allowed' | 'already_acted' | 'failed'`.
  - `changeProposedAnimal(generalApplicationId: string, animalId: string): Promise<{ ok: true; applicationId: string } | Fail>` — same errors plus `proposeAnimal`'s (`already_candidate`, `animal_adopted`, `same_person_unanswered`).
  - Both take the GENERAL application's id (state `proposed`); from the animal's candidate the UI passes `proposal.generalApplicationId` (Task 3).
- Behaviour (decided): `withdrawProposalAuthorized(db, viewer, auth)`:
  1. The general application must be `proposed` with `proposedApplicationId` → else `not_allowed`.
  2. `invitationsEver` = count of `contract_invitations` for (candidacy's animal, adopter ∈ {linkedAdopterId, autoAdopterId}) of any age/state. Not `proposalUndoable` → `already_acted`.
  3. `DELETE FROM applications WHERE id = candidacy AND state = 'open' AND origin = 'proposed' RETURNING id` — none deleted → `already_acted` (a teammate acted first).
  4. CAS the general one back: `state 'open', proposedApplicationId null, closedAt null, closedBy null WHERE id = general AND state = 'proposed'`. If that loses (cannot happen unless the row changed), log at error with ids.
  5. No observation, no history row, no notification. Log info `withdrawProposal: done` with `{ applicationId, candidacyId, animalId, viewer }`.
- `changeProposedAnimal`: same-person gate as `proposeAnimal`; then withdraw (as above) and `proposeAuthorized` with the new animal on the reloaded auth. If the propose fails, re-propose the previous animal (best effort, logged) and return the propose error.

- [ ] **Step 1: Failing tests** (real SQL, `seedEvaluation` + fixtures):
  - «withdraw: the untouched candidacy is deleted, the general request is open again, nothing else written» — after `proposeAnimal('app-s-gen','luna')`, `withdrawProposal('app-s-gen')` → `{ ok: true }`; `appRow('app-s-gen')` has `state 'open'`, `proposed_application_id null`, `closed_by null`; no applications row with `origin 'proposed'`; `adopter_events` and `notifications` unchanged vs before the withdraw.
  - «withdraw then propose the same animal again works» → second `proposeAnimal('app-s-gen','luna')` is `{ ok: true }`.
  - «a contract was ever sent → already_acted, nothing changes» — insert an invitation (even an expired one) for (luna, beto) → `{ ok: false, error: 'already_acted' }`, snapshot unchanged.
  - «the candidacy was declined → already_acted».
  - «quit races a contract» — `Promise.all([withdrawProposal(gen), createContractInvitation(luna, beto)])` → exactly one effect: either the invitation exists and the general app is still `proposed`, or neither the candidacy nor an invitation exists and the general app is `open`.
  - «change: Luna → Sol moves the candidacy» (Sol in OWNER's team) — candidacy for sol open, none for luna, general app `proposed` → sol's candidacy.
  - Access (`applications.access.test.ts`): STRANGER → `not_found`, nothing written; MATE → ok; signed out → `unauthorized`.
- [ ] **Step 2: Run** `npx vitest run src/app/actions/applications.test.ts src/app/actions/applications.access.test.ts` → FAIL (actions not exported).
- [ ] **Step 3: Implement** both actions and `withdrawProposalAuthorized` per the behaviour above; raise `EXPECTED_ACTIONS` to 193 with a sign-off block (session required; team gate `loadAuthorizedApplication`; only deletes an untouched team-internal candidacy; never touches observations).
- [ ] **Step 4: Run** the two test files → PASS; `npm run build && node scripts/check-action-surface.mjs` → «193 … as expected».
- [ ] **Step 5: Commit** «General requests: undo and change «Sumar a un animal» (withdrawProposal, changeProposedAnimal)».

### Task 3: The panel — single request, undo, who added

**Files:**
- Modify: `src/app/actions/applicants.ts` (`ApplicantSummary.proposal`), `src/app/actions/_applicants.ts` (fill it)
- Modify: `src/components/ApplicantDetailPanel.tsx` (`single` prop; undo actions; added-by line; «Sumar» copy)
- Modify: `src/components/evaluation/ProposeAnimalSheet.tsx` (title, note), new `src/components/evaluation/WithdrawProposalDialog.tsx`
- Modify: `src/components/home/HomeApplicantsPanel.tsx` (target `{ request: string }` → one application, `single`)
- Test: `src/components/ApplicantDetailPanel.test.tsx`, `src/components/evaluation/evaluation.test.tsx`, `src/app/actions/applicants*.test.ts`

**Interfaces:**
- Consumes: Task 1 keys and `proposalUndoable`; Task 2 actions.
- Produces:
  - `ApplicantSummary.proposal: { generalApplicationId: string; candidacyId: string; animal: { id: string; name: string; sex: string | null } | null; byName: string | null; canUndo: boolean } | null` — set on a general application in state `proposed` AND on a candidacy with `origin 'proposed'`; `byName` = display name of the general application's `closedBy`; `canUndo` = `proposalUndoable(...)`.
  - `HomeApplicantsTarget` gains `{ request: string }`; with it the host reads `getGeneralApplications()`, keeps only that `applicationId`, and renders `ApplicantDetailPanel` with `single`. Missing (decided by someone else, not the viewer's team) → the panel's existing error/empty path, never a blank sheet.
  - `ApplicantDetailPanel` prop `single?: boolean`: header shows «← Volver» (left) and `evaluation.general_title`; no Anterior/Siguiente/dots/counter.
- UI rules: on a `proposed` general request, under the status line «En los candidatos de {animal}» show «{name} no se entera.» and, when `proposal.canUndo`, «Cambiar animal» (opens `ProposeAnimalSheet` in change mode → `changeProposedAnimal`) and «Quitar de {animal}» (opens `WithdrawProposalDialog` → `withdrawProposal`). On a candidacy with `origin 'proposed'`: line «Sumó {byName} · formulario general» under the name, and the same two actions as text buttons when `canUndo`. Refusals: `already_acted` → toast `undo_refused`; others → the sheet's existing error handling with errorId. After success → `onOutcome()` re-read.

- [ ] **Step 1: Failing tests:** panel static render with `single` → no element containing «Anterior»/«Siguiente», contains «← Volver» and «Formulario general»; a `proposed` applicant with `proposal.canUndo` renders «Cambiar animal» and «Quitar de Luna»; with `canUndo: false` renders neither; a candidacy with `origin: 'proposed'` renders «Sumó Jonathan U · formulario general»; `WithdrawProposalDialog` renders the spec's confirm title/body with name and animal; loader test: a proposed general app and its candidacy both carry `proposal` with the same `generalApplicationId`, `canUndo` false once an invitation exists.
- [ ] **Step 2: Run** the listed tests → FAIL.
- [ ] **Step 3: Implement** per Interfaces/UI rules.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** «General requests: the panel opens one request alone; undo and «Sumó …» on both sides».

### Task 4: «Pendientes de revisar» — Formularios generales first

**Files:**
- Create: `src/components/pendientes/GeneralRequestsGroup.tsx`
- Modify: `src/components/PendingDedup.tsx` (render the group first; open rules; header count; subtitle; `?solicitud=` opens the panel)
- Test: `src/components/pendientes/GeneralRequestsGroup.test.tsx`, `tests/my-adopters-requests.user.spec.ts` (new e2e)

**Interfaces:**
- Consumes: `getGeneralApplications()` (existing), `HomeApplicantsPanel` with `{ request }` (Task 3), Task 1 keys.
- Produces: `GeneralRequestsGroup({ requests, onOpen })` — the heading «Formularios generales» (warning color, the existing group-heading classes) and one row per request whose `status.kind === 'to_evaluate'`: form icon in the amber circle, name, line `request_line_general_when` (or `asked_adopted_{f|m}` + « · {when}» when `askedAnimal`), muted summary «Prefiere: …», pill «Evaluar». All rows, never paginated.
- `PendingDedup` page mode: loads general requests alongside the pairs; renders the section when either exists; `needs` += requests to evaluate; auto-opens when a request waits (same once-only rule as `firstReceived`); `?solicitud=<id>` opens that request alone over the page and scrolls to the section; subtitle key reworded.

- [ ] **Step 1: Failing tests:** group render: 2 to-evaluate + 1 proposed → 2 rows, heading, «Evaluar»; asked-adopted line reads «Pidió a Toby (ya adoptado) · …». e2e (`user` project, fixtures `test-gr-fixture-*`): with a general request and >1 page of pairs, /my-adopters shows the section open, «Formularios generales» before «Posibles duplicados», the request row on page 1; `/my-adopters?solicitud=<id>#pendientes` opens that request alone (no «Siguiente»).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit test and the e2e (`npx playwright test tests/my-adopters-requests.user.spec.ts --config=playwright.local.config.ts --project=user --workers=1 --no-deps`) → PASS.
- [ ] **Step 5: Commit** «General requests: first group of «Pendientes de revisar», open by itself, never paginated».

### Task 5: Home — rows in «Mis adoptantes», out of «Mis animales»

**Files:**
- Modify: `src/types/homeModules.ts` (`HomeAdoptersData.requests`, `requestsToEvaluate`), `src/lib/homeModulesData.ts`, `src/lib/applicationCounts.ts` (list helper), `src/domain/homeModules.ts` (slot split), `src/components/home/HomeModules.tsx`
- Test: `src/components/home/HomeModules.test.tsx`, `src/domain/homeModules.test.ts`, `tests/home-modules.user.spec.ts`

**Interfaces:**
- Produces: `listGeneralToEvaluate(db, viewerTeam, limit): Promise<HomeRequestItem[]>` in `applicationCounts.ts` (same WHERE as `countGeneralToEvaluate`); `HomeRequestItem = { applicationId: string; name: string; askedAnimal: { name: string; sex: string | null } | null }`; `HomeAdoptersData.requests: HomeRequestItem[]`, `requestsToEvaluate: number`; `homeAdopterSlots(requests: number, pending: number, slots = HOME_CARD_SLOTS): { requests: number; pending: number; moreRequests: number }` — requests take slots first; with more requests than fit, one slot is the overflow row.
- `loadHomeAnimals`: no general row; `solicitudesCount` counts animals only. Remove `HomeGeneralRow` from the animals data and its row from `AnimalsCard`.
- `AdoptersCard`: request rows (PendingRow look, form icon, line `request_line_general` or asked-adopted) before pair rows; overflow row `request_more_*` → `/my-adopters#pendientes`; a row opens `HomeApplicantsPanel` with `{ request: applicationId }` over the home.

- [ ] **Step 1: Failing tests:** `homeAdopterSlots(2, 1)` → `{ requests: 2, pending: 1, moreRequests: 0 }`; `homeAdopterSlots(5, 2)` → `{ requests: 3, pending: 0, moreRequests: 2 }`; card render with 2 requests shows «Formulario general · por evaluar» rows before the pair row; animals card render with general requests present shows no «Formulario general» / «Sin animal elegido» row; `animalsTodo` false when only general requests exist. Update `home-modules.user.spec.ts` where it asserted the «Mis animales» general row.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** unit tests + `tests/home-modules.user.spec.ts` → PASS.
- [ ] **Step 5: Commit** «General requests: home rows in «Mis adoptantes»; «Mis animales» counts animals only».

### Task 6: /my-animals — remove the card, redirect old links

**Files:**
- Modify: `src/app/my-animals/page.tsx` (drop the «Sin animal elegido» card and `showGeneral`; redirect), `src/domain/applications.ts` if the tab count helper lives there
- Test: `tests/my-animals-solicitudes.authed.spec.ts`, `tests/applicant-evaluation.authed.spec.ts`, `tests/propose-load-animal.user.spec.ts`, unit tests referencing `GENERAL_ROW_ID` in my-animals counts

**Interfaces:**
- Consumes: `requestHref` (Task 1).
- Behaviour: when `view=solicitudes&animal=general`, `router.replace(solicitud ? requestHref(solicitud) : '/my-adopters#pendientes')` before rendering the list; the tab count no longer adds 1 for general requests.

- [ ] **Step 1: Failing tests:** e2e «an old notice link opens the request in Mis adoptantes» — visit `/my-animals?view=solicitudes&animal=general&solicitud=<fixture>` → URL becomes `/my-adopters?solicitud=<fixture>#pendientes` and the request is open; «the tab lists only animals» — no card «Sin animal elegido»/«Formulario general» in the tab. Rewrite the e2e steps that opened the general card to go through /my-adopters.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the four e2e files above (`--project=authed` / `user`) → PASS.
- [ ] **Step 5: Commit** «General requests: out of «Mis animales»; old links redirect».

### Task 7: «Agregar animal» from the sheet + same-person hint copy

**Files:**
- Modify: `src/app/my-animals/new/page.tsx` (note/submit/toast keys already reworded in Task 1; return to `requestHref`), `src/components/ApplicantDetailPanel.tsx` (gate hint now passes `{name}`)
- Test: `tests/propose-load-animal.user.spec.ts`, `src/components/evaluation/evaluation.test.tsx`

- [ ] **Step 1: Failing test:** the e2e lands on `/my-adopters?solicitud=<app>#pendientes` with status «En los candidatos de {animal}» (was the my-animals URL and «Propuesta para»).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (should be only the link and assertion; `generalRequestHref` already returns `requestHref`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** «General requests: «Agregar y sumar» returns to the request in Mis adoptantes».

### Task 8: Whole suite, build, journey check

- [ ] **Step 1:** `npx vitest run` → all pass; `npx tsc --noEmit` clean; `npm run lint` ≤ 125 warnings with none new in touched files.
- [ ] **Step 2:** `npm run build && node scripts/check-action-surface.mjs` → exit 0, «193 … as expected»; `(cd contract-app && npm run build)` exit 0.
- [ ] **Step 3:** e2e: `tests/home-modules.user.spec.ts tests/share-form-home.user.spec.ts tests/propose-load-animal.user.spec.ts tests/my-adopters-requests.user.spec.ts tests/forms.spec.ts` (`--project=user`) and `tests/applicant-evaluation.authed.spec.ts tests/my-animals-solicitudes.authed.spec.ts` (`--project=authed`) → all pass (re-run a single flaky one alone before calling it a regression; compare with staging if it persists).
- [ ] **Step 4:** grep for leftovers: `rg -n "Sin animal elegido|Propuesta para|Proponer un animal" src --glob '!**/*.test.*'` → only intentional hits (none in es/en/pt values except historical notices if any).
- [ ] **Step 5:** Commit any test-only fixes; no version bump here (release is a separate step on Jon's "push").
