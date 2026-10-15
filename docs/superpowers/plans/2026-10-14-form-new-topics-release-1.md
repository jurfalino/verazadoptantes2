# Adoption form new topics — Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the new closed (multiple-choice) adoption-form questions, their per-rescuer switches, the old/new choice for "mascotas previas" and "mudanza", their semáforo colours and their display — without changing production forms while custom forms is off.

**Architecture:** The question catalogue lives twice, as today: `src/domain/adoptionDocs.ts` (app: settings, counter, display) and `contract-app/src/lib/adoptionDocs.ts` + a new `contract-app/src/lib/formQuestions.ts` (public form: which screens, follow-ups, species, stripping); a mirror test keeps them equal. Settings stay in `adoption_doc_settings.hidden_steps`: step ids hide, a finite set of tokens (`on:<id>`, `way:<id>:old`) turns default-off questions on and picks the old wording — so the existing per-key compare-and-swap saves keep working unchanged. The public form gets `formConfig: null` only when custom forms is off; null means "today's form, none of the new questions".

**Tech Stack:** Next.js 15 (app), Vite + React (contract-app public form), Cloudflare D1/Drizzle, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-form-new-topics-design.md` (release 1 = §9 item 1; photos and open/closed are later plans).

## Global Constraints

- i18n: app keys go in `src/i18n/locales/es.ts`, `en.ts` AND `pt.ts`; contract-app keys go in all three sections (`es`, `en`, `pt`) of `contract-app/src/i18n/catalogs/form.ts`. `es` is the original; voseo in es, `você` in pt.
- No `inArray`, no magic strings for record types; pure rules in `src/domain/` (no DB/server imports).
- Every catch logs (`logger.warn`/`error`) with the same context fields as the happy path; never log free-text answers, social handles or the vet reference (privacy).
- Never guess the gender of someone other than the applicant in copy; no "/a" in any `*_gift` contract-app key (enforced by `contract-app/src/lib/giftFlow.test.ts`).
- Option values (stored in `answers_json`) are the English camelCase strings listed in Task 2 — never change them after release.
- Stage files with explicit paths (never `git add -A`); tracked `.wrangler` sqlite and `local.db` are the e2e seed.
- Version bump above `git show origin/staging:package.json`, patch level, with a CHANGELOG entry, in the last task.
- Lint warnings ≤ the ratchet in `package.json`/CI (currently 125).

## Review Focus

1. **A settings row saved before this release** (e.g. `["selfie"]`, or one hiding `petExperience`) — expected: the new on-by-default questions are asked; a hidden `petExperience`/`movingPlans` hides the whole topic in both wordings. Pinned in Task 1 and Task 2.
2. **A form opened for a specific animal** (the species question is skipped) — expected: cat-only / dog-only questions follow the animal's species from the config response; unknown species → not asked. Pinned in Task 2 and Task 5.
3. **An applicant changes the answer a follow-up depends on** (castration Sí→No, pets 2→0, "Para mí"→"Es un regalo") — expected: the follow-up's answer never reaches the submission. Pinned in Task 2.
4. **Hand-made POSTs with huge or junk free text** in `gaveAwayWhy`, `instagram`, `facebook`, `vetReference`, `motivation`, `howHeard` — expected: stored clamped to 300 chars (social 100), social handles only become profile contacts when they look like a handle or a URL. Pinned in Task 5.
5. **Custom forms off (production)** — expected: `/api/form/{userId}` returns `formConfig: null` and the public form asks exactly today's questions. Pinned in Task 2 (unit) and Task 5 (e2e).

---

## File structure

| File | Responsibility |
|---|---|
| `src/domain/adoptionDocs.ts` (modify) | Catalogue (ids, groups, new/default-off/variant/follow-up lists, tokens), settings helpers (`isQuestionOn`, `toggleQuestion`, `questionWay`, `setQuestionWay`, `settingKeyQuestion`), `isStepAsked` |
| `contract-app/src/lib/adoptionDocs.ts` (modify) | Mirror of ids/tokens; `formStepsToAsk` (null config = today's form); `stepsForAnswers`/`stepAfter` take a species context; `buildSubmitBody` strips unasked new answers |
| `contract-app/src/lib/formQuestions.ts` (create) | New-question rules for the public form: follow-ups, species-only, answer keys, stripping |
| `contract-app/src/lib/giftFlow.ts` (modify) | Gift wording + "No sé" for the new home questions |
| `src/domain/answerSignals.ts` (modify) | Semáforo rules for the new answers |
| `src/app/api/form/[userId]/route.ts` (modify) | `formConfig` gating + `animalSpecies` |
| `src/app/api/form/[userId]/submit/route.ts` (modify) | Clamp new free text; Instagram/Facebook → profile socials |
| `contract-app/src/PetShieldForm.tsx` (modify) | `choice-list` step type, new schema entries, follow-ups under hosts, species context |
| `contract-app/src/components/FollowUps.tsx` (create) | Renders the follow-up questions under a host step |
| `contract-app/src/petshield.css` (modify) | `.ps-choice-list` styles |
| `contract-app/src/i18n/catalogs/form.ts` (modify) | Public-form copy |
| `src/components/FormAnswersPanel.tsx`, `src/components/FormResultsContent.tsx` (modify) | Display of the new answers |
| `src/components/adoptionDocs/FormStepsEditor.tsx`, `src/app/settings/adoption-docs/page.tsx` (modify) | Settings rows, default-off switches, "Cómo preguntar" (old/new) |
| `src/i18n/locales/{es,en,pt}.ts` (modify) | App copy |
| `docs/ux-ui-guidelines.md` (modify) | Public-form section (spec §3) |

---

### Task 1: App catalogue and settings tokens

**Files:**
- Modify: `src/domain/adoptionDocs.ts`
- Test: `src/domain/adoptionDocs.test.ts`, `src/domain/adoptionDocsCollab.test.ts`

**Interfaces:**
- Produces (exact names, used by Tasks 2, 7, 8):
  - `FORM_STEP_IDS` (new order below)
  - `NEW_FORM_STEPS`, `DEFAULT_OFF_FORM_STEPS`, `VARIANT_FORM_STEPS`, `FOLLOW_UP_HOSTS`, `SPECIES_ONLY_STEPS`, `FORM_OPTION_TOKENS` (all `as const`)
  - `isQuestionOn(rowId: string, hidden: readonly string[]): boolean`
  - `toggleQuestion(rowId: string, hidden: readonly string[]): string[]`
  - `questionWay(rowId: 'petExperience' | 'movingPlans', hidden: readonly string[]): 'new' | 'old'`
  - `setQuestionWay(rowId: 'petExperience' | 'movingPlans', way: 'new' | 'old', hidden: readonly string[]): string[]`
  - `settingKeyQuestion(key: string): string` — `'on:catOutdoor'` → `'catOutdoor'`, `'way:petExperience:old'` → `'petExperience'`, anything else → itself
  - `isStepAsked(id, hidden)` extended (below)

- [ ] **Step 1: Write the failing tests** — append to `src/domain/adoptionDocs.test.ts` (and add the new names to its import list):

```ts
describe('release 1 — new questions (spec 2026-10-14)', () => {
    it('lists the questions in form order', () => {
        expect(FORM_STEP_IDS).toEqual([
            'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'carer', 'giftRecipient', 'children', 'allergy',
            'existingPets', 'petsCare', 'housingType', 'rental', 'household', 'hasOutdoor', 'isSafe', 'catOutdoor',
            'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'petExperience', 'lastAnimal', 'gaveAway',
            'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingPlans', 'movingIfNoPets', 'vacationPlan',
            'returnReasons', 'adaptPlan', 'visitConsent', 'identity-name', 'identity-email', 'identity-phone',
            'identity-address', 'social', 'ageRange', 'vetReference', 'motivation', 'geo', 'selfie',
        ]);
    });
    it('on by default unless listed as default-off', () => {
        expect(isQuestionOn('gaveAway', [])).toBe(true);
        expect(isQuestionOn('catOutdoor', [])).toBe(false);
        expect(isQuestionOn('catOutdoor', ['on:catOutdoor'])).toBe(true);
        expect(isQuestionOn('gaveAway', ['gaveAway'])).toBe(false);
    });
    it('toggling writes the right key and keeps order', () => {
        expect(toggleQuestion('catOutdoor', ['selfie'])).toEqual(['selfie', 'on:catOutdoor']);
        expect(toggleQuestion('catOutdoor', ['on:catOutdoor'])).toEqual([]);
        expect(toggleQuestion('gaveAway', [])).toEqual(['gaveAway']);
    });
    it('previous animal and moving: new wording by default, old on request, one switch hides both', () => {
        expect(isStepAsked('lastAnimal', [])).toBe(true);
        expect(isStepAsked('petExperience', [])).toBe(false);
        const old = setQuestionWay('petExperience', 'old', []);
        expect(old).toEqual(['way:petExperience:old']);
        expect(questionWay('petExperience', old)).toBe('old');
        expect(isStepAsked('petExperience', old)).toBe(true);
        expect(isStepAsked('lastAnimal', old)).toBe(false);
        // A row hidden before this release hides the topic in both wordings.
        expect(isStepAsked('lastAnimal', ['petExperience'])).toBe(false);
        expect(isStepAsked('petExperience', ['petExperience', 'way:petExperience:old'])).toBe(false);
        expect(isStepAsked('movingIfNoPets', [])).toBe(true);
        expect(isStepAsked('movingPlans', ['way:movingPlans:old'])).toBe(true);
    });
    it('a row saved before this release still gets the new on-by-default questions', () => {
        for (const id of ['carer', 'allergy', 'petsCare', 'rental', 'sleepPlace', 'gaveAway', 'sterilizeHow', 'returnReasons', 'adaptPlan', 'visitConsent']) {
            expect(isStepAsked(id, ['selfie']), id).toBe(true);
        }
        for (const id of DEFAULT_OFF_FORM_STEPS) expect(isStepAsked(id, ['selfie']), id).toBe(false);
    });
    it('the sanitiser keeps the new tokens and drops unknown ones', () => {
        expect(sanitizeHiddenSteps(['on:catOutdoor', 'on:nope', 'way:movingPlans:old', 'way:x:old', 'gaveAway']))
            .toEqual(['gaveAway', 'on:catOutdoor', 'way:movingPlans:old']);
    });
    it('variants are not rows of their own', () => {
        expect(TOGGLEABLE_FORM_STEPS).not.toContain('lastAnimal');
        expect(TOGGLEABLE_FORM_STEPS).not.toContain('movingIfNoPets');
        expect(TOGGLEABLE_FORM_STEPS).toContain('on:social');
    });
    it('a setting key names the question it belongs to', () => {
        expect(settingKeyQuestion('on:catOutdoor')).toBe('catOutdoor');
        expect(settingKeyQuestion('way:petExperience:old')).toBe('petExperience');
        expect(settingKeyQuestion('gaveAway')).toBe('gaveAway');
    });
});
```

Update the two existing tests in the same file that hard-code the old list:
- `'lists the 25 PetShield steps in form order'` → delete (replaced by the test above).
- `'locks terms + identity'`: change `toHaveLength(20)` to `toHaveLength(TOGGLEABLE_FORM_STEPS.length)` and add `expect(TOGGLEABLE_FORM_STEPS.length).toBe(44)` (35 rows + 9 tokens; rows: FORM_STEP_IDS 43 − 5 locked − giftRecipient − 2 variants = 35; tokens: phone-optional + 6 `on:` + 2 `way:`).
- `'groups cover every toggleable step exactly once'`: the expected list becomes `[...groupRows, ...FORM_OPTION_TOKENS]` where `groupRows` already excludes locked steps — unchanged formula, it passes once groups include every new row.

Append to `src/domain/adoptionDocsCollab.test.ts`:

```ts
describe('new question tokens ride the per-question saves', () => {
    it('mergeHidden keeps on:/way: tokens when another question changes', () => {
        expect(mergeHidden(['on:catOutdoor', 'way:movingPlans:old'], [{ key: 'gaveAway', hidden: true }]))
            .toEqual(['gaveAway', 'on:catOutdoor', 'way:movingPlans:old']);
    });
    it('each token has a state of its own', () => {
        expect(stepStates(['on:social'])['on:social']).toBe('hidden');
        expect(stepStates([])['way:petExperience:old']).toBe('shown');
    });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `export PATH="/opt/homebrew/opt/node@20/bin:$PATH"; npx vitest run src/domain/adoptionDocs.test.ts src/domain/adoptionDocsCollab.test.ts`
Expected: FAIL — `isQuestionOn is not a function`, list mismatch.

- [ ] **Step 3: Implement** in `src/domain/adoptionDocs.ts`:

Replace `FORM_STEP_IDS` with the list in the test above. After `DERIVED_FORM_STEPS` add:

```ts
/** Release 1 of spec 2026-10-14: asked only when the rescuer's config arrives (custom forms on). */
export const NEW_FORM_STEPS = [
    'carer', 'allergy', 'petsCare', 'rental', 'catOutdoor', 'sleepPlace', 'dogWalks', 'dogTied', 'lastAnimal',
    'gaveAway', 'sterilizeHow', 'movingIfNoPets', 'returnReasons', 'adaptPlan', 'visitConsent', 'social',
    'vetReference', 'motivation',
] as const;

/** Off until the rescuer turns them on (`on:<id>`): species-only, social, vet reference, motivation. */
export const DEFAULT_OFF_FORM_STEPS = ['catOutdoor', 'dogWalks', 'dogTied', 'social', 'vetReference', 'motivation'] as const;

/** The new wording of a topic whose row is the old question ('petExperience', 'movingPlans'). Not rows. */
export const VARIANT_FORM_STEPS = ['lastAnimal', 'movingIfNoPets'] as const;

/** Questions shown under another screen (spec §4.2 length check); the first host that is asked wins. */
export const FOLLOW_UP_HOSTS = {
    carer: ['intent'],
    allergy: ['children', 'household'],
    petsCare: ['existingPets'],
    sterilizeHow: ['willingToSterilize'],
} as const;

/** Asked only when the animal is this species. */
export const SPECIES_ONLY_STEPS = { catOutdoor: 'cat', dogWalks: 'dog', dogTied: 'dog' } as const;

const VARIANT_OF: Record<string, string> = { lastAnimal: 'petExperience', movingIfNoPets: 'movingPlans' };
```

Replace `FORM_OPTION_TOKENS` with:

```ts
export const FORM_OPTION_TOKENS = [
    'phone-optional',
    'on:catOutdoor', 'on:dogWalks', 'on:dogTied', 'on:social', 'on:vetReference', 'on:motivation',
    'way:petExperience:old', 'way:movingPlans:old',
] as const;
```

Change the `KNOWN` and `TOGGLEABLE_FORM_STEPS` lines to exclude variants:

```ts
const VARIANT = new Set<string>(VARIANT_FORM_STEPS);
const DEFAULT_OFF = new Set<string>(DEFAULT_OFF_FORM_STEPS);
const KNOWN = new Set<string>(FORM_STEP_IDS.filter(id => !DERIVED.has(id) && !VARIANT.has(id)));
export const TOGGLEABLE_FORM_STEPS: readonly string[] = [...FORM_STEP_IDS.filter(id => !LOCKED.has(id) && !DERIVED.has(id) && !VARIANT.has(id)), ...FORM_OPTION_TOKENS];
```

Note: `sanitizeShownSteps` uses `KNOWN`; the public form reports variant ids in `shownSteps`, so give it its own set: `const SHOWN_KNOWN = new Set<string>(FORM_STEP_IDS);` and use it there.

Replace `FORM_STEP_GROUPS`:

```ts
export const FORM_STEP_GROUPS = [
    { key: 'what', steps: ['species', 'lifeStage', 'specialNeeds', 'intent', 'carer'] },
    { key: 'home', steps: ['children', 'household', 'allergy', 'existingPets', 'petsCare', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'petExperience', 'gaveAway'] },
    { key: 'commitments', steps: ['willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingPlans', 'vacationPlan', 'returnReasons', 'adaptPlan', 'visitConsent'] },
    { key: 'person', steps: ['identity-name', 'identity-email', 'identity-phone', 'identity-address', 'social', 'ageRange', 'vetReference', 'motivation', 'geo', 'selfie'] },
] as const;
```

Add the helpers and extend `isStepAsked`:

```ts
/** Whether a settings row's question is on — default-off rows need their `on:` token. */
export function isQuestionOn(rowId: string, hidden: readonly string[]): boolean {
    return DEFAULT_OFF.has(rowId) ? hidden.includes(`on:${rowId}`) : !hidden.includes(rowId);
}

/** The stored list after flipping a row's switch, in form order. */
export function toggleQuestion(rowId: string, hidden: readonly string[]): string[] {
    const key = DEFAULT_OFF.has(rowId) ? `on:${rowId}` : rowId;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    return inFormOrder(next);
}

export function questionWay(rowId: 'petExperience' | 'movingPlans', hidden: readonly string[]): 'new' | 'old' {
    return hidden.includes(`way:${rowId}:old`) ? 'old' : 'new';
}

export function setQuestionWay(rowId: 'petExperience' | 'movingPlans', way: 'new' | 'old', hidden: readonly string[]): string[] {
    const next = new Set(hidden);
    if (way === 'old') next.add(`way:${rowId}:old`); else next.delete(`way:${rowId}:old`);
    return inFormOrder(next);
}

/** The question a stored settings key belongs to (labels for conflicts and toasts). */
export function settingKeyQuestion(key: string): string {
    const m = /^(?:on|way):([A-Za-z]+)/.exec(key);
    return m ? m[1] : key;
}
```

In `isStepAsked`, after the `household` line, before the final `return`:

```ts
    if (VARIANT.has(id)) {
        const row = VARIANT_OF[id];
        return !hidden.includes(row) && !hidden.includes(`way:${row}:old`);
    }
    if (id === 'petExperience' || id === 'movingPlans') {
        return !hidden.includes(id) && hidden.includes(`way:${id}:old`);
    }
    if (DEFAULT_OFF.has(id)) return hidden.includes(`on:${id}`);
```

- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npx tsc --noEmit` — fix any caller that typed `FORM_STEP_IDS` members narrowly (expected: none outside tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/adoptionDocs.ts src/domain/adoptionDocs.test.ts src/domain/adoptionDocsCollab.test.ts
git commit -m "form settings: catalogue and tokens for the new questions (default-off, old/new wording)"
```

---

### Task 2: Public-form rules — what is asked, follow-ups, species, stripping

**Files:**
- Modify: `contract-app/src/lib/adoptionDocs.ts`
- Create: `contract-app/src/lib/formQuestions.ts`, `contract-app/src/lib/formQuestions.test.ts`
- Modify: `src/domain/adoptionDocs.mirror.test.ts`

**Interfaces:**
- Consumes: the Task 1 lists (copied byte-identical into the contract-app; the mirror test enforces it).
- Produces (used by Tasks 3 and 6):
  - `contract-app/src/lib/formQuestions.ts`:
    - `type FormCtx = { animalSpecies?: string | null }`
    - `effectiveSpecies(answers: Record<string, unknown>, ctx: FormCtx): 'cat' | 'dog' | null`
    - `followUpVisible(id: string, answers: Record<string, unknown>): boolean`
    - `followUpsUnder(hostId: string, configSchema: { id: string }[], answers: Record<string, unknown>): string[]`
    - `stripUnaskedNewAnswers(answers: Record<string, unknown>, configSchema: { id: string }[], ctx: FormCtx): Record<string, unknown>`
  - `contract-app/src/lib/adoptionDocs.ts`:
    - `formStepsToAsk(schema, stored)` — `stored` null/undefined = today's form
    - `stepsForAnswers(schema, answers, ctx?: FormCtx)` — the screens
    - `stepAfter(configSchema, step, nextAnswers, ctx?: FormCtx)`
    - `buildSubmitBody(finalAnswers, hiddenSteps, animalId, schema, ctx?: FormCtx)`

Option values (stored; never change after release):

| Question | Values |
|---|---|
| carer | `me`, `otherAdult`, `minor` |
| allergy | `no`, `yes`, `unknown` |
| petsCare | `yes`, `some`, `no` |
| rental | `own`, `rentAllowed`, `rentNotAllowed`, `rentUnsure` |
| catOutdoor | `no`, `sometimes`, `yes` |
| sleepPlace | `inside`, `outside` |
| dogWalks | `twicePlus`, `once`, `walker`, `none` |
| dogTied | `no`, `sometimes`, `yes` |
| lastAnimal | `withMe`, `oldAge`, `lost`, `street`, `gave`, `first` |
| gaveAway | `no`, `yes` (+ free text `gaveAwayWhy`) |
| sterilizeHow | `done`, `vet`, `campaign` |
| movingIfNoPets | `find`, `family`, `return`, `unsure` |
| returnReasons | `no`, `allergy`, `baby`, `behaviour`, `other` |
| adaptPlan | `patience`, `askRescue`, `return` |
| visitConsent | `yes`, `videoOnly`, `no` |
| social | free text `instagram`, `facebook` |
| vetReference | free text `vetReference` |
| motivation | free text `motivation`, `howHeard` |

- [ ] **Step 1: Write the failing tests** — create `contract-app/src/lib/formQuestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { effectiveSpecies, followUpVisible, followUpsUnder, stripUnaskedNewAnswers } from './formQuestions'
import { formStepsToAsk, stepsForAnswers, buildSubmitBody, FORM_STEP_IDS } from './adoptionDocs'

const all = FORM_STEP_IDS.map(id => ({ id }))
const ids = (s: { id: string }[]) => s.map(x => x.id)

describe('which questions the public form asks', () => {
    it('custom forms off (null config) = today\'s form: none of the new questions, old wordings', () => {
        const asked = ids(formStepsToAsk(all, null))
        for (const id of ['carer', 'allergy', 'petsCare', 'rental', 'gaveAway', 'lastAnimal', 'movingIfNoPets', 'visitConsent', 'social'])
            expect(asked, id).not.toContain(id)
        expect(asked).toContain('petExperience')
        expect(asked).toContain('movingPlans')
    })
    it('custom forms on, nothing changed: new on-by-default questions, new wordings, default-off ones off', () => {
        const asked = ids(formStepsToAsk(all, []))
        for (const id of ['carer', 'allergy', 'rental', 'gaveAway', 'lastAnimal', 'movingIfNoPets', 'visitConsent']) expect(asked, id).toContain(id)
        for (const id of ['petExperience', 'movingPlans', 'catOutdoor', 'social', 'motivation']) expect(asked, id).not.toContain(id)
    })
    it('a row hidden before this release hides its topic in both wordings', () => {
        const asked = ids(formStepsToAsk(all, ['petExperience']))
        expect(asked).not.toContain('petExperience')
        expect(asked).not.toContain('lastAnimal')
    })
})

describe('species-only questions', () => {
    const cfg = formStepsToAsk(all, ['on:catOutdoor', 'on:dogWalks'])
    it('follow the species answer', () => {
        expect(ids(stepsForAnswers(cfg, { species: 'cat' }))).toContain('catOutdoor')
        expect(ids(stepsForAnswers(cfg, { species: 'cat' }))).not.toContain('dogWalks')
    })
    it('follow the animal when the form is for one (species question skipped)', () => {
        expect(ids(stepsForAnswers(cfg, {}, { animalSpecies: 'dog' }))).toContain('dogWalks')
        expect(effectiveSpecies({}, { animalSpecies: 'Perro' })).toBe(null) // only 'cat' | 'dog' values
    })
    it('unknown species → not asked', () => {
        expect(ids(stepsForAnswers(cfg, {}))).not.toContain('catOutdoor')
        expect(ids(stepsForAnswers(cfg, { species: 'other' }))).not.toContain('dogWalks')
    })
})

describe('follow-ups', () => {
    const cfg = formStepsToAsk(all, [])
    it('live under their host, not as screens of their own', () => {
        const screens = ids(stepsForAnswers(cfg, { intent: 'self' }))
        for (const id of ['carer', 'allergy', 'petsCare', 'sterilizeHow']) expect(screens, id).not.toContain(id)
        expect(followUpsUnder('intent', cfg, { intent: 'self' })).toEqual(['carer'])
        expect(followUpsUnder('intent', cfg, { intent: 'gift' })).toEqual([])
        expect(followUpsUnder('existingPets', cfg, { existingPets: { dogs: 1 } })).toEqual(['petsCare'])
        expect(followUpsUnder('existingPets', cfg, { existingPets: { dogs: 0 } })).toEqual([])
        expect(followUpsUnder('willingToSterilize', cfg, { willingToSterilize: 'yes' })).toEqual(['sterilizeHow'])
        expect(followUpsUnder('children', cfg, {})).toEqual(['allergy'])
    })
    it('become their own screen when no host is asked (allergy, carer)', () => {
        const noHosts = formStepsToAsk(all, ['children', 'intent'])
        const screens = ids(stepsForAnswers(noHosts, {}))
        expect(screens).toContain('allergy')
        expect(screens).toContain('carer')
    })
    it('host visibility rules', () => {
        expect(followUpVisible('carer', { intent: 'self' })).toBe(true)
        expect(followUpVisible('sterilizeHow', { willingToSterilize: 'no' })).toBe(false)
    })
})

describe('answers that were not asked never reach the submission', () => {
    const cfg = formStepsToAsk(all, [])
    it('a follow-up whose host answer changed', () => {
        const out = stripUnaskedNewAnswers({ willingToSterilize: 'no', sterilizeHow: 'vet', existingPets: { dogs: 0 }, petsCare: 'yes', intent: 'gift', carer: 'me' }, cfg, {})
        expect(out).toEqual({ willingToSterilize: 'no', existingPets: { dogs: 0 }, intent: 'gift' })
    })
    it('"¿Por qué?" only with "Sí, regalé un animal"', () => {
        expect(stripUnaskedNewAnswers({ gaveAway: 'no', gaveAwayWhy: 'x' }, cfg, {})).toEqual({ gaveAway: 'no' })
        expect(stripUnaskedNewAnswers({ gaveAway: 'yes', gaveAwayWhy: 'x' }, cfg, {})).toEqual({ gaveAway: 'yes', gaveAwayWhy: 'x' })
    })
    it('species-only answers after the species changed', () => {
        const withCat = formStepsToAsk(all, ['on:catOutdoor'])
        expect(stripUnaskedNewAnswers({ species: 'dog', catOutdoor: 'yes' }, withCat, {})).toEqual({ species: 'dog' })
    })
    it('custom forms off: no new answers at all, even from an old draft', () => {
        const today = formStepsToAsk(all, null)
        const body = buildSubmitBody({ name: 'A', rental: 'own', visitConsent: 'no', instagram: '@a' }, null, null, today, {})
        expect(body).toMatchObject({ name: 'A' })
        expect(body).not.toHaveProperty('rental')
        expect(body).not.toHaveProperty('visitConsent')
        expect(body).not.toHaveProperty('instagram')
    })
})
```

Append to `src/domain/adoptionDocs.mirror.test.ts` (inside the `describe`):

```ts
    for (const name of ['NEW_FORM_STEPS', 'DEFAULT_OFF_FORM_STEPS', 'VARIANT_FORM_STEPS', 'FORM_OPTION_TOKENS'] as const) {
        it(`${name} match`, async () => {
            const app = (await import('./adoptionDocs'))[name] as readonly string[];
            expect(idsIn(name)).toEqual([...app]);
        });
    }
    for (const name of ['FOLLOW_UP_HOSTS', 'SPECIES_ONLY_STEPS']) {
        it(`${name} match`, () => {
            const block = (src: string) => {
                const m = src.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\})`));
                return m ? m[1].replace(/\s+/g, '').replace(/,}/g, '}') : null;
            };
            expect(block(qsrc)).toEqual(block(appSrc));
        });
    }
```

and at the top of that file, after `const src = …`:

```ts
const qsrc = readFileSync(join(__dirname, '../../contract-app/src/lib/formQuestions.ts'), 'utf8');
const appSrc = readFileSync(join(__dirname, 'adoptionDocs.ts'), 'utf8');
/** Arrays live in formQuestions.ts except FORM_OPTION_TOKENS (adoptionDocs.ts). */
const idsIn = (name: string) => {
    const from = name === 'FORM_OPTION_TOKENS' ? src : qsrc;
    const m = from.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
};
```

- [ ] **Step 2: Run to see them fail**

Run: `cd contract-app && npx vitest run src/lib/formQuestions.test.ts; cd .. && npx vitest run src/domain/adoptionDocs.mirror.test.ts`
Expected: FAIL — module `./formQuestions` not found; mirror lists null.

- [ ] **Step 3: Implement.**

In `contract-app/src/lib/adoptionDocs.ts`: replace `FORM_STEP_IDS` with the Task 1 list (byte-identical), replace `FORM_OPTION_TOKENS` with the Task 1 list, and replace `formStepsToAsk`, `stepsForAnswers`, `stepAfter` and `buildSubmitBody`:

```ts
import { NEW_FORM_STEPS, DEFAULT_OFF_FORM_STEPS, VARIANT_FORM_STEPS, FOLLOW_UP_HOSTS, effectiveSpecies, SPECIES_ONLY_STEPS, stripUnaskedNewAnswers, type FormCtx } from './formQuestions'

const NEW = new Set<string>(NEW_FORM_STEPS)
const OFF = new Set<string>(DEFAULT_OFF_FORM_STEPS)
const VARIANT_OF: Record<string, string> = { lastAnimal: 'petExperience', movingIfNoPets: 'movingPlans' }

/** The app's isStepAsked, applied to the schema. `stored` null = custom forms off → today's form. */
export function formStepsToAsk<T extends { id: string }>(schema: T[], stored: readonly string[] | null | undefined): T[] {
    if (stored == null) {
        return schema.filter(s => !NEW.has(s.id) && s.id !== 'household')
    }
    const hidden = new Set(stored)
    const people = hidden.has('household')
    const rowHidden = hidden.has('children')
    return schema.filter(s => {
        if (LOCKED.has(s.id) || DERIVED.has(s.id)) return true
        if (s.id === 'children') return !rowHidden && !people
        if (s.id === 'household') return !rowHidden && people
        if (s.id in VARIANT_OF) { const row = VARIANT_OF[s.id]; return !hidden.has(row) && !hidden.has(`way:${row}:old`) }
        if (s.id === 'petExperience' || s.id === 'movingPlans') return !hidden.has(s.id) && hidden.has(`way:${s.id}:old`)
        if (OFF.has(s.id)) return hidden.has(`on:${s.id}`)
        return !hidden.has(s.id)
    })
}

/**
 * The screens for these answers: "¿Para quién es?" only after "Es un regalo";
 * species-only questions only for that species; follow-ups render inside
 * their host's screen (FollowUps) and are screens only when no host is asked.
 */
export function stepsForAnswers<T extends { id: string }>(schema: T[], answers: Record<string, unknown>, ctx: FormCtx = {}): T[] {
    const present = new Set(schema.map(s => s.id))
    const species = effectiveSpecies(answers, ctx)
    return schema.filter(s => {
        if (s.id === 'giftRecipient') return answers.intent === 'gift'
        const only = (SPECIES_ONLY_STEPS as Record<string, string>)[s.id]
        if (only) return species === only
        const hosts = (FOLLOW_UP_HOSTS as Record<string, readonly string[]>)[s.id]
        if (hosts) {
            if (hosts.some(h => present.has(h))) return false
            // No host asked: allergy and carer stand alone; petsCare / sterilizeHow depend on a host answer.
            return s.id === 'allergy' || s.id === 'carer'
        }
        return true
    })
}

export function stepAfter<T extends { id: string }>(configSchema: T[], step: number, nextAnswers: Record<string, unknown>, ctx: FormCtx = {}): { id: string } | 'submit' {
    const next = stepsForAnswers(configSchema, nextAnswers, ctx)[step + 1]
    return next ? { id: next.id } : 'submit'
}
```

`buildSubmitBody` now takes the **config** schema (what the rescuer asks, follow-ups included) instead of the on-screen steps, plus the species context, so it can tell which new answers were really asked. `shownSteps` is recomputed from the cleaned answers. Import only what is used (`stripUnaskedNewAnswers`, `FormCtx`, and the lists `formStepsToAsk`/`stepsForAnswers` need). Existing `contract-app/src/lib/adoptionDocs.test.ts` cases for `buildSubmitBody` pass a schema built from ids — their `shownSteps` expectations stay valid as long as the ids are not new questions; adjust any that are.

```ts
export function buildSubmitBody(
    finalAnswers: Record<string, unknown>,
    hiddenSteps: readonly string[] | null,
    animalId: string | null | undefined,
    configSchema: readonly { id: string }[],
    ctx: FormCtx = {},
): Record<string, unknown> {
    const cleaned = stripUnaskedNewAnswers(
        stripGiftAnswers(stripHiddenAnswers(finalAnswers, hiddenSteps ?? [])),
        [...configSchema], ctx,
    )
    return {
        ...cleaned,
        ...(animalId ? { animalId } : {}),
        shownSteps: stepsForAnswers([...configSchema], cleaned, ctx).map(s => s.id),
    }
}
```

Create `contract-app/src/lib/formQuestions.ts`:

```ts
/**
 * New adoption-form questions (spec 2026-10-14, release 1) — which follow-ups
 * show under which screen, species-only questions, and which answers a
 * submission may carry. Pure. The lists mirror src/domain/adoptionDocs.ts
 * (src/domain/adoptionDocs.mirror.test.ts).
 */

export const NEW_FORM_STEPS = [
    'carer', 'allergy', 'petsCare', 'rental', 'catOutdoor', 'sleepPlace', 'dogWalks', 'dogTied', 'lastAnimal',
    'gaveAway', 'sterilizeHow', 'movingIfNoPets', 'returnReasons', 'adaptPlan', 'visitConsent', 'social',
    'vetReference', 'motivation',
] as const

export const DEFAULT_OFF_FORM_STEPS = ['catOutdoor', 'dogWalks', 'dogTied', 'social', 'vetReference', 'motivation'] as const

export const VARIANT_FORM_STEPS = ['lastAnimal', 'movingIfNoPets'] as const

export const FOLLOW_UP_HOSTS = {
    carer: ['intent'],
    allergy: ['children', 'household'],
    petsCare: ['existingPets'],
    sterilizeHow: ['willingToSterilize'],
} as const

export const SPECIES_ONLY_STEPS = { catOutdoor: 'cat', dogWalks: 'dog', dogTied: 'dog' } as const

export type FormCtx = { animalSpecies?: string | null }

/** Answer keys a question writes, when not just its own id. */
const ANSWER_KEYS: Record<string, string[]> = {
    gaveAway: ['gaveAway', 'gaveAwayWhy'],
    social: ['instagram', 'facebook'],
    motivation: ['motivation', 'howHeard'],
}

const asSpecies = (v: unknown): 'cat' | 'dog' | null => (v === 'cat' || v === 'dog' ? v : null)

/** The species asked about: the applicant's answer, else the animal the form is for. */
export function effectiveSpecies(answers: Record<string, unknown>, ctx: FormCtx): 'cat' | 'dog' | null {
    return asSpecies(answers.species) ?? asSpecies(ctx.animalSpecies)
}

const hasPets = (v: unknown) =>
    !!v && typeof v === 'object' && Object.values(v as Record<string, unknown>).some(n => typeof n === 'number' && n > 0)

/** Whether a follow-up shows under its host for these answers. */
export function followUpVisible(id: string, answers: Record<string, unknown>): boolean {
    switch (id) {
        case 'carer': return answers.intent === 'self'
        case 'allergy': return true
        case 'petsCare': return hasPets(answers.existingPets)
        case 'sterilizeHow': return answers.willingToSterilize === 'yes'
        default: return false
    }
}

/** The follow-ups shown under `hostId` (configured, and their host answer allows them). */
export function followUpsUnder(hostId: string, configSchema: { id: string }[], answers: Record<string, unknown>): string[] {
    const present = new Set(configSchema.map(s => s.id))
    return Object.entries(FOLLOW_UP_HOSTS)
        .filter(([id, hosts]) => present.has(id) && (hosts as readonly string[]).find(h => present.has(h)) === hostId && followUpVisible(id, answers))
        .map(([id]) => id)
}

/** Keeps only the new questions' answers that were actually asked. */
export function stripUnaskedNewAnswers(answers: Record<string, unknown>, configSchema: { id: string }[], ctx: FormCtx): Record<string, unknown> {
    const present = new Set(configSchema.map(s => s.id))
    const species = effectiveSpecies(answers, ctx)
    const asked = (id: string): boolean => {
        if (!present.has(id)) return false
        const only = (SPECIES_ONLY_STEPS as Record<string, string>)[id]
        if (only && species !== only) return false
        const hosts = (FOLLOW_UP_HOSTS as Record<string, readonly string[]>)[id]
        if (hosts && hosts.some(h => present.has(h))) return followUpVisible(id, answers)
        if (hosts) return id === 'allergy' || id === 'carer'
        return true
    }
    const drop = new Set<string>()
    for (const id of NEW_FORM_STEPS) {
        const keys = ANSWER_KEYS[id] ?? [id]
        if (!asked(id)) keys.forEach(k => drop.add(k))
    }
    if (answers.gaveAway !== 'yes') drop.add('gaveAwayWhy')
    if (!drop.size) return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) if (!drop.has(k)) out[k] = v
    return out
}
```

Callers in `contract-app/src/PetShieldForm.tsx` are updated in Task 6; until then `tsc` passes because the new parameters are optional — except `buildSubmitBody`, whose 4th argument becomes the config schema: change its single call now to `buildSubmitBody(finalAnswers, hiddenSteps, animalId, configSchema)`.

- [ ] **Step 4: Run** `cd contract-app && npx vitest run && npx tsc --noEmit -p .; cd .. && npx vitest run src/domain`. Expected: PASS. Existing `contract-app/src/lib/adoptionDocs.test.ts` cases for `formStepsToAsk(…, null)` that expected the new-question-free schema keep passing; any case that built `schema` from `FORM_STEP_IDS` and expected `null` to return it unchanged must now expect the today's-form subset — update those assertions to `formStepsToAsk(schema, null)` excluding `NEW_FORM_STEPS` and `household`.

- [ ] **Step 5: Commit**

```bash
git add contract-app/src/lib/adoptionDocs.ts contract-app/src/lib/formQuestions.ts contract-app/src/lib/formQuestions.test.ts contract-app/src/lib/adoptionDocs.test.ts contract-app/src/PetShieldForm.tsx src/domain/adoptionDocs.mirror.test.ts
git commit -m "public form: which new questions are asked, follow-ups, species-only, stripping"
```

---

### Task 3: Gift wording for the new home questions

**Files:**
- Modify: `contract-app/src/lib/giftFlow.ts`, `contract-app/src/lib/giftFlow.test.ts`

**Interfaces:**
- Consumes: option values from Task 2.
- Produces: `GIFT_UNKNOWN_STEPS` and `giftTitleKey` cover the new questions; catalog keys `form.q_<x>_title_gift` (added in Task 6).

Spec §4.3: home questions about the recipient's home get recipient wording and "No sé"; visits, carer, return reasons and adapt plan keep the giver's wording. Previous-animal and gave-away follow the existing "Mascotas previas" (recipient wording + "No sé"). Allergy already offers "No sé" (no second one).

- [ ] **Step 1: Failing test** — append to `contract-app/src/lib/giftFlow.test.ts`:

```ts
describe('new home questions in a gift (spec 2026-10-14 §4.3)', () => {
    it('talk about the recipient', () => {
        for (const id of ['rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'allergy', 'lastAnimal', 'gaveAway', 'movingIfNoPets', 'sterilizeHow'])
            expect(giftTitleKey(id), id).toBe(`form.q_${id}_title_gift`)
    })
    it('offer "No sé" where the giver may not know — not where it already exists', () => {
        for (const id of ['rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'lastAnimal', 'gaveAway']) expect(GIFT_UNKNOWN_STEPS).toContain(id)
        for (const id of ['allergy', 'movingIfNoPets', 'visitConsent', 'returnReasons', 'adaptPlan', 'carer']) expect(GIFT_UNKNOWN_STEPS).not.toContain(id)
    })
})
```

- [ ] **Step 2: Run** `cd contract-app && npx vitest run src/lib/giftFlow.test.ts`. Expected: FAIL (`giftTitleKey('rental')` is null).

- [ ] **Step 3: Implement** in `giftFlow.ts`:

```ts
export const GIFT_UNKNOWN_STEPS = ['children', 'hasOutdoor', 'isSafe', 'petExperience', 'willingToSterilize', 'movingPlans',
    'rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'lastAnimal', 'gaveAway'] as const
```

and add to `TITLE`:

```ts
    rental: 'form.q_rental_title_gift',
    sleepPlace: 'form.q_sleepPlace_title_gift',
    catOutdoor: 'form.q_catOutdoor_title_gift',
    dogWalks: 'form.q_dogWalks_title_gift',
    dogTied: 'form.q_dogTied_title_gift',
    allergy: 'form.q_allergy_title_gift',
    lastAnimal: 'form.q_lastAnimal_title_gift',
    gaveAway: 'form.q_gaveAway_title_gift',
    movingIfNoPets: 'form.q_movingIfNoPets_title_gift',
    sterilizeHow: 'form.q_sterilizeHow_title_gift',
```

(The keys follow `form.q_<id>_title_gift`; the copy is added in Task 6 with every other catalog key, and the existing "no /a in *_gift" test then covers them.)

- [ ] **Step 4: Run** the same. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contract-app/src/lib/giftFlow.ts contract-app/src/lib/giftFlow.test.ts
git commit -m "gift flow: new home questions talk about the recipient, with 'No sé'"
```

---

### Task 4: Semáforo for the new answers

**Files:**
- Modify: `src/domain/answerSignals.ts`, `src/domain/answerSignals.test.ts`

**Interfaces:**
- Consumes: Task 2 values.
- Produces: `answerSignal(field, raw)` covers the new fields (used by `AnswerValue` in Task 7).

Spec §5 lists only red and amber; new questions get **no** green (ruling: the spec set no "ok" readings for them).

- [ ] **Step 1: Failing test** — append to `src/domain/answerSignals.test.ts`:

```ts
describe('new questions (spec 2026-10-14 §5)', () => {
    const cases: Array<[string, string, ReturnType<typeof answerSignal>]> = [
        ['movingIfNoPets', 'return', 'risk'], ['movingIfNoPets', 'family', 'caution'], ['movingIfNoPets', 'find', null],
        ['gaveAway', 'yes', 'risk'], ['gaveAway', 'no', null],
        ['lastAnimal', 'lost', 'risk'], ['lastAnimal', 'street', 'risk'], ['lastAnimal', 'gave', 'risk'], ['lastAnimal', 'oldAge', null],
        ['returnReasons', 'baby', 'caution'], ['returnReasons', 'behaviour', 'caution'], ['returnReasons', 'no', null],
        ['willingToSterilize', 'no', 'risk'], ['willingToSterilize', 'yes', null],
        ['catOutdoor', 'yes', 'risk'], ['catOutdoor', 'sometimes', 'caution'], ['catOutdoor', 'no', null],
        ['sleepPlace', 'outside', 'caution'], ['sleepPlace', 'inside', null],
        ['rental', 'rentNotAllowed', 'caution'], ['rental', 'rentUnsure', 'caution'], ['rental', 'own', null],
        ['visitConsent', 'no', 'risk'], ['visitConsent', 'videoOnly', null],
        ['adaptPlan', 'return', 'risk'], ['adaptPlan', 'patience', null],
        ['dogTied', 'yes', 'risk'], ['dogTied', 'sometimes', 'caution'],
        ['carer', 'minor', 'caution'], ['carer', 'me', null],
        ['allergy', 'yes', 'caution'], ['allergy', 'unknown', null],
        ['catOutdoor', 'unknown', null],
    ];
    it.each(cases)('%s = %s → %s', (field, value, expected) => {
        expect(answerSignal(field, value)).toBe(expected);
    });
});
```

- [ ] **Step 2: Run** `npx vitest run src/domain/answerSignals.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — add to the `switch` in `answerSignal` (before `default`), and extend the header comment with "spec 2026-10-14 §5: red = likely dealbreaker, amber = talk it through; no green for the new questions":

```ts
        case 'movingIfNoPets': return v === 'return' ? 'risk' : v === 'family' ? 'caution' : null;
        case 'gaveAway': return v === 'yes' ? 'risk' : null;
        case 'lastAnimal': return ['lost', 'street', 'gave'].includes(v) ? 'risk' : null;
        case 'returnReasons': return ['allergy', 'baby', 'behaviour', 'other'].includes(v) ? 'caution' : null;
        case 'willingToSterilize': return v === 'no' ? 'risk' : null;
        case 'catOutdoor':
        case 'dogTied': return v === 'yes' ? 'risk' : v === 'sometimes' ? 'caution' : null;
        case 'sleepPlace': return v === 'outside' ? 'caution' : null;
        case 'rental': return v === 'rentNotAllowed' || v === 'rentUnsure' ? 'caution' : null;
        case 'visitConsent': return v === 'no' ? 'risk' : null;
        case 'adaptPlan': return v === 'return' ? 'risk' : null;
        case 'carer': return v === 'minor' ? 'caution' : null;
        case 'allergy': return v === 'yes' ? 'caution' : null;
```

- [ ] **Step 4: Run** the same. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/answerSignals.ts src/domain/answerSignals.test.ts
git commit -m "semáforo: red and amber for the new answers"
```

---

### Task 5: Server — config gating, animal species, submit

**Files:**
- Modify: `src/app/api/form/[userId]/route.ts`, `src/app/api/form/[userId]/submit/route.ts`
- Create: `src/domain/formFreeText.ts`, `src/domain/formFreeText.test.ts`
- Modify: `tests/adoption-docs.spec.ts`, `tests/form-results-link.authed.spec.ts`

**Interfaces:**
- Consumes: `getFeatureFlag` (`src/config/features.ts`), `createAdopterFromSubmission({ socials })` (`src/app/actions/_adopterFactory.ts`, accepts `string | { value, platform }`).
- Produces:
  - `GET /api/form/{userId}?animalId=X` → `{ valid, userName, formConfig: null | { hiddenSteps: string[] }, animalSpecies: 'cat' | 'dog' | null }`
  - `src/domain/formFreeText.ts`: `clampFreeText(v: unknown, max: number): string | undefined`, `socialHandle(v: unknown, platform: 'instagram' | 'facebook'): { value: string; platform: 'instagram' | 'facebook' } | null`

- [ ] **Step 1: Failing tests.**

`src/domain/formFreeText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampFreeText, socialHandle } from './formFreeText';

describe('free text from the public form', () => {
    it('trims and clamps; non-strings and blanks are dropped', () => {
        expect(clampFreeText('  hola ', 300)).toBe('hola');
        expect(clampFreeText('x'.repeat(400), 300)).toHaveLength(300);
        expect(clampFreeText(42, 300)).toBeUndefined();
        expect(clampFreeText('   ', 300)).toBeUndefined();
    });
});

describe('social handles that may reach a profile', () => {
    it('accepts a handle or a profile URL of that network', () => {
        expect(socialHandle(' @laura.perez ', 'instagram')).toEqual({ value: '@laura.perez', platform: 'instagram' });
        expect(socialHandle('instagram.com/laura', 'instagram')).toEqual({ value: 'instagram.com/laura', platform: 'instagram' });
        expect(socialHandle('https://facebook.com/laura.p', 'facebook')).toEqual({ value: 'https://facebook.com/laura.p', platform: 'facebook' });
    });
    it('refuses sentences, other networks and junk', () => {
        expect(socialHandle('no tengo', 'instagram')).toBeNull();
        expect(socialHandle('facebook.com/laura', 'instagram')).toBeNull();
        expect(socialHandle('@'.repeat(5), 'instagram')).toBeNull();
        expect(socialHandle('x'.repeat(120), 'instagram')).toBeNull();
    });
});
```

`tests/adoption-docs.spec.ts` — the two tests that assert `formConfig` is `null` for a user without settings now run with the flag on (seed), so they assert the defaults instead:
- in `'GET /api/form/{userId} returns formConfig: null for a user with no adoption_doc_settings row'`: rename to `'… returns the default config (no hidden steps) for a user with no settings row'` and replace `expect(json.formConfig).toBeNull();` with `expect(json.formConfig).toEqual({ hiddenSteps: [] });`
- in the "leaving the group" test: replace `expect(JSON.parse(afterFormBody).formConfig).toBeNull();` with `expect(JSON.parse(afterFormBody).formConfig).toEqual({ hiddenSteps: [] });`

Add to `tests/adoption-docs.spec.ts`, in the same `describe`:

```ts
    test('custom forms off → formConfig null (production: today\'s form)', async ({ request }) => {
        execD1(`UPDATE app_config SET value = 'false' WHERE key = 'ENABLE_CUSTOM_ADOPTION_DOCS'`);
        try {
            const json = await (await request.get(`/api/form/${NO_SETTINGS_USER_ID}`)).json();
            expect(json.formConfig).toBeNull();
        } finally {
            execD1(`UPDATE app_config SET value = 'true' WHERE key = 'ENABLE_CUSTOM_ADOPTION_DOCS'`);
        }
    });
```

(If `getFeatureFlag` caches, read `src/config/features.ts` first: `_flagCache` is `null` today — no cache. If that changes, call the existing cache-reset helper here.)

Add to `tests/form-results-link.authed.spec.ts`:

```ts
    test('the form config names the animal\'s species; new free text is clamped; Instagram reaches the profile', async ({ request }) => {
        const cfg = await (await request.get(`/api/form/${ADMIN_USER_ID}?animalId=test-animal-fixture-1`)).json();
        const species = one(`SELECT species FROM adoptions WHERE id = 'test-animal-fixture-1'`).species;
        expect(cfg.animalSpecies).toBe(species === 'cat' || species === 'dog' ? species : null);

        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E Nuevas ${stamp}`, email: `e2e-nuevas-${stamp}@example.com`, phone: `31${String(stamp).slice(-8)}`, address: '1 New St',
            intent: 'self', gaveAway: 'yes', gaveAwayWhy: 'x'.repeat(500), instagram: `@e2e.nuevas.${stamp}`, facebook: 'no tengo',
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        const row = one(`SELECT auto_adopter_id, answers_json FROM form_submissions WHERE id = '${submissionId}'`);
        const answers = JSON.parse(String(row.answers_json));
        expect(answers.gaveAwayWhy).toHaveLength(300);
        const contacts = String(one(`SELECT contact_entries FROM adopters WHERE id = '${row.auto_adopter_id}'`).contact_entries);
        expect(contacts).toContain(`@e2e.nuevas.${stamp}`);
        expect(contacts).not.toContain('no tengo');
    });
```

(If `test-animal-fixture-1` has no `species` column value, the expectation above still holds: `null`.)

- [ ] **Step 2: Run** `npx vitest run src/domain/formFreeText.test.ts` (FAIL: module missing) and the two e2e files with the local harness:

```bash
S=<scratchpad>; $S/e2e.sh nt5red tests/adoption-docs.spec.ts --project=user
$S/e2e.sh nt5red2 tests/form-results-link.authed.spec.ts --project=authed -g "species"
```

Expected: FAIL (`formConfig` still `null`; `animalSpecies` undefined; `gaveAwayWhy` 500 chars).

- [ ] **Step 3: Implement.**

`src/domain/formFreeText.ts`:

```ts
/**
 * Free text from the public adoption form (spec 2026-10-14). The server
 * re-checks it: a hand-made POST can't store a novel or put junk on a profile.
 */
export function clampFreeText(v: unknown, max: number): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
}

const HOST: Record<'instagram' | 'facebook', RegExp> = {
    instagram: /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/i,
    facebook: /^(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.com\/[A-Za-z0-9.]{1,50}\/?$/i,
};
const HANDLE = /^@?[A-Za-z0-9._]{2,30}$/;

/** A handle (@user) or a profile URL of that network — anything else is not a contact. */
export function socialHandle(v: unknown, platform: 'instagram' | 'facebook'): { value: string; platform: 'instagram' | 'facebook' } | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t || t.length > 100) return null;
    if (HOST[platform].test(t)) return { value: t, platform };
    if (/[/:]/.test(t) || /\s/.test(t)) return null;
    if (!HANDLE.test(t) || !/[A-Za-z0-9]/.test(t)) return null;
    return { value: t.startsWith('@') ? t : `@${t}`, platform };
}
```

Note `socialHandle(' @laura.perez ')` → `'@laura.perez'`; `'@@@@@'` fails `HANDLE`.

`src/app/api/form/[userId]/route.ts` — replace the `formConfig` computation and response. **Deviation from spec §6.2 (ruling):** the spec says `resolveDocsForRescuer` returns the defaults when the flag is on; it is also called by both contract routes and the submit route, where a non-null "no customisation" result would change behaviour. The defaults are applied here, in the one route the public form reads, with the same effect for applicants.

```ts
        // Custom forms (spec 2026-10-14 §6.2): null ONLY when the switch is off —
        // that is the public form's "today's form". On, but nothing customised
        // yet → the defaults ({ hiddenSteps: [] }), which include the new questions.
        const { resolveDocsForRescuer } = await import('@/lib/adoptionDocsRepo');
        const { getFeatureFlag } = await import('@/config/features');
        const resolved = await resolveDocsForRescuer(db, user?.email);
        const formConfig = resolved
            ? { hiddenSteps: resolved.hiddenSteps }
            : (await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS')) ? { hiddenSteps: [] as string[] } : null;

        // Cat-only / dog-only questions on a form opened for one animal (the
        // species question is skipped there). Only the species leaves this route.
        const animalId = new URL(request.url).searchParams.get('animalId');
        let animalSpecies: 'cat' | 'dog' | null = null;
        if (animalId) {
            const { adoptions } = await import('@/db/schema');
            const row = await db.select({ species: adoptions.species }).from(adoptions).where(eq(adoptions.id, animalId)).get()
                .catch((e: unknown) => {
                    logger.warn('api/form/[userId]: animal species lookup failed', { userId, animalId, error: e instanceof Error ? e.message : String(e) });
                    return undefined;
                });
            const s = row?.species?.toLowerCase();
            animalSpecies = s === 'cat' || s === 'dog' ? s : null;
        }

        return withCors(NextResponse.json({
            valid: !!user,
            userName: user?.name || null,
            formConfig,
            animalSpecies,
        }), origin);
```

Check the value stored in `adoptions.species` for animals (`grep -rn "species:" src/db/schema.ts` and an existing animal row): if it is Spanish (`perro`/`gato`), map those too: `const s = …; animalSpecies = s === 'cat' || s === 'gato' ? 'cat' : s === 'dog' || s === 'perro' ? 'dog' : null;` — use the mapping that matches stored data, and keep the e2e expectation in sync.

`src/app/api/form/[userId]/submit/route.ts` — after the gift recipient block, before `if (Array.isArray(body.householdPeople) …`:

```ts
        // New free-text answers (spec 2026-10-14): clamped here, never trusted.
        for (const [key, max] of [['gaveAwayWhy', 300], ['vetReference', 300], ['motivation', 300], ['howHeard', 300], ['instagram', 100], ['facebook', 100]] as const) {
            const v = clampFreeText(body[key], max);
            if (v === undefined) delete answers[key]; else answers[key] = v;
        }
        // Instagram / Facebook become profile contacts only when they look like one.
        const socials = [socialHandle(body.instagram, 'instagram'), socialHandle(body.facebook, 'facebook')]
            .filter((s): s is NonNullable<typeof s> => s !== null);
```

import `{ clampFreeText, socialHandle } from '@/domain/formFreeText'`, and pass `socials` to `createAdopterFromSubmission({ …, socials })`.

- [ ] **Step 4: Run** the unit test and both e2e commands again. Expected: PASS. Also run `tests/household-question.authed.spec.ts` (`--project=authed`): its `cfg0.formConfig?.hiddenSteps ?? []` already tolerates `{ hiddenSteps: [] }`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/formFreeText.ts src/domain/formFreeText.test.ts "src/app/api/form/[userId]/route.ts" "src/app/api/form/[userId]/submit/route.ts" tests/adoption-docs.spec.ts tests/form-results-link.authed.spec.ts
git commit -m "form API: defaults when custom forms is on, the animal's species, clamped free text, Instagram/Facebook to the profile"
```

---

### Task 6: Public form UI — new questions, follow-ups, copy

**Files:**
- Create: `contract-app/src/components/FollowUps.tsx`
- Modify: `contract-app/src/PetShieldForm.tsx`, `contract-app/src/petshield.css`, `contract-app/src/i18n/catalogs/form.ts`

**Interfaces:**
- Consumes: Task 2 (`formStepsToAsk`, `stepsForAnswers(schema, answers, ctx)`, `stepAfter(…, ctx)`, `followUpsUnder`, `FormCtx`), Task 3 (`adaptStepForGift` covers the new ids), Task 5 (`animalSpecies` in the config response).
- Produces: the public form asks the new questions; `FollowUps` props `{ ids: string[]; answers: Record<string, unknown>; onAnswer(key: string, value: string): void; questions: Record<string, ChoiceQuestion> }` where `type ChoiceQuestion = { title: string; options: Array<{ value: string; label: string }> }`.

New step type (vertical list; long labels; no icons — guideline §3.2 updated in Task 9):

```ts
/** A closed question whose answers are too long for cards: one full-width button per option. */
interface ChoiceListStep {
    id: string; type: 'choice-list'; title: string;
    options: Array<{ value: string; label: string; withText?: { key: string; label: string } }>;
}
```

`withText`: choosing that option reveals a text box (`gaveAway: 'yes'` → `gaveAwayWhy`) and does not auto-advance.

- [ ] **Step 1: Catalog copy** — add to `contract-app/src/i18n/catalogs/form.ts`, in each locale section (es / en / pt in that order per row):

| Key | es | en | pt |
|---|---|---|---|
| `form.q_carer_title` | ¿Quién lo va a cuidar día a día? | Who will look after it day to day? | Quem vai cuidar dele no dia a dia? |
| `form.opt_carer_me` | Yo | Me | Eu |
| `form.opt_carer_otherAdult` | Otro adulto de la casa | Another adult at home | Outro adulto da casa |
| `form.opt_carer_minor` | Un menor | A minor | Um menor |
| `form.q_allergy_title` | ¿Alguien en la casa tiene alergia a los animales? | Is anyone at home allergic to animals? | Alguém na casa tem alergia a animais? |
| `form.q_allergy_title_gift` | ¿Alguien en la casa de {n} tiene alergia a los animales? | Is anyone in {n}'s home allergic to animals? | Alguém na casa de {n} tem alergia a animais? |
| `form.q_petsCare_title` | ¿Están castrados y vacunados? | Are they neutered and vaccinated? | Eles são castrados e vacinados? |
| `form.opt_some` | Algunos | Some | Alguns |
| `form.q_rental_title` | ¿La casa es tuya o alquilás? | Do you own your home or rent? | A casa é sua ou você aluga? |
| `form.q_rental_title_gift` | ¿La casa de {n} es propia o alquilada? | Does {n} own or rent their home? | A casa de {n} é própria ou alugada? |
| `form.opt_rental_own` | Es propia | I own it | É própria |
| `form.opt_rental_rentAllowed` | Alquilo y permiten animales | I rent and animals are allowed | Alugo e permitem animais |
| `form.opt_rental_rentNotAllowed` | Alquilo y no permiten | I rent and they're not allowed | Alugo e não permitem |
| `form.opt_rental_rentUnsure` | Alquilo, no sé si permiten | I rent, not sure if allowed | Alugo, não sei se permitem |
| `form.q_catOutdoor_title` | ¿Saldría a la calle o a los techos? | Would it go out to the street or roofs? | Ele sairia para a rua ou telhados? |
| `form.q_catOutdoor_title_gift` | En lo de {n}, ¿saldría a la calle o a los techos? | At {n}'s, would it go out to the street or roofs? | Na casa de {n}, ele sairia para a rua ou telhados? |
| `form.opt_sometimes` | A veces | Sometimes | Às vezes |
| `form.q_sleepPlace_title` | ¿Dónde va a dormir? | Where will it sleep? | Onde ele vai dormir? |
| `form.q_sleepPlace_title_gift` | ¿Dónde va a dormir en lo de {n}? | Where will it sleep at {n}'s? | Onde ele vai dormir na casa de {n}? |
| `form.opt_sleep_inside` | Adentro | Indoors | Dentro de casa |
| `form.opt_sleep_outside` | Afuera | Outdoors | Fora de casa |
| `form.q_dogWalks_title` | ¿Cuántas veces por día lo sacarían a pasear? | How many times a day would it be walked? | Quantas vezes por dia ele seria levado para passear? |
| `form.q_dogWalks_title_gift` | En lo de {n}, ¿cuántas veces por día lo sacarían a pasear? | At {n}'s, how many times a day would it be walked? | Na casa de {n}, quantas vezes por dia ele seria levado para passear? |
| `form.opt_walks_twicePlus` | 2 veces o más | Twice or more | 2 vezes ou mais |
| `form.opt_walks_once` | 1 vez | Once | 1 vez |
| `form.opt_walks_walker` | Lo pasea un paseador | A dog walker | Um passeador |
| `form.opt_walks_none` | No sale, tiene patio | It doesn't go out, there's a yard | Não sai, tem quintal |
| `form.q_dogTied_title` | ¿Va a estar atado, o solo en un patio o terraza? | Will it be tied up, or alone in a yard or terrace? | Ele vai ficar amarrado, ou sozinho num quintal ou terraço? |
| `form.q_dogTied_title_gift` | En lo de {n}, ¿va a estar atado, o solo en un patio o terraza? | At {n}'s, will it be tied up, or alone in a yard or terrace? | Na casa de {n}, ele vai ficar amarrado, ou sozinho num quintal ou terraço? |
| `form.q_lastAnimal_title` | ¿Qué pasó con tu último animal? | What happened to your last animal? | O que aconteceu com o seu último animal? |
| `form.q_lastAnimal_title_gift` | ¿Qué pasó con el último animal de {n}? | What happened to {n}'s last animal? | O que aconteceu com o último animal de {n}? |
| `form.opt_last_withMe` | Sigue conmigo | Still with me | Ainda está comigo |
| `form.opt_last_oldAge` | Murió de viejo o enfermo | Died of old age or illness | Morreu de velhice ou doença |
| `form.opt_last_lost` | Se perdió o escapó | Got lost or ran away | Se perdeu ou fugiu |
| `form.opt_last_street` | Murió en la calle (atropellado, envenenado) | Died outside (hit by a car, poisoned) | Morreu na rua (atropelado, envenenado) |
| `form.opt_last_gave` | Lo di o lo regalé | I gave it away | Eu dei ou doei |
| `form.opt_last_first` | Es mi primera vez | This is my first | É a minha primeira vez |
| `form.q_gaveAway_title` | ¿Alguna vez diste o regalaste un animal? | Have you ever given an animal away? | Você já deu ou doou um animal? |
| `form.q_gaveAway_title_gift` | ¿{n} alguna vez dio o regaló un animal? | Has {n} ever given an animal away? | {n} já deu ou doou um animal? |
| `form.gaveAway_why` | ¿Por qué? | Why? | Por quê? |
| `form.q_sterilizeHow_title` | ¿Cómo lo castrarías? | How would you have it neutered? | Como você faria a castração? |
| `form.q_sterilizeHow_title_gift` | ¿Cómo lo castrarían? | How would they have it neutered? | Como fariam a castração? |
| `form.opt_sterilize_done` | Ya está castrado | It's already neutered | Já é castrado |
| `form.opt_sterilize_vet` | Con mi veterinario | With my vet | Com meu veterinário |
| `form.opt_sterilize_campaign` | En una campaña gratuita | At a free campaign | Numa campanha gratuita |
| `form.q_movingIfNoPets_title` | Si te mudás y no aceptan animales, ¿qué harías? | If you move and animals aren't allowed, what would you do? | Se você se mudar e não aceitarem animais, o que faria? |
| `form.q_movingIfNoPets_title_gift` | Si {n} se muda y no aceptan animales, ¿qué haría? | If {n} moves and animals aren't allowed, what would happen? | Se {n} se mudar e não aceitarem animais, o que faria? |
| `form.opt_moving_find` | Busco otro lugar que acepte | Find a place that allows them | Procuro outro lugar que aceite |
| `form.opt_moving_family` | Lo dejo con un familiar | Leave it with a relative | Deixo com um familiar |
| `form.opt_moving_return` | Lo devuelvo o lo doy | Return it or give it away | Devolvo ou dou |
| `form.q_returnReasons_title` | ¿Hay algo por lo que lo devolverías? | Is there anything that would make you return it? | Existe algo pelo qual você o devolveria? |
| `form.opt_return_no` | No | No | Não |
| `form.opt_return_allergy` | Alergia | Allergy | Alergia |
| `form.opt_return_baby` | Un bebé | A baby | Um bebê |
| `form.opt_return_behaviour` | Problemas de conducta | Behaviour problems | Problemas de comportamento |
| `form.opt_return_other` | Otro | Something else | Outro |
| `form.q_adaptPlan_title` | Si rompe cosas, se hace encima o no se lleva con tu otra mascota… | If it breaks things, has accidents or doesn't get along with your other pet… | Se ele quebrar coisas, fizer as necessidades em casa ou não se der bem com seu outro animal… |
| `form.opt_adapt_patience` | Le tengo paciencia o busco un educador | I'm patient or find a trainer | Tenho paciência ou procuro um adestrador |
| `form.opt_adapt_askRescue` | Pido ayuda al refugio | I ask the rescue for help | Peço ajuda ao abrigo |
| `form.opt_adapt_return` | Lo devuelvo | I return it | Devolvo |
| `form.q_visitConsent_title` | ¿Aceptás una visita o videollamada para conocer dónde va a vivir, y que te contactemos después para saber cómo está? | Do you accept a visit or video call to see where it will live, and being contacted afterwards to hear how it's doing? | Você aceita uma visita ou videochamada para conhecer onde ele vai morar, e que entremos em contato depois para saber como ele está? |
| `form.opt_visit_videoOnly` | Solo videollamada | Video call only | Só videochamada |
| `form.q_social_title` | ¿Tenés Instagram o Facebook? | Do you have Instagram or Facebook? | Você tem Instagram ou Facebook? |
| `form.q_social_subtitle` | Nos ayuda a conocerte y a saber de él después. Es opcional. | It helps us get to know you and hear how it's doing later. Optional. | Nos ajuda a conhecer você e saber dele depois. É opcional. |
| `form.field_instagram` | Instagram | Instagram | Instagram |
| `form.field_facebook` | Facebook | Facebook | Facebook |
| `form.field_social_placeholder` | @usuario | @username | @usuario |
| `form.q_vetReference_title` | ¿Tenés veterinario? | Do you have a vet? | Você tem veterinário? |
| `form.field_vetReference` | Nombre o teléfono (opcional) | Name or phone (optional) | Nome ou telefone (opcional) |
| `form.q_motivation_title` | Contanos un poco más | Tell us a bit more | Conte um pouco mais |
| `form.field_motivation` | ¿Por qué querés adoptar? | Why do you want to adopt? | Por que você quer adotar? |
| `form.field_howHeard` | ¿Cómo nos conociste? | How did you hear about us? | Como você nos conheceu? |

Existing keys reused: `form.opt_yes`, `form.opt_no`, `form.opt_unknown`.

- [ ] **Step 2: Schema entries** — in `DEFAULT_SCHEMA` (`PetShieldForm.tsx`), insert entries so the array order equals `FORM_STEP_IDS` (Task 1). Every new closed question is `choice-list`; text questions are `text-fields` with no required field. Example entries (write all 18 the same way, values from the Task 2 table, labels from the Step 1 keys):

```ts
        {
            id: 'carer', type: 'choice-list', title: t('form.q_carer_title'),
            options: [
                { value: 'me', label: t('form.opt_carer_me') },
                { value: 'otherAdult', label: t('form.opt_carer_otherAdult') },
                { value: 'minor', label: t('form.opt_carer_minor') },
            ],
        },
        {
            id: 'gaveAway', type: 'choice-list', title: t('form.q_gaveAway_title'),
            options: [
                { value: 'no', label: t('form.opt_no') },
                { value: 'yes', label: t('form.opt_yes'), withText: { key: 'gaveAwayWhy', label: t('form.gaveAway_why') } },
            ],
        },
        {
            id: 'social', type: 'text-fields', title: t('form.q_social_title'),
            fields: [
                { name: 'instagram', label: t('form.field_instagram'), placeholder: t('form.field_social_placeholder') },
                { name: 'facebook', label: t('form.field_facebook'), placeholder: t('form.field_social_placeholder') },
            ],
        },
```

`allergy` options: `no` (opt_no), `yes` (opt_yes), `unknown` (opt_unknown). `petsCare`: `yes`, `some` (opt_some), `no`. `catOutdoor`/`dogTied`: `no`, `sometimes` (opt_sometimes), `yes`. `visitConsent`: `yes`, `videoOnly`, `no`. `movingIfNoPets`: `find`, `family`, `return`, `unsure` (label opt_unknown). `social` has `subtitle` — `TextFieldsStep` gains an optional `subtitle?: string` rendered under the title like other steps.

- [ ] **Step 3: Species context and callers** — store the config response's species:

```ts
    const [animalSpecies, setAnimalSpecies] = useState<string | null>(null)
```

In the config `fetch`, request `${API_URL}/api/form/${encodeURIComponent(userId)}${animalId ? `?animalId=${encodeURIComponent(animalId)}` : ''}` and in `.then` add `setAnimalSpecies(typeof data?.animalSpecies === 'string' ? data.animalSpecies : null)` (type the response `{ formConfig?: …; animalSpecies?: unknown }`). Then `const formCtx = { animalSpecies }` and pass it to every `stepsForAnswers(…)`, `stepAfter(…)` and `buildSubmitBody(…, configSchema, formCtx)` call (5 call sites: `schema`, hydration, re-map effect, `goNext`, `handleSubmit`).

- [ ] **Step 4: Render** — add `case 'choice-list'` to `renderStep`, `canAdvance` (`!!answers[currentStep.id]`) and `validateWithAnswers` (`err_select_option` when empty), and the follow-ups under hosts.

`contract-app/src/components/FollowUps.tsx`:

```tsx
/** The follow-up questions shown under their host's screen (spec 2026-10-14 §4.2). */
export type ChoiceQuestion = { title: string; options: Array<{ value: string; label: string }> }

export default function FollowUps({ ids, answers, onAnswer, questions }: {
    ids: string[]; answers: Record<string, unknown>; onAnswer: (key: string, value: string) => void; questions: Record<string, ChoiceQuestion>
}) {
    if (!ids.length) return null
    return (
        <div className="ps-followups">
            {ids.map(id => (
                <fieldset key={id} className="ps-followup" data-testid={`followup-${id}`}>
                    <legend className="ps-followup__title">{questions[id].title}</legend>
                    <div className="ps-choice-list ps-choice-list--compact">
                        {questions[id].options.map(o => (
                            <button key={o.value} type="button"
                                className={`ps-choice ${answers[id] === o.value ? 'ps-choice--selected' : ''}`}
                                aria-pressed={answers[id] === o.value}
                                onClick={() => onAnswer(id, o.value)}>
                                {o.label}
                            </button>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    )
}
```

In `PetShieldForm.tsx`:
- Build `followUpQuestions: Record<string, ChoiceQuestion>` from the `DEFAULT_SCHEMA` entries of `carer`, `allergy`, `petsCare`, `sterilizeHow`, each passed through `adaptStepForGift` (so a gift words them for the recipient).
- `const underThis = currentStep ? followUpsUnder(currentStep.id, configSchema, answers) : []` and render `<FollowUps ids={underThis} …/>` at the end of the host's JSX for `icon-cards`, `segmented-cards`, `pet-counter` and `household-people` cases.
- Auto-advance: in the `icon-cards` and `segmented-cards` `onClick`, before `goNext`, compute `const nextA = { ...answers, [currentStep.id]: opt.value }` and only call `goNext({ [currentStep.id]: opt.value })` when `followUpsUnder(currentStep.id, configSchema, nextA).length === 0`; otherwise just `setAnswer`.
- `canAdvance`/`validateWithAnswers`: when `underThis` is non-empty, also require `!!answers[id]` for each (`form.err_select_option` on the first missing one).
- `choice-list` render: a `ps-choice-list` of full-width buttons; tapping selects, and auto-advances unless the option has `withText` or follow-ups would show; with `withText`, render an `<input className="ps-input">` bound to `answers[withText.key]` under the list. `canAdvance` for choice-list: answered (text optional).

- [ ] **Step 5: CSS** — `contract-app/src/petshield.css` (tokens already used by `.ps-card`):

```css
.ps-choice-list { display: flex; flex-direction: column; gap: var(--ps-2); }
.ps-choice {
    width: 100%; min-height: 48px; padding: var(--ps-3) var(--ps-4);
    text-align: left; font-size: 16px; font-weight: 600;
    border: 1px solid var(--ps-border); border-radius: var(--ps-radius-lg);
    background: var(--ps-surface); color: var(--ps-text);
}
.ps-choice--selected { border-color: var(--ps-accent); box-shadow: 0 0 0 2px var(--ps-accent); }
@media (hover: hover) { .ps-choice:hover:not(.ps-choice--selected) { border-color: var(--ps-accent); } }
.ps-choice-list--compact .ps-choice { min-height: 44px; font-size: 15px; }
.ps-followups { margin-top: var(--ps-5); display: flex; flex-direction: column; gap: var(--ps-4); }
.ps-followup { border: 0; padding: 0; margin: 0; }
.ps-followup__title { font-size: 16px; font-weight: 700; margin-bottom: var(--ps-2); color: var(--ps-text); }
```

(Check the variable names against the top of `petshield.css`; use the ones `.ps-card` uses if any differ. 16px on the full-size choice avoids iOS zoom.)

- [ ] **Step 6: Verify** — `cd contract-app && npx tsc --noEmit -p . && npx vitest run && npm run build`. Expected: PASS. Then the browser check (vite on a free port, config mocked), recording these lines:

```js
// scratchpad/new-topics.mjs — mock /api/form/** with
//   { valid:true, userName:'T', formConfig:{ hiddenSteps:['on:catOutdoor'] }, animalSpecies:null }
// draft { stepId:'intent', answers:{ legal:true, species:'cat' } }; then:
// 1. tap "Para mí" → title stays "¿Es para vos o es un regalo?", carer options visible (no auto-advance)
// 2. tap "Yo" → Continuar → next title "¿Hay niños en el hogar?" with "¿Alguien en la casa tiene alergia…" under it
// 3. walk Continuar/taps to "¿Saldría a la calle o a los techos?" (cat) and "¿Alguna vez diste o regalaste un animal?";
//    tap "Sí" → "¿Por qué?" input appears, no auto-advance
// 4. mock formConfig:null → none of the above new titles appear before "¿Cómo te llamás?"
// print each title in order; assert no horizontal overflow at 390 and 1280.
```

Expected: the titles in the order above; no overflow; no console errors.

- [ ] **Step 7: Commit**

```bash
git add contract-app/src/components/FollowUps.tsx contract-app/src/PetShieldForm.tsx contract-app/src/petshield.css contract-app/src/i18n/catalogs/form.ts
git commit -m "public form: the new questions, follow-ups under their screen, the animal's species"
```

---

### Task 7: Results display

**Files:**
- Modify: `src/components/FormAnswersPanel.tsx`, `src/components/FormResultsContent.tsx`, `src/i18n/locales/{es,en,pt}.ts`
- Test: `tests/form-results-link.authed.spec.ts`

**Interfaces:**
- Consumes: Task 4 `answerSignal`; Task 2 values.
- Produces: `export const ADOPTER_INFO_FIELDS: string[]` and `export const OTHER_PETS_FIELDS: string[]` in `FormAnswersPanel.tsx` (used by `FormResultsContent`), and the panel's sections cover every new field.

- [ ] **Step 1: Failing e2e** — append to `tests/form-results-link.authed.spec.ts`:

```ts
    test('the new answers show on the form screen with their dots; open text has none', async ({ page, request }) => {
        const stamp = Date.now();
        const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
            name: `E2E Mostrar ${stamp}`, email: `e2e-mostrar-${stamp}@example.com`, phone: `32${String(stamp).slice(-8)}`, address: '1 Show St',
            intent: 'self', carer: 'minor', rental: 'rentNotAllowed', movingIfNoPets: 'return', gaveAway: 'yes', gaveAwayWhy: 'Me mudé',
            lastAnimal: 'street', visitConsent: 'no', instagram: '@e2e.mostrar', motivation: 'Siempre quise un gato',
        } });
        expect(res.ok(), await res.text()).toBeTruthy();
        const { submissionId } = await res.json();
        await page.goto(`/form-results/${submissionId}`);
        await dismissCountryBanner(page);
        const answers = page.getByRole('button', { name: /Complete answers|Respuestas completas|Respostas completas/ });
        if ((await answers.getAttribute('aria-expanded')) === 'false') await answers.click();
        const row = (label: RegExp) => page.locator('div.flex.items-baseline', { hasText: label });
        await expect(row(/Moving|Mudanza|Mudança/).locator('[data-signal="risk"]')).toBeVisible();
        await expect(row(/Gave an animal away|Regaló un animal|Deu um animal/).locator('[data-signal="risk"]')).toBeVisible();
        await expect(page.getByText('Me mudé')).toBeVisible();
        await expect(row(/Day-to-day carer|Quién lo cuida|Quem cuida/).locator('[data-signal="caution"]')).toBeVisible();
        await expect(row(/Visit|Visita/).locator('[data-signal="risk"]')).toBeVisible();
        await expect(row(/Why adopt|Por qué adopta|Por que adota/).locator('[data-signal]')).toHaveCount(0);
        await expect(page.getByText('@e2e.mostrar')).toBeVisible();
    });
```

- [ ] **Step 2: Run** `$S/e2e.sh nt7red tests/form-results-link.authed.spec.ts --project=authed -g "new answers"`. Expected: FAIL (rows absent).

- [ ] **Step 3: Implement.**

App locale keys — `petshield.fields.<id>` (label), `petshield.options.<id>.<value>`, `petshield.fields_gift.<id>` (with `{n}`), in es / en / pt:

| Key | es | en | pt |
|---|---|---|---|
| fields.carer | Quién lo cuida | Day-to-day carer | Quem cuida |
| options.carer.me / otherAdult / minor | El adoptante / Otro adulto de la casa / Un menor | The applicant / Another adult at home / A minor | O adotante / Outro adulto da casa / Um menor |
| fields.allergy | Alergias en la casa | Allergies at home | Alergias na casa |
| fields_gift.allergy | Alergias en la casa de {n} | Allergies in {n}'s home | Alergias na casa de {n} |
| options.allergy.no / yes / unknown | No / Sí / No sabe | No / Yes / Doesn't know | Não / Sim / Não sabe |
| fields.petsCare | Mascotas castradas y vacunadas | Pets neutered and vaccinated | Animais castrados e vacinados |
| options.petsCare.yes / some / no | Sí / Algunas / No | Yes / Some / No | Sim / Alguns / Não |
| fields.rental | Vivienda propia o alquilada | Owns or rents | Casa própria ou alugada |
| fields_gift.rental | Vivienda de {n} | {n}'s home | Casa de {n} |
| options.rental.own / rentAllowed / rentNotAllowed / rentUnsure / unknown | Propia / Alquila, permiten animales / Alquila, no permiten animales / Alquila, no sabe si permiten / No sabe | Owns / Rents, animals allowed / Rents, animals not allowed / Rents, unsure if allowed / Doesn't know | Própria / Aluga, permitem animais / Aluga, não permitem animais / Aluga, não sabe se permitem / Não sabe |
| fields.catOutdoor | Sale a la calle o techos | Goes out to street or roofs | Sai para rua ou telhados |
| fields_gift.catOutdoor | Sale a la calle en lo de {n} | Goes out at {n}'s | Sai para a rua na casa de {n} |
| options.catOutdoor.no / sometimes / yes / unknown | No / A veces / Sí / No sabe | No / Sometimes / Yes / Doesn't know | Não / Às vezes / Sim / Não sabe |
| fields.sleepPlace | Dónde duerme | Where it sleeps | Onde dorme |
| fields_gift.sleepPlace | Dónde duerme en lo de {n} | Where it sleeps at {n}'s | Onde dorme na casa de {n} |
| options.sleepPlace.inside / outside / unknown | Adentro / Afuera / No sabe | Indoors / Outdoors / Doesn't know | Dentro / Fora / Não sabe |
| fields.dogWalks | Paseos por día | Walks per day | Passeios por dia |
| fields_gift.dogWalks | Paseos por día en lo de {n} | Walks per day at {n}'s | Passeios por dia na casa de {n} |
| options.dogWalks.twicePlus / once / walker / none / unknown | 2 o más / 1 / Paseador / No sale, tiene patio / No sabe | 2 or more / 1 / Dog walker / Doesn't go out, has a yard / Doesn't know | 2 ou mais / 1 / Passeador / Não sai, tem quintal / Não sabe |
| fields.dogTied | Atado o solo afuera | Tied or alone outside | Amarrado ou sozinho fora |
| fields_gift.dogTied | Atado o solo afuera en lo de {n} | Tied or alone outside at {n}'s | Amarrado ou sozinho fora na casa de {n} |
| options.dogTied.no / sometimes / yes / unknown | No / A veces / Sí / No sabe | No / Sometimes / Yes / Doesn't know | Não / Às vezes / Sim / Não sabe |
| fields.lastAnimal | Su último animal | Their last animal | Seu último animal |
| fields_gift.lastAnimal | Último animal de {n} | {n}'s last animal | Último animal de {n} |
| options.lastAnimal.withMe / oldAge / lost / street / gave / first / unknown | Sigue con él/ella / Murió de viejo o enfermo / Se perdió o escapó / Murió en la calle / Lo dio o regaló / Es su primera vez / No sabe | Still with them / Died of old age or illness / Got lost or ran away / Died outside / Gave it away / First animal / Doesn't know | Ainda está com a pessoa / Morreu de velhice ou doença / Se perdeu ou fugiu / Morreu na rua / Deu ou doou / É o primeiro / Não sabe |
| fields.gaveAway | Regaló un animal | Gave an animal away | Deu um animal |
| fields_gift.gaveAway | {n} regaló un animal | {n} gave an animal away | {n} deu um animal |
| options.gaveAway.no / yes / unknown | No / Sí / No sabe | No / Yes / Doesn't know | Não / Sim / Não sabe |
| fields.gaveAwayWhy | Por qué lo regaló | Why they gave it away | Por que deu |
| fields.sterilizeHow | Cómo lo castraría | How they'd neuter it | Como castraria |
| options.sterilizeHow.done / vet / campaign | Ya está castrado / Con su veterinario / Campaña gratuita | Already neutered / Their vet / Free campaign | Já castrado / Veterinário próprio / Campanha gratuita |
| fields.movingIfNoPets | Mudanza sin animales | Moving, no animals allowed | Mudança sem animais |
| fields_gift.movingIfNoPets | Si {n} se muda sin animales | If {n} moves, no animals | Se {n} se mudar sem animais |
| options.movingIfNoPets.find / family / return / unsure | Busca otro lugar / Lo deja con un familiar / Lo devuelve o lo da / No sabe | Finds another place / Leaves it with a relative / Returns it or gives it away / Doesn't know | Procura outro lugar / Deixa com um familiar / Devolve ou dá / Não sabe |
| fields.returnReasons | Lo devolvería por | Would return it for | Devolveria por |
| options.returnReasons.no / allergy / baby / behaviour / other | Nada / Alergia / Un bebé / Problemas de conducta / Otro motivo | Nothing / Allergy / A baby / Behaviour problems / Another reason | Nada / Alergia / Um bebê / Problemas de comportamento / Outro motivo |
| fields.adaptPlan | Si no se adapta | If it doesn't adapt | Se não se adaptar |
| options.adaptPlan.patience / askRescue / return | Paciencia o educador / Pide ayuda al refugio / Lo devuelve | Patience or trainer / Asks the rescue / Returns it | Paciência ou adestrador / Pede ajuda ao abrigo / Devolve |
| fields.visitConsent | Visita y seguimiento | Visit and follow-up | Visita e acompanhamento |
| options.visitConsent.yes / videoOnly / no | Acepta / Solo videollamada / No acepta | Accepts / Video call only / Doesn't accept | Aceita / Só videochamada / Não aceita |
| fields.instagram | Instagram | Instagram | Instagram |
| fields.facebook | Facebook | Facebook | Facebook |
| fields.vetReference | Su veterinario | Their vet | Seu veterinário |
| fields.motivation | Por qué adopta | Why adopt | Por que adota |
| fields.howHeard | Cómo nos conoció | How they heard of us | Como nos conheceu |

`FormAnswersPanel.tsx`:
- `renderFormAnswerValue`: add the new closed fields to the `petshield.options.${key}.${val}` case list: `carer`, `allergy`, `petsCare`, `rental`, `catOutdoor`, `sleepPlace`, `dogWalks`, `dogTied`, `lastAnimal`, `gaveAway`, `sterilizeHow`, `movingIfNoPets`, `returnReasons`, `adaptPlan`, `visitConsent`. Free text (`gaveAwayWhy`, `instagram`, `facebook`, `vetReference`, `motivation`, `howHeard`) falls through to `String(raw)`.
- Sections (replace the `fields` arrays):
  - identity: `['ageRange', 'carer', 'lastAnimal', 'petExperience', 'gaveAway', 'gaveAwayWhy', 'instagram', 'facebook', 'vetReference', 'motivation', 'howHeard']`
  - household: `['children', 'allergy', 'existingPets', 'petsCare', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied']`
  - commitments: `['specialNeeds', 'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingIfNoPets', 'movingPlans', 'vacationPlan', 'returnReasons', 'adaptPlan', 'visitConsent']`
- Export the field lists the results page uses, and use them there:

```ts
/** "Datos del adoptante" on the form screen, after name/email/phone/address. */
export const ADOPTER_INFO_FIELDS = ['ageRange', 'carer', 'children', 'allergy', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'instagram', 'facebook', 'vetReference', 'motivation', 'howHeard'];
/** "Otras mascotas" on the form screen. */
export const OTHER_PETS_FIELDS = ['lastAnimal', 'petExperience', 'gaveAway', 'gaveAwayWhy', 'existingPets', 'petsCare'];
```

In `FormResultsContent.tsx` replace the literal arrays at the `['ageRange', 'children', …]` and `['petExperience', 'existingPets']` maps with `ADOPTER_INFO_FIELDS` and `OTHER_PETS_FIELDS`, and widen the "Otras mascotas" box condition to `OTHER_PETS_FIELDS.some(f => fullAnswers[f] !== undefined)` (keeping the existing pet-count check for `existingPets`). The "Otras mascotas" rows also render through `AnswerValue` (dots), like the adopter-info rows.

`fieldLabel` already prefers `fields_gift.<id>` on gift forms — no change.

- [ ] **Step 4: Run** the e2e again and the whole `form-results-link` spec. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FormAnswersPanel.tsx src/components/FormResultsContent.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts tests/form-results-link.authed.spec.ts
git commit -m "form results: the new answers with their semáforo"
```

---

### Task 8: Settings — rows, default-off switches, old/new wording

**Files:**
- Modify: `src/components/adoptionDocs/FormStepsEditor.tsx`, `src/app/settings/adoption-docs/page.tsx`, `src/i18n/locales/{es,en,pt}.ts`
- Test: `tests/household-question.authed.spec.ts`

**Interfaces:**
- Consumes: Task 1 `isQuestionOn`, `toggleQuestion`, `questionWay`, `setQuestionWay`, `settingKeyQuestion`, `FOLLOW_UP_HOSTS`, `SPECIES_ONLY_STEPS`, `VARIANT_FORM_STEPS`.

- [ ] **Step 1: Failing e2e** — append to `tests/household-question.authed.spec.ts`:

```ts
    test('new questions: a default-off switch turns on, previous animal can use the old wording, the public config carries both', async ({ page, request }) => {
        execD1(`UPDATE adoption_doc_settings SET hidden_steps = NULL WHERE ${OWNER}`);
        await page.goto('/settings/adoption-docs');
        await dismissCountryBanner(page);
        const cat = page.getByTestId('form-step-catOutdoor');
        await expect(cat).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
        await dismissCountryBanner(page);
        await expect(page.getByTestId('form-step-gaveAway')).toHaveAttribute('aria-checked', 'true');

        await cat.click();
        await page.getByTestId('way-petExperience-old').click();
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored, { timeout: 15_000 }).toEqual(['on:catOutdoor', 'way:petExperience:old']);
        const cfg = await (await request.get('/api/form/test-admin-id')).json();
        expect(cfg.formConfig.hiddenSteps).toEqual(['on:catOutdoor', 'way:petExperience:old']);

        await page.getByTestId('way-petExperience-new').click();
        await cat.click();
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored, { timeout: 15_000 }).toEqual([]);
    });
```

- [ ] **Step 2: Run** `$S/e2e.sh nt8red tests/household-question.authed.spec.ts --project=authed -g "new questions"`. Expected: FAIL (`form-step-catOutdoor` not found).

- [ ] **Step 3: Implement.**

`FormStepsEditor.tsx`:
- Rows: `group.steps.filter(id => id !== 'household')` as today (the new rows come from `FORM_STEP_GROUPS`).
- Row state: `const on = isQuestionOn(id, hidden)`; click: `onChange(toggleQuestion(id, hidden))` (replaces the `!hiddenSet.has(id)` / `toggle(id)` pair for non-locked rows).
- Conflict and "Actualizado por" for a row also read the row's token key: `const key = (DEFAULT_OFF_FORM_STEPS as readonly string[]).includes(id) ? `on:${id}` : id;` and use `conflicts[key]` / `updatedBy[key]`; for `petExperience`/`movingPlans` also show `conflicts[`way:${id}:old`]` (like `household` under `children`).
- Under `petExperience` and `movingPlans` when on, a radiogroup like `householdChoice`, testids `way-<id>-new` / `way-<id>-old`, labels `adoptionDocs.way_<id>_new` / `adoptionDocs.way_<id>_old`, calling `onChange(setQuestionWay(id, way, hidden))`.
- A hint after species-only rows, inside the label span: `{(SPECIES_ONLY_STEPS as Record<string, string>)[id] && <span className="text-xs text-stone-500"> · {t(`adoptionDocs.only_${(SPECIES_ONLY_STEPS as Record<string, string>)[id]}`)}</span>}`.
- Counter: `questions = FORM_STEP_IDS.filter(id => id !== 'household' && !(DERIVED_FORM_STEPS as readonly string[]).includes(id) && !(VARIANT_FORM_STEPS as readonly string[]).includes(id) && id !== 'petsCare' && id !== 'sterilizeHow')`; `shown = questions.filter(id => LOCKED.has(id) || isQuestionOn(id, hidden) || (id === 'children' && isStepAsked('household', hidden)))` (`LOCKED` is the editor's existing set) — `legal` and identity rows count as asked. petsCare and sterilizeHow are follow-ups of a question already counted (spec §6).
- `conflictBanner` label: `label(settingKeyQuestion(key))` for `on:`/`way:` keys (append `({label})` like `household`).

`src/app/settings/adoption-docs/page.tsx` — the toast's `question(id)` maps through `settingKeyQuestion(id)` first:

```ts
            const question = (key: string) => {
                const id = settingKeyQuestion(key);
                return t(key === 'phone-optional' ? 'adoptionDocs.phone_required_question'
                    : id.startsWith('identity-') || id === 'selfie' ? `adoptionDocs.step_${id.replace('-', '_')}` : `petshield.fields.${id}`);
            };
```

App locale keys (`adoptionDocs.*`), es / en / pt:

| Key | es | en | pt |
|---|---|---|---|
| way_petExperience_new | ¿Qué pasó con tu último animal? (recomendado) | What happened to your last animal? (recommended) | O que aconteceu com seu último animal? (recomendado) |
| way_petExperience_old | ¿Tuviste mascotas antes? (simple) | Have you had pets before? (simple) | Você já teve animais? (simples) |
| way_movingPlans_new | Si te mudás y no aceptan animales… (recomendado) | If you move and animals aren't allowed… (recommended) | Se você se mudar e não aceitarem animais… (recomendado) |
| way_movingPlans_old | ¿Tenés pensado mudarte pronto? (simple) | Planning to move soon? (simple) | Pensa em se mudar em breve? (simples) |
| only_cat | solo gatos | cats only | só gatos |
| only_dog | solo perros | dogs only | só cães |

The row labels come from `petshield.fields.<id>` (Task 7); `social` needs `petshield.fields.social`: es "Instagram y Facebook", en "Instagram and Facebook", pt "Instagram e Facebook"; `motivation` row reuses `fields.motivation`.

- [ ] **Step 4: Run** the new e2e and the whole `household-question` spec and `npx vitest run src/domain`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/adoptionDocs/FormStepsEditor.tsx src/app/settings/adoption-docs/page.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts tests/household-question.authed.spec.ts
git commit -m "form settings: switches for the new questions, old/new wording for previous animal and moving"
```

---

### Task 9: Public-form guidelines

**Files:**
- Modify: `docs/ux-ui-guidelines.md`

- [ ] **Step 1:** Add a section "Public adoption form" after the personas in §1.1, with the text of spec §3 (persona "The Applicant" and rules 1–8), adding to rule 2 the new answer style: "**a list of full-width options** for closed answers longer than a word or two (`choice-list`)". In §4.4, clarify the existing bullet: "Wizard steps cap at 3 for `AdoptionFormWizard` (the rescuer's record wizard) — **not** the public form, which follows the Public adoption form rules."

- [ ] **Step 2: Commit**

```bash
git add docs/ux-ui-guidelines.md
git commit -m "ux guidelines: the public adoption form (applicant persona, answer styles, options, length, photos, wording)"
```

---

### Task 10: Verification and release notes

- [ ] **Step 1:** Run, reading each output:
  - `npx tsc --noEmit`; `npx vitest run`; `npm run lint` (warnings ≤ ratchet); `npm run build`; `node scripts/check-action-surface.mjs` (no new server actions — expect "as expected");
  - `cd contract-app && npx tsc --noEmit -p . && npx vitest run && npm run build`;
  - e2e: `tests/adoption-docs.spec.ts` (`--project=user`), `tests/form-results-link.authed.spec.ts`, `tests/household-question.authed.spec.ts`, `tests/merge-undo.authed.spec.ts` (`--project=authed`).
- [ ] **Step 2:** Visual pass at 390 and 1280, light and dark: the public form's new screens (choice-list, follow-ups), the form results rows, the settings rows (default-off switches, old/new radios). Measure `scrollWidth <= clientWidth`.
- [ ] **Step 3:** Version: `git show origin/staging:package.json | grep version` → bump one patch above with `npm version <v> --no-git-tag-version`; CHANGELOG entry: what applicants see with custom forms on (new questions, follow-ups, cat/dog questions), what rescuers can switch, that production forms don't change while custom forms is off; and the earlier fixes already on this branch (gift "No sé" clean-up, old gift drafts, vacation "No sé", wording without "/a", merge keeps the gift mark and phone, "Hija · Laura Pérez").
- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "v<version>: adoption form — new questions (custom forms), gift fixes"
```
