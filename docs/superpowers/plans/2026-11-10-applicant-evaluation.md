# Evaluating applicants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every form application becomes something a rescuer evaluates and finishes. The home and Mis animales show what's waiting, the applicant panel gives what's needed to decide, and each application ends in a recorded outcome.

**Architecture:** There's a new `applications` table, one row per candidacy: person × animal, or person × «Sin animal elegido». `form_submissions` stays the source of the answers. The adopter is never copied: it's read through `form_submissions.linked_adopter_id`. Pure rules live in `src/domain/applications.ts` and `src/domain/formAnswers.ts`. They cover state derivation (where «Contrato enviado» is derived from a live invitation), counts, ordering, which applications an adoption closes, merge dedupe, and the answers summary. The DB modules call them:
- `src/lib/applicationWrites.ts` and `src/lib/applicationCounts.ts`: plain modules.
- `src/app/actions/_applications.ts`: not `'use server'`.
- `src/app/actions/applications.ts`: `'use server'`.

The single placement write point, `updateRecord`, closes the other candidates when an ADOPTION placement opens. `applicantScope.ts` stays the one rule for which applications belong to an animal.

**Tech Stack:** Next.js 15 App Router, Drizzle on Cloudflare D1 (better-sqlite3 locally), vitest 4 with `migratedDb()` for SQL integration tests and `renderToStaticMarkup` for component tests, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-applicant-evaluation-design.md`. Its «Answers (Jon …)» section wins over earlier sections. In particular, Q5 → B: general applications are the «Sin animal elegido» row and card in Mis animales, and Mis adoptantes gets nothing new.

## Global Constraints

- D1: never `inArray()` or `IN (array)`. Use OR-of-`eq` chains (see `applicantScopeWhere`) or `Promise.all` per id.
- Subrequest budget: counts run ONE grouped query per distinct animal-owner team (`createOwnerTeamResolver`). Never fan out per animal and then per application. The live-invitation check is a LEFT JOIN.
- Every catch logs with its operation context (ids, actor). Never silent. D1 fallbacks use `logger.warn('<op>: D1 fallback hit', {...})`.
- Client error toasts carry an errorId (`resolveErrorId(e, '<Component>')`). Catch blocks use `userFacingMessage(e, fallback)` / `handledAsStale(e)` (`src/lib/errorMessage.ts`).
- i18n: every key exists in `es.ts`, `en.ts` AND `pt.ts`. All new copy lands in Task 1. Later tasks use those keys and add none.
- No magic strings: states, origins, close reasons, the TTL and the automatic actor come from `src/domain/constants.ts`.
- `src/domain/*` imports no DB, server, React or `@/lib/*` module.
- Themed Tailwind colours only. Amber to-do rows reuse `bg-amber-100 text-amber-700` (TodoRow / due-badge). Icons are SVG or lucide, never emoji, in new UI. Every tap target is ≥44px (`min-h-11`).
- Verification per task:
  - `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run <files>`
  - `npx tsc --noEmit`
  - `npm run lint`: warnings ≤ 125.
  - For tasks touching `'use server'` files: `npm run build` then `node scripts/check-action-surface.mjs`.
- Playwright:
  - Use `data-testid` selectors (Chromium renders English).
  - Destructive tests insert their own `test-ev-fixture-*` rows (`execD1Batch`) and delete them after.
  - Seeded fixtures go in `tests/seed.sql`, which `scripts/setup-test-db.js` loads AFTER all migrations. A migration backfill therefore never sees seed rows, so every seeded `form_submissions` row that a test relies on as an applicant needs its own `applications` row.
- Before changing or removing any visible text, grep ALL of `tests/` (helpers included, single words too) for it.
- Commits: explicit `git add <paths>`, never `-A`/`-u`. `local.db` and `.wrangler/**.sqlite` are tracked e2e seeds and are never staged. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No version bump, no CHANGELOG, no push.
- Migrations are hand-written, numbered `0106_…`. Before committing, re-check `git ls-tree origin/staging drizzle/` and renumber if 0106 is taken. They must be idempotent: every migration re-runs on each test-DB setup. The runner strips `--…` to end of line and splits on `;`, so no `;` or `--` inside string literals.

## Review Focus

1. **A retried «No avanzar»** (double tap, a network retry after a timeout) must leave exactly one observation and one `declined` row. The observation id is pre-seeded from the application id. Test in Task 8: `declineApplication twice → one adopter_events row, state declined once`.
2. **Count parity across invitation edge cases.** The home line, the tab count and the panel's por-evaluar list must agree when an application has a live link, a link retired by a newer send, an expired link, a link with `expires_at NULL`, a forged outsider row, or a cross-org teammate's link. Test in Task 7: `countToEvaluateByAnimal equals loadApplicantsForAnimal().filter(isToEvaluate) on the edge fixture`.
3. **A fostered animal adopted by someone else between the signer opening the link and pressing «Firmar».** The signature must answer 409 and must never end the other person's adoption. Today the non-CAS `updateRecord` would close whatever placement is active. Test in Task 5: `contract signature on a fostered animal loses to a concurrent adoption`.
4. **Undo of a merge that deduped applications** puts every `replaced` / `also_applied` row back to `open`. Test in Task 6: `unmergeAdopters restores the application states the merge changed`.
5. **«N respuestas sin observaciones» is off by the rows «Todas las respuestas» skips**: free-text `{ open: '' }`, `existingPets` with all zeros, a household-people form. Test in Task 1: `summarizeAnswers counts exactly the rows FormAnswersPanel renders`. Also a component test in Task 9 that counts `data-testid="answer-row"` in the rendered panel.

---

## File map

| File | Responsibility |
|---|---|
| `src/domain/constants.ts` (modify) | `APPLICATION_STATES`, `APPLICATION_ORIGINS`, `APPLICATION_CLOSE_REASONS`, `INVITATION_TTL_DAYS`, `APPLICATION_AUTO_ACTOR`, `LIFE_STAGE_YEARS` |
| `src/domain/applications.ts` (create) | Status derivation, ordering, adoption-close plan, merge-dedupe plan, submission→application rule, proposal ranking |
| `src/domain/formAnswers.ts` (create) | `FORM_ANSWER_SECTIONS` (moved from FormAnswersPanel), `answerShown`, `summarizeAnswers` |
| `src/domain/placements.ts` (modify) | `takesContract` |
| `src/domain/homeModules.ts` (modify) | `homeAnimalRows` with offers / due / applications slots |
| `src/domain/pendingRowRules.ts` (modify) | `deferredToEvaluation` |
| `src/db/schema.ts` + `drizzle/0106_applications.sql` (create) | Table, indexes, idempotent backfill |
| `src/lib/applicantScope.ts` (modify) | Scope over `applications ⋈ form_submissions`; `generalScopeWhere` |
| `src/lib/applicationWrites.ts` (create) | Create on submit, close on adoption, dedupe after merge, restore on unmerge |
| `src/lib/applicationCounts.ts` (create) | Grouped counts, to-evaluate adopter ids, offer counts |
| `src/lib/formMatchCards.ts` (create) | Match-card profiles extracted from `/form-results` |
| `src/app/actions/_applicants.ts`, `applicants.ts` (modify) | Applicant list over applications, with status. General list loader |
| `src/app/actions/_applications.ts` (create) | Authorization + loaders behind the new actions |
| `src/app/actions/applications.ts` (create, `'use server'`) | The 7 new actions |
| `src/app/actions/_recordWrite.ts`, `src/lib/recordSave.ts` (modify) | Adoption closes the others. `closedApplications` in the save result |
| Contract routes + `contract.ts` (modify) | Fostered animals take contracts. CAS signature |
| `src/lib/adopterMerge.ts` (modify) | Dedupe after merge, restore on undo |
| `src/app/actions/duplicates.ts` (modify) | Q6: pairs inside an evaluation not counted |
| `src/components/ApplicantDetailPanel.tsx` + `src/components/evaluation/*` (create) | Panel changes, dialogs, sheets |
| Home: `homeModulesData.ts`, `types/homeModules.ts`, `HomeModules.tsx`, `HomeApplicantsPanel.tsx` (create) | Rows, panel over the home, offer row |
| `src/app/api/my-animals/route.ts`, `src/app/my-animals/page.tsx`, `src/lib/myAnimalsTabCount.ts` | `?view=solicitudes`, card rows, «Sin animal elegido» card |

---

### Task 1: Domain rules, constants and all copy

**Files:**
- Modify: `src/domain/constants.ts`, `src/domain/placements.ts`, `src/components/FormAnswersPanel.tsx` (import the sections, filter with `answerShown`)
- Create: `src/domain/applications.ts`, `src/domain/formAnswers.ts`
- Modify: `src/i18n/locales/{es,en,pt}.ts` (namespace `evaluation`, plus `common.actor_automatic`, `audit.event_application_closed`)
- Test: `src/domain/applications.test.ts`, `src/domain/formAnswers.test.ts`, `src/i18n/evaluationKeys.test.ts`

**Interfaces:**
- Consumes: `answerSignal`, `personSignal` (`src/domain/answerSignals.ts`).
- Produces (`src/domain/constants.ts`):
  ```ts
  export const APPLICATION_STATES = { OPEN: 'open', DECLINED: 'declined', CLOSED: 'closed', ADOPTED: 'adopted', PROPOSED: 'proposed', REPLACED: 'replaced', ALSO_APPLIED: 'also_applied' } as const;
  export type ApplicationState = typeof APPLICATION_STATES[keyof typeof APPLICATION_STATES];
  export const APPLICATION_ORIGINS = { FORM: 'form', PROPOSED: 'proposed', ADOPTED_ANIMAL: 'adopted_animal' } as const;
  export type ApplicationOrigin = typeof APPLICATION_ORIGINS[keyof typeof APPLICATION_ORIGINS];
  export const APPLICATION_CLOSE_REASONS = { ADOPTED_OTHER: 'adopted_other', ADOPTED_OPEN_LINK: 'adopted_open_link' } as const;
  export type ApplicationCloseReason = typeof APPLICATION_CLOSE_REASONS[keyof typeof APPLICATION_CLOSE_REASONS];
  /** Moved from contract.ts (a sync export from a 'use server' file fails the build). */
  export const INVITATION_TTL_DAYS = 30;
  /** adopter_history.changed_by / applications.closed_by for automatic closes. */
  export const APPLICATION_AUTO_ACTOR = 'application-auto';
  /** «Prefiere» life stage from an animal's estimated birth date (my call — no rule existed). */
  export const LIFE_STAGE_YEARS = { PUPPY_UNDER: 1, SENIOR_FROM: 8 } as const;
  ```
- Produces (`src/domain/applications.ts`):
  ```ts
  export type InvitationLike = { createdAt: number; expiresAt: number | null; usedAt: number | null }; // unix seconds
  export function isLiveInvitation(inv: InvitationLike, nowSec: number): boolean;
  export type ContractNote = { kind: 'replaced' | 'expired'; at: number };
  export function contractNote(invitations: readonly InvitationLike[], nowSec: number): ContractNote | null;
  export type ApplicationFacts = { state: ApplicationState; closeReason: ApplicationCloseReason | null; closedAt: number | null };
  export type ApplicationStatus =
    | { kind: 'to_evaluate'; note: ContractNote | null }
    | { kind: 'contract_sent'; sentAt: number }
    | { kind: 'declined'; at: number | null }
    | { kind: 'closed'; reason: ApplicationCloseReason }
    | { kind: 'adopted' } | { kind: 'proposed' } | { kind: 'replaced' } | { kind: 'also_applied' };
  export function applicationStatus(app: ApplicationFacts, invitations: readonly InvitationLike[], nowSec: number): ApplicationStatus;
  export function isToEvaluate(s: ApplicationStatus): boolean;
  export function panelOrder<T extends { status: ApplicationStatus; appliedAt: number | null }>(items: readonly T[]): T[];
  export function nextToEvaluateIndex(statuses: readonly ApplicationStatus[], from: number): number; // -1 = none left
  export type AdoptionVia = 'invitation' | 'in_app' | 'open_link';
  export function planAdoptionClose(open: ReadonlyArray<{ id: string; adopterId: string | null }>, adopterId: string, via: AdoptionVia):
    Array<{ id: string; state: 'closed' | 'adopted'; closeReason: ApplicationCloseReason | null }>;
  export type MergeApp = { id: string; animalId: string | null; state: ApplicationState; createdAt: number; formOwner: string };
  export function planMergeDedupe(apps: readonly MergeApp[], sameTeam: (a: string, b: string) => boolean):
    Array<{ id: string; state: 'replaced' | 'also_applied'; replacedBy: string }>;
  export function submissionApplication(selectedAnimalId: string | null, animal: { recordType: string | null; adopterId: string | null } | null | undefined):
    { animalId: string | null; origin: ApplicationOrigin; askedAnimalId: string | null };
  export type LifeStage = 'puppy' | 'young' | 'senior';
  export function lifeStageOf(birthMs: number | null, nowMs: number): LifeStage | null;
  export function matchesPreference(animal: { species: string | null; birthMs: number | null }, pref: { species: string | null; lifeStage: string | null }, nowMs: number): boolean;
  export function rankProposalAnimals<T extends { name: string | null; species: string | null; birthMs: number | null }>(animals: readonly T[], pref: { species: string | null; lifeStage: string | null }, nowMs: number): Array<T & { matches: boolean }>;
  ```
- Produces (`src/domain/formAnswers.ts`):
  ```ts
  export const FORM_ANSWER_SECTIONS: ReadonlyArray<{ id: string; titleKey: string; fields: readonly string[] }>; // verbatim from FormAnswersPanel
  export function answerShown(field: string, raw: unknown): boolean;     // FormAnswersPanel renders a row for it
  export type FlaggedAnswer = { field: string; signal: 'risk' | 'caution' }; // field 'household' = the people list
  export function summarizeAnswers(answers: Record<string, unknown>): { flagged: FlaggedAnswer[]; restCount: number };
  ```
- Produces (`src/domain/placements.ts`): `export function takesContract(animal: { adopterId: string | null; recordType: string | null }): boolean`. It is false only for an active ADOPTION.

- [ ] **Step 1: Write the failing tests** (`src/domain/applications.test.ts`), with `NOW = 1_800_000_000` and `DAY = 86_400`:

```ts
it('a link is live while unused and unexpired; expires_at NULL is live (by-token/submit treat it so)', () => {
  expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: null }, NOW)).toBe(true);
  expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: null, usedAt: null }, NOW)).toBe(true);
  expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW, usedAt: null }, NOW)).toBe(false);
  expect(isLiveInvitation({ createdAt: NOW - DAY, expiresAt: NOW + DAY, usedAt: NOW }, NOW)).toBe(false);
});
it('open + live link = contract_sent at the link\'s createdAt', () => {
  expect(applicationStatus(open, [{ createdAt: NOW - 2 * DAY, expiresAt: NOW + 28 * DAY, usedAt: null }], NOW)).toEqual({ kind: 'contract_sent', sentAt: NOW - 2 * DAY });
});
it('retired early → to_evaluate with «replaced» at its expiresAt; ran its 30 days → «expired»', () => {
  expect(applicationStatus(open, [{ createdAt: NOW - 5 * DAY, expiresAt: NOW - 3 * DAY, usedAt: null }], NOW))
    .toEqual({ kind: 'to_evaluate', note: { kind: 'replaced', at: NOW - 3 * DAY } });
  expect(applicationStatus(open, [{ createdAt: NOW - 40 * DAY, expiresAt: NOW - 10 * DAY, usedAt: null }], NOW))
    .toEqual({ kind: 'to_evaluate', note: { kind: 'expired', at: NOW - 10 * DAY } });
});
it('the note comes from the NEWEST dead unused link; a used link gives no note', () => { /* two dead links → newest wins; [used] → note null */ });
it('outcomes ignore links', () => {
  expect(applicationStatus({ state: 'declined', closeReason: null, closedAt: NOW }, [live], NOW)).toEqual({ kind: 'declined', at: NOW });
  expect(applicationStatus({ state: 'closed', closeReason: 'adopted_other', closedAt: NOW }, [], NOW)).toEqual({ kind: 'closed', reason: 'adopted_other' });
});
it('panelOrder: to_evaluate oldest first, then contract_sent, then outcomes newest first', () => { /* ids in expected order */ });
it('nextToEvaluateIndex: next after `from`, else wraps to the first, else -1', () => {
  expect(nextToEvaluateIndex([te, cs, te], 0)).toBe(2);
  expect(nextToEvaluateIndex([te, cs, done], 2)).toBe(0);
  expect(nextToEvaluateIndex([cs, done], 0)).toBe(-1);
});
it('planAdoptionClose: the adopter\'s own → adopted; others → closed adopted_other (invitation, in_app) or adopted_open_link', () => {
  expect(planAdoptionClose([{ id: 'a', adopterId: 'juan' }, { id: 'b', adopterId: 'ana' }, { id: 'c', adopterId: null }], 'juan', 'invitation'))
    .toEqual([{ id: 'a', state: 'adopted', closeReason: null }, { id: 'b', state: 'closed', closeReason: 'adopted_other' }, { id: 'c', state: 'closed', closeReason: 'adopted_other' }]);
  expect(planAdoptionClose([{ id: 'b', adopterId: 'ana' }], 'new-signer', 'open_link')).toEqual([{ id: 'b', state: 'closed', closeReason: 'adopted_open_link' }]);
});
it('planMergeDedupe: per animal the newest open stays; older → replaced; a same-team general → also_applied; another team\'s general stays open', () => {
  const sameTeam = (a: string, b: string) => a.split('@')[1] === b.split('@')[1];
  expect(planMergeDedupe([
    { id: 'old', animalId: 'luna', state: 'open', createdAt: 1, formOwner: 'x@a.org' },
    { id: 'new', animalId: 'luna', state: 'open', createdAt: 2, formOwner: 'y@a.org' },
    { id: 'gen', animalId: null, state: 'open', createdAt: 3, formOwner: 'x@a.org' },
    { id: 'genB', animalId: null, state: 'open', createdAt: 4, formOwner: 'z@b.org' },
    { id: 'done', animalId: 'luna', state: 'declined', createdAt: 0, formOwner: 'x@a.org' },
  ], sameTeam)).toEqual([
    { id: 'old', state: 'replaced', replacedBy: 'new' },
    { id: 'gen', state: 'also_applied', replacedBy: 'new' },
  ]);
});
it('planMergeDedupe: two open generals of one team → the older is replaced by the newer', () => { /* … */ });
it('submissionApplication: adopted animal → general «adopted_animal»; fostered/available → the animal; unknown id → general; lookup failed (undefined) → the animal', () => {
  expect(submissionApplication('luna', { recordType: 'adoption', adopterId: 'p' })).toEqual({ animalId: null, origin: 'adopted_animal', askedAnimalId: 'luna' });
  expect(submissionApplication('luna', { recordType: 'foster', adopterId: 'p' })).toEqual({ animalId: 'luna', origin: 'form', askedAnimalId: null });
  expect(submissionApplication('luna', null)).toEqual({ animalId: null, origin: 'form', askedAnimalId: null });
  expect(submissionApplication('luna', undefined)).toEqual({ animalId: 'luna', origin: 'form', askedAnimalId: null });
  expect(submissionApplication(null, undefined)).toEqual({ animalId: null, origin: 'form', askedAnimalId: null });
});
it('lifeStageOf: <1y puppy, ≥8y senior, else young; null birth → null', () => { /* … */ });
it('rankProposalAnimals: matching species+life stage first (both = dog|cat; other = neither; none/null = any), then by name', () => { /* … */ });
it('takesContract: false only for an active adoption', () => {
  expect(takesContract({ adopterId: 'p', recordType: 'adoption' })).toBe(false);
  expect(takesContract({ adopterId: 'p', recordType: 'foster' })).toBe(true);
  expect(takesContract({ adopterId: null, recordType: 'available' })).toBe(true);
});
```

`src/domain/formAnswers.test.ts`:

```ts
it('flags red before amber, in section order; counts the rest that FormAnswersPanel would show', () => {
  const r = summarizeAnswers({ intent: 'gift', children: '2', isSafe: 'yes', allergy: 'yes', housingType: 'house', motivation: { open: '' }, existingPets: { dog: 0 } });
  expect(r.flagged).toEqual([{ field: 'intent', signal: 'risk' }, { field: 'children', signal: 'caution' }, { field: 'allergy', signal: 'caution' }]);
  expect(r.restCount).toBe(2); // isSafe, housingType — the blank open answer and the all-zero pets are not rows
});
it('a household-people form: the people row is flagged with its worst person (under 5 → risk), «children» is not counted twice', () => {
  expect(summarizeAnswers({ children: '1', householdPeople: [{ relationship: 'child', age: 3 }, { relationship: 'partner', age: 40 }] }).flagged)
    .toEqual([{ field: 'household', signal: 'risk' }]);
});
it('summarizeAnswers counts exactly the rows FormAnswersPanel renders', () => {
  // Fixture with every field type. Render <FormAnswersPanel> via renderToStaticMarkup (t mocked, as HomeModules.test.tsx does),
  // count data-testid="answer-row" + household-people rows, and assert flagged.length + restCount equals it.
});
it('no red or amber → flagged empty', () => { expect(summarizeAnswers({ isSafe: 'yes' }).flagged).toEqual([]); });
```

`src/i18n/evaluationKeys.test.ts`: the key paths of `evaluation` (recursively), plus `common.actor_automatic` and `audit.event_application_closed`, are the same set in `es`, `en` and `pt`, and every value is a non-empty string.

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/domain/applications.test.ts src/domain/formAnswers.test.ts src/i18n/evaluationKeys.test.ts`
Expected: FAIL. Cannot find module `./applications` / `./formAnswers`, and `evaluation` is undefined.

- [ ] **Step 3: Implement the constants, `applications.ts`, `formAnswers.ts` and `takesContract`**

Rules the signatures don't pin:
- `contractNote` looks only at unused, dead links (`!isLiveInvitation && usedAt == null`). It returns null when any link is live.
  - `kind: 'replaced'` when `expiresAt < createdAt + INVITATION_TTL_DAYS*86400`, else `'expired'`.
  - `at = expiresAt`.
- `applicationStatus`:
  - state `open` with a live link → `contract_sent`, where `sentAt` is the newest live link's `createdAt`.
  - state `open` without a live link → `to_evaluate` with its `contractNote`.
  - Every other state maps 1:1. `closed` with a null reason is treated as `adopted_other`.
- `planMergeDedupe` considers only `open` rows.
  1. Group the open animal rows by `animalId`. The highest `createdAt` stays. The others become `replaced`, with `replacedBy` = the survivor.
  2. Open generals: if any surviving open animal row has `sameTeam(general.formOwner, row.formOwner)`, the general becomes `also_applied`, with `replacedBy` = the newest such row.
  3. Otherwise generals of the same team dedupe like animal rows.
- `answerShown` returns false for undefined/null/'', for `{ open: '' }`, and for `existingPets` that isn't an object or has no positive count. Anything else is true.
- `summarizeAnswers`:
  - Walk `FORM_ANSWER_SECTIONS` in order, over shown fields only.
  - When `householdPeople` is an array, the `children` field becomes the single `household` entry, with the worst `personSignal` (or counted in the rest if every person is green).
  - Red entries are listed before amber ones. `restCount` = shown rows − flagged.
- `FormAnswersPanel`: replace its local `sections` array with `FORM_ANSWER_SECTIONS`. Replace the `visibleFields` filter with `answerShown`. Visible output is unchanged.
- `createContractInvitation` keeps its behaviour. It now imports `INVITATION_TTL_DAYS` from constants, and the local const is deleted.

- [ ] **Step 4: Add the copy.**

Namespace `evaluation` in `es.ts`, `en.ts` and `pt.ts`, values verbatim. `{n}`, `{name}`, `{animal}` and `{date}` are interpolated with `interpolate()`. Keys ending `_f`/`_m` are picked by the animal's sex (`hembra`/`female` → `_f`, else `_m`, as HomeDuePanel does).

| key | es | en | pt |
|---|---|---|---|
| to_evaluate_one | 1 solicitud por evaluar | 1 application to review | 1 candidatura para avaliar |
| to_evaluate_many | {n} solicitudes por evaluar | {n} applications to review | {n} candidaturas para avaliar |
| general_title | Sin animal elegido | No animal chosen | Sem animal escolhido |
| general_body | Formularios generales, y los que pidieron un animal que ya fue adoptado. | General forms, and people who asked for an animal that was already adopted. | Formulários gerais, e quem pediu um animal que já foi adotado. |
| tab | Con solicitudes por evaluar | With applications to review | Com candidaturas para avaliar |
| more_one | 1 animal más con solicitudes | 1 more animal with applications | Mais 1 animal com candidaturas |
| more_many | {n} animales más con solicitudes | {n} more animals with applications | Mais {n} animais com candidaturas |
| offer_row_one_f / _m | {animal} fue adoptada · avisá a 1 candidato / adoptado · … | {animal} was adopted · tell 1 applicant | {animal} foi adotada / adotado · avise 1 candidato |
| offer_row_many_f / _m | {animal} fue adoptada · avisá a {n} candidatos / adoptado · … | {animal} was adopted · tell {n} applicants | {animal} foi adotada / adotado · avise {n} candidatos |
| status_contract_sent | Contrato enviado el {date} | Contract sent {date} | Contrato enviado em {date} |
| status_declined | No avanzó · {date} | Not moving forward · {date} | Não avançou · {date} |
| status_closed | Cerrada: {reason} | Closed: {reason} | Encerrada: {reason} |
| closed_other_f / _m | {animal} fue adoptada por otra persona / adoptado … | {animal} was adopted by someone else | {animal} foi adotada / adotado por outra pessoa |
| closed_open_link_f / _m | {animal} fue adoptada / adoptado | {animal} was adopted | {animal} foi adotada / adotado |
| status_adopted | Adoptó a {animal} | Adopted {animal} | Adotou {animal} |
| status_proposed | Propuesta para {animal} | Proposed for {animal} | Proposta para {animal} |
| status_replaced | Reemplazada por un formulario más nuevo | Replaced by a newer form | Substituída por um formulário mais novo |
| status_also_applied | También pidió a {animal} | Also applied for {animal} | Também pediu {animal} |
| note_replaced | Su contrato se reemplazó el {date} | Their contract was replaced on {date} | O contrato foi substituído em {date} |
| note_expired | Su contrato venció el {date} | Their contract expired on {date} | O contrato venceu em {date} |
| asked_adopted_f / _m | Pidió a {animal} (ya adoptada) / (ya adoptado) | Asked for {animal} (already adopted) | Pediu {animal} (já adotada) / (já adotado) |
| answers_rest_one | 1 respuesta sin observaciones | 1 answer with nothing to note | 1 resposta sem observações |
| answers_rest_many | {n} respuestas sin observaciones | {n} answers with nothing to note | {n} respostas sem observações |
| answers_see_all | Ver todas | See all | Ver todas |
| answers_none | Ninguna respuesta para revisar | No answers to check | Nenhuma resposta para revisar |
| decline | No avanzar | Don't move forward | Não avançar |
| propose | Proponer un animal | Suggest an animal | Propor um animal |
| decline_title_animal | No avanzar con {name} para {animal} | Don't move forward with {name} for {animal} | Não avançar com {name} para {animal} |
| decline_title | No avanzar con {name} | Don't move forward with {name} | Não avançar com {name} |
| decline_note | Se guarda como una observación en el perfil de {name}, como cualquier otra. | It's saved as an observation on {name}'s profile, like any other. | Fica salvo como uma observação no perfil de {name}, como qualquer outra. |
| decline_prefill_animal | No avanzamos con su solicitud para {animal}. | We're not moving forward with their application for {animal}. | Não avançamos com a candidatura para {animal}. |
| decline_prefill | No avanzamos con su solicitud. | We're not moving forward with their application. | Não avançamos com a candidatura. |
| decline_text_label | Observación | Observation | Observação |
| decline_rating | Calificación (1-5) | Rating (1-5) | Avaliação (1-5) |
| decline_reason | Motivo | Reason | Motivo |
| decline_save | Guardar | Save | Salvar |
| missing_both | Falta: calificación y motivo | Missing: rating and reason | Falta: avaliação e motivo |
| missing_rating | Falta: calificación | Missing: rating | Falta: avaliação |
| missing_reason | Falta: motivo | Missing: reason | Falta: motivo |
| decline_failed | No se pudo guardar. Probá de nuevo. | Couldn't save. Try again. | Não foi possível salvar. Tente de novo. |
| propose_title | Proponer un animal a {name} | Suggest an animal to {name} | Propor um animal para {name} |
| candidates_one | 1 candidato | 1 applicant | 1 candidato |
| candidates_many | {n} candidatos | {n} applicants | {n} candidatos |
| candidates_none | Sin candidatos | No applicants | Sem candidatos |
| propose_empty | No hay animales que puedan recibir solicitudes. | No animals can take applications right now. | Não há animais que possam receber candidaturas. |
| propose_already | {name} ya es candidato de {animal}. | {name} is already an applicant for {animal}. | {name} já é candidato de {animal}. |
| propose_failed | No se pudo proponer. Probá de nuevo. | Couldn't suggest it. Try again. | Não foi possível propor. Tente de novo. |
| offer_title | Avisar a los otros candidatos | Let the other applicants know | Avisar os outros candidatos |
| offer_message_label | Mensaje | Message | Mensagem |
| offer_message | Hola {name}, gracias por tu interés en {animal}. Ya encontró familia. Si querés, te avisamos cuando haya otro animal que se ajuste a lo que buscás. | Hi {name}, thanks for your interest in {animal}. They've found a home. If you'd like, we'll let you know when another animal matches what you're looking for. | Olá {name}, obrigado pelo seu interesse em {animal}. Já encontrou uma família. Se quiser, avisamos quando houver outro animal que combine com o que você procura. |
| offer_not_now | Ahora no | Not now | Agora não |
| offer_done | Listo | Done | Pronto |
| offer_failed | No se pudo cargar la lista. | Couldn't load the list. | Não foi possível carregar a lista. |
| back | ← Volver | ← Back | ← Voltar |
| action_failed | No se pudo completar. Probá de nuevo. | Couldn't complete it. Try again. | Não foi possível concluir. Tente de novo. |

Also add:
- `common.actor_automatic`: «Automático» / «Automatic» / «Automático».
- `audit.event_application_closed`: «Solicitud cerrada» / «Application closed» / «Candidatura encerrada».

- [ ] **Step 5: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx vitest run src/components` (FormAnswersPanel consumers).
Expected: PASS. The existing FormAnswersPanel/answer-layout component tests are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/domain/constants.ts src/domain/applications.ts src/domain/applications.test.ts src/domain/formAnswers.ts src/domain/formAnswers.test.ts src/domain/placements.ts src/components/FormAnswersPanel.tsx src/app/actions/contract.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts src/i18n/evaluationKeys.test.ts
git commit -m "feat(evaluation): domain rules, constants and copy for applicant evaluation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `applications` table, migration and backfill

**Files:**
- Modify: `src/db/schema.ts` (after `contractInvitations`)
- Create: `drizzle/0106_applications.sql`
- Test: `src/db/applicationsMigration.test.ts`

**Interfaces:**
- Consumes: the constants from Task 1 (the values only. The SQL hard-codes the same strings, and the test asserts they're equal to the constants).
- Produces: `applications` in `src/db/schema.ts`. Columns in camelCase: `id`, `submissionId`, `animalId`, `origin`, `askedAnimalId`, `state`, `closeReason`, `declineRecordId`, `proposedApplicationId`, `replacedByApplicationId`, `offerDoneAt`, `closedAt`, `closedBy`, `createdAt`. All timestamps are `integer(..., { mode: 'timestamp' })` except `offerDoneAt`/`closedAt`, which are plain unix-second integers like `contract_invitations`. Indexes:
  - `idx_applications_animal_state` (animal_id, state)
  - `idx_applications_submission` (submission_id)
  - `idx_applications_one_per_form`: UNIQUE (submission_id) WHERE origin <> 'proposed'
  - `idx_applications_one_proposal`: UNIQUE (submission_id, animal_id) WHERE origin = 'proposed'
- There is **no `adopter_id`**: the adopter is `form_submissions.linked_adopter_id` through `submission_id` (see the deviations in the report).

- [ ] **Step 1: Write the failing test**

```ts
// migratedDb() then seed rows, then re-run 0106's statements (idempotence + backfill).
it('backfills one application per form: available → open, general → open, adopted by the applicant → adopted, adopted by someone else → closed with no offer', () => {
  // Seed: animals luna (no placement), sol (adoption placement adopter 'juan'), mia (FOSTER placement 'x').
  // Forms: s1→luna (linked ana), s2→sol (linked juan), s3→sol (linked ana), s4 general, s5→mia.
  rerun0106();
  expect(rows()).toEqual([
    { id: 'app-s1', animal_id: 'luna', origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
    { id: 'app-s2', animal_id: 'sol', origin: 'form', state: 'adopted', close_reason: null, offer_done_at: expect.any(Number) },
    { id: 'app-s3', animal_id: 'sol', origin: 'form', state: 'closed', close_reason: 'adopted_other', offer_done_at: expect.any(Number) },
    { id: 'app-s4', animal_id: null, origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
    { id: 'app-s5', animal_id: 'mia', origin: 'form', state: 'open', close_reason: null, offer_done_at: null },
  ]);
});
it('re-running the migration adds nothing and changes nothing', () => { rerun0106(); const a = rows(); rerun0106(); expect(rows()).toEqual(a); });
it('one form application per submission; one proposal per (submission, animal)', () => {
  expect(() => insertApp({ id: 'dup', submission_id: 's1', origin: 'form' })).toThrow(/UNIQUE/);
  insertApp({ id: 'p1', submission_id: 's4', animal_id: 'luna', origin: 'proposed' });
  expect(() => insertApp({ id: 'p2', submission_id: 's4', animal_id: 'luna', origin: 'proposed' })).toThrow(/UNIQUE/);
});
it('the SQL literals equal the domain constants', () => { /* APPLICATION_STATES.OPEN === 'open' … read from the .sql text */ });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/db/applicationsMigration.test.ts`
Expected: FAIL with "no such table: applications".

- [ ] **Step 3: Write `drizzle/0106_applications.sql` and the schema entry**

Start with a header comment: the date, why, "Additive only", and that production has 0 forms. Then `CREATE TABLE IF NOT EXISTS applications (…)`, the four `CREATE [UNIQUE] INDEX IF NOT EXISTS`, separated by `--> statement-breakpoint`, then the backfill:

```sql
INSERT OR IGNORE INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at, closed_at, closed_by, created_at)
SELECT 'app-' || fs.id, fs.id, fs.selected_animal_id, 'form',
  CASE WHEN p.id IS NULL THEN 'open' WHEN p.adopter_id = fs.linked_adopter_id THEN 'adopted' ELSE 'closed' END,
  CASE WHEN p.id IS NOT NULL AND p.adopter_id IS NOT fs.linked_adopter_id THEN 'adopted_other' END,
  CASE WHEN p.id IS NOT NULL THEN CAST(strftime('%s','now') AS INTEGER) END,
  p.started_at,
  CASE WHEN p.id IS NOT NULL THEN 'application-auto' END,
  fs.created_at
FROM form_submissions fs
LEFT JOIN placements p ON p.animal_id = fs.selected_animal_id AND p.ended_at IS NULL AND p.record_type = 'adoption'
```

`offer_done_at` is set on every backfilled closed row, so the home never shows a stale «avisá a N» (spec «Existing data»: no offer sheet). Run `.agents/workflows/schema-sync.md` for the local DBs.

- [ ] **Step 4: Run the test and confirm it passes**

Run: the Step 2 command.
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/0106_applications.sql src/db/applicationsMigration.test.ts
git commit -m "feat(evaluation): applications table with idempotent backfill from form_submissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Applicants are applications: scope, list, invitation access, form submit

**Files:**
- Modify: `src/lib/applicantScope.ts`, `src/lib/applicantScope.test.ts`
- Modify: `src/app/actions/_applicants.ts` (`listApplicantIdsForAnimal`, `loadApplicantsForAnimal`, new `loadGeneralApplications`, shared `enrichApplicantRows`)
- Modify: `src/app/actions/applicants.ts` (`ApplicantSummary` fields)
- Modify: `src/lib/contractInvitationAccess.ts`, `src/lib/contractInvitationAccess.test.ts` (fake gains `innerJoin`)
- Create: `src/lib/applicationWrites.ts` (`createApplicationForSubmission`)
- Modify: `src/app/api/form/[userId]/submit/route.ts`
- Modify fixtures: `tests/seed.sql` (an `applications` row for each of `test-sub-fixture-apl-owner`, `-apl-mate`, `-apl-outsider`, `-apl-link`, `-xorg-mate`, `-xorg-outsider`, with ids `app-<submission id>`), `src/app/actions/_applicants.alerts.test.ts` (insert the matching applications). Grep `src/**/*.test.ts` for `INTO form_submissions` and add rows wherever the test reads applicants.
- Test: `src/app/actions/_applicants.applications.test.ts`, `src/lib/applicationWrites.test.ts`

**Interfaces:**
- Consumes: `applicationStatus`, `isToEvaluate`, `submissionApplication`, `APPLICATION_*` (Task 1); `applications` (Task 2).
- Produces:
  ```ts
  // applicantScope.ts — callers MUST innerJoin(formSubmissions, eq(formSubmissions.id, applications.submissionId))
  export function applicantScopeWhere(animalId: string, teamEmails: ReadonlyArray<string | null | undefined>): SQL | null; // applications.animal_id = ? AND OR(lower(form_submissions.user_id) = ?)
  export function generalScopeWhere(teamEmails: ReadonlyArray<string | null | undefined>): SQL | null;                     // applications.animal_id IS NULL AND OR(...)
  // _applicants.ts
  export async function listApplicantIdsForAnimal(db, animalId: string, teamEmails: readonly string[]): Promise<Array<{ submissionId: string; applicationId: string }>>; // excludes state 'replaced'
  export async function loadApplicantsForAnimal(db, animal: { id: string; adopterId: string | null }, teamEmails: readonly string[], viewerEmail: string | null | undefined): Promise<ApplicantSummary[]>; // panelOrder
  export async function loadGeneralApplications(db, teamEmails: readonly string[], viewerEmail: string | null | undefined): Promise<ApplicantSummary[]>; // panelOrder
  // applicants.ts — ApplicantSummary gains:
  applicationId: string; origin: ApplicationOrigin; status: ApplicationStatus;
  askedAnimal: { id: string; name: string; sex: string | null } | null; // origin adopted_animal, only when teammateVisibleAnimal allows
  // hasInvite := status.kind === 'contract_sent'   (fixes «Reenviar» for dead links)
  // isSigned  := status.kind === 'adopted'         (a foster holder's own application is not «Firmado»)
  // applicationWrites.ts
  export async function createApplicationForSubmission(db, input: { submissionId: string; selectedAnimalId: string | null; animal: { recordType: string | null; adopterId: string | null } | null | undefined; createdAt: Date }): Promise<string>; // application id = 'app-' + submissionId; INSERT OR IGNORE
  ```

- [ ] **Step 1: Write the failing tests**

`applicantScope.test.ts` (update the existing assertions):

```ts
expect(q.sql).toContain('"applications"."animal_id" = ?');
expect(q.sql.match(/lower\("form_submissions"\."user_id"\) = \?/g)).toHaveLength(2);
// generalScopeWhere: '"applications"."animal_id" is null', one OR per email, null for an empty team, never `in (`.
```

`_applicants.applications.test.ts` (migratedDb + `asyncDb`, as in `_applicants.alerts.test.ts`):

```ts
it('lists the animal\'s applications through the owner\'s team — a forged outsider row and a «replaced» row never show', async () => { … });
it('a proposed application (origin proposed, submission has selected_animal_id NULL) is a candidate of the animal', async () => { … });
it('status: live link → contract_sent and hasInvite; a retired link → to_evaluate with note replaced, hasInvite false', async () => { … });
it('order: por evaluar oldest first, then contract sent, then outcomes', async () => { … });
it('loadGeneralApplications: animal_id NULL rows of the viewer\'s team; askedAnimal named only for the team\'s own animal (forged other-team animal → null)', async () => { … });
```

`contractInvitationAccess.test.ts`: add `it('a person proposed for the animal counts as an applicant', …)`. Its fake `from(applications).innerJoin(…).where(…).all()` returns the submissions.

`applicationWrites.test.ts`:

```ts
it('submit for an adopted animal stores a general «adopted_animal» application remembering the animal', async () => { … });
it('called twice for one submission → one row', async () => { … });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/lib/applicantScope.test.ts src/app/actions/_applicants.applications.test.ts src/lib/contractInvitationAccess.test.ts src/lib/applicationWrites.test.ts`
Expected: FAIL. The SQL still names `selected_animal_id`, and `applicationId` is undefined.

- [ ] **Step 3: Implement**

- `loadApplicantsForAnimal`:
  - Select from `applications` `innerJoin` `formSubmissions`, with the same columns as today plus the application's `id`, `origin`, `state`, `closeReason`, `closedAt` and `createdAt`.
  - Per row, replace the `hasInvite` query with one query for every invitation of `(animalId, linkedAdopterId)`, selecting `{ createdAt, expiresAt, usedAt }`. That's the same one-query-per-row budget as today.
  - Compute `status` with `applicationStatus(…, nowSec)`. Return `panelOrder(enriched)` instead of newest-first.
  - Extract the per-row enrichment into `enrichApplicantRows(db, rows, ctx)` so `loadGeneralApplications` reuses it verbatim. General rows have no invitations.
- `askedAnimal`: one `animals` read per adopted_animal row, filtered by `teammateVisibleAnimal({ id, name, owner }, teamEmails)`.
- `resolveInvitationAccess`: query `applications` `innerJoin` `formSubmissions` `where(and(scope, or(eq(linkedAdopterId, adopter.id), eq(autoAdopterId, adopter.id))))`. The rest is unchanged.
- Submit route:
  - Extend the existing selected-animal lookup to read `recordType` and `adopterId` too. It stays `undefined` when the lookup throws, and becomes `null` when there's no row.
  - Right after it, call `createApplicationForSubmission` in its own `try`/`catch` that logs `logger.error('form submit: application not created', e, { submissionId, selectedAnimalId })`. The form stays saved.
- `tests/seed.sql`: insert the six `applications` rows (state `open`, origin `form`, `animal_id` = the submission's `selected_animal_id`).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `src/app/actions/_applicants.alerts.test.ts` and `src/lib/applicantScope.test.ts`.
Expected: PASS.

- [ ] **Step 5: Run the e2e specs that read applicants**

Run: `npx playwright test tests/team-applicants.spec.ts tests/form-results-link.authed.spec.ts tests/form-results-masking.authed.spec.ts tests/form-results-denied.authed.spec.ts`
Expected: PASS. Same applicants as before, now through `applications`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/applicantScope.ts src/lib/applicantScope.test.ts src/app/actions/_applicants.ts src/app/actions/applicants.ts src/lib/contractInvitationAccess.ts src/lib/contractInvitationAccess.test.ts src/lib/applicationWrites.ts src/lib/applicationWrites.test.ts src/app/actions/_applicants.applications.test.ts src/app/actions/_applicants.alerts.test.ts "src/app/api/form/[userId]/submit/route.ts" tests/seed.sql
git commit -m "feat(evaluation): applicants are applications — scope, status, invitation access, submit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: An adoption closes the other candidates

**Files:**
- Modify: `src/lib/applicationWrites.ts` (`closeApplicationsOnAdoption`)
- Modify: `src/app/actions/_recordWrite.ts` (`updateRecord` opts and return)
- Modify: `src/lib/recordSave.ts` (`RecordSaveResult.closedApplications`)
- Modify: `src/lib/userDisplay.ts` (`SYSTEM_ACTOR_LABEL_KEYS`: `[APPLICATION_AUTO_ACTOR, 'common.actor_automatic']`)
- Modify: `src/components/AdopterProfileV2.tsx` (history: `application_closed`)
- Test: `src/lib/applicationClose.test.ts`

**Interfaces:**
- Consumes: `planAdoptionClose`, `AdoptionVia`, `APPLICATION_AUTO_ACTOR` (Task 1); `applicantScopeWhere` (Task 3).
- Produces:
  ```ts
  export async function closeApplicationsOnAdoption(db, input: { animalId: string; ownerEmail: string | null; animalName: string | null; animalSex: string | null; adopterId: string; via: AdoptionVia; nowSec: number }): Promise<number>; // count closed for OTHERS; never throws (logs error, returns 0)
  // _recordWrite.ts
  export async function updateRecord(db, data, existing, actor, opts?: { cas?: boolean; adoptionVia?: AdoptionVia }): Promise<{ lost: boolean; landed?: string[]; closedApplications?: number }>;
  // recordSave.ts
  export type RecordSaveResult = { …existing; closedApplications?: { animalId: string; count: number } };
  ```
- History row on each closed candidate's profile (`form_submissions.linked_adopter_id`):
  - `changedBy: APPLICATION_AUTO_ACTOR`, `kind: 'contribution'` (explicit).
  - `changes: JSON.stringify({ application_closed: { animalId, animalName, animalSex, reason } })`.
  - Not a record and no rating.

- [ ] **Step 1: Write the failing tests** (migratedDb, calling `updateRecord` directly):

```ts
it('available → adoption: in-scope open applications of others close (adopted_other), the adopter\'s own → adopted, a history row each, by the automatic actor, kind contribution', async () => { … });
it('foster → adoption (ended then opened) closes them too', async () => { … });
it('a FOSTER placement closes nothing', async () => { … });
it('a lost CAS race (someone else holds the animal) closes nothing and returns lost', async () => { … });
it('via open_link: every open candidate closes with adopted_open_link and offer_done_at set (no offer)', async () => { … });
it('a forged outsider row (form link outside the owner\'s team) is left untouched', async () => { … });
it('a failure inside the close never throws into the adoption: placement landed, logger.error called with { animalId, adopterId }', async () => { … });
it('saveRecordFor reports closedApplications for the in-app adoption of an inventory animal', async () => { … });
```

Plus a `userDisplay` test: `actorLabel('application-auto', null, t) === t('common.actor_automatic')`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/lib/applicationClose.test.ts src/lib/userDisplay.test.ts`
Expected: FAIL. `closeApplicationsOnAdoption` is not exported.

- [ ] **Step 3: Implement**

- In `updateRecord`, call `closeApplicationsOnAdoption` only after `openPlacement(...)` returned true AND `desiredType === RECORD_TYPES.ADOPTION`. That covers both the "ended then open" branch and the "available → placed" branch.
  - Pass `ownerEmail: existing.addedBy`, `animalName: existing.animalName`, `animalSex: existing.sex`, `via: opts.adoptionVia ?? 'in_app'`.
  - Put the result in `closedApplications`.
- `closeApplicationsOnAdoption`:
  1. Resolve the scope with `getTeamEmails(ownerEmail)`, and read the open in-scope rows (with `linked_adopter_id`).
  2. Apply `planAdoptionClose`.
  3. Update each row by `id` AND `state = 'open'`. Write `closed_at = nowSec` and `closed_by = APPLICATION_AUTO_ACTOR`. `open_link` rows also get `offer_done_at = nowSec`.
  4. Insert a history row per closed row that has an adopter.
  5. Wrap everything in one `try`/`catch` → `logger.error('closeApplicationsOnAdoption failed', e, { animalId, adopterId, via })`, returning 0.
- In `updateRecordFields`, carry `closedApplications` from the winning `updateRecord` call into the result when > 0.
- `AdopterProfileV2`:
  - Parse `parsed.application_closed` → eventType `application_closed`, badge `audit.event_application_closed`.
  - Description: `evaluation.closed_other_{f|m}` or `evaluation.closed_open_link_{f|m}`, with `{animal}`.
  - Grep the other `adopter_history` readers (`activity.ts`, `OrgActivityFeed.tsx`, `recordFieldAuthors`, approvers) and make sure none treats this row as a rescuer's edit. They key on other change names; if one generic-renders unknown keys, skip `application_closed` there.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx vitest run src/lib/recordSave src/app/actions/_recordWrite`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/applicationWrites.ts src/lib/applicationClose.test.ts src/app/actions/_recordWrite.ts src/lib/recordSave.ts src/lib/userDisplay.ts src/lib/userDisplay.test.ts src/components/AdopterProfileV2.tsx
git commit -m "feat(evaluation): an adoption closes the other candidates at the single write point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fostered animals take applications and contracts

**Files:**
- Modify: `src/app/actions/contract.ts:69`, `src/app/api/contract/by-token/[token]/route.ts:70`, `src/app/api/contract/[id]/submit/route.ts:118,205-231`
- Modify: `src/app/api/my-animals/route.ts:184` (applicants for foster too), `src/lib/homeModulesData.ts:203` (`status !== 'adopted'`)
- Test: `src/lib/contractFosterSign.test.ts`

**Interfaces:**
- Consumes: `takesContract` (Task 1); `updateRecord(…, { cas: true, adoptionVia })` (Task 4).
- Produces: the three routes refuse only when `!takesContract(animal)`. Submit calls `updateRecord(db, {...}, animal, 'contract', { cas: true, adoptionVia: invitation ? 'invitation' : 'open_link' })`. When `lost`, it deletes the stored contract (as the conflict branch does today) and answers `409 { code: 'already_placed', errorId }`.

- [ ] **Step 1: Write the failing tests** (migratedDb, `updateRecord` with the submit route's exact arguments and the view row as `existing`):

```ts
it('signing for a fostered animal ends the foster and opens the adoption — one active placement', async () => { … });
it('contract signature on a fostered animal loses to a concurrent adoption: lost=true and the other adoption stays active', async () => {
  // existing = view row read while fostered; then (simulated race) end foster + open adoption for 'b';
  // updateRecord(…, { cas: true, adoptionVia: 'invitation' }) → { lost: true }; active placement still b's adoption.
});
it('createContractInvitation accepts a fostered animal and refuses an adopted one', async () => { … });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/lib/contractFosterSign.test.ts`
Expected: FAIL. «Animal already adopted» comes back for the fostered animal.

- [ ] **Step 3: Implement**

Swap the three `animal.adopterId` guards for `!takesContract(animal)`. Keep their existing status codes and `code` values. In submit, branch on `{ lost }` as well as on `isActivePlacementConflict` (keep both). Update the route comments that say "it was 'available' with no placement".

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx playwright test tests/contract-link.spec.ts tests/contract-storage.authed.spec.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/contract.ts "src/app/api/contract/by-token/[token]/route.ts" "src/app/api/contract/[id]/submit/route.ts" src/app/api/my-animals/route.ts src/lib/homeModulesData.ts src/lib/contractFosterSign.test.ts
git commit -m "feat(evaluation): fostered animals take contracts; signing is compare-and-swap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One application per person per animal after a merge

**Files:**
- Modify: `src/lib/applicationWrites.ts` (`dedupeApplicationsAfterMerge`, `restoreApplicationStates`)
- Modify: `src/lib/adopterMerge.ts` (after step 5b; the undo type at ~610 gains `applicationStates?`; unmerge step 2)
- Test: `src/lib/applicationMerge.test.ts`

**Interfaces:**
- Consumes: `planMergeDedupe` (Task 1); `createOwnerTeamResolver` (`_applicants.ts`) for `sameTeam`.
- Produces:
  ```ts
  export type ApplicationStateUndo = { id: string; state: ApplicationState; replacedBy: string | null };
  export async function dedupeApplicationsAfterMerge(db, survivorId: string, ctx: { actorEmail: string }): Promise<ApplicationStateUndo[]>; // prior states of the rows it changed; never throws (logs, returns [])
  export async function restoreApplicationStates(db, undo: readonly ApplicationStateUndo[]): Promise<void>; // per id, chunked OR like repointRows
  ```

- [ ] **Step 1: Write the failing tests** (migratedDb, real `mergeAdopters` / `unmergeAdopters`):

```ts
it('after «Sí, es la misma persona» the newer form for Luna stays, the older reads replaced', async () => { … });
it('a general application of the survivor ends as also_applied when the same team has their open Luna application', async () => { … });
it('another team\'s general application is left open', async () => { … });
it('unmergeAdopters restores the application states the merge changed', async () => { … });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/lib/applicationMerge.test.ts`
Expected: FAIL. Both applications are still open.

- [ ] **Step 3: Implement**

- `dedupeApplicationsAfterMerge` reads every application whose submission's `linked_adopter_id = survivorId`, joined to the submission's `user_id` as `formOwner`.
  - `sameTeam(a, b)` = `(await resolver(a)).includes(b.toLowerCase())`. Resolve every distinct owner first; the function is sync.
  - Apply the plan with `UPDATE … WHERE id = ? AND state = 'open'`, setting `state`, `replaced_by_application_id`, `closed_at` and `closed_by = APPLICATION_AUTO_ACTOR`.
- In `mergeAdopters`, after 5b: `undo.applicationStates = await dedupeApplicationsAfterMerge(db, primaryId, { actorEmail })`. In `unmergeAdopters` step 2: `await restoreApplicationStates(db, undo.applicationStates ?? [])`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx vitest run src/lib/adopterMerge src/app/actions/mergePendingDedupPair.test.ts` and `npx playwright test tests/merge-undo.authed.spec.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/applicationWrites.ts src/lib/adopterMerge.ts src/lib/applicationMerge.test.ts
git commit -m "feat(evaluation): one application per person per animal after a merge; undo restores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Counts, and the duplicate that is not a second to-do (Q6)

**Files:**
- Create: `src/lib/applicationCounts.ts`
- Modify: `src/domain/pendingRowRules.ts` (`deferredToEvaluation`)
- Modify: `src/app/actions/duplicates.ts` (the `needs` loop, ~1335)
- Test: `src/lib/applicationCounts.test.ts`, `src/domain/pendingRowRules.test.ts`, `src/app/actions/pendingDedupFeed.test.ts` (add a case)

**Interfaces:**
- Consumes: `applicantScopeWhere`, `generalScopeWhere` (Task 3); `isLiveInvitation` semantics (Task 1).
- Produces:
  ```ts
  /** Open applications with NO live link (usedAt NULL AND (expiresAt NULL OR > now)), per animal, for animals whose owner's team is `ownerTeam`. ONE grouped query. */
  export async function countToEvaluateByAnimal(db, ownerTeam: readonly string[], nowSec: number): Promise<Map<string, number>>;
  /** Open applications (to evaluate + contract sent) per animal — «N candidatos». ONE grouped query. */
  export async function countOpenByAnimal(db, ownerTeam: readonly string[]): Promise<Map<string, number>>;
  export async function countGeneralToEvaluate(db, viewerTeam: readonly string[]): Promise<number>;
  /** Linked adopter ids of the team's applications still to evaluate (animal + general). */
  export async function toEvaluateAdopterIds(db, team: readonly string[], nowSec: number): Promise<Set<string>>;
  /** Animals with closed adopted_other applications whose offer is not done: animalId → candidates. */
  export async function offerCountsByAnimal(db, ownerTeam: readonly string[]): Promise<Map<string, number>>;
  // pendingRowRules.ts
  export function deferredToEvaluation(pair: { group: RowPair['group']; adopter1Id: string; adopter2Id: string }, toEvaluate: ReadonlySet<string>): boolean; // only group 'pair'
  ```
- Decision pinned here: «Contrato enviado» IS an outcome (spec «Words»). A pair whose applicant has a live link counts again in «esperan tu respuesta».

- [ ] **Step 1: Write the failing tests**

```ts
// applicationCounts.test.ts — one fixture: Luna (owner O, team O+M) with apps via O's link (no link), via M's link (live link),
// via M's link (retired link), via O's link (expired link), via O's link (expires_at NULL link), via an outsider's link (no link);
// a cross-org animal whose applicant came through the owner's other group.
it('countToEvaluateByAnimal equals loadApplicantsForAnimal().filter(isToEvaluate) on the edge fixture', async () => {
  for (const animal of ['luna', 'brisa']) expect((await countToEvaluateByAnimal(db, teamOf(animal), NOW)).get(animal) ?? 0)
    .toBe((await loadApplicantsForAnimal(db, { id: animal, adopterId: null }, teamOf(animal), OWNER)).filter(a => isToEvaluate(a.status)).length);
});
it('binds no arrays and issues one query per call', async () => { /* spy on db.select */ });
it('toEvaluateAdopterIds excludes an applicant with a live link', async () => { … });
// pendingRowRules.test.ts
it('deferredToEvaluation: a plain possible duplicate with a side in evaluation → true; a received request → false', () => { … });
// pendingDedupFeed.test.ts
it('a pending pair whose side is the team\'s applicant to evaluate is not counted in needsViewer; after «No avanzar» it counts again', async () => { … });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/lib/applicationCounts.test.ts src/domain/pendingRowRules.test.ts src/app/actions/pendingDedupFeed.test.ts`
Expected: FAIL. The module is missing and needsViewer is 1.

- [ ] **Step 3: Implement**

Each count is a single `select … from applications innerJoin formSubmissions leftJoin contractInvitations on (animal_id, adopter_id = linked_adopter_id, used_at IS NULL, (expires_at IS NULL OR expires_at > now)) where state='open' and scope … group by animal_id`. In `getPendingDuplicatesForUser`:
1. Start `toEvaluateAdopterIds(db, team, nowSec)` with the other reads. On failure it logs a warn, returns an empty set, and counts as today.
2. In the `needs` loop, skip `needs.add` when `deferredToEvaluation({ group, adopter1Id: c.adopter1Id, adopter2Id: c.adopter2Id }, ids)`.

The row then lists under «No necesitan nada tuyo» on /my-adopters, and leaves the home and the header count.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx playwright test tests/pendientes-d.authed.spec.ts tests/home-modules.user.spec.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/applicationCounts.ts src/lib/applicationCounts.test.ts src/domain/pendingRowRules.ts src/domain/pendingRowRules.test.ts src/app/actions/duplicates.ts src/app/actions/pendingDedupFeed.test.ts
git commit -m "feat(evaluation): grouped application counts; a duplicate inside an evaluation is not a second to-do

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The evaluation server actions

**Files:**
- Create: `src/app/actions/_applications.ts` (`loadAuthorizedApplication`, loaders), `src/app/actions/applications.ts` (`'use server'`)
- Create: `src/lib/formMatchCards.ts`. Extracted from `src/app/form-results/[submissionId]/page.tsx:212-305`, the profile reads, masking, households and standing. The page now calls it, and its output is unchanged.
- Modify: `scripts/check-action-surface.mjs` (comment only: the computed +7 → 188, and why it stays 181 until Tasks 9 and 10 import them)
- Test: `src/app/actions/applications.access.test.ts`, `src/app/actions/applications.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7. `saveRecordFor` (`src/lib/recordSave.ts`), `isOwnerOrgMateOrAdmin`, `canAccessFormSubmission`, `loadOpenPairs`, `formLinkKind`, `formResultsView`, `myAnimalsScope`, `isInTeamScope`.
- Produces (`applications.ts`):
  ```ts
  export type ApplicationActionError = 'unauthorized' | 'not_found' | 'not_allowed' | 'invalid' | 'already_decided' | 'already_candidate' | 'animal_adopted' | 'failed';
  export type Fail = { ok: false; error: ApplicationActionError; errorId?: string };
  export async function getGeneralApplications(): Promise<ApplicantSummary[]>;                       // viewer's team, panelOrder; [] signed out
  export async function getApplicationDuplicates(applicationId: string): Promise<{ ok: true; applicant: { name: string; email?: string; phone?: string; address?: string }; cards: FormMatchCardData[]; canLink: boolean; willMerge: boolean } | Fail>;
  export async function declineApplication(applicationId: string, input: { text: string; rating: number; reason: string }): Promise<{ ok: true; recordId: string } | Fail>;
  export async function getProposalAnimals(applicationId: string): Promise<{ ok: true; animals: Array<{ id: string; name: string | null; species: string | null; photo: string | null; matches: boolean; candidates: number }> } | Fail>;
  export async function proposeAnimal(applicationId: string, animalId: string): Promise<{ ok: true; applicationId: string } | Fail>;
  export async function getAdoptionOffer(animalId: string): Promise<{ ok: true; animalName: string | null; animalSex: string | null; candidates: Array<{ applicationId: string; firstName: string; phone: string | null; email: string | null }> } | Fail>;
  export async function markOfferDone(animalId: string): Promise<{ ok: true; count: number } | Fail>;
  ```
  `src/lib/formMatchCards.ts`: `export type FormMatchCardData = { match: { id: string; name: string; matchTypes: string[]; score?: number; candidateId: string | null; canAnswer: boolean }; profile: FormResultMatchCardProps['profile'] }` and `export async function loadFormMatchCards(db, viewer: string, matches: FormMatchCardData['match'][], ctx: { submissionId: string; typed: Array<string | null | undefined> }): Promise<FormMatchCardData[]>`.
- Authorization (`loadAuthorizedApplication(db, applicationId, viewer)` → `{ app, submission, animal } | null`):
  - An animal application needs: the animal exists and isn't deleted, `isOwnerOrgMateOrAdmin(viewer, animal.addedBy)`, and the form link owner is in `getTeamEmails(animal.addedBy)`.
  - A general application needs `canAccessFormSubmission(db, submission, viewer)`.
  - Anything else → `not_found` (never says it exists).
- `declineApplication`:
  - Validation:
    - `rating` is an integer 1–5.
    - `reason` is trimmed, 1–2000 chars.
    - `text` is trimmed, 1–500 chars.
    - The state is `open`, else `already_decided`.
    - A linked adopter exists, else `not_allowed`.
  - Writes, in this order:
    1. `saveRecordFor({ id: 'decline-' + applicationId, recordType: 'observation', adopterId, rating, details: text + '\n' + reason, animalId: app.animalId ?? undefined, animalName: animal?.name ?? null }, undefined, { notifyOwnerTeam: true })`. The id is pre-seeded, so a retry is the same record. `id` accepts ≤64 chars.
    2. Retire the live link for `(animal, adopter)`: `expiresAt = now`, where `usedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`.
    3. `UPDATE applications SET state='declined', decline_record_id, closed_at, closed_by WHERE id AND state='open'`.
- `proposeAnimal`:
  - The application must be general and open.
  - The animal must take contracts (`takesContract`) and not be deleted.
  - The general form's link owner must be `isInTeamScope` of the animal owner's team, else `not_allowed`.
  - The person must not already be an open candidate of that animal, else `already_candidate`.
  - Insert `{ origin: 'proposed', animal_id, submission_id }`. The unique index makes it idempotent.
  - Then the CAS `UPDATE … SET state='proposed', proposed_application_id WHERE id AND state='open'`. If the CAS loses, delete the row this call inserted and return `already_decided`.
- `getProposalAnimals`: `myAnimalsScope(viewer).availableWhere` (available + foster), filtered to animals whose owner's team contains the form link owner, then `rankProposalAnimals(…, { species: submission.species, lifeStage: submission.lifeStage })`, with `candidates` from `countOpenByAnimal`, and the first photo per animal (as the home enrich does). Animals where this person already has an open application are left out.
- `getAdoptionOffer` / `markOfferDone`:
  - Use the animal gate as above.
  - Rows: `state='closed' AND close_reason='adopted_other' AND offer_done_at IS NULL`, in scope.
  - `firstName` = the first word of `form_submissions.name`.
  - `phone` and `email` are what the person typed on the form.
  - `markOfferDone` updates by id, one statement per row.
- Every action is `try`/`catch` → `logger.error('<action> failed', e, { applicationId | animalId, viewer })`, returning `{ ok: false, error: 'failed', errorId }`.

- [ ] **Step 1: Write the failing tests**

`applications.access.test.ts`:

```ts
it.each(['getApplicationDuplicates','declineApplication','getProposalAnimals','proposeAnimal'])('%s: a rescuer outside the owner\'s team gets not_found and nothing is written', …);
it('getAdoptionOffer / markOfferDone: outsider → not_found; org-mate and admin → ok', …);
it('proposeAnimal refuses an animal of a team the form link owner is not in (not_allowed)', …);
it('signed out → unauthorized for every action', …);
```

`applications.test.ts`:

```ts
it('declineApplication writes one observation (rating, text\\nreason, animalId) and marks the application declined with its record id', …);
it('declineApplication twice → one adopter_events row, state declined once', …);           // Review Focus 1
it('declineApplication on a live contract retires the link (by-token would answer expired)', …);
it('declineApplication refuses rating 0, rating 6, a blank reason', …);
it('proposeAnimal creates a proposed candidate visible in loadApplicantsForAnimal and ends the general one as proposed', …);
it('proposeAnimal on an already-decided general application → already_decided, no stray proposed row', …);
it('getProposalAnimals: fostered animals included, adopted excluded, matching species/life stage first, candidates count', …);
it('getAdoptionOffer lists only adopted_other candidates not yet offered; markOfferDone empties it', …);
it('getApplicationDuplicates returns the open pairs of the applicant\'s auto-created profile, masked as /form-results masks them', …);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/app/actions/applications.access.test.ts src/app/actions/applications.test.ts`
Expected: FAIL. Cannot find module `./applications`.

- [ ] **Step 3: Implement the actions and the `formMatchCards` extraction**

The `/form-results` page builds its `matchList` as today and calls `loadFormMatchCards`. `getApplicationDuplicates` builds its `matchList` from `loadOpenPairs(db, linkedAdopterId, viewer, { limit: 20 })` when `formLinkKind(...) === 'new_profile'` (else `[]`). It returns `canLink = formResultsView(kind, cards.length).canLinkMatches` and `willMerge = kind === 'new_profile'`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx playwright test tests/form-results-link.authed.spec.ts tests/form-results-masking.authed.spec.ts tests/form-match-one-answer.authed.spec.ts`.
Expected: PASS. The `/form-results` output is unchanged.

- [ ] **Step 5: Build and check the surface**

Run: `npm run build && node scripts/check-action-surface.mjs`
Expected: `181` (nothing imports the new actions yet). Add a comment above `EXPECTED_ACTIONS` with the computed 188 and each action's what-a-stranger-can-do line from the authorization rules above.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/_applications.ts src/app/actions/applications.ts src/app/actions/applications.access.test.ts src/app/actions/applications.test.ts src/lib/formMatchCards.ts "src/app/form-results/[submissionId]/page.tsx" scripts/check-action-surface.mjs
git commit -m "feat(evaluation): server actions — decline, propose, duplicates, offer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The applicant panel: outcome, answers, duplicate, «No avanzar», «Proponer un animal»

**Files:**
- Modify: `src/components/ApplicantDetailPanel.tsx`, `src/components/AnimalApplicants.tsx`, `src/components/FormResultMatchCard.tsx` (optional `onLinked?: () => void`; when set, call it instead of `router.push`)
- Create: `src/components/evaluation/ApplicationStatusLine.tsx`, `ApplicationAnswersSummary.tsx`, `ApplicationDuplicate.tsx`, `DeclineApplicationDialog.tsx`, `ProposeAnimalSheet.tsx`
- Modify: `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS = 185`, measured)
- Test: `src/components/evaluation/evaluation.test.tsx`, `src/components/ApplicantDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `ApplicantSummary` (Task 3); actions `declineApplication`, `proposeAnimal`, `getProposalAnimals`, `getApplicationDuplicates` (Task 8); `summarizeAnswers`, `nextToEvaluateIndex` (Task 1); `StarRating`, `FormResultMatchCard`, `FormAnswersPanel`.
- Produces:
  ```ts
  // ApplicantDetailPanel props (replaces animalId/animalName):
  { applicants: ApplicantSummary[]; initialIndex: number;
    animal: { id: string; name: string; sex: string | null } | null;   // null = «Sin animal elegido»
    onClose: () => void;
    /** After an outcome: re-read the list; the panel moves to nextToEvaluateIndex or closes on -1. */
    onOutcome?: () => Promise<ApplicantSummary[] | null>;
    /** Opened from a page: the header's close reads «← Volver». */
    returnLabel?: boolean;
    onContractIssued?: (url: string, applicant: ApplicantSummary) => void; }
  ```
- Test ids:
  - `applicant-status-line`, `answers-flagged`, `answers-rest`, `answers-none`, `applicant-duplicate`
  - `evaluate-decline`, `evaluate-send-contract`, `evaluate-propose`
  - `decline-dialog`, `decline-text`, `decline-reason`, `decline-save`, `decline-missing`
  - `propose-sheet`, `propose-animal-<id>`

- [ ] **Step 1: Write the failing tests** (`renderToStaticMarkup`, `t` from `es` as in HomeModules.test.tsx; actions mocked):

```ts
it('to_evaluate on an animal: footer «No avanzar» + «Enviar contrato»; no status line', …);
it('contract_sent: «Contrato enviado el 9 nov» + «No avanzar» + «Reenviar contrato»', …);
it('general to_evaluate: «Prefiere: …» at the top, footer «No avanzar» + «Proponer un animal»', …);
it('origin adopted_animal: «Pidió a Luna (ya adoptada)» under the name', …);
it('declined / closed / proposed / replaced / also_applied: the outcome line replaces the buttons', …);
it('to_evaluate with a replaced link: «Su contrato se reemplazó el {date}»', …);
it('answers: red then amber as «{question}: {answer}», then «N respuestas sin observaciones · Ver todas»; none → «Ninguna respuesta para revisar»', …);
it('the rest count equals the rows in «Todas las respuestas» for the same form', …);   // Review Focus 5
it('decline dialog: prefilled «No avanzamos con su solicitud para Luna.», «Guardar» disabled with «Falta: calificación y motivo»', …);
it('decline dialog at 1★ shows import.rating_one_bans', …);
it('the fixed intent / household lines are gone (grep tests/ first)', …);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/components/evaluation/evaluation.test.tsx src/components/ApplicantDetailPanel.test.tsx`
Expected: FAIL. Module not found / the old footer.

- [ ] **Step 3: Implement**

- Before removing the «Intención» / «Hogar» rows: `grep -rn "applicants_panel_intent\|applicants_panel_household\|Intención\|Hogar" tests/`, and fix any spec that reads them.
- Panel body order:
  1. identity block (unchanged), with `askedAnimal` line under it
  2. `ApplicationStatusLine`
  3. Perfil del adoptante (unchanged)
  4. `ApplicationDuplicate`: lazy `getApplicationDuplicates(applicationId)` per shown applicant; renders one `FormResultMatchCard` per card with `onLinked={() => onOutcome?.()}`; renders nothing while loading or when there are no cards; a failure shows `evaluation.action_failed` with its errorId
  5. Respuestas: «Prefiere» first for general; `ApplicationAnswersSummary`, where «Ver todas» opens the existing `<details>` «Todas las respuestas» by setting its `open` state; selfie, photos, map, «Ver formulario completo» unchanged
  6. footer
- «Contrato enviado» keeps today's share block after sending.
- `DeclineApplicationDialog`:
  - Opens over the panel (`Modal`).
  - Textarea `decline-text` is prefilled.
  - `StarRating size="lg" showLabel clearable={false}` with `onChange={v => v > 0 && setRating(v)}`. Tapping the current star would otherwise clear it.
  - Motivo is a textarea.
  - «Guardar» stays disabled until rating > 0 and the reason is non-blank; `decline-missing` names what's missing.
  - On save: `declineApplication`. On `ok` → `onOutcome`. On fail → toast `evaluation.decline_failed` with `errorId ?? resolveErrorId(...)`, guarded by `handledAsStale`.
- `ProposeAnimalSheet`:
  - Lists `getProposalAnimals`; each row is ≥44px, with photo/species icon, name, and `candidates_*`.
  - Picking one → `proposeAnimal` → `onOutcome`.
  - `already_candidate` → toast `propose_already`.
- `AnimalApplicants` passes `onOutcome={() => getApplicantsForAnimal(animalId)}` and `animal={{ id, name, sex }}`. `AnimalProfile` passes `sex`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx tsc --noEmit && npm run lint`.
Expected: PASS; warnings ≤ 125.

- [ ] **Step 5: Build and measure the surface**

Run: `npm run build && node scripts/check-action-surface.mjs`
Expected: 185 once `EXPECTED_ACTIONS = 185`: +declineApplication, +proposeAnimal, +getProposalAnimals, +getApplicationDuplicates.

- [ ] **Step 6: Commit**

```bash
git add src/components/ApplicantDetailPanel.tsx src/components/ApplicantDetailPanel.test.tsx src/components/AnimalApplicants.tsx src/components/AnimalProfile.tsx src/components/FormResultMatchCard.tsx src/components/evaluation scripts/check-action-surface.mjs
git commit -m "feat(evaluation): applicant panel — outcome line, answers summary, duplicate, No avanzar, Proponer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Home: application rows, the panel over the home, and the offer to tell the others

**Files:**
- Modify: `src/domain/homeModules.ts` (`homeAnimalRows`), `src/domain/homeModules.test.ts`
- Modify: `src/types/homeModules.ts`, `src/lib/homeModulesData.ts` (`loadHomeAnimals`), `src/components/home/HomeModules.tsx`, `src/components/home/HomeModules.test.tsx`
- Create: `src/components/home/HomeApplicantsPanel.tsx`, `src/components/evaluation/AdoptionOfferSheet.tsx`
- Modify: `src/components/AdoptionFormWizard.tsx`, `src/components/AdoptionFormEditV2.tsx` (open the sheet after a save that returned `closedApplications`)
- Modify: `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS = 188`, measured)
- Test: the above, plus `tests/home-modules.user.spec.ts` (add cases)

**Interfaces:**
- Consumes: `countToEvaluateByAnimal`, `countGeneralToEvaluate`, `offerCountsByAnimal` (Task 7); `getApplicantsForAnimal`, `getGeneralApplications`, `getAdoptionOffer`, `markOfferDone` (Tasks 3/8); `ApplicantDetailPanel` (Task 9).
- Produces:
  ```ts
  // types/homeModules.ts
  HomeAnimalRow += { sex: string | null; toEvaluate: number; offer: number /* candidates to tell; 0 = none */ };
  export type HomeGeneralRow = { id: typeof GENERAL_ROW_ID; general: true; toEvaluate: number };
  HomeAnimalsData.rows: Array<HomeAnimalRow | HomeGeneralRow>;
  HomeAnimalsData += { solicitudesCount: number /* = the tab count: animals with toEvaluate > 0, + 1 when general > 0 */; moreApplications: number };
  // domain/homeModules.ts
  export const GENERAL_ROW_ID = 'general';
  export function homeAnimalRows<O extends { id: string }, D extends { id: string }, A extends { id: string }, R extends { id: string }>(
    todo: { offers: readonly O[]; due: readonly D[]; applications: readonly A[] }, recent: readonly R[], slots?: number,
  ): { offers: O[]; due: D[]; applications: A[]; recent: R[]; moreDue: number; moreApplications: number };
  ```
- The slot rule. The signature doesn't determine it, so here it is:
  ```ts
  // todo = [...offers, ...due, ...applications] deduped by id, first kept (check-up wins over applications — spec «Calls I made»).
  // fits: todo.length <= slots → all shown, recent fills the rest.
  // else: n = slots - 1; if the hidden part holds BOTH due and application items → n = slots - 2.
  //       shown = todo.slice(0, n); moreDue / moreApplications = hidden counts of each kind (offers are never counted:
  //       a hidden offer waits for a free slot). Each non-zero «more» is its own TodoRow and takes one slot.
  ```
  Application rows: the general row first, then animals by `toEvaluate` descending, then name.
- Test ids: `home-animals-applications` (animal row), `home-animals-general`, `home-animals-offer`, `home-animals-applications-more`, `home-applicants-panel`, `offer-sheet`, `offer-message`, `offer-wa-<applicationId>`, `offer-email-<applicationId>`, `offer-not-now`, `offer-done`.

- [ ] **Step 1: Write the failing tests**

`homeModules.test.ts`:

```ts
it('applications take slots like due animals; an animal with both shows as due', () => { … });
it('5 due + 2 applications in 4 slots → 2 due listed, moreDue 3, moreApplications 2 (two «more» rows)', () => { … });
it('offers come first and are never counted as «more»', () => { … });
it('the existing homeAnimalRows expectations hold with empty offers/applications', () => { /* the old cases, new shape */ });
```

`HomeModules.test.tsx`:

```ts
it('an animal with applications: amber «3 solicitudes por evaluar» instead of the grey line', …);
it('«Sin animal elegido · 2 solicitudes por evaluar» row', …);
it('offer row «Luna fue adoptada · avisá a 2 candidatos» (hembra) / «adoptado» otherwise', …);
it('«2 animales más con solicitudes» links to /my-animals?view=solicitudes', …);
it('the card is a to-do (todo state) when solicitudesCount > 0 even with no check-up due', …);
```

`evaluation.test.tsx`:

```ts
it('AdoptionOfferSheet: Jon\'s message with {name}/{animal} filled; WhatsApp only with a phone (wa.me/<digits>?text=), Email only with an email (mailto:…?subject=&body=)', …);
```

`tests/home-modules.user.spec.ts`:

```ts
test('the animal row\'s «N solicitudes por evaluar» equals the cards on /my-animals?view=solicitudes', …);
test('tapping the row opens the applicant panel over the home; «No avanzar» there moves to the next and the row\'s count drops', …);
test('offer row → sheet → «Listo» → the row is gone after reload', …);
```

The user-project fixtures are `test-hm-fixture-ev-*`: an animal, 2 forms with applications, and 1 closed `adopted_other` application with `offer_done_at NULL`. They're deleted in `afterAll`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/domain/homeModules.test.ts src/components/home/HomeModules.test.tsx src/components/evaluation/evaluation.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `loadHomeAnimals`:
  - Per distinct owner team in the `allWhere` list (resolver), one `countToEvaluateByAnimal` and one `offerCountsByAnimal`. Plus one `countGeneralToEvaluate(viewer team)`.
  - Build `applications` = animals with `toEvaluate > 0` that take contracts, plus the general row. Build `offers` = animals with `offer > 0`.
  - Then call `homeAnimalRows`. Enrich only the shown rows, as today.
  - `stateOf(data.animals, d => d.dueCount > 0 || d.solicitudesCount > 0 || d.rows.some(r => 'offer' in r && r.offer > 0), …)`.
- `AnimalsCard`: amber row line `evaluation.to_evaluate_*`. A row with `due` keeps the check-up line.
- `HomeApplicantsPanel({ target: { animal } | 'general', onClose, onChanged })`:
  - Loads `getApplicantsForAnimal(id)` or `getGeneralApplications()`.
  - Opens `ApplicantDetailPanel` at the first `to_evaluate` index.
  - `onOutcome` re-loads and calls `onChanged` (the home's `load`).
  - Errors: `handledAsStale` → close; else `resolveErrorId` shown with `homeModules.error_code`, as HomeDuePanel does.
- `AdoptionOfferSheet({ animalId, onClose })`:
  - `getAdoptionOffer` → editable textarea prefilled from `evaluation.offer_message`, with `{name}` replaced per person at link time and `{animal}` once.
  - Per person: «WhatsApp» = `phoneAppUrl('whatsapp', phone) + '?text=' + encodeURIComponent(msg)`; «Email» = `mailto:${email}?subject=${animal}&body=…`.
  - «Ahora no» and «Listo» both call `markOfferDone(animalId)` then `onClose`. A failure keeps the sheet and toasts with the errorId.
- `AdoptionFormWizard` / `AdoptionFormEditV2`: when `result.closedApplications?.count > 0`, render `AdoptionOfferSheet` for `result.closedApplications.animalId` before the existing reset/close/refresh, and continue on its close.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx playwright test tests/home-modules.user.spec.ts`.
Expected: PASS.

- [ ] **Step 5: Build and measure the surface**

Run: `npm run build && node scripts/check-action-surface.mjs`
Expected: 188 once `EXPECTED_ACTIONS = 188`: +getGeneralApplications, +getAdoptionOffer, +markOfferDone.

- [ ] **Step 6: Commit**

```bash
git add src/domain/homeModules.ts src/domain/homeModules.test.ts src/types/homeModules.ts src/lib/homeModulesData.ts src/components/home/HomeModules.tsx src/components/home/HomeModules.test.tsx src/components/home/HomeApplicantsPanel.tsx src/components/evaluation/AdoptionOfferSheet.tsx src/components/evaluation/evaluation.test.tsx src/components/AdoptionFormWizard.tsx src/components/AdoptionFormEditV2.tsx scripts/check-action-surface.mjs tests/home-modules.user.spec.ts
git commit -m "feat(evaluation): home rows for applications, panel over the home, offer to tell the others

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Mis animales: «Con solicitudes por evaluar», the card row, «Sin animal elegido», deep link

**Files:**
- Modify: `src/app/api/my-animals/route.ts` (`view=solicitudes`; `toEvaluate` on every row; headers `x-solicitudes-count`, `x-general-to-evaluate`)
- Modify: `src/lib/myAnimalsTabCount.ts` (+ `'solicitudes'` → `solicitudes`), `src/lib/myAnimalsTabCount.test.ts`
- Modify: `src/app/my-animals/page.tsx` (tab, card footer row, the general card, the panel with `returnLabel`, `?animal=&solicitud=` deep link)
- Modify: `src/app/api/form/[userId]/submit/route.ts` (the notice url)
- Test: `src/app/api/my-animals/solicitudes.test.ts`, `tests/my-animals-solicitudes.authed.spec.ts`

**Interfaces:**
- Consumes: Task 7 counts; Task 9 panel; `getApplicantsForAnimal`, `getGeneralApplications`.
- Produces:
  - `GET /api/my-animals?view=solicitudes`: `allWhere` animals with `toEvaluate > 0` that take contracts, ordered by `toEvaluate` desc, then date.
  - Every tab list carries `x-solicitudes-count` (= solicitudes cards, general included) and `x-general-to-evaluate`. The page shows the tab while `view === 'solicitudes' || count > 0`, as with pendientes.
  - The form-submission notice url becomes `/my-animals?view=solicitudes&animal=<animal_id|general>&solicitud=<applicationId>` when `ENABLE_ANIMALS_FOR_ADOPTION` is on, else `/form-results/<submissionId>` as today. The page opens the panel at that application when it loads.
  - Test ids: `tab-solicitudes`, `solicitudes-badge-<animalId>` (amber card row), `general-card`, `general-card-badge`.

- [ ] **Step 1: Write the failing tests**

```ts
// solicitudes.test.ts (route handler with mocked auth + migratedDb)
it('view=solicitudes lists only animals with applications to evaluate — fostered included, adopted excluded', …);
it('x-solicitudes-count = animals with toEvaluate + 1 for general; the same on every tab', …);
it('each row carries toEvaluate (0 when none)', …);
// myAnimalsTabCount.test.ts
it("'solicitudes' reads counts.solicitudes when not the loaded tab", …);
```

`tests/my-animals-solicitudes.authed.spec.ts` (fixtures `test-ev-fixture-*`: an animal owned by the admin with 2 applications, one general application via the admin's link):

```ts
test('the tab count equals the cards; «Sin animal elegido» is the first card and only in this tab', …);
test('the card\'s amber row opens the panel; «← Volver» returns to the page', …);
test('decline from the general card: rating + reason → «No avanzó · …»; the tab count drops by one', …);
test('propose from the general card: pick the animal → it becomes that animal\'s candidate; «Enviar contrato» issues a link', …);
test('a notification deep link opens the panel at that application', …);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run src/app/api/my-animals/solicitudes.test.ts src/lib/myAnimalsTabCount.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Route: compute the to-evaluate map once per distinct owner team over the rows being returned (same resolver as the applicants chip). For the header count, use one `allWhere` id select plus the same grouped counts. Never per animal per application.
- Page:
  - The amber row is a `<button>` styled like `due-badge` (`min-h-11`), placed next to the due badge in the footer. Both show when both apply.
  - The general card is first in `view === 'solicitudes'` only. It uses the form icon (SVG), `evaluation.general_title`, `general_body` and the amber row.
  - Clearing filters on tab switch also applies here.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: the Step 2 command, plus `npx playwright test tests/my-animals-solicitudes.authed.spec.ts tests/my-animals.spec.ts tests/my-animals-meta-layout.authed.spec.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/my-animals/route.ts src/app/api/my-animals/solicitudes.test.ts src/lib/myAnimalsTabCount.ts src/lib/myAnimalsTabCount.test.ts src/app/my-animals/page.tsx "src/app/api/form/[userId]/submit/route.ts" tests/my-animals-solicitudes.authed.spec.ts
git commit -m "feat(evaluation): Mis animales «Con solicitudes por evaluar», card row, «Sin animal elegido», deep link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end: adoption closes, the offer, fostered contracts, mobile layout

**Files:**
- Create: `tests/applicant-evaluation.authed.spec.ts`
- Modify: `src/components/AdoptionFormWizard.tsx`, `src/components/AnimalSelectPicker.tsx` (data-testids only)
- Modify: `tests/mobile.spec.ts` (one case)

**Interfaces:**
- Consumes: everything above. Fixtures are `test-ev-fixture-*`, inserted with `execD1Batch` and removed in `afterAll`.

- [ ] **Step 1: Write the specs**

```ts
test('a contract sent to A then to B: A reads «Su contrato se reemplazó el …» and por evaluar again; the tab count includes A', …);
test('«No avanzar» on a live contract: the link page answers expired (GET /api/contract/by-token/<token> → 410 expired)', …);
test('an adoption registered in-app closes the other candidates: their panel line «Cerrada: … adoptada por otra persona», the offer sheet opens after the save', …);
//   Registered through AdoptionFormWizard: open /adopter/<applicant A>?newAdoption=adoption, pick the fixture animal from the
//   inventory step, save. No spec drives this wizard yet: add data-testids to its inventory picker and save button
//   (AdoptionFormWizard / AnimalSelectPicker) in this task. Then assert offer-sheet is visible and B's panel line.
test('a fostered animal: its applicant gets «Enviar contrato» and the token page loads (200)', …);
test('a form for an adopted animal lands in «Sin animal elegido» with «Pidió a … (ya adoptada)»', …); // POST /api/form/<userId>/submit with animalId
```

`mobile.spec.ts`: at 390px, the panel footer buttons and the decline dialog have `scrollWidth <= clientWidth` and buttons ≥44px tall.

- [ ] **Step 2: Run them**

Run: `npx playwright test tests/applicant-evaluation.authed.spec.ts tests/mobile.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full verification**

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH npx vitest run && npx tsc --noEmit && npm run lint && npm run build && node scripts/check-action-surface.mjs && npx playwright test`
Expected: all green; lint warnings ≤ 125; surface 188.

- [ ] **Step 4: Commit**

```bash
git add tests/applicant-evaluation.authed.spec.ts tests/mobile.spec.ts src/components/AdoptionFormWizard.tsx src/components/AnimalSelectPicker.tsx
git commit -m "test(evaluation): end-to-end — adoption closes, offer, fostered contracts, mobile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes (run 2026-11-10)

- **Spec coverage.**
  - Decisions E1–E3 → Tasks 8/9. Decision 1 (home rows) → Task 10. Decision 2 → Tasks 8/9.
  - Decision 3 → Task 4. Decision 4 / Q4 → Tasks 8/10. Decision 5 → Tasks 1/3. Q1 → Tasks 1/3/8.
  - Q2 → Task 5. Q3 → Task 6. Q5 → Tasks 10/11. Q6 → Task 7. Q8 copy → Task 1.
  - «Existing data» → Task 2. Notifications deep link → Task 11. Destination-page parity → Tasks 7/10/11.
  - Q7 (no reopening): nothing is written on a return, by design.
- **Not built, on purpose:** the open contract link (non-goal 6) and API (Catpuccino) requests («Only app forms are applications»).
- **Types:**
  - `ApplicationStatus`, `AdoptionVia`, `ApplicantSummary.status` and `FormMatchCardData` are used under the same names in Tasks 3–11.
  - `updateRecord` opts `{ cas, adoptionVia }` is the same in Tasks 4 and 5.
  - `homeAnimalRows` changes signature in Task 10 only.
