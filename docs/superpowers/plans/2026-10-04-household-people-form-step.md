# Household people form step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rescuer choose, per form, between "¿Hay niños?" and a people list
("¿Quiénes viven en la casa?": relationship, age, optional first and last name).
Fully named people land on the applicant's profile, each form is linked from its
profile, and the form screen shows a semáforo per person.

**Architecture:**
- **Pure rules** live in `src/domain/` (people parsing, the age signal, the
  question-choice resolution) and are mirrored in `contract-app/src/lib/` where
  the public form needs them.
- **Configuration** reuses the existing `hidden_steps` list: a `'household'` token
  means "people list".
- **Submit** writes the people into `answersJson`, puts fully named people on the
  auto-created profile, and records the adoption request.
- **Merges** carry household members.

**Tech Stack:**
- Next.js 15 (app, Cloudflare Pages, D1/Drizzle), Vite + React (`contract-app`).
- Vitest (both), Playwright (app).
- i18n: es / en / pt in `src/i18n/locales/*.ts` and `contract-app/src/i18n/catalogs/form.ts`.

**Spec:** `docs/superpowers/specs/2026-10-04-household-people-form-step-design.md`

## Global Constraints

- **Default unchanged:** with no `'household'` token, every form asks "¿Hay niños?"
  exactly as today. Existing configs must behave identically.
- **Per person:**
  - relationship ∈ `partner | child | parent | sibling | other_relative | housemate`,
    required (never `unknown` from the form);
  - `age` an integer 0–120, required;
  - `firstName` and `lastName` optional, trimmed, ≤ 60 chars each;
  - max **15** people.
- **Profile members:** only people with **both** names become profile
  `household_members`, each with `name = "firstName lastName"`, `age`,
  `ageAsOf = submission ISO date (YYYY-MM-DD)` and `addedBy = 'form-submission'`.
- **Semáforo:** age < 5 → `risk` (red); 5–17 → `caution` (amber); ≥ 18 → `ok`
  (green); "Vivo solo/a" → `ok`.
- **Compatibility:** the `children` answer is always derived from the ages (count of
  age < 18 → `'none' | '1' | '2' | '3+'`) and written alongside, both by the client
  and recomputed by the server.
- **Wording:** "¿Quiénes viven en la casa?" (`housingType=house`) / "¿Quiénes viven
  en el departamento?" (`apartment`) / "¿Quiénes viven en tu hogar?" (else).
  Subtitle "Sin contarte a vos". The step goes right after `housingType`.
- **Every submission** records an adoption request on its profile at submit time.
  It counts toward "demasiados pedidos", as intended.
- **D1:** never `inArray`. **Logging:** every catch re-emits context and never
  swallows silently. **i18n:** every new key goes in es + en + pt (and in
  contract-app's three locales).
- **Server actions:** no new browser-callable actions (`EXPECTED_ACTIONS` stays
  162). Changes to existing action inputs are fine.

## Review Focus

1. **A legacy config that hid `children` and then picks the people list.**
   Expected: neither question is asked (one switch for the row). Test in Task 3.
2. **A stale draft or answers carrying `householdPeople` on a form configured for
   "¿Hay niños?" (or the reverse).** Expected: the submit body carries only the
   answers of the question asked. Test in Task 3 (`stripHiddenAnswers`).
3. **A forged client sending out-of-range ages, unknown relationships, 50 people or
   a lying `children` count.** Expected: the server drops bad people, caps at 15
   and recomputes `children`. Test in Task 1.
4. **"Es la misma persona" after a form put members on the auto profile.**
   Expected: the members move to the chosen profile; undo restores the survivor's
   original members. Test in Task 6.
5. **An age recorded last year.** Expected: the profile shows the current age
   (`age + whole years since ageAsOf`), never a stale one. Test in Task 2.

---

### Task 1: People parsing, derived children and the per-person signal (domain)

**Files:**
- Create: `src/domain/householdPeople.ts`
- Create: `src/domain/householdPeople.test.ts`
- Modify: `src/domain/answerSignals.ts` (add `personSignal`)
- Modify: `src/domain/answerSignals.test.ts`

**Interfaces:**
- Produces:
  - `type FormRelationship = 'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate'`
  - `FORM_RELATIONSHIPS: readonly FormRelationship[]`
  - `interface HouseholdPerson { relationship: FormRelationship; age: number; firstName?: string; lastName?: string }`
  - `MAX_HOUSEHOLD_PEOPLE = 15`
  - `parseHouseholdPeople(raw: unknown): HouseholdPerson[]`
  - `childrenAnswer(people: readonly HouseholdPerson[]): 'none' | '1' | '2' | '3+'`
  - `fullName(p: HouseholdPerson): string | null` (both names present → "First Last", else null)
  - `personSignal(age: number): AnswerSignal` in `answerSignals.ts`

- [ ] **Step 1: Write the failing tests** — `src/domain/householdPeople.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseHouseholdPeople, childrenAnswer, fullName, MAX_HOUSEHOLD_PEOPLE } from './householdPeople';

describe('parseHouseholdPeople', () => {
    it('keeps valid people, trimming names', () => {
        expect(parseHouseholdPeople([{ relationship: 'child', age: 7, firstName: ' Tomás ', lastName: ' López ' }]))
            .toEqual([{ relationship: 'child', age: 7, firstName: 'Tomás', lastName: 'López' }]);
    });
    it('drops unknown relationships, "unknown", non-integer and out-of-range ages', () => {
        expect(parseHouseholdPeople([
            { relationship: 'boss', age: 30 }, { relationship: 'unknown', age: 30 },
            { relationship: 'child', age: -1 }, { relationship: 'child', age: 121 },
            { relationship: 'child', age: 3.5 }, { relationship: 'child', age: '4' },
            { relationship: 'partner', age: 0 },
        ])).toEqual([{ relationship: 'partner', age: 0 }]);
    });
    it('omits empty names and caps each at 60 chars', () => {
        const [p] = parseHouseholdPeople([{ relationship: 'sibling', age: 20, firstName: '  ', lastName: 'x'.repeat(80) }]);
        expect(p.firstName).toBeUndefined();
        expect(p.lastName).toHaveLength(60);
    });
    it('caps the list at 15 and ignores non-arrays', () => {
        const many = Array.from({ length: 40 }, () => ({ relationship: 'housemate', age: 30 }));
        expect(parseHouseholdPeople(many)).toHaveLength(MAX_HOUSEHOLD_PEOPLE);
        expect(parseHouseholdPeople('nope')).toEqual([]);
        expect(parseHouseholdPeople(null)).toEqual([]);
    });
});

describe('childrenAnswer', () => {
    it('counts people under 18, mapped to the legacy answer', () => {
        expect(childrenAnswer([])).toBe('none');
        expect(childrenAnswer([{ relationship: 'partner', age: 40 }])).toBe('none');
        expect(childrenAnswer([{ relationship: 'child', age: 17 }])).toBe('1');
        expect(childrenAnswer([{ relationship: 'child', age: 2 }, { relationship: 'child', age: 9 }])).toBe('2');
        expect(childrenAnswer([1, 2, 3, 4].map(a => ({ relationship: 'child' as const, age: a })))).toBe('3+');
    });
});

describe('fullName', () => {
    it('needs both names', () => {
        expect(fullName({ relationship: 'child', age: 7, firstName: 'Tomás', lastName: 'López' })).toBe('Tomás López');
        expect(fullName({ relationship: 'child', age: 7, firstName: 'Tomás' })).toBeNull();
        expect(fullName({ relationship: 'child', age: 7 })).toBeNull();
    });
});
```

Append to `src/domain/answerSignals.test.ts`:

```ts
import { personSignal } from './answerSignals';
describe('personSignal', () => {
    it('under 5 is red, 5–17 amber, adults green', () => {
        expect(personSignal(0)).toBe('risk');
        expect(personSignal(4)).toBe('risk');
        expect(personSignal(5)).toBe('caution');
        expect(personSignal(17)).toBe('caution');
        expect(personSignal(18)).toBe('ok');
        expect(personSignal(80)).toBe('ok');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/householdPeople.test.ts src/domain/answerSignals.test.ts`
Expected: FAIL. The module is not found, and `personSignal` is not exported.

- [ ] **Step 3: Implement** — `src/domain/householdPeople.ts`

```ts
/**
 * The adoption form's "¿Quiénes viven en la casa?" answer (spec:
 * docs/superpowers/specs/2026-10-04-household-people-form-step-design.md).
 * Pure: the server re-parses whatever the public form sends — a forged body
 * must not put junk on a profile or lie about the children count.
 * contract-app mirrors FORM_RELATIONSHIPS (mirror test).
 */
export type FormRelationship = 'partner' | 'child' | 'parent' | 'sibling' | 'other_relative' | 'housemate';
export const FORM_RELATIONSHIPS: readonly FormRelationship[] = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate'];
const REL = new Set<string>(FORM_RELATIONSHIPS);

export interface HouseholdPerson { relationship: FormRelationship; age: number; firstName?: string; lastName?: string }

export const MAX_HOUSEHOLD_PEOPLE = 15;
const MAX_NAME = 60;

function cleanName(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().slice(0, MAX_NAME);
    return s || undefined;
}

export function parseHouseholdPeople(raw: unknown): HouseholdPerson[] {
    if (!Array.isArray(raw)) return [];
    const out: HouseholdPerson[] = [];
    for (const r of raw) {
        if (out.length >= MAX_HOUSEHOLD_PEOPLE) break;
        if (!r || typeof r !== 'object') continue;
        const { relationship, age } = r as Record<string, unknown>;
        if (typeof relationship !== 'string' || !REL.has(relationship)) continue;
        if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 120) continue;
        const firstName = cleanName((r as Record<string, unknown>).firstName);
        const lastName = cleanName((r as Record<string, unknown>).lastName);
        out.push({ relationship: relationship as FormRelationship, age, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) });
    }
    return out;
}

/** The legacy "¿Hay niños?" answer, derived — never trusted from the client. */
export function childrenAnswer(people: readonly HouseholdPerson[]): 'none' | '1' | '2' | '3+' {
    const n = people.filter(p => p.age < 18).length;
    return n === 0 ? 'none' : n === 1 ? '1' : n === 2 ? '2' : '3+';
}

/** Only fully named people become profile household members. */
export function fullName(p: HouseholdPerson): string | null {
    return p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null;
}
```

Add to `src/domain/answerSignals.ts`, below `answerSignal`:

```ts
/** One person in "¿Quiénes viven en la casa?" (Jon, 2026-10-04): under 5 red, 5–17 amber, adults green. */
export function personSignal(age: number): AnswerSignal {
    return age < 5 ? 'risk' : age < 18 ? 'caution' : 'ok';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/householdPeople.test.ts src/domain/answerSignals.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/householdPeople.ts src/domain/householdPeople.test.ts src/domain/answerSignals.ts src/domain/answerSignals.test.ts
git commit -m "household people: parse, derive children, per-person signal"
```

---

### Task 2: Member age (profile model) and merging members

**Files:**
- Modify: `src/lib/householdMembers.ts` (add `age?`, `ageAsOf?`; `currentAge`; `mergeHouseholdMembers`)
- Test: `src/lib/householdMembers.test.ts` (exists; append)

**Interfaces:**
- Produces:
  - `HouseholdMember.age?: number`, `HouseholdMember.ageAsOf?: string` (ISO `YYYY-MM-DD`)
  - `currentAge(m: { age?: number; ageAsOf?: string }, today?: Date): number | null`
  - `mergeHouseholdMembers(survivor: HouseholdMember[], absorbed: HouseholdMember[]): HouseholdMember[]`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/householdMembers.test.ts`)

```ts
import { currentAge, mergeHouseholdMembers, deserializeHouseholdMembers, serializeHouseholdMembers } from './householdMembers';

describe('member age', () => {
    it('round-trips age + ageAsOf and drops invalid ones', () => {
        const json = serializeHouseholdMembers([
            { id: 'a', name: 'Tomás López', relationship: 'child', contactEntries: [], age: 7, ageAsOf: '2026-10-04' },
            { id: 'b', name: 'Ana Ruiz', relationship: 'partner', contactEntries: [], age: -3 as number, ageAsOf: 'yesterday' },
        ]);
        const [a, b] = deserializeHouseholdMembers(json);
        expect(a.age).toBe(7); expect(a.ageAsOf).toBe('2026-10-04');
        expect(b.age).toBeUndefined(); expect(b.ageAsOf).toBeUndefined();
    });
    it('currentAge adds whole years since ageAsOf', () => {
        const m = { age: 7, ageAsOf: '2025-10-04' };
        expect(currentAge(m, new Date('2026-10-03'))).toBe(7);
        expect(currentAge(m, new Date('2026-10-04'))).toBe(8);
        expect(currentAge({ age: 7 }, new Date('2030-01-01'))).toBe(7); // no date → as recorded
        expect(currentAge({}, new Date())).toBeNull();
    });
});

describe('mergeHouseholdMembers', () => {
    const m = (id: string, name: string, relationship: 'child' | 'partner') => ({ id, name, relationship, contactEntries: [] });
    it('appends the absorbed members, skipping same name + relationship', () => {
        const out = mergeHouseholdMembers([m('1', 'Tomás López', 'child')], [m('2', ' tomás  lópez ', 'child'), m('3', 'Ana Ruiz', 'partner')]);
        expect(out.map(x => x.id)).toEqual(['1', '3']);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/householdMembers.test.ts`
Expected: FAIL. `currentAge` and `mergeHouseholdMembers` are not exported, and age is dropped.

- [ ] **Step 3: Implement** in `src/lib/householdMembers.ts`
  - Add `age?: number; ageAsOf?: string;` to `HouseholdMember`, with a doc comment:
    "age as given on `ageAsOf`; show `currentAge()`".
  - In `deserializeHouseholdMembers`, after `relationship`, add:

```ts
const age = typeof m.age === 'number' && Number.isInteger(m.age) && m.age >= 0 && m.age <= 120 ? m.age : undefined;
const ageAsOf = typeof m.ageAsOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.ageAsOf) ? m.ageAsOf : undefined;
```

  and spread `...(age !== undefined ? { age } : {}), ...(age !== undefined && ageAsOf ? { ageAsOf } : {})`
  into the pushed member.
  - Make sure `serializeHouseholdMembers` keeps `age` and `ageAsOf`. If it maps
    fields explicitly, add them. If it serialises the object, nothing changes.
  - Add:

```ts
/** Age today: the recorded age plus whole years elapsed since it was recorded. */
export function currentAge(m: { age?: number; ageAsOf?: string }, today: Date = new Date()): number | null {
    if (typeof m.age !== 'number') return null;
    if (!m.ageAsOf) return m.age;
    const [y, mo, d] = m.ageAsOf.split('-').map(Number);
    let years = today.getUTCFullYear() - y;
    if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) years--;
    return m.age + Math.max(0, years);
}

const nameKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The survivor's members plus the absorbed profile's, minus exact (name + relationship) repeats. */
export function mergeHouseholdMembers(survivor: HouseholdMember[], absorbed: HouseholdMember[]): HouseholdMember[] {
    const seen = new Set(survivor.map(m => `${nameKey(m.name)}|${m.relationship ?? ''}`));
    const out = [...survivor];
    for (const m of absorbed) {
        const k = `${nameKey(m.name)}|${m.relationship ?? ''}`;
        if (m.name.trim() && seen.has(k)) continue;
        seen.add(k);
        out.push(m);
    }
    return out.slice(0, MAX_MEMBERS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/householdMembers.test.ts`
Expected: PASS (the new tests and every existing one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/householdMembers.ts src/lib/householdMembers.test.ts
git commit -m "household members: age with as-of date, current age, merge"
```

---

### Task 3: The question choice ("¿Hay niños?" vs people), in both apps

**Files:**
- Modify: `src/domain/adoptionDocs.ts` and `contract-app/src/lib/adoptionDocs.ts`:
  - `FORM_STEP_IDS`: add `'household'` right after `'housingType'`, in both;
  - `FORM_STEP_GROUPS` "home": add `'household'`.
- Modify: `contract-app/src/lib/adoptionDocs.ts`:
  - replace `applyHiddenSteps` with `formStepsToAsk`;
  - fix `stripHiddenAnswers`;
  - mirror `FORM_RELATIONSHIPS`;
  - add `childrenAnswer`.
- Modify: `src/domain/adoptionDocs.ts`: add `householdQuestion` and `isStepAsked`.
- Modify: `src/domain/adoptionDocs.mirror.test.ts`: also mirror `FORM_RELATIONSHIPS`.
- Modify: `contract-app/src/PetShieldForm.tsx:540`: use `formStepsToAsk`.
- Modify: `src/components/adoptionDocs/FormStepsEditor.tsx`: the choice on the children row, and the counter.
- Modify: `src/i18n/locales/{es,en,pt}.ts`: `adoptionDocs.household_choice_children`,
  `adoptionDocs.household_choice_people`, `adoptionDocs.household_choice_label`,
  `petshield.fields.household`.
- Test: `contract-app/src/lib/adoptionDocs.test.ts` (append), `src/domain/adoptionDocs.test.ts` (append).

**Interfaces:**
- Consumes: `FORM_RELATIONSHIPS` (Task 1) for the mirror.
- Produces:
  - app: `householdQuestion(hidden: readonly string[]): 'children' | 'people'`
  - app: `isStepAsked(id: string, hidden: readonly string[]): boolean`
  - contract-app: `formStepsToAsk<T extends { id: string }>(schema: T[], stored: readonly string[] | null | undefined): T[]`
  - contract-app: `childrenAnswer(people: ReadonlyArray<{ age: number }>): 'none' | '1' | '2' | '3+'`
  - contract-app: `FORM_RELATIONSHIPS` (same values as Task 1)

- [ ] **Step 1: Write the failing tests**

Append to `contract-app/src/lib/adoptionDocs.test.ts`:

```ts
import { formStepsToAsk, stripHiddenAnswers, childrenAnswer } from './adoptionDocs'
const S = ['intent', 'children', 'housingType', 'household', 'hasOutdoor'].map(id => ({ id }))
const ids = (x: { id: string }[]) => x.map(s => s.id)

describe('formStepsToAsk', () => {
    it('default (no config) asks "¿Hay niños?", never the people list', () => {
        expect(ids(formStepsToAsk(S, null))).toEqual(['intent', 'children', 'housingType', 'hasOutdoor'])
        expect(ids(formStepsToAsk(S, []))).toEqual(['intent', 'children', 'housingType', 'hasOutdoor'])
    })
    it('"household" chosen → people list instead of the children question', () => {
        expect(ids(formStepsToAsk(S, ['household']))).toEqual(['intent', 'housingType', 'household', 'hasOutdoor'])
    })
    it('hiding "children" hides the household question whichever is chosen', () => {
        expect(ids(formStepsToAsk(S, ['children']))).toEqual(['intent', 'housingType', 'hasOutdoor'])
        expect(ids(formStepsToAsk(S, ['children', 'household']))).toEqual(['intent', 'housingType', 'hasOutdoor'])
    })
    it('still hides other hidden steps and never a locked one', () => {
        expect(ids(formStepsToAsk([{ id: 'legal' }, ...S], ['legal', 'intent']))).toEqual(['legal', 'children', 'housingType', 'hasOutdoor'])
    })
})

describe('stripHiddenAnswers with the household choice', () => {
    const answers = { children: '2', householdPeople: [{ relationship: 'child', age: 4 }], livesAlone: false, intent: 'self' }
    it('people chosen: keeps the people, drops nothing it asked', () => {
        expect(stripHiddenAnswers(answers, ['household'])).toEqual(answers)
    })
    it('children chosen (default): drops a stale people list', () => {
        expect(stripHiddenAnswers(answers, [])).toEqual({ children: '2', intent: 'self' })
    })
    it('row hidden: drops both', () => {
        expect(stripHiddenAnswers(answers, ['children', 'household'])).toEqual({ intent: 'self' })
    })
})

describe('childrenAnswer (mirror)', () => {
    it('counts under-18s', () => {
        expect(childrenAnswer([])).toBe('none')
        expect(childrenAnswer([{ age: 17 }, { age: 30 }])).toBe('1')
        expect(childrenAnswer([{ age: 1 }, { age: 2 }, { age: 3 }])).toBe('3+')
    })
})
```

Append to `src/domain/adoptionDocs.test.ts`:

```ts
import { householdQuestion, isStepAsked } from './adoptionDocs';
describe('household question choice', () => {
    it('reads the token', () => {
        expect(householdQuestion([])).toBe('children');
        expect(householdQuestion(['household'])).toBe('people');
    });
    it('isStepAsked mirrors the public form', () => {
        expect(isStepAsked('children', [])).toBe(true);
        expect(isStepAsked('household', [])).toBe(false);
        expect(isStepAsked('household', ['household'])).toBe(true);
        expect(isStepAsked('children', ['household'])).toBe(false);
        expect(isStepAsked('household', ['children', 'household'])).toBe(false);
        expect(isStepAsked('intent', ['intent'])).toBe(false);
        expect(isStepAsked('legal', ['legal'])).toBe(true);
    });
});
```

Append to `src/domain/adoptionDocs.mirror.test.ts` inside the `describe`:

```ts
it('FORM_RELATIONSHIPS match', async () => {
    const { FORM_RELATIONSHIPS } = await import('./householdPeople');
    expect(ids('FORM_RELATIONSHIPS')).toEqual([...FORM_RELATIONSHIPS]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/adoptionDocs.test.ts src/domain/adoptionDocs.mirror.test.ts && (cd contract-app && npx vitest run src/lib/adoptionDocs.test.ts)`
Expected: FAIL. The new exports are missing, and the mirror ids differ.

- [ ] **Step 3: Implement**

Both `FORM_STEP_IDS`: insert `'household',` after `'housingType',`. App
`FORM_STEP_GROUPS` "home":
`['children', 'household', 'existingPets', 'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience']`.

App `src/domain/adoptionDocs.ts`, after `sanitizeShownSteps`:

```ts
/**
 * "¿Hay niños?" vs the people list (spec 2026-10-04 §2). Stored in the same
 * hidden_steps list: the 'household' token means "people list"; absent (every
 * existing config) means the children question. 'children' in the list hides
 * the household question whichever is chosen — one switch for the row.
 */
export function householdQuestion(hidden: readonly string[]): 'children' | 'people' {
    return hidden.includes('household') ? 'people' : 'children';
}

/** Whether the public form asks `id` under this stored list. */
export function isStepAsked(id: string, hidden: readonly string[]): boolean {
    if (LOCKED.has(id)) return true;
    const rowHidden = hidden.includes('children');
    if (id === 'children') return !rowHidden && householdQuestion(hidden) === 'children';
    if (id === 'household') return !rowHidden && householdQuestion(hidden) === 'people';
    return !hidden.includes(id);
}
```

contract-app `lib/adoptionDocs.ts`:
- Replace `applyHiddenSteps` with the following. Keep `applyHiddenSteps` exported
  as an alias only if other code imports it; grep first.

```ts
/** Steps the public form asks under the stored list (app: isStepAsked). Default asks "¿Hay niños?". */
export function formStepsToAsk<T extends { id: string }>(schema: T[], stored: readonly string[] | null | undefined): T[] {
    const hidden = new Set(stored ?? [])
    const people = hidden.has('household')
    const rowHidden = hidden.has('children')
    return schema.filter(s => {
        if (LOCKED.has(s.id)) return true
        if (s.id === 'children') return !rowHidden && !people
        if (s.id === 'household') return !rowHidden && people
        return !hidden.has(s.id)
    })
}
```

In `stripHiddenAnswers`, treat the household pair explicitly. `'household'` is a
choice, not a hide. When the people list is chosen, the step also writes a derived
`children`, which must survive. Before the `for` loop:

```ts
const people = hidden.has('household')
const rowHidden = hidden.has('children')
if (rowHidden) drop.add('children')
if (rowHidden || !people) { drop.add('householdPeople'); drop.add('livesAlone') }
```

and at the top of the loop body: `if (id === 'household' || id === 'children') continue`.

Add the mirror list and helper:

```ts
export const FORM_RELATIONSHIPS = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate'] as const
export function childrenAnswer(people: ReadonlyArray<{ age: number }>): 'none' | '1' | '2' | '3+' {
    const n = people.filter(p => p.age < 18).length
    return n === 0 ? 'none' : n === 1 ? '1' : n === 2 ? '2' : '3+'
}
```

`PetShieldForm.tsx:540`: `const schema = formStepsToAsk(baseSchema, hiddenSteps)`.
Update the import. The schema entry for `household` is added in Task 4. Until then
the filter is a no-op for it.

`FormStepsEditor.tsx`:
- Skip `'household'` when rendering rows: `group.steps.filter(id => id !== 'household')`.
- Count questions as `FORM_STEP_IDS.filter(id => id !== 'household')`, with "shown"
  = `isStepAsked(id, hidden) || (id === 'children' && isStepAsked('household', hidden))`.
- Under the `children` row's switch, when the row is on, render a two-option
  segmented control (`role="radiogroup"`, label
  `t('adoptionDocs.household_choice_label')`):
  - "¿Hay niños? (simple)" (`household_choice_children`);
  - "Personas del hogar (detallado)" (`household_choice_people`).
- Selecting one calls
  `onChange(FORM_STEP_IDS.filter(s => (s === 'household' ? choosePeople : hiddenSet.has(s))))`.
- Each option is a `<button role="radio" aria-checked>` with `data-testid="household-choice-children"` / `"household-choice-people"`, `min-h-11`, using
  `bg-teal-600 text-white` when selected and `bg-white border border-stone-200 text-stone-700` otherwise.
- The conflict banner for key `'household'` renders inside the children row, using
  `label('household')`.

i18n (app, all three locales; `petshield.fields.household` sits in the existing
`petshield.fields` block):
- es:
  - `household_choice_label: 'Cómo preguntar'`
  - `household_choice_children: '¿Hay niños? (simple)'`
  - `household_choice_people: 'Personas del hogar (detallado)'`
  - `petshield.fields.household: 'Personas del hogar'`
- en:
  - `'How to ask'`
  - `'Any children? (simple)'`
  - `'Household members (detailed)'`
  - `'Household members'`
- pt:
  - `'Como perguntar'`
  - `'Há crianças? (simples)'`
  - `'Pessoas da casa (detalhado)'`
  - `'Pessoas da casa'`

- [ ] **Step 4: Run the tests to verify they pass, then type-check both apps**

Run: `npx vitest run src/domain && (cd contract-app && npx vitest run && npx tsc --noEmit) && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/adoptionDocs.ts src/domain/adoptionDocs.test.ts src/domain/adoptionDocs.mirror.test.ts contract-app/src/lib/adoptionDocs.ts contract-app/src/lib/adoptionDocs.test.ts contract-app/src/PetShieldForm.tsx src/components/adoptionDocs/FormStepsEditor.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
git commit -m "adoption docs: choose '¿Hay niños?' or the household people list"
```

---

### Task 4: The public form step (contract-app)

**Files:**
- Modify: `contract-app/src/PetShieldForm.tsx`:
  - a `HouseholdPeopleStep` type;
  - a schema entry after `housingType`;
  - title from `housingType`;
  - render case;
  - `canAdvance` and `validateWithAnswers`.
- Create: `contract-app/src/components/HouseholdPeople.tsx` (the list and card editor, controlled)
- Create: `contract-app/src/lib/householdPeopleForm.ts`: pure helpers
  `isPersonComplete`, `householdStepTitleKey`
- Test: `contract-app/src/lib/householdPeopleForm.test.ts`
- Modify: `contract-app/src/i18n/catalogs/form.ts` (es / en / pt)

**Interfaces:**
- Consumes: `FORM_RELATIONSHIPS`, `childrenAnswer` (Task 3, contract-app copy).
- Produces, as answers written by the step:
  - `householdPeople: Array<{ relationship; age: number; firstName?; lastName? }>`
  - `livesAlone: boolean`
  - `children` (derived)

- [ ] **Step 1: Write the failing tests** — `contract-app/src/lib/householdPeopleForm.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { isPersonComplete, householdStepTitleKey, canLeaveHouseholdStep } from './householdPeopleForm'

describe('household step helpers', () => {
    it('a person needs a relationship and a whole age 0–120', () => {
        expect(isPersonComplete({ relationship: 'child', age: 7 })).toBe(true)
        expect(isPersonComplete({ relationship: 'child', age: null })).toBe(false)
        expect(isPersonComplete({ relationship: null, age: 7 })).toBe(false)
        expect(isPersonComplete({ relationship: 'child', age: 130 })).toBe(false)
    })
    it('title follows the housing answer', () => {
        expect(householdStepTitleKey('house')).toBe('form.q_household_title_house')
        expect(householdStepTitleKey('apartment')).toBe('form.q_household_title_apartment')
        expect(householdStepTitleKey(undefined)).toBe('form.q_household_title_home')
    })
    it('Continue needs "Vivo solo/a" or at least one person, and no unfinished card', () => {
        expect(canLeaveHouseholdStep({ livesAlone: true, people: [], editing: null })).toBe(true)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [], editing: null })).toBe(false)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [{ relationship: 'partner', age: 40 }], editing: null })).toBe(true)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [{ relationship: 'partner', age: 40 }], editing: { relationship: 'child', age: null } })).toBe(false)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd contract-app && npx vitest run src/lib/householdPeopleForm.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the helpers** — `contract-app/src/lib/householdPeopleForm.ts`

```ts
export type DraftPerson = { relationship: string | null; age: number | null; firstName?: string; lastName?: string }

export function isPersonComplete(p: DraftPerson): boolean {
    return !!p.relationship && typeof p.age === 'number' && Number.isInteger(p.age) && p.age >= 0 && p.age <= 120
}

export function householdStepTitleKey(housingType: unknown): string {
    return housingType === 'house' ? 'form.q_household_title_house'
        : housingType === 'apartment' ? 'form.q_household_title_apartment'
        : 'form.q_household_title_home'
}

export function canLeaveHouseholdStep(s: { livesAlone: boolean; people: DraftPerson[]; editing: DraftPerson | null }): boolean {
    if (s.editing) return false
    return s.livesAlone || (s.people.length > 0 && s.people.every(isPersonComplete))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd contract-app && npx vitest run src/lib/householdPeopleForm.test.ts`
Expected: PASS

- [ ] **Step 5: Build the step**
  - **Type:** in `PetShieldForm.tsx` add
    `interface HouseholdPeopleStep { id: string; type: 'household-people'; title: string; subtitle?: string }`
    to the `FormStep` union.
  - **Schema entry:** in `DEFAULT_SCHEMA`, right after the `housingType` entry:
    `{ id: 'household', type: 'household-people', title: '', subtitle: t('form.q_household_subtitle') }`.
    The title is resolved at render: `t(householdStepTitleKey(answers.housingType))`.
  - **`HouseholdPeople.tsx`** is a controlled component. Props:
    `{ people, livesAlone, onChange(people, livesAlone) }`, with `t` from `useT()`.
    It renders:
    - one compact card per person, "Hijo/a · 7 años · Tomás López", with Editar and Quitar (44 px buttons);
    - **"Agregar persona"**, which opens an inline card with:
      - relationship chips from `FORM_RELATIONSHIPS` (labels `form.rel_<value>`);
      - `<input type="number" inputMode="numeric" min=0 max=120>` for Edad, `font-size:16px`;
      - two optional text inputs, Nombre and Apellido;
      - Guardar, enabled when `isPersonComplete`, and Cancelar;
    - **"Vivo solo/a"**: a full-width secondary button. It sets `livesAlone=true`
      and `people=[]`, then calls `goNext` (the parent passes `onAlone`).
    - **Adding a person** sets `livesAlone=false`.
    - **Max 15 people:** the button hides once 15 are listed.
  - **Styling:** the form's existing `ps-*` classes and CSS variables
    (`--ps-accent`, `--ps-2`, …) as the `pet-counter` step uses them. Inline SVG
    icons only.
  - **Render case** `case 'household-people'`: `HouseholdPeople`, with
    `onChange={(people, alone) => { setAnswer('householdPeople', people); setAnswer('livesAlone', alone); setAnswer('children', childrenAnswer(people)) }}`.
  - **`canAdvance`:** `case 'household-people': return canLeaveHouseholdStep({ livesAlone: !!answers.livesAlone, people: answers.householdPeople ?? [], editing: householdEditing })`.
    `householdEditing` is lifted state that the component reports via `onEditingChange`.
  - **`validateWithAnswers`:** for `household-people` with `!canAdvance()`, set
    `newErrors.household = t('form.err_household')`.
  - **i18n:** add to `contract-app/src/i18n/catalogs/form.ts`, in es, en and pt.
    - es:
      - `form.q_household_title_house: '¿Quiénes viven en la casa?'`
      - `form.q_household_title_apartment: '¿Quiénes viven en el departamento?'`
      - `form.q_household_title_home: '¿Quiénes viven en tu hogar?'`
      - `form.q_household_subtitle: 'Sin contarte a vos'`
      - `form.household_alone: 'Vivo solo/a'`
      - `form.household_add: 'Agregar persona'`
      - `form.household_relationship: 'Relación'`
      - `form.household_age: 'Edad'`
      - `form.household_first_name: 'Nombre (opcional)'`
      - `form.household_last_name: 'Apellido (opcional)'`
      - `form.household_save: 'Guardar'`
      - `form.household_cancel: 'Cancelar'`
      - `form.household_edit: 'Editar'`
      - `form.household_remove: 'Quitar'`
      - `form.household_years: '{n} años'`
      - `form.err_household: 'Agregá a las personas que viven con vos o elegí «Vivo solo/a».'`
      - `form.rel_partner: 'Pareja'`
      - `form.rel_child: 'Hijo/a'`
      - `form.rel_parent: 'Padre/Madre'`
      - `form.rel_sibling: 'Hermano/a'`
      - `form.rel_other_relative: 'Otro familiar'`
      - `form.rel_housemate: 'Amigo/a o compañero/a'`
    - en: "Who lives in the house?" / "…in the apartment?" / "…in your home?",
      "Not counting you", "I live alone", "Add person", "Relationship", "Age",
      "First name (optional)", "Last name (optional)", "Save", "Cancel", "Edit",
      "Remove", "{n} years old", "Add the people who live with you or choose “I
      live alone”.", "Partner", "Son/Daughter", "Father/Mother", "Brother/Sister",
      "Other relative", "Friend or roommate".
    - pt (pt-BR, `você`): "Quem mora na casa?" / "…no apartamento?" / "…na sua
      casa?", "Sem contar você", "Moro sozinho/a", "Adicionar pessoa", "Relação",
      "Idade", "Nome (opcional)", "Sobrenome (opcional)", "Salvar", "Cancelar",
      "Editar", "Remover", "{n} anos", "Adicione as pessoas que moram com você ou
      escolha “Moro sozinho/a”.", "Parceiro/a", "Filho/a", "Pai/Mãe", "Irmão/Irmã",
      "Outro parente", "Amigo/a ou colega".

- [ ] **Step 6: Type-check, unit tests, and a manual run**

Run: `cd contract-app && npx tsc --noEmit && npx vitest run`
Expected: PASS.

Then `cd contract-app && npm run dev`. Open the form for a rescuer whose stored list
includes `'household'` (local: insert a settings row; see Task 7). At 390 px and
1280 px, check:
- the title follows the housing answer;
- Continue is blocked until "Vivo solo/a" or a complete person;
- names are optional;
- the draft survives a reload.

- [ ] **Step 7: Commit**

```bash
git add contract-app/src/PetShieldForm.tsx contract-app/src/components/HouseholdPeople.tsx contract-app/src/lib/householdPeopleForm.ts contract-app/src/lib/householdPeopleForm.test.ts contract-app/src/i18n/catalogs/form.ts
git commit -m "form: '¿Quiénes viven en la casa?' step — people with relationship, age, optional names"
```

---

### Task 5: Submit — sanitise people, put named people on the profile, record the request

**Files:**
- Create: `src/lib/formRequest.ts`. Move `addFormRequestRecord` here from
  `src/app/actions/formSubmission.ts`, unchanged, with **no** `'use server'`, so a
  route can import it without creating a browser-callable action.
- Modify: `src/app/actions/formSubmission.ts`: import `addFormRequestRecord` from `@/lib/formRequest`.
- Modify: `src/app/actions/_adopterFactory.ts`: `CreateAdopterInput.householdMembers?: HouseholdMember[]`,
  written in the adopter insert before tokenising.
- Modify: `src/app/api/form/[userId]/submit/route.ts`.

**Interfaces:**
- Consumes: `parseHouseholdPeople`, `childrenAnswer`, `fullName` (Task 1);
  `HouseholdMember`, `serializeHouseholdMembers` (Task 2).
- Produces: `addFormRequestRecord(db, submissionId, adopterId, actorEmail): Promise<void>`
  exported from `src/lib/formRequest.ts`.

- [ ] **Step 1: Move the helper.** Cut `addFormRequestRecord` and its imports
  (`adoptions`, `formSubmissions`, `insertRecord`, `RECORD_TYPES`,
  `buildDetailedDescription`) into `src/lib/formRequest.ts`.
  `buildDetailedDescription` lives in `formSubmission.ts`. Move it and its label
  maps into `src/lib/formRequest.ts` as well, and import them back where
  `getFormSubmissionPrefill` uses them. Run `npx tsc --noEmit` and
  `node scripts/check-action-surface.mjs` after `npm run build`.
  Expected: still 162 actions.

- [ ] **Step 2: Factory accepts members.** In `_adopterFactory.ts`, add
  `householdMembers?: HouseholdMember[]` to `CreateAdopterInput`, and in the
  `db.insert(adopters).values({...})` add
  `householdMembers: input.householdMembers?.length ? serializeHouseholdMembers(input.householdMembers) : null,`.
  Tokenising already runs after the insert, so the names reach dedup.

- [ ] **Step 3: Submit route.** In `/api/form/[userId]/submit/route.ts`:
  - after `const answers = { ...body }`:

```ts
// "¿Quiénes viven en la casa?" (spec 2026-10-04). Re-parsed here: the client
// can't put junk on a profile or lie about the children count.
const householdPeople = parseHouseholdPeople(body.householdPeople);
if (Array.isArray(body.householdPeople) || body.livesAlone === true) {
    answers.householdPeople = householdPeople;
    answers.livesAlone = body.livesAlone === true && householdPeople.length === 0;
    answers.children = childrenAnswer(householdPeople);
}
const today = new Date().toISOString().slice(0, 10);
const profileMembers: HouseholdMember[] = householdPeople.flatMap((p, i) => {
    const name = fullName(p);
    return name ? [{ id: `form-${submissionId}-${i}`, name, relationship: p.relationship, contactEntries: [], age: p.age, ageAsOf: today, addedBy: 'form-submission' }] : [];
});
```

  - pass `householdMembers: profileMembers` to `createAdopterFromSubmission({...})`;
  - right after the `formSubmissions` update that sets `autoAdopterId`:

```ts
// Every form shows on its profile's history ("Ver formulario completado")
// and counts toward "demasiados pedidos" (Jon, 2026-10-04). Idempotent.
await addFormRequestRecord(db, submissionId, adopterId, rescuerEmail);
```

  `answersJson` is built from `answers`. Make sure the people assignment happens
  **before** `answersJson: JSON.stringify(...)`; move the block up if the insert
  comes first. The submission row stores `household` (the legacy attributes
  JSON). Leave it unchanged.

- [ ] **Step 4: Verify.**
  Run: `npx tsc --noEmit && npx vitest run && npm run build && node scripts/check-action-surface.mjs`
  Expected: PASS, and "162 browser-callable endpoints, as expected".

- [ ] **Step 5: Commit**

```bash
git add src/lib/formRequest.ts src/app/actions/formSubmission.ts src/app/actions/_adopterFactory.ts 'src/app/api/form/[userId]/submit/route.ts'
git commit -m "form submit: household people to answers + named people to the profile; record the request at submit"
```

---

### Task 6: Merges carry household members (and undo restores them)

**Files:**
- Modify: `src/lib/adopterMerge.ts` (moved out of `src/app/actions/duplicates.ts` on 2026-10-04):
  - `mergeAdopters`: merge the members;
  - `MergeUndoPayload.primarySnapshot.householdMembers?: string | null`;
  - `unmergeAdopters`: restore them.
- Test: `tests/merge-undo.authed.spec.ts` (extend), plus the unit test from Task 2.

**Interfaces:**
- Consumes: `mergeHouseholdMembers`, `deserializeHouseholdMembers`, `serializeHouseholdMembers` (Task 2).

- [ ] **Step 1: Write the failing e2e assertion.** In `tests/merge-undo.authed.spec.ts`,
  in the mass-merge test, before merging, give fixture B a member:

```ts
execD1(`UPDATE adopters SET household_members = '[{"id":"hm-b","name":"Tomás López","relationship":"child","contactEntries":[],"age":7,"ageAsOf":"2026-10-04"}]' WHERE id = '${B}'`);
```

  After the merge, assert A has `Tomás López`. After undo, assert A's
  `household_members` equals its pre-merge value (null or its own list):

```ts
const a = one(`SELECT household_members FROM adopters WHERE id = '${A}'`);
expect(String(a.household_members)).toContain('Tomás López');
// … after undo:
const a2 = one(`SELECT household_members FROM adopters WHERE id = '${A}'`);
expect(isD1Null(a2.household_members) || !String(a2.household_members).includes('Tomás López')).toBe(true);
```

  Use the spec's existing helpers. Add a `one()` helper as in
  `tests/form-results-link.authed.spec.ts` if missing.

- [ ] **Step 2: Run it to verify it fails**

Run (local harness, see `project_local_e2e_harness`): `npx playwright test tests/merge-undo.authed.spec.ts --config=playwright.local.config.ts --project=authed --workers=1 --no-deps`
Expected: FAIL. A lacks Tomás López.

- [ ] **Step 3: Implement.** In `mergeAdopters` (`src/lib/adopterMerge.ts`; it already turns the absorbed name into an alias):
  - add `householdMembers: primary.householdMembers ?? null` to `undo.primarySnapshot`;
  - next to the alias carry-over, add:

```ts
const absorbedMembers = deserializeHouseholdMembers(secondary.householdMembers);
if (absorbedMembers.length) {
    updates.householdMembers = serializeHouseholdMembers(
        mergeHouseholdMembers(deserializeHouseholdMembers(primary.householdMembers), absorbedMembers),
    );
}
```

  In `unmergeAdopters` step 3, add
  `...(undo.primarySnapshot.householdMembers !== undefined ? { householdMembers: undo.primarySnapshot.householdMembers } : {})`.
  The field is optional on the type: payloads written before this change have no
  snapshot, so undo leaves members as they are.

- [ ] **Step 4: Run it to verify it passes**

Run: the same Playwright command, plus `npx vitest run src/lib/householdMembers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/adopterMerge.ts tests/merge-undo.authed.spec.ts
git commit -m "merge: carry household members (undoable)"
```

---

### Task 7: Form screen + applicant panel show the people with the semáforo; profile shows age

**Files:**
- Modify: `src/components/FormAnswersPanel.tsx`. Add `HouseholdPeopleAnswer`
  (exported), and in the household section render it in place of the `children`
  row when `fullAnswers.householdPeople` is an array.
- Modify: `src/components/FormResultsContent.tsx`. In the "Datos del adoptante"
  field map, render `HouseholdPeopleAnswer` instead of the `children` row when
  `householdPeople` is present.
- Modify: `src/components/HouseholdSection.tsx`. Show "· N años" after the
  relationship using `currentAge(m)`. Edit mode gets an optional age input (sent
  through the existing add/update member actions).
- Modify: `src/app/actions/householdMembers.ts`. Add/update accept optional `age`
  (integer 0–120 via zod) and set `ageAsOf` to today when `age` is provided.
- Modify: `src/i18n/locales/{es,en,pt}.ts`: `formResults.household_alone`,
  `formResults.household_years`, `adopter.hh_age`, `adopter.hh_years`.
- Test: `tests/form-results-link.authed.spec.ts` (new test); `src/lib/householdMembers.test.ts` covers `currentAge`.

**Interfaces:**
- Consumes: `personSignal` (Task 1), `currentAge` (Task 2), `AnswerValue`'s dot
  styling (existing `SIGNAL_COLOR`).
- Produces: `HouseholdPeopleAnswer({ people, livesAlone }: { people: Array<{ relationship: string; age: number; firstName?: string; lastName?: string }>; livesAlone?: boolean })`

- [ ] **Step 1: Write the failing e2e test.** In `tests/form-results-link.authed.spec.ts`:

```ts
test('household people: dots per person, only the fully named one reaches the profile, form linked from it', async ({ page, request }) => {
    const stamp = Date.now();
    const res = await request.post(`/api/form/${ADMIN_USER_ID}/submit`, { data: {
        name: `E2E Hogar ${stamp}`, email: `e2e-hogar-${stamp}@example.com`, phone: `22${String(stamp).slice(-8)}`, address: '1 Hogar St', intent: 'self', housingType: 'house',
        householdPeople: [
            { relationship: 'child', age: 3, firstName: 'Tomás', lastName: 'López' },
            { relationship: 'child', age: 11 },
            { relationship: 'partner', age: 38, firstName: 'Laura' },
        ],
        livesAlone: false, children: 'none', // lying count — server recomputes
    } });
    expect(res.ok()).toBeTruthy();
    const { submissionId } = await res.json();
    const row = one(`SELECT auto_adopter_id, answers_json FROM form_submissions WHERE id = '${submissionId}'`);
    expect(JSON.parse(String(row.answers_json)).children).toBe('2');
    const prof = one(`SELECT household_members FROM adopters WHERE id = '${row.auto_adopter_id}'`);
    const members = JSON.parse(String(prof.household_members));
    expect(members.map((m: { name: string }) => m.name)).toEqual(['Tomás López']);
    expect(members[0]).toMatchObject({ relationship: 'child', age: 3 });

    await page.goto(`/form-results/${submissionId}`);
    await dismissCountryBanner(page);
    const answers = page.getByRole('button', { name: /Complete answers|Respuestas completas|Respostas completas/ });
    if ((await answers.getAttribute('aria-expanded')) === 'false') await answers.click();
    const people = page.getByTestId('household-people');
    await expect(people.locator('[data-signal="risk"]')).toHaveCount(1);   // 3 years
    await expect(people.locator('[data-signal="caution"]')).toHaveCount(1); // 11
    await expect(people.locator('[data-signal="ok"]')).toHaveCount(1);      // 38
    await expect(people).toContainText('Tomás López');

    await page.goto(`/adopter/${row.auto_adopter_id}`);
    await dismissCountryBanner(page);
    await expect(page.getByRole('link', { name: /View completed form|Ver formulario completado|Ver formulário/ })).toHaveAttribute('href', `/form-results/${submissionId}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/form-results-link.authed.spec.ts --config=playwright.local.config.ts --project=authed --workers=1 --no-deps`
Expected: FAIL. There is no `household-people` test id. If Task 5 is done, the
profile assertions already pass.

- [ ] **Step 3: Implement `HouseholdPeopleAnswer`** in `FormAnswersPanel.tsx`:

```tsx
export function HouseholdPeopleAnswer({ people, livesAlone }: { people: Array<{ relationship: string; age: number; firstName?: string; lastName?: string }>; livesAlone?: boolean }) {
    const { t } = useLanguage();
    const dot = (s: AnswerSignal) => (
        <span role="img" aria-label={t(`formResults.signal_${s}`)} title={t(`formResults.signal_${s}`)} data-signal={s}
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0 self-center" style={{ background: SIGNAL_COLOR[s] }} />
    );
    if (!people.length) {
        return livesAlone ? <span data-testid="household-people" className="inline-flex items-baseline gap-1.5 text-stone-800">{dot('ok')}{t('formResults.household_alone')}</span> : null;
    }
    return (
        <ul data-testid="household-people" className="space-y-1">
            {people.map((p, i) => {
                const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
                return (
                    <li key={i} className="flex items-baseline gap-1.5 text-stone-800 min-w-0 [overflow-wrap:anywhere]">
                        {dot(personSignal(p.age))}
                        <span>{t(`adopter.hh_rel_${p.relationship}`)} · {t('formResults.household_years').replace('{n}', String(p.age))}{name && <span className="text-stone-500"> · {name}</span>}</span>
                    </li>
                );
            })}
        </ul>
    );
}
```

  In both places that render the `children` row:
  `if (field === 'children' && Array.isArray(fullAnswers.householdPeople)) return <Row key="household" label={t('petshield.fields.household')}><HouseholdPeopleAnswer people={fullAnswers.householdPeople} livesAlone={fullAnswers.livesAlone} /></Row>`.
  Use each file's existing row markup: the label span `min-w-[140px]` plus the value.

  i18n:
  - es: `formResults.household_alone: 'Vive solo/a'`, `formResults.household_years: '{n} años'`,
    `adopter.hh_age: 'Edad'`, `adopter.hh_years: '{n} años'`
  - en: `'Lives alone'`, `'{n} years old'`, `'Age'`, `'{n} years old'`
  - pt: `'Mora sozinho/a'`, `'{n} anos'`, `'Idade'`, `'{n} anos'`

- [ ] **Step 4: Profile age.**
  - In `HouseholdSection.tsx`, after the relationship label, render
    `{currentAge(m) !== null && <> · {t('adopter.hh_years').replace('{n}', String(currentAge(m)))}</>}`.
  - In edit mode, add an optional `<input type="number" min=0 max=120 inputMode="numeric">`
    labelled `adopter.hh_age` (16 px font).
  - Pass `age` to `addHouseholdMember` and `updateHouseholdMember`.
  - In `src/app/actions/householdMembers.ts`, extend both zod inputs with
    `age: z.number().int().min(0).max(120).optional()`. When present, store
    `age` and `ageAsOf: new Date().toISOString().slice(0, 10)`. No new action is
    created, so `EXPECTED_ACTIONS` is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run && npx playwright test tests/form-results-link.authed.spec.ts tests/household-legacy.authed.spec.ts --config=playwright.local.config.ts --project=authed --workers=1 --no-deps`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/FormAnswersPanel.tsx src/components/FormResultsContent.tsx src/components/HouseholdSection.tsx src/app/actions/householdMembers.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts tests/form-results-link.authed.spec.ts
git commit -m "form results + profile: household people with semáforo and age"
```

---

### Task 8: Configuration end to end, visual pass, release notes

**Files:**
- Create: `tests/household-question.authed.spec.ts`
- Modify: `CHANGELOG.md`, `package.json` (version bump per `.agents/workflows/deploy.md`)

- [ ] **Step 1: Write the e2e test.** `ENABLE_CUSTOM_ADOPTION_DOCS` is already
  `'true'` in `tests/seed.sql`. The admin's own settings row is
  `owner_type='user'`, `owner_id='gatitosolivos@gmail.com'`.

```ts
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/** "¿Hay niños?" vs "Personas del hogar": the choice is stored as a 'household' token in hidden_steps (spec 2026-10-04 §2). */
const OWNER = "owner_type = 'user' AND owner_id = 'gatitosolivos@gmail.com'";
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { cwd: process.cwd(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function stored(): string[] {
    const r = JSON.parse(execD1(`SELECT hidden_steps FROM adoption_doc_settings WHERE ${OWNER}`));
    const v = (Array.isArray(r) ? r[0] : r)?.results?.[0]?.hidden_steps;
    return v && v !== 'null' ? JSON.parse(v) : [];
}

test.describe('household question choice', () => {
    let before: string | null = null;
    test.beforeAll(() => {
        const r = JSON.parse(execD1(`SELECT hidden_steps FROM adoption_doc_settings WHERE ${OWNER}`));
        before = (Array.isArray(r) ? r[0] : r)?.results?.[0]?.hidden_steps ?? null;
    });
    test.afterAll(() => {
        execD1(`UPDATE adoption_doc_settings SET hidden_steps = ${before && before !== 'null' ? `'${before}'` : 'NULL'} WHERE ${OWNER}`);
    });

    test('default asks "¿Hay niños?"; choosing the people list switches the public form', async ({ page, request }) => {
        execD1(`UPDATE adoption_doc_settings SET hidden_steps = NULL WHERE ${OWNER}`);
        const cfg0 = await (await request.get('/api/form/test-admin-id')).json();
        expect(cfg0.formConfig?.hiddenSteps ?? []).not.toContain('household');

        await page.goto('/settings/adoption-docs');
        await dismissCountryBanner(page);
        await page.getByTestId('household-choice-people').click();
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored).toContain('household');

        const cfg1 = await (await request.get('/api/form/test-admin-id')).json();
        expect(cfg1.formConfig.hiddenSteps).toContain('household');

        // One switch for the row: turning it off hides the household question, the choice is kept.
        await page.getByTestId('form-step-children').click();
        await page.getByTestId('adoption-docs-save-form').click();
        await expect.poll(stored).toEqual(expect.arrayContaining(['children', 'household']));
    });
});
```

  If no settings row exists for the admin yet, the `UPDATE`s are no-ops. In that
  case insert one in `beforeAll` with
  `INSERT OR IGNORE INTO adoption_doc_settings (id, owner_type, owner_id, hidden_steps, updated_at, updated_by) VALUES ('test-household-settings', 'user', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), 'test-seed')`.

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/household-question.authed.spec.ts --config=playwright.local.config.ts --project=authed --workers=1 --no-deps`
Expected: PASS

- [ ] **Step 3: Full verification.**
  Run: `npx tsc --noEmit && npx vitest run && (cd contract-app && npx tsc --noEmit && npx vitest run) && npm run lint && npm run build && node scripts/check-action-surface.mjs`
  Expected:
  - everything passes;
  - lint warnings ≤ 125;
  - 162 actions.

  Then run the related e2e: `form-results-link`, `merge-undo`, `household-legacy`,
  `adoption-docs`, `contract-link`, `my-adopters-forms`, `household-question`.

- [ ] **Step 4: Visual pass** (temporary, uncommitted Playwright script, as in
  previous sessions). Cover:
  - **Screens:** the form-results household block, the profile household section
    with age, the settings choice, and the contract-app step (via `npm run dev`
    in contract-app);
  - **Variants:** light and dark at 1280 and 390;
  - **Checks:** `scrollWidth ≤ clientWidth`, and no untheme-able classes. Grep each
    new class against `src/app/globals.css`.

- [ ] **Step 5: Release notes + version.** Bump the patch above `origin/staging`
  (`git show origin/staging:package.json`), and add a CHANGELOG entry in user
  terms. Commit with an explicit path list. Never use `git add -A`.

```bash
git add CHANGELOG.md package.json package-lock.json tests/household-question.authed.spec.ts
git commit -m "v<version>: household people as an alternative to '¿Hay niños?'"
```
