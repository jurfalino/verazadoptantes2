# Interview Guide (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A flag-gated phone-interview guide. Rescuers enter what they know about an adopter and see possible matching profiles. They learn the three-stage technique, then run an adaptive question list (rail + focus panel) with autosave. At the end they save the interview to a confirmed or new profile, as an observation with an optional rating.

**Architecture:**
- A pure rule-based question engine in `src/domain/interview/` that derives known facts, builds the queue and compares facts.
- Server helpers in `src/lib/interviews/` (not `'use server'`) for persistence, candidate summaries and timeline links.
- Nine gated server actions in `src/app/actions/interviews.ts`.
- A client wizard in `src/components/interview/`, mounted by an edge page at `/interview`.
- Completion reuses the existing write paths (`saveAdopter`, `appendToExistingAdopter`, `addHouseholdMember`, `saveAdoption`), so tokens, history, audit and pending-search closure behave exactly as they do today.

**Tech Stack:** Next.js 15 App Router (edge pages), React client components, Drizzle on Cloudflare D1, zod, vitest (+ `migratedDb` for real SQL), Playwright.

**Spec:** `.agents/plans/interview-guide.md` (approved 2026-10-04). Read it first; decisions D1–D9 are referenced below.

**Worktree:** `/Users/jurfalino/Developer/Personal/verazadoptantes2-interview`, branch `feature/interview-guide` (from `origin/staging` 178eec84, v2.56.145).
- Run every command from that directory.
- Run `npm ci` once under Node 20 before Task 1.
- Never `git add -A` / `-u`: tracked `.wrangler` sqlite and `local.db` are the e2e seed. Stage explicit paths only.

## Refinements to the spec (made while planning)

1. **No `queue_json` column.** The queue is a pure function of stored state (`prep`, `answers`, `visited`, `custom`, candidates), so storing it would duplicate state that can drift.
2. **Candidate ids are recorded server-side only.**
   - `startInterview` and `refreshInterviewCandidates` run the match on the server from the *stored* draft and union the ids into `candidate_ids_json`.
   - `verifyInterviewFact` compares the *stored* answers with the raw profile.
   - The client never sends an identifier to compare against a profile, so verification cannot be used as an oracle beyond what the interview itself contains.
3. **Action list:** the spec's `findInterviewCandidates` is split into `previewInterviewCandidates` (stateless, prep screen), `startInterview` and `refreshInterviewCandidates`. That makes 9 actions in total.
4. **`tests/seed.sql` gets no row.** The e2e spec toggles the flag itself (same as `pinned-visit-intent.authed.spec.ts`), and parity falls back to the code default `false`.

## Global Constraints

- Flag `ENABLE_INTERVIEW_GUIDE`, default **off**. When off, `/interview` and `/interview/[id]` call `notFound()`, every action returns `{ ok: false, error: 'disabled' }`, and no entry point renders.
- Never `inArray()` / `sql\`IN ${array}\`` (D1 breaks it). Fan out with `Promise.all`.
- Every catch logs with the operation's context. Never swallow silently. Context means ids and counts only: never log answers, prep facts, names, phones, emails, socials or addresses.
- i18n keys go into **all three** of `src/i18n/locales/{es,en,pt}.ts`. Spanish is the default locale and uses voseo ("contame", "tenés").
- `t()` takes no params. Interpolate with `.replace('{name}', value)`.
- Client error toasts: `if (!handledAsStale(e)) toast.error(title, userFacingMessage(e, title), resolveErrorId(e, '<Component>.<op>'))`.
- Only themed Tailwind colours: the `teal-*` / `stone-*` classes already used by `AdoptionFormWizard`. No hex, no gradients, no `bg-blue-*`. Inputs use `text-base md:text-sm` (≥16px on mobile).
- Functional icons are inline SVG with `currentColor`, never emoji.
- Pages that read session or searchParams declare `export const runtime = 'edge'`.
- New `'use server'` exports must be signed off in `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS`), in the same commit as the build that measures them.
- `npm run build` must pass before any push. A sync export in a `'use server'` file passes tsc but fails the build.
- Lint warnings ≤ 125 (ratchet).
- Candidate data shown to the client comes only from `findFormDuplicates` / `hydrateDuplicateMatches` output, which is already masked. Never select raw `adopters.contactInfo` / `contactEntries` / `addressInfo` into a client payload.
- Writes only target a profile the rescuer explicitly chose on the review screen, or one the interview started from (D2).

## Review Focus

1. **Interviewing someone else's protected profile:** no raw contact value of that profile reaches the browser, neither in the candidate card nor the verification hint. Pinned in Task 6 (`toCandidateSummary` tests) and Task 7 (verify returns a boolean only).
2. **Retrying a save that failed halfway** (new profile created, then the observation insert failed) must not create a second profile. Pinned in Task 8 (idempotency test).
3. **A second tab still autosaving after the interview was completed** must not revert it to a draft. Pinned in Task 7 (`saveInterviewDraft` refuses non-drafts).
4. **Clearing an answer** (typing, then deleting everything) must not leave the question "answered" or count its facts as known. Pinned in Task 2 (`answerHasContent` / filled tests) and Task 11 (the client removes empty answers).
5. **Pasting a huge text, or a client sending a giant payload,** is refused by validation instead of being stored. Pinned in Task 7 (validation caps test).

---

### Task 1: Register the feature flag

**Files:**
- Modify: `src/config/features.ts` (the `FEATURE_FLAGS` literal ends at the `ENABLE_SHEET_IMPORT: false,` line, ~L125; the `getAllFeatureFlags` `result` literal ~L211-245)
- Modify: `src/lib/publicConfig.ts` (`PUBLIC_FLAG_KEYS` ~L56-59, defaults map ~L82-84)
- Modify: `src/app/admin/(admin-only)/config/page.tsx` (type ~L58, list ~L102, defaults ~L142, hydration ~L213)
- Modify: `src/app/api/admin/config/route.ts` (~L97)
- Modify: `src/i18n/locales/es.ts`, `en.ts`, `pt.ts` (inside `admin: {`, next to `flag_label_sheet_import`)
- Test: `src/config/featureFlagRegistration.test.ts` (existing; extend the client-visible list)

**Interfaces:**
- Produces: `getFeatureFlag('ENABLE_INTERVIEW_GUIDE')` (server) and `config.ENABLE_INTERVIEW_GUIDE === 'true'` from `/api/config` (client).

- [ ] **Step 1: Extend the registration test so it fails**

In `src/config/featureFlagRegistration.test.ts`, change the client-visible list to:

```ts
        for (const f of ['ENABLE_ANIMALS_FOR_ADOPTION', 'ENABLE_FOLLOWUPS', 'ENABLE_EMAIL_OTP', 'ENABLE_PWA_INSTALL_PROMPT', 'ENABLE_CUSTOM_ADOPTION_DOCS', 'ENABLE_INTERVIEW_GUIDE']) {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/config/featureFlagRegistration.test.ts`
Expected: FAIL on "client-visible flags are in PUBLIC_FLAG_KEYS" (`ENABLE_INTERVIEW_GUIDE` missing).

- [ ] **Step 3: Register the flag everywhere**

`src/config/features.ts`, append inside `FEATURE_FLAGS` after `ENABLE_SHEET_IMPORT: false,`:

```ts
    // Phone-interview guide (/interview + «Entrevistar» on profiles): prepare,
    // learn the three-stage technique, run an adaptive question list, save to
    // the confirmed profile. Spec: .agents/plans/interview-guide.md.
    // Client-visible (user menu) → also in PUBLIC_FLAG_KEYS. Default off.
    ENABLE_INTERVIEW_GUIDE: false,
```

In the same file, inside `getAllFeatureFlags`' `result` literal, add after `ENABLE_SHEET_IMPORT: false,`:

```ts
        ENABLE_INTERVIEW_GUIDE: false,
```

`src/lib/publicConfig.ts`, append to `PUBLIC_FLAG_KEYS` after `'ENABLE_SHEET_IMPORT',`:

```ts
    // «Entrevista» in the user menu.
    'ENABLE_INTERVIEW_GUIDE',
```

and to the defaults map after `ENABLE_SHEET_IMPORT: 'false',`:

```ts
    ENABLE_INTERVIEW_GUIDE: 'false',
```

`src/app/admin/(admin-only)/config/page.tsx`, add next to each `ENABLE_SHEET_IMPORT` occurrence:

```ts
        ENABLE_INTERVIEW_GUIDE?: string;
```
```ts
    { key: 'ENABLE_INTERVIEW_GUIDE', labelKey: 'flag_label_interview_guide', descKey: 'flag_desc_interview_guide' },
```
```ts
        ENABLE_INTERVIEW_GUIDE: false,
```
```ts
                        ENABLE_INTERVIEW_GUIDE: data.config?.ENABLE_INTERVIEW_GUIDE === 'true',
```

`src/app/api/admin/config/route.ts`, after the `ENABLE_SHEET_IMPORT` line:

```ts
            ENABLE_INTERVIEW_GUIDE: config['ENABLE_INTERVIEW_GUIDE'] || 'false',
```

i18n, inside `admin: {` after `flag_desc_sheet_import`:

```ts
// es.ts
        flag_label_interview_guide: 'Guía de entrevista telefónica',
        flag_desc_interview_guide: 'Muestra «Entrevista» en el menú y «Entrevistar» en los perfiles: una guía para entrevistar adoptantes por teléfono y guardar lo que se habló.',
// en.ts
        flag_label_interview_guide: 'Phone interview guide',
        flag_desc_interview_guide: 'Shows «Interview» in the menu and «Interview» on profiles: a guide for interviewing adopters by phone and saving what was said.',
// pt.ts
        flag_label_interview_guide: 'Guia de entrevista por telefone',
        flag_desc_interview_guide: 'Mostra «Entrevista» no menu e «Entrevistar» nos perfis: um guia para entrevistar adotantes por telefone e salvar o que foi dito.',
```

- [ ] **Step 4: Run the test and tsc**

Run: `npx vitest run src/config/featureFlagRegistration.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/config/features.ts src/lib/publicConfig.ts "src/app/admin/(admin-only)/config/page.tsx" src/app/api/admin/config/route.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts src/config/featureFlagRegistration.test.ts
git commit -m "feat(interview): register ENABLE_INTERVIEW_GUIDE flag (default off)"
```

---

### Task 2: Domain types and known-facts derivation

**Files:**
- Create: `src/domain/interview/types.ts`
- Create: `src/domain/interview/facts.ts`
- Test: `src/domain/interview/facts.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `types.ts`: `Stage`, `STAGES`, `AnswerKind`, `FactKey`, `VerifiableFact`, `VERIFIABLE_FACTS`, `ContactType`, `ContactValue`, `HouseholdValue`, `AnswerStatus`, `Answer`, `PrepFacts`, `EMPTY_PREP`, `CandidateSummary`, `CustomQuestion`, `InterviewContext`, `KnownFacts`, `QueueItem`, `QuestionDef`.
  - `facts.ts`: `contactKey(type: ContactType, value: string): string | null`, `answerHasContent(a: Answer): boolean`, `deriveKnownFacts(ctx: InterviewContext, bank: readonly QuestionDef[]): KnownFacts`, `identifierSignature(k: KnownFacts): string`.

- [ ] **Step 1: Write `types.ts`** (types only, nothing to test on its own)

```ts
/**
 * Interview guide — shared types (spec: .agents/plans/interview-guide.md §4).
 * Pure: no DB, no server imports. The client and the server both build the
 * question queue from these, so the same state always yields the same queue.
 */
import type { Relationship } from '@/lib/householdMembers';

export type Stage = 'rapport' | 'story' | 'details';
export const STAGES: readonly Stage[] = ['rapport', 'story', 'details'];

export type AnswerKind = 'text' | 'contact' | 'household' | 'choice' | 'number';

export type FactKey =
    | 'name' | 'phones' | 'emails' | 'socials' | 'address' | 'aliases' | 'locality'
    | 'how_found' | 'work' | 'motivation' | 'schedule'
    | 'housing_type' | 'housing_tenure' | 'years_at_address' | 'outdoor_space'
    | 'household' | 'household_agree' | 'pets_current' | 'pets_past' | 'time_alone' | 'vet'
    | 'prev_address' | 'prior_adoptions' | 'returned_before'
    | 'moving_plan' | 'travel_plan' | 'budget' | 'references';

/** Facts a candidate profile can hold and the server can compare. */
export type VerifiableFact = 'phones' | 'emails' | 'socials' | 'address';
export const VERIFIABLE_FACTS: readonly VerifiableFact[] = ['phones', 'emails', 'socials', 'address'];

export type ContactType = 'phone' | 'email' | 'social';
export interface ContactValue { type: ContactType; value: string }
export interface HouseholdValue { name: string; relationship: Relationship | null }

export type AnswerStatus = 'answered' | 'skipped' | 'no_answer';
export interface Answer {
    status: AnswerStatus;
    text?: string;
    contacts?: ContactValue[];
    household?: HouseholdValue[];
    choice?: string;
    number?: number;
}

export interface PrepFacts {
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    address: string;
}
export const EMPTY_PREP: PrepFacts = { name: '', phones: [], emails: [], socials: [], address: '' };

/** A possible matching profile, as THIS viewer may see it (built server-side from masked data). */
export interface CandidateSummary {
    adopterId: string;
    displayName: string;
    relevancePercent: number;
    avgRating: number | null;
    adoptionCount: number;
    /** The viewer may add contacts/household to this profile (owner, org-mate, admin). */
    canEdit: boolean;
    /** Facts the profile holds, whether or not the viewer may see them. */
    stored: VerifiableFact[];
    /** Values the viewer may see. A fact in `stored` but absent here is protected. */
    visible: Partial<Record<VerifiableFact, string[]>>;
}

export interface CustomQuestion { id: string; stage: Stage; text: string }

export interface InterviewContext {
    prep: PrepFacts;
    answers: Record<string, Answer>;
    /** Ids in the order they first got an answer record. Never re-ordered. */
    visited: string[];
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    confirmedAdopterId?: string;
}

export interface KnownFacts {
    name: string;
    phones: string[];
    emails: string[];
    socials: string[];
    address?: string;
    household: HouseholdValue[];
    /** Sorted, unique. */
    filled: FactKey[];
}

export interface QueueItem {
    id: string;
    stage: Stage;
    state: AnswerStatus | 'upcoming';
    added?: { reasonKey: 'interview.reason.followup' | 'interview.reason.verify' | 'interview.reason.custom'; parentId?: string };
    verify?: { fact: VerifiableFact; candidateIds: string[] };
}

export interface QuestionDef {
    id: string;
    stage: Stage;
    kind: AnswerKind;
    /** Lower = asked earlier within its stage. */
    priority: number;
    /** Facts this question establishes. Dropped once all are known. Empty = always asked. */
    fills: FactKey[];
    /** Helps identify the person; moved forward while candidates are unconfirmed. */
    dedup?: boolean;
    /** Acts as `dedup` when it tells the current candidates apart. */
    discriminates?: (candidates: readonly CandidateSummary[]) => boolean;
    /** Values for kind 'choice'; labels are i18n `interview.choice.<value>`. */
    choices?: readonly string[];
    /** Carries a verification hint against candidates that hold this fact. */
    verifies?: VerifiableFact;
    /** Has an i18n technique hint at `interview.h.<id>`. */
    hint?: boolean;
    when?: (known: KnownFacts, ctx: InterviewContext) => boolean;
    /** Follow-up: only asked once a parent answer passes `test`. */
    followUpOf?: { parents: readonly string[]; test: (a: Answer) => boolean };
}
```

- [ ] **Step 2: Write the failing tests** in `src/domain/interview/facts.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { contactKey, answerHasContent, deriveKnownFacts, identifierSignature } from './facts';
import type { InterviewContext, QuestionDef } from './types';
import { EMPTY_PREP } from './types';

const BANK: QuestionDef[] = [
    { id: 'q_phone', stage: 'rapport', kind: 'contact', priority: 1, fills: ['phones'] },
    { id: 'q_address', stage: 'story', kind: 'text', priority: 1, fills: ['address'] },
    { id: 'q_home', stage: 'story', kind: 'household', priority: 2, fills: ['household'] },
    { id: 'q_work', stage: 'rapport', kind: 'text', priority: 2, fills: ['work'] },
];

function ctx(over: Partial<InterviewContext> = {}): InterviewContext {
    return { prep: { ...EMPTY_PREP, name: 'Juan Pérez' }, answers: {}, visited: [], custom: [], candidates: [], ...over };
}

describe('contactKey', () => {
    it('phones compare on their last 8 digits, ignoring formatting and country code', () => {
        expect(contactKey('phone', '+54 9 11 6585-1333')).toBe(contactKey('phone', '1165851333'));
    });
    it('too-short phones are not identifiers', () => {
        expect(contactKey('phone', '12-34')).toBeNull();
    });
    it('emails are case-insensitive; socials reduce to the handle', () => {
        expect(contactKey('email', ' Juan@Mail.com ')).toBe('juan@mail.com');
        expect(contactKey('social', 'https://instagram.com/juan.perez')).toBe(contactKey('social', '@juan.perez'));
    });
});

describe('answerHasContent', () => {
    it('whitespace, empty rows and missing values are not content', () => {
        expect(answerHasContent({ status: 'answered', text: '   ' })).toBe(false);
        expect(answerHasContent({ status: 'answered', contacts: [{ type: 'phone', value: ' ' }] })).toBe(false);
        expect(answerHasContent({ status: 'answered', household: [{ name: ' ', relationship: null }] })).toBe(false);
        expect(answerHasContent({ status: 'answered', number: 0 })).toBe(true);
        expect(answerHasContent({ status: 'answered', choice: 'rent' })).toBe(true);
    });
});

describe('deriveKnownFacts', () => {
    it('prep identifiers count as known and fill their facts', () => {
        const k = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['11 6585 1333'], address: 'Calle 1' } }), BANK);
        expect(k.phones).toEqual(['11 6585 1333']);
        expect(k.filled).toEqual(['address', 'name', 'phones']);
    });

    it('answered questions fill their facts and add typed identifiers, de-duplicated', () => {
        const k = deriveKnownFacts(ctx({
            prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'] },
            answers: {
                q_phone: { status: 'answered', contacts: [{ type: 'phone', value: '+54 11 6585-1333' }, { type: 'email', value: 'j@x.com' }] },
                q_work: { status: 'answered', text: 'Enfermera' },
                q_home: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] },
            },
        }), BANK);
        expect(k.phones).toHaveLength(1);
        expect(k.emails).toEqual(['j@x.com']);
        expect(k.household).toEqual([{ name: 'Ana', relationship: 'partner' }]);
        expect(k.filled).toEqual(expect.arrayContaining(['work', 'household', 'emails', 'phones']));
    });

    it('a cleared or skipped answer fills nothing', () => {
        const k = deriveKnownFacts(ctx({
            answers: { q_work: { status: 'answered', text: '  ' }, q_address: { status: 'skipped' } },
        }), BANK);
        expect(k.filled).toEqual(['name']);
    });

    it('the confirmed profile fills facts the viewer can see, but not protected ones', () => {
        const k = deriveKnownFacts(ctx({
            confirmedAdopterId: 'a1',
            candidates: [{ adopterId: 'a1', displayName: 'Juan', relevancePercent: 90, avgRating: null, adoptionCount: 0, canEdit: true,
                stored: ['phones', 'address'], visible: { phones: ['1165851333'] } }],
        }), BANK);
        expect(k.filled).toContain('phones');
        expect(k.filled).not.toContain('address');
        expect(k.phones).toEqual([]); // values are never copied from a profile
    });
});

describe('identifierSignature', () => {
    it('changes only when an identifier is added, not when wording differs', () => {
        const a = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'] } }), BANK);
        const b = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['+54 11 6585-1333'] } }), BANK);
        const c = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'], emails: ['j@x.com'] } }), BANK);
        expect(identifierSignature(a)).toBe(identifierSignature(b));
        expect(identifierSignature(a)).not.toBe(identifierSignature(c));
    });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/domain/interview/facts.test.ts`
Expected: FAIL, "Cannot find module './facts'".

- [ ] **Step 4: Implement `facts.ts`**

```ts
/**
 * What the interview already knows: prep + answered questions + what the
 * confirmed profile shows this viewer. Drives gap-filling in the queue and
 * the identifiers sent to the duplicate engine.
 */
import { normalizeSocialHandle, normalizeText } from '@/lib/tokenizer';
import type { Answer, ContactType, FactKey, HouseholdValue, InterviewContext, KnownFacts, QuestionDef } from './types';
import { VERIFIABLE_FACTS } from './types';

/** Stable comparison key for an identifier, or null when it can't identify anyone. */
export function contactKey(type: ContactType, value: string): string | null {
    const v = (value || '').trim();
    if (!v) return null;
    if (type === 'phone') {
        const digits = v.replace(/\D/g, '');
        return digits.length >= 7 ? digits.slice(-8) : null;
    }
    if (type === 'email') return v.toLowerCase();
    return normalizeSocialHandle(v) ?? (normalizeText(v).replace(/^@+/, '') || null);
}

export function answerHasContent(a: Answer): boolean {
    if (a.text && a.text.trim()) return true;
    if (a.contacts?.some(c => c.value.trim())) return true;
    if (a.household?.some(h => h.name.trim() || h.relationship)) return true;
    if (a.choice) return true;
    return typeof a.number === 'number' && Number.isFinite(a.number);
}

export function deriveKnownFacts(ctx: InterviewContext, bank: readonly QuestionDef[]): KnownFacts {
    const byId = new Map(bank.map(q => [q.id, q]));
    const lists: Record<ContactType, Map<string, string>> = { phone: new Map(), email: new Map(), social: new Map() };
    const add = (type: ContactType, raw: string) => {
        const key = contactKey(type, raw);
        if (key && !lists[type].has(key)) lists[type].set(key, raw.trim());
    };
    ctx.prep.phones.forEach(p => add('phone', p));
    ctx.prep.emails.forEach(e => add('email', e));
    ctx.prep.socials.forEach(s => add('social', s));

    const filled = new Set<FactKey>();
    const name = ctx.prep.name.trim();
    if (name) filled.add('name');
    let address = ctx.prep.address.trim() || undefined;
    const household: HouseholdValue[] = [];

    for (const id of Object.keys(ctx.answers).sort()) {
        const a = ctx.answers[id];
        const q = byId.get(id);
        if (!q || a.status !== 'answered' || !answerHasContent(a)) continue;
        q.fills.forEach(f => filled.add(f));
        a.contacts?.forEach(c => add(c.type, c.value));
        a.household?.forEach(h => {
            if (h.name.trim() || h.relationship) household.push({ name: h.name.trim(), relationship: h.relationship });
        });
        if (q.fills.includes('address') && a.text?.trim()) address = a.text.trim();
    }

    if (lists.phone.size) filled.add('phones');
    if (lists.email.size) filled.add('emails');
    if (lists.social.size) filled.add('socials');
    if (address) filled.add('address');
    if (household.length) filled.add('household');

    if (ctx.confirmedAdopterId) {
        const c = ctx.candidates.find(x => x.adopterId === ctx.confirmedAdopterId);
        if (c) for (const f of VERIFIABLE_FACTS) if (c.visible[f]?.length) filled.add(f);
    }

    return {
        name,
        phones: [...lists.phone.values()],
        emails: [...lists.email.values()],
        socials: [...lists.social.values()],
        address,
        household,
        filled: [...filled].sort(),
    };
}

/** Changes only when the set of identifiers changes, which is when re-matching is worth it. */
export function identifierSignature(k: KnownFacts): string {
    const keys = (type: ContactType, vs: string[]) => vs.map(v => contactKey(type, v)).filter(Boolean).sort().join(',');
    return [normalizeText(k.name), keys('phone', k.phones), keys('email', k.emails), keys('social', k.socials)].join('|');
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/domain/interview/facts.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/domain/interview/types.ts src/domain/interview/facts.ts src/domain/interview/facts.test.ts
git commit -m "feat(interview): domain types and known-facts derivation"
```

---

### Task 3: Fact comparison and answer-visibility rule

**Files:**
- Create: `src/domain/interview/verify.ts`
- Create: `src/domain/interview/access.ts`
- Test: `src/domain/interview/verify.test.ts`, `src/domain/interview/access.test.ts`

**Interfaces:**
- Consumes: `contactKey` (Task 2).
- Produces: `factMatches(fact: VerifiableFact, stored: string[], given: string[]): boolean`; `canViewInterviewAnswers(p: { viewer: string | null | undefined; conductedBy: string; ownerEmail: string | null | undefined; viewerIsAdmin: boolean; viewerIsOrgMate: boolean }): boolean`.

- [ ] **Step 1: Write the failing tests**

`src/domain/interview/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { factMatches } from './verify';

describe('factMatches', () => {
    it('phones match across formatting and country code', () => {
        expect(factMatches('phones', ['+5491165851333'], ['11 6585-1333'])).toBe(true);
        expect(factMatches('phones', ['+5491165851333'], ['11 6585-0000'])).toBe(false);
    });
    it('emails and socials compare normalized', () => {
        expect(factMatches('emails', ['Juan@Mail.com'], ['juan@mail.com'])).toBe(true);
        expect(factMatches('socials', ['https://www.instagram.com/juan.perez/'], ['@juan.perez'])).toBe(true);
    });
    it('addresses match when equal after accents/case, or sharing two meaningful words', () => {
        expect(factMatches('address', ['Av. Rivadavia 4500, Caballito'], ['av rivadavia 4500 caballito'])).toBe(true);
        expect(factMatches('address', ['Rivadavia 4500, Caballito'], ['vivo en Rivadavia 4500'])).toBe(true);
        expect(factMatches('address', ['Rivadavia 4500, Caballito'], ['Corrientes 1200, Almagro'])).toBe(false);
    });
    it('nothing to compare is never a match', () => {
        expect(factMatches('phones', [], ['1165851333'])).toBe(false);
        expect(factMatches('phones', ['1165851333'], [])).toBe(false);
    });
});
```

`src/domain/interview/access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canViewInterviewAnswers } from './access';

const base = { conductedBy: 'ana@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false };

describe('canViewInterviewAnswers (spec D7)', () => {
    it('interviewer, profile owner, owner org-mates and admins may read answers', () => {
        expect(canViewInterviewAnswers({ ...base, viewer: 'ana@x.com' })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'owner@x.com' })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'mate@x.com', viewerIsOrgMate: true })).toBe(true);
        expect(canViewInterviewAnswers({ ...base, viewer: 'root@x.com', viewerIsAdmin: true })).toBe(true);
    });
    it('any other rescuer, and nobody signed out, may not', () => {
        expect(canViewInterviewAnswers({ ...base, viewer: 'other@x.com' })).toBe(false);
        expect(canViewInterviewAnswers({ ...base, viewer: null })).toBe(false);
        expect(canViewInterviewAnswers({ ...base, ownerEmail: null, viewer: 'other@x.com' })).toBe(false);
    });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/domain/interview/verify.test.ts src/domain/interview/access.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/domain/interview/verify.ts`:

```ts
/**
 * Compares what the interviewee said with what a profile holds. Runs on the
 * server only, so a protected value never reaches the browser; the client
 * learns a boolean (spec §4.4).
 */
import { extractAddressWords, normalizeText } from '@/lib/tokenizer';
import { contactKey } from './facts';
import type { ContactType, VerifiableFact } from './types';

const CONTACT_TYPE: Record<Exclude<VerifiableFact, 'address'>, ContactType> = { phones: 'phone', emails: 'email', socials: 'social' };

function addressMatches(a: string, b: string): boolean {
    const na = normalizeText(a).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const nb = normalizeText(b).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (na && na === nb) return true;
    const wa = new Set(extractAddressWords(a));
    return extractAddressWords(b).filter(w => wa.has(w)).length >= 2;
}

export function factMatches(fact: VerifiableFact, stored: string[], given: string[]): boolean {
    if (!stored.length || !given.length) return false;
    if (fact === 'address') return given.some(g => stored.some(s => addressMatches(s, g)));
    const type = CONTACT_TYPE[fact];
    const keys = new Set(stored.map(v => contactKey(type, v)).filter((k): k is string => !!k));
    return given.some(g => {
        const k = contactKey(type, g);
        return !!k && keys.has(k);
    });
}
```

`src/domain/interview/access.ts`:

```ts
/** Who may read a completed interview's answers (spec D7). Everyone else sees only that it happened. */
export function canViewInterviewAnswers(p: {
    viewer: string | null | undefined;
    conductedBy: string;
    ownerEmail: string | null | undefined;
    viewerIsAdmin: boolean;
    viewerIsOrgMate: boolean;
}): boolean {
    if (!p.viewer) return false;
    if (p.viewer === p.conductedBy) return true;
    if (p.viewerIsAdmin) return true;
    if (p.ownerEmail && p.viewer === p.ownerEmail) return true;
    return p.viewerIsOrgMate;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/domain/interview/verify.test.ts src/domain/interview/access.test.ts`
Expected: PASS. If the "sharing two words" address case fails, print `extractAddressWords('Rivadavia 4500, Caballito')` and adjust the *test input* to two words the extractor keeps (it drops words under 3 characters and stopwords). Do not loosen the threshold.

- [ ] **Step 5: Commit**

```bash
git add src/domain/interview/verify.ts src/domain/interview/access.ts src/domain/interview/verify.test.ts src/domain/interview/access.test.ts
git commit -m "feat(interview): server-side fact comparison and answer-visibility rule"
```

---

### Task 4: Question bank and interview copy (es/en/pt)

**Files:**
- Create: `src/domain/interview/bank.ts`
- Modify: `src/i18n/locales/es.ts`, `en.ts`, `pt.ts` (new top-level `interview: { … }` block before the final `};`)
- Test: `src/domain/interview/bank.test.ts`

**Interfaces:**
- Consumes: `QuestionDef`, `Answer` (Task 2).
- Produces: `QUESTION_BANK: readonly QuestionDef[]`, `questionById(id: string): QuestionDef | undefined`, `textMatches(re: RegExp): (a: Answer) => boolean`. i18n keys: `interview.q.<id>`, `interview.h.<id>`, `interview.choice.<value>`, `interview.stage.<stage>`, `interview.technique.<stage>.{title,goal,tip1..tip4}`, `interview.reason.{followup,verify,custom}`, plus the UI strings listed in Step 4.

- [ ] **Step 1: Write the failing bank-integrity test** `src/domain/interview/bank.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { QUESTION_BANK, questionById, textMatches } from './bank';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const LOCALES = { es, en, pt } as const;
type Dict = Record<string, unknown>;
const get = (d: Dict, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], d);

describe('QUESTION_BANK', () => {
    it('has ~40 questions with unique ids across all three stages', () => {
        const ids = QUESTION_BANK.map(q => q.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(38);
        for (const s of ['rapport', 'story', 'details']) expect(QUESTION_BANK.some(q => q.stage === s)).toBe(true);
    });

    it('every question, hint and choice has copy in es, en and pt', () => {
        for (const [loc, dict] of Object.entries(LOCALES)) {
            for (const q of QUESTION_BANK) {
                expect(typeof get(dict as Dict, `interview.q.${q.id}`), `${loc} interview.q.${q.id}`).toBe('string');
                if (q.hint) expect(typeof get(dict as Dict, `interview.h.${q.id}`), `${loc} interview.h.${q.id}`).toBe('string');
                for (const c of q.choices ?? []) expect(typeof get(dict as Dict, `interview.choice.${c}`), `${loc} choice.${c}`).toBe('string');
            }
            for (const s of ['rapport', 'story', 'details']) {
                for (const k of ['title', 'goal', 'tip1', 'tip2', 'tip3', 'tip4']) {
                    expect(typeof get(dict as Dict, `interview.technique.${s}.${k}`), `${loc} technique.${s}.${k}`).toBe('string');
                }
            }
        }
    });

    it('follow-ups point at real parents; choice questions declare choices', () => {
        for (const q of QUESTION_BANK) {
            for (const p of q.followUpOf?.parents ?? []) expect(questionById(p), `${q.id} → ${p}`).toBeDefined();
            if (q.kind === 'choice') expect(q.choices?.length).toBeGreaterThan(1);
        }
    });

    it('the lost-pet follow-up fires in all three languages and stays quiet otherwise', () => {
        const q = questionById('details_pet_what_happened')!;
        for (const text of ['Se me perdió en 2022', 'He ran away last year', 'Ele fugiu de casa']) {
            expect(q.followUpOf!.test({ status: 'answered', text })).toBe(true);
        }
        expect(q.followUpOf!.test({ status: 'answered', text: 'Vive conmigo, tiene 12 años' })).toBe(false);
    });

    it('textMatches also reads choices and household relationships', () => {
        expect(textMatches(/^rent$/)({ status: 'answered', choice: 'rent' })).toBe(true);
        expect(textMatches(/child/)({ status: 'answered', household: [{ name: 'Leo', relationship: 'child' }] })).toBe(true);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/domain/interview/bank.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `bank.ts`**

```ts
/**
 * The question bank (spec §4.3). Copy lives in i18n `interview.q.<id>`; Jon
 * edits the Spanish before flag-on (D5). Ordering, applicability and
 * follow-ups are rules here; `queue.ts` applies them.
 */
import type { Answer, QuestionDef } from './types';

/** Test a regex against everything an answer says: text, choice, household. */
export function textMatches(re: RegExp): (a: Answer) => boolean {
    return (a) => {
        const parts = [a.text ?? '', a.choice ?? '', ...(a.household ?? []).flatMap(h => [h.name, h.relationship ?? ''])];
        return re.test(parts.join(' \n'));
    };
}

const LOST_PET = /(perd|escap|muri|falleci|regal|devolv|lost|ran away|died|passed away|gave (him|her|it) away|rehom|returned|perdeu|fugiu|morreu|faleceu|doei|devolvi)/i;
const KIDS = /(child|hij|niñ|nene|nena|beb|chic[oa]s?\b|kid|son\b|daughter|baby|filh|crian)/i;
const PETS_NOW = /(perr|gat|dog|cat|cachorr|gato|cão|cao)/i;
const yearsHere = (a?: Answer) => (a?.status === 'answered' && typeof a.number === 'number' ? a.number : null);

export const QUESTION_BANK: readonly QuestionDef[] = [
    // ── Confianza (rapport) ───────────────────────────────────────────────
    { id: 'rapport_good_time', stage: 'rapport', kind: 'choice', priority: 5, fills: [], choices: ['yes', 'later'] },
    { id: 'rapport_how_found', stage: 'rapport', kind: 'text', priority: 10, fills: ['how_found'] },
    { id: 'rapport_work', stage: 'rapport', kind: 'text', priority: 20, fills: ['work'] },
    { id: 'rapport_area', stage: 'rapport', kind: 'text', priority: 30, fills: ['locality'], dedup: true, when: (k) => !k.address },
    { id: 'rapport_nickname', stage: 'rapport', kind: 'text', priority: 40, fills: ['aliases'], dedup: true },
    { id: 'rapport_phone', stage: 'rapport', kind: 'contact', priority: 50, fills: ['phones'], dedup: true, verifies: 'phones' },
    { id: 'rapport_social', stage: 'rapport', kind: 'contact', priority: 60, fills: ['socials'], dedup: true, verifies: 'socials' },
    { id: 'rapport_childhood_pets', stage: 'rapport', kind: 'text', priority: 65, fills: [] },
    { id: 'rapport_why_now', stage: 'rapport', kind: 'text', priority: 70, fills: ['motivation'] },

    // ── Historia (open narrative) ─────────────────────────────────────────
    { id: 'story_typical_day', stage: 'story', kind: 'text', priority: 10, fills: ['schedule'], hint: true },
    { id: 'story_home', stage: 'story', kind: 'text', priority: 20, fills: [] },
    { id: 'story_housing_type', stage: 'story', kind: 'choice', priority: 25, fills: ['housing_type'], choices: ['house', 'apartment', 'ph', 'other'] },
    { id: 'story_tenure', stage: 'story', kind: 'choice', priority: 26, fills: ['housing_tenure'], choices: ['own', 'rent', 'family'] },
    { id: 'story_years_here', stage: 'story', kind: 'number', priority: 27, fills: ['years_at_address'] },
    { id: 'story_address', stage: 'story', kind: 'text', priority: 28, fills: ['address'], dedup: true, verifies: 'address' },
    { id: 'story_household', stage: 'story', kind: 'household', priority: 30, fills: ['household'], dedup: true },
    { id: 'story_household_opinion', stage: 'story', kind: 'text', priority: 35, fills: ['household_agree'], when: (k) => k.household.length > 0 },
    { id: 'story_pets_now', stage: 'story', kind: 'text', priority: 40, fills: ['pets_current'] },
    { id: 'story_pets_past', stage: 'story', kind: 'text', priority: 45, fills: ['pets_past'], hint: true },
    { id: 'story_time_alone', stage: 'story', kind: 'number', priority: 50, fills: ['time_alone'] },
    { id: 'story_outdoor', stage: 'story', kind: 'text', priority: 55, fills: ['outdoor_space'] },
    { id: 'story_vet', stage: 'story', kind: 'text', priority: 60, fills: ['vet'] },

    // ── Detalles (probing) ────────────────────────────────────────────────
    { id: 'details_pet_what_happened', stage: 'details', kind: 'text', priority: 5, fills: [], hint: true,
        followUpOf: { parents: ['story_pets_past'], test: textMatches(LOST_PET) } },
    { id: 'details_other_phones', stage: 'details', kind: 'contact', priority: 10, fills: [], dedup: true, verifies: 'phones', hint: true },
    { id: 'details_other_socials', stage: 'details', kind: 'contact', priority: 15, fills: [], dedup: true, verifies: 'socials' },
    { id: 'details_email', stage: 'details', kind: 'contact', priority: 18, fills: ['emails'], dedup: true, verifies: 'emails' },
    { id: 'details_landlord', stage: 'details', kind: 'text', priority: 20, fills: [],
        followUpOf: { parents: ['story_tenure'], test: textMatches(/^rent$/m) } },
    { id: 'details_moved_before', stage: 'details', kind: 'text', priority: 25, fills: ['prev_address'], dedup: true,
        when: (_k, ctx) => { const y = yearsHere(ctx.answers.story_years_here); return y !== null && y < 2; } },
    { id: 'details_prior_adoptions', stage: 'details', kind: 'text', priority: 30, fills: ['prior_adoptions'],
        discriminates: (cs) => cs.length >= 2 && new Set(cs.map(c => c.adoptionCount > 0)).size > 1 },
    { id: 'details_returned', stage: 'details', kind: 'text', priority: 35, fills: ['returned_before'], hint: true },
    { id: 'details_kids', stage: 'details', kind: 'text', priority: 38, fills: [],
        followUpOf: { parents: ['story_household'], test: textMatches(KIDS) } },
    { id: 'details_pets_now_care', stage: 'details', kind: 'text', priority: 40, fills: [],
        followUpOf: { parents: ['story_pets_now'], test: textMatches(PETS_NOW) } },
    { id: 'details_moving_plans', stage: 'details', kind: 'text', priority: 45, fills: ['moving_plan'] },
    { id: 'details_hardest_moment', stage: 'details', kind: 'text', priority: 48, fills: [] },
    { id: 'details_holidays', stage: 'details', kind: 'text', priority: 50, fills: ['travel_plan'] },
    { id: 'details_prev_pet_home', stage: 'details', kind: 'text', priority: 55, fills: [],
        when: (k) => k.filled.includes('pets_past') && k.filled.includes('years_at_address') },
    { id: 'details_yesterday', stage: 'details', kind: 'text', priority: 60, fills: [], when: (k) => k.filled.includes('schedule') },
    { id: 'details_who_cares', stage: 'details', kind: 'text', priority: 65, fills: [], when: (k) => k.household.length > 0 },
    { id: 'details_vet_where', stage: 'details', kind: 'text', priority: 70, fills: [], when: (k) => k.filled.includes('vet') },
    { id: 'details_budget', stage: 'details', kind: 'text', priority: 75, fills: ['budget'] },
    { id: 'details_references', stage: 'details', kind: 'text', priority: 80, fills: ['references'] },
];

const BY_ID = new Map(QUESTION_BANK.map(q => [q.id, q]));
export function questionById(id: string): QuestionDef | undefined {
    return BY_ID.get(id);
}
```

- [ ] **Step 4: Add the `interview` i18n block to all three locales**

Insert a new top-level key `interview: { ... },` just before the final `};` of each locale file. Use exactly these keys. Every row of every table below becomes a key.

**UI strings** (`interview.<key>`):

| key | es | en | pt |
|---|---|---|---|
| title | Entrevista | Interview | Entrevista |
| menu | Entrevista telefónica | Phone interview | Entrevista por telefone |
| start_from_profile | Entrevistar | Interview | Entrevistar |
| start_from_profile_desc | Guía para una entrevista telefónica | Guide for a phone interview | Guia para uma entrevista por telefone |
| drafts_title | Entrevistas sin terminar | Unfinished interviews | Entrevistas não concluídas |
| draft_continue | Continuar | Continue | Continuar |
| draft_discard | Descartar | Discard | Descartar |
| prep_title | ¿Qué sabés de la persona? | What do you know about this person? | O que você sabe sobre a pessoa? |
| prep_intro | Completá lo que tengas. Buscamos si ya está registrada. | Fill in what you have. We'll check whether they're already registered. | Preencha o que tiver. Verificamos se a pessoa já está registrada. |
| prep_name | Nombre | Name | Nome |
| prep_phones | Teléfonos | Phones | Telefones |
| prep_socials | Redes sociales | Social media | Redes sociais |
| prep_emails | Emails | Emails | Emails |
| prep_address | Dirección | Address | Endereço |
| prep_add_row | + Agregar | + Add | + Adicionar |
| prep_searching | Buscando coincidencias… | Looking for matches… | Procurando correspondências… |
| prep_no_matches | Sin coincidencias por ahora. | No matches so far. | Nenhuma correspondência por enquanto. |
| prep_candidates | Posibles perfiles | Possible profiles | Perfis possíveis |
| prep_lead | Probablemente es esta persona | Probably this person | Provavelmente é esta pessoa |
| prep_lead_selected | Marcado como probable | Marked as likely | Marcado como provável |
| prep_start | Comenzar | Start | Começar |
| view_profile | Ver perfil | View profile | Ver perfil |
| adoptions_count | {n} adopciones | {n} adoptions | {n} adoções |
| technique_title | Cómo entrevistar | How to interview | Como entrevistar |
| technique_dont_show | No volver a mostrar | Don't show again | Não mostrar novamente |
| technique_continue | Empezar la entrevista | Start the interview | Começar a entrevista |
| technique_button | Técnica | Technique | Técnica |
| close | Cerrar | Close | Fechar |
| questions_drawer | Preguntas {done}/{total} | Questions {done}/{total} | Perguntas {done}/{total} |
| now | Ahora | Now | Agora |
| skip | Saltar | Skip | Pular |
| no_answer | No respondió | No answer | Não respondeu |
| next | Siguiente | Next | Próxima |
| answer_label | Respuesta | Answer | Resposta |
| answer_placeholder | Respuesta… | Answer… | Resposta… |
| add_question | + Agregar pregunta | + Add question | + Adicionar pergunta |
| add_question_placeholder | Escribí tu pregunta | Type your question | Escreva sua pergunta |
| add_question_save | Agregar | Add | Adicionar |
| finish | Terminar | Finish | Concluir |
| saved | Guardado | Saved | Salvo |
| saving | Guardando… | Saving… | Salvando… |
| offline | Sin conexión — reintentando | Offline — retrying | Sem conexão — tentando novamente |
| candidates_count | {n} posibles perfiles | {n} possible profiles | {n} perfis possíveis |
| candidate_one | 1 posible perfil | 1 possible profile | 1 perfil possível |
| candidate_confirmed | Perfil: {name} | Profile: {name} | Perfil: {name} |
| new_candidate | Nuevo posible perfil | New possible profile | Novo perfil possível |
| verify_on_profile | En el perfil de {name}: | On {name}'s profile: | No perfil de {name}: |
| verify_match | Coincide con el perfil de {name} | Matches {name}'s profile | Coincide com o perfil de {name} |
| verify_nomatch | No coincide con el perfil de {name} | Doesn't match {name}'s profile | Não coincide com o perfil de {name} |
| verify_pending | Se compara cuando anotes la respuesta | Compared once you note the answer | Comparado quando você anotar a resposta |
| contact_type_phone | Teléfono | Phone | Telefone |
| contact_type_email | Email | Email | Email |
| contact_type_social | Red social | Social media | Rede social |
| household_name | Nombre | Name | Nome |
| household_add | + Agregar persona | + Add person | + Adicionar pessoa |
| remove | Quitar | Remove | Remover |
| review_title | Revisar y guardar | Review and save | Revisar e salvar |
| review_who | ¿Quién era? | Who was it? | Quem era? |
| review_new_person | Persona nueva | New person | Pessoa nova |
| review_new_person_desc | Crear un perfil con lo que se habló | Create a profile from this interview | Criar um perfil com o que foi conversado |
| review_add_title | Agregar al perfil | Add to the profile | Adicionar ao perfil |
| review_already | ya está | already there | já está |
| review_cannot_edit | Quedará en la entrevista; el responsable del perfil puede agregarlo. | It stays in the interview; the profile's owner can add it. | Fica na entrevista; o responsável pelo perfil pode adicionar. |
| review_nothing_new | No hay datos nuevos para agregar. | Nothing new to add. | Não há dados novos para adicionar. |
| review_rating | Calificación (opcional) | Rating (optional) | Avaliação (opcional) |
| review_summary | Resumen (opcional) | Summary (optional) | Resumo (opcional) |
| review_summary_public | Visible para todos los rescatistas | Visible to all rescuers | Visível para todos os protetores |
| review_save | Guardar entrevista | Save interview | Salvar entrevista |
| review_back | Volver a la entrevista | Back to the interview | Voltar à entrevista |
| review_pick_required | Elegí un perfil o «Persona nueva». | Pick a profile or «New person». | Escolha um perfil ou «Pessoa nova». |
| saved_toast | Entrevista guardada | Interview saved | Entrevista salva |
| save_failed | No se pudo guardar la entrevista | Couldn't save the interview | Não foi possível salvar a entrevista |
| load_failed | No se pudo cargar la entrevista | Couldn't load the interview | Não foi possível carregar a entrevista |
| disabled | La guía de entrevista no está disponible | The interview guide isn't available | O guia de entrevista não está disponível |
| badge | Entrevista | Interview | Entrevista |
| view_answers | Ver respuestas | View answers | Ver respostas |
| readonly_title | Entrevista con {name} | Interview with {name} | Entrevista com {name} |
| readonly_by | Por {who} · {date} | By {who} · {date} | Por {who} · {date} |
| prep_section | Lo que se sabía antes | Known beforehand | O que se sabia antes |
| not_answered | Sin respuesta | No answer | Sem resposta |
| skipped | Salteada | Skipped | Pulada |

**Stages** (`interview.stage.<s>`): rapport = Confianza / Rapport / Confiança · story = Historia / Story / História · details = Detalles / Details / Detalhes.

**Reasons** (`interview.reason.<r>`): followup = Por lo que respondió antes / Based on an earlier answer / Com base em uma resposta anterior · verify = Ayuda a confirmar el perfil / Helps confirm the profile / Ajuda a confirmar o perfil · custom = Tu pregunta / Your question / Sua pergunta.

**Choices** (`interview.choice.<v>`):
- yes = Sí / Yes / Sim
- later = Mejor en otro momento / Another time / Melhor outra hora
- house = Casa / House / Casa
- apartment = Departamento / Apartment / Apartamento
- ph = PH / Duplex / Sobrado
- other = Otro / Other / Outro
- own = Propia / Owned / Própria
- rent = Alquilada / Rented / Alugada
- family = De la familia / Family home / Da família

**Technique** (`interview.technique.<stage>.<k>`):

| stage.k | es | en | pt |
|---|---|---|---|
| rapport.title | Confianza | Rapport | Confiança |
| rapport.goal | Que la persona se sienta cómoda y hable con naturalidad. | Help the person feel at ease and talk naturally. | Fazer a pessoa se sentir à vontade e falar com naturalidade. |
| rapport.tip1 | Presentate y contá por qué llamás. | Introduce yourself and say why you're calling. | Apresente-se e diga por que está ligando. |
| rapport.tip2 | Empezá con preguntas fáciles y cálidas. | Start with easy, friendly questions. | Comece com perguntas fáceis e amigáveis. |
| rapport.tip3 | Explicá que hacés estas preguntas a todos. | Explain that you ask everyone these questions. | Explique que você faz essas perguntas a todos. |
| rapport.tip4 | Escuchá más de lo que hablás. | Listen more than you talk. | Escute mais do que fala. |
| story.title | Historia | Story | História |
| story.goal | Que cuente su vida con sus palabras: casa, rutina, animales. | Let them tell their life in their own words: home, routine, animals. | Deixar que conte sua vida com suas palavras: casa, rotina, animais. |
| story.tip1 | Usá preguntas abiertas: «contame…», «¿cómo es…?». | Use open questions: «tell me…», «what is it like…?». | Use perguntas abertas: «me conta…», «como é…?». |
| story.tip2 | No interrumpas; los silencios invitan a seguir contando. | Don't interrupt; silence invites them to keep going. | Não interrompa; o silêncio convida a continuar. |
| story.tip3 | No reveles lo que ya sabés de la persona. | Don't reveal what you already know about them. | Não revele o que você já sabe sobre a pessoa. |
| story.tip4 | Anotá los detalles concretos: nombres, lugares, fechas. | Note concrete details: names, places, dates. | Anote detalhes concretos: nomes, lugares, datas. |
| details.title | Detalles | Details | Detalhes |
| details.goal | Volver sobre lo que contó para ver si la historia es coherente. | Go back over what they said to see if the story holds together. | Voltar ao que foi contado para ver se a história é coerente. |
| details.tip1 | Retomá detalles que mencionó: «dijiste que…, ¿cuándo fue?». | Pick up details they mentioned: «you said…, when was that?». | Retome detalhes mencionados: «você disse que…, quando foi?». |
| details.tip2 | Preguntá qué pasó, no qué haría. | Ask what happened, not what they would do. | Pergunte o que aconteceu, não o que faria. |
| details.tip3 | Si algo no cierra, anotalo sin acusar. | If something doesn't add up, note it without accusing. | Se algo não fecha, anote sem acusar. |
| details.tip4 | Las dudas y los cambios de versión también son información. | Hesitations and changing stories are information too. | Hesitações e mudanças de versão também são informação. |

**Questions** (`interview.q.<id>`):

| id | es | en | pt |
|---|---|---|---|
| rapport_good_time | ¿Es buen momento para hablar unos 15 minutos? | Is now a good time to talk for about 15 minutes? | É um bom momento para conversar uns 15 minutos? |
| rapport_how_found | ¿Cómo llegaste a nosotros? | How did you find us? | Como você chegou até nós? |
| rapport_work | ¿A qué te dedicás? | What do you do for a living? | Com o que você trabalha? |
| rapport_area | ¿De qué zona sos? | Which area do you live in? | De qual região você é? |
| rapport_nickname | ¿Te dicen de alguna otra forma? | Do people call you by any other name? | As pessoas te chamam de outro jeito? |
| rapport_phone | ¿A qué número te puedo escribir? | Which number can I message you on? | Para qual número posso te escrever? |
| rapport_social | ¿Tenés Instagram o Facebook? Así te mando fotos. | Do you have Instagram or Facebook? I can send you photos there. | Você tem Instagram ou Facebook? Assim te mando fotos. |
| rapport_childhood_pets | ¿Tuviste animales de chico o de chica? | Did you have animals growing up? | Você teve animais quando era criança? |
| rapport_why_now | ¿Qué te hizo pensar en adoptar ahora? | What made you think about adopting now? | O que te fez pensar em adotar agora? |
| story_typical_day | Contame cómo es un día normal tuyo, de la mañana a la noche. | Tell me what a normal day looks like for you, from morning to night. | Me conta como é um dia normal seu, de manhã até a noite. |
| story_home | Contame cómo es tu casa. | Tell me about your home. | Me conta como é a sua casa. |
| story_housing_type | ¿Es casa, departamento o PH? | Is it a house, an apartment or a duplex? | É casa, apartamento ou sobrado? |
| story_tenure | ¿Es propia, alquilada o de la familia? | Do you own it, rent it, or is it a family home? | É própria, alugada ou da família? |
| story_years_here | ¿Hace cuántos años vivís ahí? | How many years have you lived there? | Há quantos anos você mora aí? |
| story_address | ¿Cuál es la dirección? | What is the address? | Qual é o endereço? |
| story_household | ¿Quiénes viven con vos? | Who lives with you? | Quem mora com você? |
| story_household_opinion | ¿Qué opinan los demás en tu casa sobre adoptar? | What do the others at home think about adopting? | O que os outros da casa acham de adotar? |
| story_pets_now | Contame de los animales que tenés ahora. | Tell me about the animals you have now. | Me conta dos animais que você tem agora. |
| story_pets_past | Contame de los animales que tuviste antes. ¿Qué fue de ellos? | Tell me about animals you had before. What happened to them? | Me conta dos animais que você teve antes. O que aconteceu com eles? |
| story_time_alone | ¿Cuántas horas por día quedaría solo el animal? | How many hours a day would the animal be alone? | Quantas horas por dia o animal ficaria sozinho? |
| story_outdoor | ¿Tenés patio, balcón o terraza? ¿Cómo está protegido? | Do you have a yard, balcony or terrace? How is it secured? | Você tem quintal, varanda ou terraço? Como é protegido? |
| story_vet | ¿Tenés veterinaria de confianza? | Do you have a vet you trust? | Você tem um veterinário de confiança? |
| details_pet_what_happened | Contame qué pasó exactamente. ¿Cuándo y dónde fue? | Tell me exactly what happened. When and where was it? | Me conta exatamente o que aconteceu. Quando e onde foi? |
| details_other_phones | ¿Usaste otros números en los últimos años? | Have you used other phone numbers in recent years? | Você usou outros números nos últimos anos? |
| details_other_socials | ¿Tuviste otras cuentas de redes sociales? | Have you had other social media accounts? | Você teve outras contas de redes sociais? |
| details_email | ¿Cuál es tu email? | What is your email? | Qual é o seu email? |
| details_landlord | ¿El contrato permite animales? ¿El dueño está al tanto? | Does the lease allow animals? Does the landlord know? | O contrato permite animais? O proprietário sabe? |
| details_moved_before | ¿Dónde vivías antes y por qué te mudaste? | Where did you live before, and why did you move? | Onde você morava antes e por que se mudou? |
| details_prior_adoptions | ¿Adoptaste antes de alguna rescatista o refugio? ¿De quién y cuándo? | Have you adopted before from a rescuer or shelter? From whom, and when? | Você já adotou antes de algum protetor ou abrigo? De quem e quando? |
| details_returned | ¿Alguna vez tuviste que dar en adopción o devolver un animal? ¿Qué pasó? | Have you ever had to rehome or return an animal? What happened? | Você já precisou doar ou devolver um animal? O que aconteceu? |
| details_kids | ¿Qué edad tienen los chicos? ¿Convivieron con animales antes? | How old are the children? Have they lived with animals before? | Quantos anos têm as crianças? Já conviveram com animais? |
| details_pets_now_care | ¿Están castrados y vacunados? ¿Cómo se llevan con otros animales? | Are they neutered and vaccinated? How do they get along with other animals? | Eles são castrados e vacinados? Como se dão com outros animais? |
| details_moving_plans | ¿Pensás mudarte en el próximo año? ¿Qué pasaría con el animal? | Are you planning to move in the next year? What would happen to the animal? | Você pensa em se mudar no próximo ano? O que aconteceria com o animal? |
| details_hardest_moment | ¿Cuál fue el momento más difícil que tuviste con un animal y cómo lo resolviste? | What was the hardest moment you've had with an animal, and how did you handle it? | Qual foi o momento mais difícil com um animal e como você resolveu? |
| details_holidays | Si te vas de vacaciones, ¿quién lo cuida? | If you go on holiday, who looks after the animal? | Se você viajar de férias, quem cuida do animal? |
| details_prev_pet_home | Cuando tenías a tu animal anterior, ¿dónde vivías? | When you had your previous animal, where were you living? | Quando você tinha seu animal anterior, onde morava? |
| details_yesterday | ¿Qué hiciste ayer, de la mañana a la noche? | What did you do yesterday, from morning to night? | O que você fez ontem, de manhã até a noite? |
| details_who_cares | ¿Quién se encarga del día a día: comida, paseos, veterinaria? | Who takes care of the day-to-day: food, walks, vet visits? | Quem cuida do dia a dia: comida, passeios, veterinário? |
| details_vet_where | ¿Cómo se llama la veterinaria y en qué zona está? | What is the vet called and which area is it in? | Como se chama o veterinário e em que região fica? |
| details_budget | ¿Cuánto calculás que gasta un animal por mes entre comida y veterinaria? | How much do you think an animal costs per month in food and vet care? | Quanto você calcula que um animal custa por mês com comida e veterinário? |
| details_references | ¿Hay alguien que pueda darnos una referencia tuya? (rescatista, veterinaria) | Is there someone who could give us a reference for you? (a rescuer, a vet) | Há alguém que possa nos dar uma referência sua? (protetor, veterinário) |

**Hints** (`interview.h.<id>`):
- story_typical_day = Dejá que hable; no interrumpas. / Let them talk; don't interrupt. / Deixe a pessoa falar; não interrompa.
- story_pets_past = Escuchá cómo habla de ellos. / Notice how they talk about them. / Repare em como a pessoa fala deles.
- details_pet_what_happened = Pedí fechas y lugares concretos. / Ask for concrete dates and places. / Peça datas e lugares concretos.
- details_other_phones = No digas qué número tenemos registrado. / Don't say which number we have on file. / Não diga qual número temos registrado.
- details_returned = Preguntá qué pasó, no si lo haría. / Ask what happened, not whether they would. / Pergunte o que aconteceu, não se faria.

Shape (es shown; en/pt identical keys):

```ts
    interview: {
        title: 'Entrevista',
        // …every UI string above…
        stage: { rapport: 'Confianza', story: 'Historia', details: 'Detalles' },
        reason: { followup: 'Por lo que respondió antes', verify: 'Ayuda a confirmar el perfil', custom: 'Tu pregunta' },
        choice: { yes: 'Sí', later: 'Mejor en otro momento', house: 'Casa', apartment: 'Departamento', ph: 'PH', other: 'Otro', own: 'Propia', rent: 'Alquilada', family: 'De la familia' },
        technique: {
            rapport: { title: 'Confianza', goal: '…', tip1: '…', tip2: '…', tip3: '…', tip4: '…' },
            story: { /* … */ },
            details: { /* … */ },
        },
        q: { rapport_good_time: '¿Es buen momento para hablar unos 15 minutos?', /* …all 40… */ },
        h: { story_typical_day: 'Dejá que hable; no interrumpas.', /* …5… */ },
    },
```

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run src/domain/interview/bank.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/interview/bank.ts src/domain/interview/bank.test.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
git commit -m "feat(interview): question bank (40) and interview copy in es/en/pt"
```

---

### Task 5: Queue builder

**Files:**
- Create: `src/domain/interview/queue.ts`
- Test: `src/domain/interview/queue.test.ts`

**Interfaces:**
- Consumes: `deriveKnownFacts` (Task 2), `QUESTION_BANK` (Task 4), types (Task 2).
- Produces: `MAX_UPCOMING = 25`; `buildQueue(ctx: InterviewContext, bank?: readonly QuestionDef[]): QueueItem[]`, ordered as answered/skipped items in `visited` order, then upcoming items by stage → boost → priority → id; `nextUpcomingId(queue: QueueItem[], excludeId?: string | null): string | null`.

- [ ] **Step 1: Write the failing tests** `src/domain/interview/queue.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildQueue, nextUpcomingId, MAX_UPCOMING } from './queue';
import { QUESTION_BANK } from './bank';
import type { CandidateSummary, InterviewContext, QuestionDef } from './types';
import { EMPTY_PREP } from './types';

function ctx(over: Partial<InterviewContext> = {}): InterviewContext {
    return { prep: { ...EMPTY_PREP, name: 'Juan Pérez' }, answers: {}, visited: [], custom: [], candidates: [], ...over };
}
const cand = (id: string, over: Partial<CandidateSummary> = {}): CandidateSummary => ({
    adopterId: id, displayName: id, relevancePercent: 60, avgRating: null, adoptionCount: 0, canEdit: false,
    stored: [], visible: {}, ...over,
});
const ids = (q: ReturnType<typeof buildQueue>) => q.map(i => i.id);
const upcoming = (q: ReturnType<typeof buildQueue>) => q.filter(i => i.state === 'upcoming').map(i => i.id);

describe('buildQueue', () => {
    it('starts with rapport, then story, then details, and caps the upcoming list', () => {
        const q = buildQueue(ctx());
        const stages = q.map(i => i.stage);
        expect(stages.indexOf('story')).toBeGreaterThan(stages.lastIndexOf('rapport'));
        expect(stages.indexOf('details')).toBeGreaterThan(stages.lastIndexOf('story'));
        expect(upcoming(q).length).toBeLessThanOrEqual(MAX_UPCOMING);
        expect(q[0].id).toBe('rapport_good_time');
    });

    it('drops questions whose facts the prep already gave', () => {
        const q = buildQueue(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'], address: 'Calle 1' } }));
        expect(ids(q)).not.toContain('rapport_phone');
        expect(ids(q)).not.toContain('story_address');
        expect(ids(q)).not.toContain('rapport_area'); // only asked when the address is unknown
    });

    it('verification-only questions exist only when a candidate holds that fact', () => {
        expect(ids(buildQueue(ctx()))).not.toContain('details_other_phones');
        const q = buildQueue(ctx({ candidates: [cand('a1', { stored: ['phones'] })] }));
        const item = q.find(i => i.id === 'details_other_phones')!;
        expect(item.verify).toEqual({ fact: 'phones', candidateIds: ['a1'] });
        expect(item.added?.reasonKey).toBe('interview.reason.verify');
    });

    it('with unconfirmed candidates, dedup questions lead their stage', () => {
        const q = buildQueue(ctx({ candidates: [cand('a1')] }));
        const rapport = upcoming(q).filter(id => id.startsWith('rapport_'));
        const firstNonDedup = rapport.findIndex(id => !QUESTION_BANK.find(b => b.id === id)!.dedup);
        const lastDedup = rapport.map(id => !!QUESTION_BANK.find(b => b.id === id)!.dedup).lastIndexOf(true);
        expect(lastDedup).toBeLessThan(firstNonDedup);
    });

    it('a confirmed profile verifies only against itself', () => {
        const q = buildQueue(ctx({
            confirmedAdopterId: 'a1',
            candidates: [cand('a1', { stored: ['phones'] }), cand('a2', { stored: ['phones'] })],
        }));
        expect(q.find(i => i.id === 'details_other_phones')!.verify!.candidateIds).toEqual(['a1']);
    });

    it('follow-ups appear only after a matching answer, marked with their parent', () => {
        expect(ids(buildQueue(ctx()))).not.toContain('details_pet_what_happened');
        const q = buildQueue(ctx({
            answers: { story_pets_past: { status: 'answered', text: 'Tuve un perro que se escapó' } },
            visited: ['story_pets_past'],
        }));
        const item = q.find(i => i.id === 'details_pet_what_happened')!;
        expect(item.added).toEqual({ reasonKey: 'interview.reason.followup', parentId: 'story_pets_past' });
    });

    it('a rented home brings the landlord question; owning does not', () => {
        const rent = buildQueue(ctx({ answers: { story_tenure: { status: 'answered', choice: 'rent' } }, visited: ['story_tenure'] }));
        const own = buildQueue(ctx({ answers: { story_tenure: { status: 'answered', choice: 'own' } }, visited: ['story_tenure'] }));
        expect(ids(rent)).toContain('details_landlord');
        expect(ids(own)).not.toContain('details_landlord');
    });

    it('answered items keep their place, in the order they were answered', () => {
        const q = buildQueue(ctx({
            answers: { story_home: { status: 'answered', text: 'Casa' }, rapport_work: { status: 'skipped' } },
            visited: ['story_home', 'rapport_work'],
        }));
        expect(q.slice(0, 2).map(i => [i.id, i.state])).toEqual([['story_home', 'answered'], ['rapport_work', 'skipped']]);
    });

    it('custom questions lead the upcoming items of their stage until answered', () => {
        const q = buildQueue(ctx({ custom: [{ id: 'custom:1', stage: 'rapport', text: '¿Tenés auto?' }] }));
        expect(upcoming(q)[0]).toBe('custom:1');
        expect(q.find(i => i.id === 'custom:1')!.added?.reasonKey).toBe('interview.reason.custom');
    });

    it('is deterministic for the same input', () => {
        const c = ctx({ candidates: [cand('a1', { stored: ['phones', 'emails'] })] });
        expect(buildQueue(c)).toEqual(buildQueue(c));
    });

    it('never trims rapport questions to make room (later stages give way first)', () => {
        const q = buildQueue(ctx());
        const rapportBank = QUESTION_BANK.filter(b => b.stage === 'rapport' && !b.verifies && !b.followUpOf).map(b => b.id);
        for (const id of rapportBank) expect(ids(q)).toContain(id);
    });

    it('when trimming to the cap, keeps follow-ups and drops the highest-priority-number items first', () => {
        const bank: QuestionDef[] = Array.from({ length: 30 }, (_, i) => ({ id: `q${String(i).padStart(2, '0')}`, stage: 'details', kind: 'text', priority: i, fills: [] }));
        bank.push({ id: 'fu', stage: 'details', kind: 'text', priority: 99, fills: [], followUpOf: { parents: ['q00'], test: () => true } });
        const q = buildQueue(ctx({ answers: { q00: { status: 'answered', text: 'x' } }, visited: ['q00'] }), bank);
        const up = upcoming(q);
        expect(up).toHaveLength(MAX_UPCOMING);
        expect(up).toContain('fu');
        expect(up).not.toContain('q29');
    });
});

describe('nextUpcomingId', () => {
    it('returns the first upcoming item other than the current one', () => {
        const q = buildQueue(ctx());
        const first = nextUpcomingId(q);
        expect(first).toBe('rapport_good_time');
        expect(nextUpcomingId(q, first)).not.toBe(first);
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/domain/interview/queue.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `queue.ts`**

```ts
/**
 * Builds the interview's question list (spec §4.2). Pure and deterministic:
 * the client calls it on every change and the read-only view calls it again
 * later, with the same result.
 */
import { QUESTION_BANK } from './bank';
import { deriveKnownFacts } from './facts';
import type { InterviewContext, QuestionDef, QueueItem, Stage } from './types';

export const MAX_UPCOMING = 25;
const STAGE_INDEX: Record<Stage, number> = { rapport: 0, story: 1, details: 2 };

type Ranked = QueueItem & { boost: number; priority: number };

export function buildQueue(ctx: InterviewContext, bank: readonly QuestionDef[] = QUESTION_BANK): QueueItem[] {
    const known = deriveKnownFacts(ctx, bank);
    const byId = new Map(bank.map(q => [q.id, q]));
    const customById = new Map(ctx.custom.map(c => [c.id, c]));
    const unconfirmed = !ctx.confirmedAdopterId && ctx.candidates.length > 0;
    const pool = ctx.confirmedAdopterId
        ? ctx.candidates.filter(c => c.adopterId === ctx.confirmedAdopterId)
        : ctx.candidates;

    const locked: QueueItem[] = [];
    for (const id of ctx.visited) {
        const status = ctx.answers[id]?.status;
        const q = byId.get(id);
        const c = customById.get(id);
        if (!status || (!q && !c)) continue;
        locked.push(c
            ? { id, stage: c.stage, state: status, added: { reasonKey: 'interview.reason.custom' } }
            : { id, stage: q!.stage, state: status });
    }

    const upcoming: Ranked[] = [];
    for (const c of ctx.custom) {
        if (ctx.answers[c.id]) continue;
        upcoming.push({ id: c.id, stage: c.stage, state: 'upcoming', added: { reasonKey: 'interview.reason.custom' }, boost: -1, priority: 0 });
    }
    for (const q of bank) {
        if (ctx.answers[q.id]) continue;
        let added: QueueItem['added'];
        if (q.followUpOf) {
            const parent = q.followUpOf.parents.find(p => {
                const a = ctx.answers[p];
                return a?.status === 'answered' && q.followUpOf!.test(a);
            });
            if (!parent) continue;
            added = { reasonKey: 'interview.reason.followup', parentId: parent };
        }
        if (q.when && !q.when(known, ctx)) continue;
        if (q.fills.length > 0 && q.fills.every(f => known.filled.includes(f))) continue;
        let verify: QueueItem['verify'];
        if (q.verifies) {
            const candidateIds = pool.filter(c => c.stored.includes(q.verifies!)).map(c => c.adopterId);
            if (candidateIds.length) {
                verify = { fact: q.verifies, candidateIds };
                if (!added && q.fills.length === 0) added = { reasonKey: 'interview.reason.verify' };
            } else if (q.fills.length === 0) {
                continue; // exists only to verify, and there is nothing to verify against
            }
        }
        const dedup = q.dedup === true || (q.discriminates?.(ctx.candidates) ?? false);
        upcoming.push({
            id: q.id, stage: q.stage, state: 'upcoming',
            ...(added ? { added } : {}), ...(verify ? { verify } : {}),
            boost: unconfirmed && dedup ? 0 : 1, priority: q.priority,
        });
    }

    let kept = upcoming;
    if (kept.length > MAX_UPCOMING) {
        const droppable = kept
            .filter(i => !i.added && i.boost === 1)
            // Priorities are per stage, so compare stage first: later stages give way first.
            .sort((a, b) => STAGE_INDEX[b.stage] - STAGE_INDEX[a.stage] || b.priority - a.priority || b.id.localeCompare(a.id));
        const drop = new Set(droppable.slice(0, kept.length - MAX_UPCOMING).map(i => i.id));
        kept = kept.filter(i => !drop.has(i.id));
    }
    kept.sort((a, b) =>
        STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage] || a.boost - b.boost || a.priority - b.priority || a.id.localeCompare(b.id));

    return [...locked, ...kept.map(({ boost: _b, priority: _p, ...item }) => item)];
}

export function nextUpcomingId(queue: QueueItem[], excludeId: string | null = null): string | null {
    return queue.find(i => i.state === 'upcoming' && i.id !== excludeId)?.id ?? null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/domain/interview/`
Expected: PASS (all domain tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/interview/queue.ts src/domain/interview/queue.test.ts
git commit -m "feat(interview): deterministic adaptive question queue"
```

---

### Task 6: `interviews` table, server helpers, candidate summaries

**Files:**
- Create: `drizzle/0079_interviews.sql`
- Modify: `src/db/schema.ts` (append the table after `pendingSearches`)
- Create: `src/lib/interviews/candidates.ts`
- Create: `src/lib/interviews/store.ts`
- Create: `src/lib/interviews/validation.ts`
- Test: `src/lib/interviews/candidates.test.ts`, `src/lib/interviews/validation.test.ts`

**Interfaces:**
- Consumes: domain types (Task 2), `DiscoveryMatch` (`src/app/actions/types.ts`), `hydrateDuplicateMatches`, `findFormDuplicates`, `deserializeContactEntries` / `parseBlobToContactEntries` (`src/lib/contactEntries.ts`).
- Produces:
  - `interviews` (Drizzle table).
  - `toCandidateSummary(m: DiscoveryMatch, opts: { viewerIsAdmin: boolean }): CandidateSummary`
  - `storedFactValues(row: { contactEntries: string | null; contactInfo: string | null; addressInfo: string | null }, fact: VerifiableFact): string[]`
  - `InterviewState`, `parseInterviewRow(row): InterviewState`, `loadInterview(db, id): Promise<InterviewState | null>`, `contextFor(state, candidates): InterviewContext`
  - `matchCandidates(known: KnownFacts, viewerIsAdmin: boolean): Promise<CandidateSummary[]>`
  - `hydrateCandidates(db, ids: string[], viewer: string, viewerIsAdmin: boolean): Promise<CandidateSummary[]>`
  - `mergeCandidates(fresh: CandidateSummary[], stored: CandidateSummary[]): CandidateSummary[]`
  - Zod schemas: `prepSchema`, `draftPatchSchema`, `completeInputSchema`, and the types `DraftPatch` and `CompleteInput`.

- [ ] **Step 1: Write the migration** `drizzle/0079_interviews.sql`

The test-DB loader splits on `;` and strips `--` comments, so no semicolons or `--` inside the SQL text.

```sql
-- Interview guide (spec .agents/plans/interview-guide.md section 5.1).
-- One row per phone interview. Drafts autosave here; on completion adopter_id
-- and event_id (the observation row) are set and status flips last.
CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    conducted_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source_kind TEXT NOT NULL,
    source_id TEXT,
    prep_json TEXT,
    answers_json TEXT,
    candidate_ids_json TEXT,
    adopter_id TEXT,
    event_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interviews_drafts ON interviews (conducted_by, status);
CREATE INDEX IF NOT EXISTS idx_interviews_adopter ON interviews (adopter_id);
CREATE INDEX IF NOT EXISTS idx_interviews_event ON interviews (event_id);
```

- [ ] **Step 2: Add the Drizzle table** to `src/db/schema.ts` (after `pendingSearches`)

```ts
// Interview guide (ENABLE_INTERVIEW_GUIDE). prep_json = { prep, leadCandidateId,
// confirmedAdopterId }; answers_json = { answers, visited, custom }. The question
// queue is NOT stored: it is buildQueue() of this state. See
// .agents/plans/interview-guide.md §5.
export const interviews = sqliteTable("interviews", {
    id: text("id").primaryKey(),
    conductedBy: text("conducted_by").notNull(),
    /** 'draft' | 'completed' | 'discarded' */
    status: text("status").notNull().default('draft'),
    /** 'standalone' | 'profile' (Phase 2: 'form' | 'animal') */
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id"),
    prepJson: text("prep_json"),
    answersJson: text("answers_json"),
    candidateIdsJson: text("candidate_ids_json"),
    adopterId: text("adopter_id"),
    eventId: text("event_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => ({
    draftsIdx: index("idx_interviews_drafts").on(table.conductedBy, table.status),
    adopterIdx: index("idx_interviews_adopter").on(table.adopterId),
    eventIdx: index("idx_interviews_event").on(table.eventId),
}));
```

Apply locally so `next dev` sees it (`setup-test-db.js` replays drizzle/*.sql for e2e). Run: `npx wrangler d1 execute DB --local --file=drizzle/0079_interviews.sql`
Expected: success. (`local.db` and `.wrangler` change; do **not** stage them.)

- [ ] **Step 3: Write the failing tests**

`src/lib/interviews/candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCandidateSummary, storedFactValues } from './candidates';
import type { DiscoveryMatch } from '@/app/actions/types';

function match(over: Partial<DiscoveryMatch> & { adopter?: Partial<DiscoveryMatch['adopter']> } = {}): DiscoveryMatch {
    const { adopter, ...rest } = over;
    return {
        adopterId: 'a1', adopterName: 'Juan Pérez (raw)', relevancePercent: 72, matchTypes: ['name'], matchValues: [], source: 'token',
        ownership: undefined, matchSnippet: null, contactProtected: false, visibilityBadge: null, avgRating: 4,
        thumbnail: null, stats: { searchHits: 0, profileViews: 0, requests: 0, adoptions: 2 }, flags: {} as DiscoveryMatch['flags'],
        adopter: { id: 'a1', name: 'Juan Pérez', contactInfo: null, contactEntries: null, addressInfo: null, ...adopter } as DiscoveryMatch['adopter'],
        ...rest,
    } as DiscoveryMatch;
}

describe('toCandidateSummary', () => {
    it('an unprotected profile exposes its values to the viewer', () => {
        const s = toCandidateSummary(match({ adopter: {
            contactEntries: JSON.stringify([{ type: 'phone', value: '+5491165851333' }, { type: 'email', value: 'j@x.com' }]),
            addressInfo: 'Rivadavia 4500',
        } }), { viewerIsAdmin: false });
        expect(s.stored.sort()).toEqual(['address', 'emails', 'phones']);
        expect(s.visible.phones).toEqual(['+5491165851333']);
        expect(s.visible.address).toEqual(['Rivadavia 4500']);
        expect(s.displayName).toBe('Juan Pérez');
        expect(s.adoptionCount).toBe(2);
    });

    it('a protected profile: masked entries are stored-but-invisible, the masked address is never visible', () => {
        const s = toCandidateSummary(match({ contactProtected: true, adopter: {
            contactEntries: JSON.stringify([{ type: 'phone', value: '11••••1333', masked: true }, { type: 'social', value: '@juanp' }]),
            addressInfo: 'Riv••••',
        } }), { viewerIsAdmin: false });
        expect(s.stored.sort()).toEqual(['address', 'phones', 'socials']);
        expect(s.visible.phones).toBeUndefined();
        expect(s.visible.address).toBeUndefined();
        expect(s.visible.socials).toEqual(['@juanp']); // unlocked entry (not masked)
    });

    it('a protected profile never falls back to parsing the masked contactInfo blob', () => {
        const s = toCandidateSummary(match({ contactProtected: true, adopter: { contactEntries: null, contactInfo: 'Tel: 11••••1333' } }), { viewerIsAdmin: false });
        expect(s.visible).toEqual({});
    });

    it('canEdit for own/team profiles and admins only', () => {
        expect(toCandidateSummary(match({ ownership: 'mine' }), { viewerIsAdmin: false }).canEdit).toBe(true);
        expect(toCandidateSummary(match({ ownership: 'team' }), { viewerIsAdmin: false }).canEdit).toBe(true);
        expect(toCandidateSummary(match(), { viewerIsAdmin: true }).canEdit).toBe(true);
        expect(toCandidateSummary(match(), { viewerIsAdmin: false }).canEdit).toBe(false);
    });
});

describe('storedFactValues (raw row, server-only)', () => {
    it('reads structured entries, falling back to the blob, plus addressInfo', () => {
        const row = { contactEntries: null, contactInfo: 'Tel: 11 6585-1333', addressInfo: 'Rivadavia 4500' };
        expect(storedFactValues(row, 'phones')).toHaveLength(1); // parsed from the blob
        expect(storedFactValues(row, 'address')).toEqual(['Rivadavia 4500']);
    });
});
```

`src/lib/interviews/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { draftPatchSchema, prepSchema, completeInputSchema } from './validation';

describe('interview validation caps', () => {
    it('refuses oversized answers and payloads', () => {
        const huge = 'x'.repeat(4001);
        expect(draftPatchSchema.safeParse({ answers: { rapport_work: { status: 'answered', text: huge } }, visited: [], custom: [], leadCandidateId: null }).success).toBe(false);
        const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`custom:${i}`, { status: 'skipped' }]));
        expect(draftPatchSchema.safeParse({ answers: many, visited: [], custom: [], leadCandidateId: null }).success).toBe(false);
    });
    it('accepts a normal draft', () => {
        expect(draftPatchSchema.safeParse({
            answers: { story_household: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] } },
            visited: ['story_household'], custom: [{ id: 'custom:1', stage: 'details', text: '¿Auto?' }], leadCandidateId: null,
        }).success).toBe(true);
    });
    it('prep needs a 2+ character name', () => {
        expect(prepSchema.safeParse({ name: 'J', phones: [], emails: [], socials: [], address: '' }).success).toBe(false);
    });
    it('complete input: rating 1-5 or null, target id or "new"', () => {
        expect(completeInputSchema.safeParse({ adopterId: 'new', additions: { contacts: [], address: null, household: [] }, rating: 6, summary: null }).success).toBe(false);
        expect(completeInputSchema.safeParse({ adopterId: 'new', additions: { contacts: [], address: null, household: [] }, rating: null, summary: 'ok' }).success).toBe(true);
    });
});
```

- [ ] **Step 4: Run and watch them fail**

Run: `npx vitest run src/lib/interviews/`
Expected: FAIL (modules missing).

- [ ] **Step 5: Implement**

`src/lib/interviews/validation.ts`:

```ts
import { z } from 'zod';
import type { Relationship } from '@/lib/householdMembers';

// Mirrors RELATIONSHIPS in src/lib/householdMembers.ts; `satisfies` fails tsc if they drift.
const REL = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate', 'unknown'] as const satisfies readonly Relationship[];

const text = z.string().max(4000);
const short = z.string().max(300);
const contact = z.object({ type: z.enum(['phone', 'email', 'social']), value: short });
const household = z.object({ name: z.string().max(120), relationship: z.enum(REL).nullable() });
const answer = z.object({
    status: z.enum(['answered', 'skipped', 'no_answer']),
    text: text.optional(),
    contacts: z.array(contact).max(20).optional(),
    household: z.array(household).max(30).optional(),
    choice: z.string().max(40).optional(),
    number: z.number().finite().min(0).max(1000).optional(),
});
const questionId = z.string().regex(/^(custom:\d{1,3}|[a-z_]{3,60})$/);

export const prepSchema = z.object({
    name: z.string().trim().min(2).max(200),
    phones: z.array(short).max(10),
    emails: z.array(short).max(10),
    socials: z.array(short).max(10),
    address: z.string().max(500),
});

export const draftPatchSchema = z.object({
    answers: z.record(questionId, answer).refine(r => Object.keys(r).length <= 200, 'too many answers'),
    visited: z.array(questionId).max(300),
    custom: z.array(z.object({ id: z.string().regex(/^custom:\d{1,3}$/), stage: z.enum(['rapport', 'story', 'details']), text: z.string().trim().min(1).max(500) })).max(30),
    leadCandidateId: z.string().max(64).nullable(),
});
export type DraftPatch = z.infer<typeof draftPatchSchema>;

export const completeInputSchema = z.object({
    adopterId: z.string().max(64),
    additions: z.object({
        contacts: z.array(contact).max(30),
        address: z.string().max(500).nullable(),
        household: z.array(household).max(30),
    }),
    rating: z.number().int().min(1).max(5).nullable(),
    summary: z.string().max(2000).nullable(),
});
export type CompleteInput = z.infer<typeof completeInputSchema>;
```

`src/lib/interviews/candidates.ts`:

```ts
/**
 * Candidate summaries for the interview UI. Built ONLY from the masked
 * DiscoveryMatch that findFormDuplicates / hydrateDuplicateMatches return,
 * so a protected value never reaches the browser (spec §4.4). A masked
 * blob is never parsed (it would look like real values).
 */
import type { DiscoveryMatch } from '@/app/actions/types';
import { deserializeContactEntries, parseBlobToContactEntries, type ContactEntry } from '@/lib/contactEntries';
import type { CandidateSummary, VerifiableFact } from '@/domain/interview/types';

const ENTRY_FACT: Partial<Record<ContactEntry['type'], VerifiableFact>> = { phone: 'phones', email: 'emails', social: 'socials', address: 'address' };

export function toCandidateSummary(m: DiscoveryMatch, opts: { viewerIsAdmin: boolean }): CandidateSummary {
    const a = m.adopter;
    let entries = deserializeContactEntries(a.contactEntries);
    if (!entries.length && !m.contactProtected && a.contactInfo) entries = parseBlobToContactEntries(a.contactInfo);

    const stored = new Set<VerifiableFact>();
    const visible: Partial<Record<VerifiableFact, string[]>> = {};
    for (const e of entries) {
        const f = ENTRY_FACT[e.type];
        if (!f) continue;
        stored.add(f);
        if (!e.masked && !(f === 'address' && m.contactProtected)) (visible[f] ??= []).push(e.value);
    }
    if (a.addressInfo && a.addressInfo.trim()) {
        stored.add('address');
        if (!m.contactProtected) (visible.address ??= []).push(a.addressInfo.trim());
    }

    return {
        adopterId: m.adopterId,
        displayName: a.name || '',
        relevancePercent: m.relevancePercent,
        avgRating: m.avgRating,
        adoptionCount: m.stats?.adoptions ?? 0,
        canEdit: opts.viewerIsAdmin || m.ownership === 'mine' || m.ownership === 'team',
        stored: [...stored].sort(),
        visible,
    };
}

/** Raw profile values for a fact. SERVER-ONLY: the result must never be returned to a client. */
export function storedFactValues(
    row: { contactEntries: string | null; contactInfo: string | null; addressInfo: string | null },
    fact: VerifiableFact,
): string[] {
    let entries = deserializeContactEntries(row.contactEntries);
    if (!entries.length && row.contactInfo) entries = parseBlobToContactEntries(row.contactInfo);
    const values = entries.filter(e => ENTRY_FACT[e.type] === fact).map(e => e.value);
    if (fact === 'address' && row.addressInfo?.trim()) values.push(row.addressInfo.trim());
    return values;
}
```

`src/lib/interviews/store.ts`:

```ts
/**
 * Interview persistence + candidate plumbing. Not 'use server': these are
 * trusted helpers that the actions in src/app/actions/interviews.ts call
 * after their own session/flag/ownership checks.
 */
import { eq } from 'drizzle-orm';
import { interviews } from '@/db/schema';
import { findFormDuplicates } from '@/app/actions/findFormDuplicates';
import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import type { DuplicateMatch } from '@/app/actions/types';
import type { Answer, CandidateSummary, CustomQuestion, InterviewContext, KnownFacts, PrepFacts } from '@/domain/interview/types';
import { EMPTY_PREP } from '@/domain/interview/types';
import { toCandidateSummary } from './candidates';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Db handle type the other action helpers take
type Db = any;

export interface InterviewState {
    id: string;
    conductedBy: string;
    status: 'draft' | 'completed' | 'discarded';
    sourceKind: 'standalone' | 'profile';
    sourceId: string | null;
    prep: PrepFacts;
    leadCandidateId: string | null;
    confirmedAdopterId: string | null;
    answers: Record<string, Answer>;
    visited: string[];
    custom: CustomQuestion[];
    candidateIds: string[];
    adopterId: string | null;
    eventId: string | null;
    updatedAt: Date | null;
    completedAt: Date | null;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; } // corrupt JSON → empty state; the row id is logged by callers
}

export function parseInterviewRow(row: typeof interviews.$inferSelect): InterviewState {
    const prepBlob = parseJson<{ prep?: PrepFacts; leadCandidateId?: string | null; confirmedAdopterId?: string | null }>(row.prepJson, {});
    const ans = parseJson<{ answers?: Record<string, Answer>; visited?: string[]; custom?: CustomQuestion[] }>(row.answersJson, {});
    return {
        id: row.id,
        conductedBy: row.conductedBy,
        status: row.status as InterviewState['status'],
        sourceKind: row.sourceKind as InterviewState['sourceKind'],
        sourceId: row.sourceId,
        prep: { ...EMPTY_PREP, ...prepBlob.prep },
        leadCandidateId: prepBlob.leadCandidateId ?? null,
        confirmedAdopterId: prepBlob.confirmedAdopterId ?? null,
        answers: ans.answers ?? {},
        visited: ans.visited ?? [],
        custom: ans.custom ?? [],
        candidateIds: parseJson<string[]>(row.candidateIdsJson, []),
        adopterId: row.adopterId,
        eventId: row.eventId,
        updatedAt: row.updatedAt ?? null,
        completedAt: row.completedAt ?? null,
    };
}

export async function loadInterview(db: Db, id: string): Promise<InterviewState | null> {
    const row = await db.select().from(interviews).where(eq(interviews.id, id)).get();
    return row ? parseInterviewRow(row) : null;
}

export function prepJson(s: Pick<InterviewState, 'prep' | 'leadCandidateId' | 'confirmedAdopterId'>): string {
    return JSON.stringify({ prep: s.prep, leadCandidateId: s.leadCandidateId, confirmedAdopterId: s.confirmedAdopterId });
}
export function answersJson(s: Pick<InterviewState, 'answers' | 'visited' | 'custom'>): string {
    return JSON.stringify({ answers: s.answers, visited: s.visited, custom: s.custom });
}

export function contextFor(s: InterviewState, candidates: CandidateSummary[]): InterviewContext {
    return {
        prep: s.prep, answers: s.answers, visited: s.visited, custom: s.custom, candidates,
        ...(s.confirmedAdopterId ? { confirmedAdopterId: s.confirmedAdopterId } : {}),
    };
}

/** Run the duplicate engine on what the interview knows (no address: D9). */
export async function matchCandidates(known: KnownFacts, viewerIsAdmin: boolean): Promise<CandidateSummary[]> {
    if (known.name.length < 2) return [];
    const { results } = await findFormDuplicates({ name: known.name, phones: known.phones, emails: known.emails, socials: known.socials });
    return results.filter(m => !m.adopter.deletedAt).map(m => toCandidateSummary(m, { viewerIsAdmin }));
}

/** Re-hydrate stored candidate ids through the same masked bridge. */
export async function hydrateCandidates(db: Db, ids: string[], viewer: string, viewerIsAdmin: boolean): Promise<CandidateSummary[]> {
    if (!ids.length) return [];
    const stubs: DuplicateMatch[] = ids.map(adopterId => ({ adopterId, adopterName: '', relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token' }));
    const hydrated = await hydrateDuplicateMatches(db, stubs, { viewer, isUnauthenticated: false });
    return hydrated.filter(m => !m.adopter.deletedAt).map(m => toCandidateSummary(m, { viewerIsAdmin }));
}

/** Fresh results win (they carry relevance); stored ones that dropped out are kept. */
export function mergeCandidates(fresh: CandidateSummary[], stored: CandidateSummary[]): CandidateSummary[] {
    const seen = new Set(fresh.map(c => c.adopterId));
    return [...fresh, ...stored.filter(c => !seen.has(c.adopterId))];
}

```

If `DuplicateMatch` has more required fields than the stub above, `npx tsc --noEmit` reports them. Fill them with empty/neutral values (check `src/app/actions/types.ts`).

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run src/lib/interviews/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0079_interviews.sql src/db/schema.ts src/lib/interviews/candidates.ts src/lib/interviews/store.ts src/lib/interviews/validation.ts src/lib/interviews/candidates.test.ts src/lib/interviews/validation.test.ts
git commit -m "feat(interview): interviews table, masked candidate summaries, store helpers"
```

---

### Task 7: Draft-lifecycle server actions

**Files:**
- Create: `src/app/actions/interviewTypes.ts` (shared result/view types; not `'use server'`)
- Create: `src/app/actions/interviews.ts` (`'use server'`)
- Test: `src/app/actions/interviews.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers, `buildQueue`/`deriveKnownFacts`/`factMatches`/`canViewInterviewAnswers` (Tasks 2–5).
- Produces (client-callable):
  - `previewInterviewCandidates(prep: PrepFacts): Promise<ActionResult<{ candidates: CandidateSummary[] }>>`
  - `startInterview(input: { prep?: PrepFacts; leadCandidateId?: string | null; adopterId?: string }): Promise<ActionResult<{ interviewId: string; view: InterviewView }>>`
  - `saveInterviewDraft(interviewId: string, patch: DraftPatch): Promise<ActionResult<{ updatedAt: number }>>`
  - `refreshInterviewCandidates(interviewId: string): Promise<ActionResult<{ candidates: CandidateSummary[] }>>`
  - `getInterview(interviewId: string): Promise<ActionResult<{ view: InterviewView }>>`
  - `listMyInterviewDrafts(): Promise<ActionResult<{ drafts: DraftSummary[] }>>`
  - `verifyInterviewFact(interviewId: string, candidateId: string, fact: VerifiableFact): Promise<ActionResult<{ match: boolean }>>`
  - `discardInterviewDraft(interviewId: string): Promise<ActionResult<object>>`
  - `ActionResult<T> = ({ ok: true } & T) | { ok: false; error: InterviewError; errorId?: string }`, where `InterviewError = 'disabled' | 'not_found' | 'forbidden' | 'invalid' | 'generic'`.

- [ ] **Step 1: Write the shared types** `src/app/actions/interviewTypes.ts`

```ts
import type { Answer, CandidateSummary, CustomQuestion, PrepFacts } from '@/domain/interview/types';

export type InterviewError = 'disabled' | 'not_found' | 'forbidden' | 'invalid' | 'generic';
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: InterviewError; errorId?: string };

export interface InterviewView {
    id: string;
    status: 'draft' | 'completed' | 'discarded';
    sourceKind: 'standalone' | 'profile';
    prep: PrepFacts;
    leadCandidateId: string | null;
    confirmedAdopterId: string | null;
    answers: Record<string, Answer>;
    visited: string[];
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    adopterId: string | null;
    /** Display name of the interviewer (name, else email handle). */
    conductedByName: string;
    /** True only for the interviewer while it is a draft. */
    canEdit: boolean;
    completedAt: number | null;
}

export interface DraftSummary { id: string; name: string; answeredCount: number; updatedAt: number | null }
```

- [ ] **Step 2: Write the failing integration tests** `src/app/actions/interviews.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import type { CandidateSummary } from '@/domain/interview/types';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, flag: true, matches: [] as CandidateSummary[] } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => state.flag }));
vi.mock('@/app/actions/userNames', () => ({ resolveUserNames: async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]])) }));
vi.mock('@/lib/interviews/store', async (orig) => {
    const real = await orig<typeof import('@/lib/interviews/store')>();
    return {
        ...real,
        matchCandidates: vi.fn(async () => state.matches),
        hydrateCandidates: vi.fn(async (_db: unknown, ids: string[]) => state.matches.filter(m => ids.includes(m.adopterId))),
    };
});

import {
    previewInterviewCandidates, startInterview, saveInterviewDraft, refreshInterviewCandidates,
    getInterview, listMyInterviewDrafts, verifyInterviewFact, discardInterviewDraft,
} from './interviews';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const PREP = { name: 'Juan Pérez', phones: ['11 6585-1333'], emails: [], socials: [], address: '' };
const cand = (id: string, over: Partial<CandidateSummary> = {}): CandidateSummary => ({
    adopterId: id, displayName: 'Juan', relevancePercent: 70, avgRating: null, adoptionCount: 0, canEdit: false, stored: ['phones'], visible: {}, ...over,
});
const emptyPatch = { answers: {}, visited: [], custom: [], leadCandidateId: null };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    state.flag = true;
    state.matches = [];
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_entries, created_at, updated_at, deleted_at, is_demo)
        VALUES ('a1', 'Juan Pérez', '5', ?, ?, 1000, 1000, NULL, 0)`).run(STRANGER, JSON.stringify([{ type: 'phone', value: '+5491165851333' }]));
});

describe('interview actions — gate', () => {
    it('flag off: every action refuses with "disabled"', async () => {
        state.flag = false;
        expect(await previewInterviewCandidates(PREP)).toEqual({ ok: false, error: 'disabled' });
        expect(await startInterview({ prep: PREP })).toEqual({ ok: false, error: 'disabled' });
        expect(await listMyInterviewDrafts()).toEqual({ ok: false, error: 'disabled' });
    });
    it('signed out: refused', async () => {
        session.user = null;
        const r = await startInterview({ prep: PREP });
        expect(r.ok).toBe(false);
    });
});

describe('startInterview / drafts', () => {
    it('records the server-side match as candidates and keeps a valid lead', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ prep: PREP, leadCandidateId: 'a1' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const row = sqlite.prepare('SELECT * FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(JSON.parse(row.candidate_ids_json as string)).toEqual(['a1']);
        expect(r.view.leadCandidateId).toBe('a1');
        expect(row.conducted_by).toBe(OWNER);
    });

    it('a lead the server did not find is dropped (no forged candidates)', async () => {
        state.matches = [];
        const r = await startInterview({ prep: PREP, leadCandidateId: 'a1' });
        expect(r.ok && r.view.leadCandidateId).toBe(null);
    });

    it('from a profile: starts confirmed on that profile', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ adopterId: 'a1' });
        expect(r.ok && r.view.confirmedAdopterId).toBe('a1');
        expect(r.ok && r.view.sourceKind).toBe('profile');
    });

    it('only the interviewer can save, read or discard a draft', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        session.user = MATE;
        expect(await saveInterviewDraft(r.interviewId, emptyPatch)).toEqual({ ok: false, error: 'forbidden' });
        expect((await getInterview(r.interviewId)).ok).toBe(false);
        expect(await discardInterviewDraft(r.interviewId)).toEqual({ ok: false, error: 'forbidden' });
    });

    it('saves answers; refuses invalid payloads; never revives a completed interview', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        const ok = await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'Enfermera' } }, visited: ['rapport_work'] });
        expect(ok.ok).toBe(true);
        expect((await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'x'.repeat(5000) } } } as never))).toEqual({ ok: false, error: 'invalid' });
        sqlite.prepare(`UPDATE interviews SET status = 'completed' WHERE id = ?`).run(r.interviewId);
        expect(await saveInterviewDraft(r.interviewId, emptyPatch)).toEqual({ ok: false, error: 'invalid' });
        const row = sqlite.prepare('SELECT status FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(row.status).toBe('completed');
    });

    it('lists only my open drafts with answered counts', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'x' } }, visited: ['rapport_work'] });
        session.user = MATE;
        await startInterview({ prep: { ...PREP, name: 'Otra Persona' } });
        session.user = OWNER;
        const l = await listMyInterviewDrafts();
        expect(l.ok && l.drafts.map(d => [d.name, d.answeredCount])).toEqual([['Juan Pérez', 1]]);
    });
});

describe('refreshInterviewCandidates / verifyInterviewFact', () => {
    it('refresh unions newly matched ids into the stored candidates', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        state.matches = [cand('a1')];
        const f = await refreshInterviewCandidates(r.interviewId);
        expect(f.ok && f.candidates.map(c => c.adopterId)).toEqual(['a1']);
        const row = sqlite.prepare('SELECT candidate_ids_json FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(JSON.parse(row.candidate_ids_json as string)).toEqual(['a1']);
    });

    it('verify compares the STORED answers with the raw profile and returns only a boolean', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ prep: { ...PREP, phones: [] } });
        if (!r.ok) throw new Error('start failed');
        await saveInterviewDraft(r.interviewId, { ...emptyPatch,
            answers: { rapport_phone: { status: 'answered', contacts: [{ type: 'phone', value: '11 6585-1333' }] } }, visited: ['rapport_phone'] });
        const v = await verifyInterviewFact(r.interviewId, 'a1', 'phones');
        expect(v).toEqual({ ok: true, match: true });
        expect(Object.keys(v)).toEqual(['ok', 'match']);
    });

    it('verify refuses a profile that is not one of this interview’s candidates', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        expect(await verifyInterviewFact(r.interviewId, 'a1', 'phones')).toEqual({ ok: false, error: 'forbidden' });
    });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/app/actions/interviews.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/app/actions/interviews.ts`**

```ts
'use server';

/**
 * Interview guide actions (spec .agents/plans/interview-guide.md §6).
 * Every export: session required, ENABLE_INTERVIEW_GUIDE on, and drafts are
 * the interviewer's alone. Logs carry ids and counts only — never answers,
 * prep facts or identifiers.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { adopters, interviews } from '@/db/schema';
import { deriveKnownFacts } from '@/domain/interview/facts';
import { factMatches } from '@/domain/interview/verify';
import { canViewInterviewAnswers } from '@/domain/interview/access';
import { QUESTION_BANK } from '@/domain/interview/bank';
import type { CandidateSummary, PrepFacts, VerifiableFact } from '@/domain/interview/types';
import { VERIFIABLE_FACTS } from '@/domain/interview/types';
import { storedFactValues } from '@/lib/interviews/candidates';
import {
    answersJson, contextFor, hydrateCandidates, loadInterview, matchCandidates, mergeCandidates, parseInterviewRow, prepJson,
    type InterviewState,
} from '@/lib/interviews/store';
import { draftPatchSchema, prepSchema, type DraftPatch } from '@/lib/interviews/validation';
import type { ActionResult, DraftSummary, InterviewView } from './interviewTypes';

class Refusal extends Error {
    constructor(public code: 'disabled' | 'not_found' | 'forbidden' | 'invalid') { super(code); }
}

async function gate(): Promise<{ actor: string; actorIsAdmin: boolean }> {
    if (!(await getFeatureFlag('ENABLE_INTERVIEW_GUIDE'))) throw new Refusal('disabled');
    const actor = await getUser();
    const { isAdminAsync } = await import('@/config/admins');
    return { actor, actorIsAdmin: await isAdminAsync(actor) };
}

function refuse<T>(e: unknown, op: string, ctx: Record<string, unknown>): ActionResult<T> {
    if (e instanceof Refusal) return { ok: false, error: e.code };
    if (e instanceof Error && e.message === 'Authentication required') return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'generic', errorId: logger.error(`interviews.${op} failed`, e, ctx) };
}

async function ownDraft(db: unknown, id: string, actor: string): Promise<InterviewState> {
    const s = await loadInterview(db, id);
    if (!s) throw new Refusal('not_found');
    if (s.conductedBy !== actor) throw new Refusal('forbidden');
    if (s.status !== 'draft') throw new Refusal('invalid');
    return s;
}

async function conductorName(email: string): Promise<string> {
    try {
        const { resolveUserNames } = await import('./userNames');
        const map = await resolveUserNames([email]);
        return map[email] || email.split('@')[0];
    } catch (e) {
        logger.warn('interviews.conductorName: name lookup fell back to handle', { error: e instanceof Error ? e.message : String(e) });
        return email.split('@')[0];
    }
}

async function toView(s: InterviewState, candidates: CandidateSummary[], canEdit: boolean): Promise<InterviewView> {
    return {
        id: s.id, status: s.status, sourceKind: s.sourceKind, prep: s.prep,
        leadCandidateId: s.leadCandidateId, confirmedAdopterId: s.confirmedAdopterId,
        answers: s.answers, visited: s.visited, custom: s.custom, candidates,
        adopterId: s.adopterId, conductedByName: await conductorName(s.conductedBy), canEdit,
        completedAt: s.completedAt ? Math.floor(s.completedAt.getTime() / 1000) : null,
    };
}

export async function previewInterviewCandidates(prep: PrepFacts): Promise<ActionResult<{ candidates: CandidateSummary[] }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const parsed = prepSchema.safeParse(prep);
        if (!parsed.success) return { ok: true, candidates: [] };
        const known = deriveKnownFacts({ prep: parsed.data, answers: {}, visited: [], custom: [], candidates: [] }, QUESTION_BANK);
        return { ok: true, candidates: await matchCandidates(known, g.actorIsAdmin) };
    } catch (e) {
        return refuse(e, 'preview', { actor });
    }
}

export async function startInterview(input: { prep?: PrepFacts; leadCandidateId?: string | null; adopterId?: string }): Promise<ActionResult<{ interviewId: string; view: InterviewView }>> {
    let actor: string | undefined;
    const adopterId = input?.adopterId ? String(input.adopterId).slice(0, 64) : undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const id = crypto.randomUUID();
        let state: InterviewState;
        let candidates: CandidateSummary[];

        if (adopterId) {
            candidates = await hydrateCandidates(db, [adopterId], actor, g.actorIsAdmin);
            if (!candidates.length) throw new Refusal('not_found');
            state = {
                id, conductedBy: actor, status: 'draft', sourceKind: 'profile', sourceId: adopterId,
                prep: { name: candidates[0].displayName, phones: [], emails: [], socials: [], address: '' },
                leadCandidateId: adopterId, confirmedAdopterId: adopterId,
                answers: {}, visited: [], custom: [], candidateIds: [adopterId],
                adopterId: null, eventId: null, updatedAt: null, completedAt: null,
            };
        } else {
            const parsed = prepSchema.safeParse(input?.prep);
            if (!parsed.success) throw new Refusal('invalid');
            const known = deriveKnownFacts({ prep: parsed.data, answers: {}, visited: [], custom: [], candidates: [] }, QUESTION_BANK);
            candidates = await matchCandidates(known, g.actorIsAdmin);
            const ids = candidates.map(c => c.adopterId);
            const lead = input.leadCandidateId && ids.includes(input.leadCandidateId) ? input.leadCandidateId : null;
            state = {
                id, conductedBy: actor, status: 'draft', sourceKind: 'standalone', sourceId: null,
                prep: parsed.data, leadCandidateId: lead, confirmedAdopterId: null,
                answers: {}, visited: [], custom: [], candidateIds: ids,
                adopterId: null, eventId: null, updatedAt: null, completedAt: null,
            };
        }

        await db.insert(interviews).values({
            id, conductedBy: actor, status: 'draft', sourceKind: state.sourceKind, sourceId: state.sourceId,
            prepJson: prepJson(state), answersJson: answersJson(state), candidateIdsJson: JSON.stringify(state.candidateIds),
            createdAt: new Date(), updatedAt: new Date(),
        });
        logger.info('interviews.start', { interviewId: id, actor, sourceKind: state.sourceKind, candidateCount: candidates.length });
        return { ok: true, interviewId: id, view: await toView(state, candidates, true) };
    } catch (e) {
        return refuse(e, 'start', { actor, adopterId });
    }
}

export async function saveInterviewDraft(interviewId: string, patch: DraftPatch): Promise<ActionResult<{ updatedAt: number }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const parsed = draftPatchSchema.safeParse(patch);
        if (!parsed.success) throw new Refusal('invalid');
        const s = await ownDraft(db, String(interviewId), actor);
        const lead = parsed.data.leadCandidateId && s.candidateIds.includes(parsed.data.leadCandidateId) ? parsed.data.leadCandidateId : null;
        const now = new Date();
        await db.update(interviews).set({
            answersJson: answersJson(parsed.data),
            prepJson: prepJson({ ...s, leadCandidateId: lead }),
            updatedAt: now,
        }).where(and(eq(interviews.id, s.id), eq(interviews.status, 'draft')));
        return { ok: true, updatedAt: Math.floor(now.getTime() / 1000) };
    } catch (e) {
        return refuse(e, 'saveDraft', { actor, interviewId });
    }
}

export async function refreshInterviewCandidates(interviewId: string): Promise<ActionResult<{ candidates: CandidateSummary[] }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const [fresh, stored] = await Promise.all([
            s.confirmedAdopterId ? Promise.resolve([]) : matchCandidates(known, g.actorIsAdmin),
            hydrateCandidates(db, s.candidateIds, actor, g.actorIsAdmin),
        ]);
        const candidates = mergeCandidates(fresh, stored);
        const ids = [...new Set([...s.candidateIds, ...candidates.map(c => c.adopterId)])];
        if (ids.length !== s.candidateIds.length) {
            await db.update(interviews).set({ candidateIdsJson: JSON.stringify(ids), updatedAt: new Date() }).where(eq(interviews.id, s.id));
        }
        return { ok: true, candidates };
    } catch (e) {
        return refuse(e, 'refreshCandidates', { actor, interviewId });
    }
}

export async function getInterview(interviewId: string): Promise<ActionResult<{ view: InterviewView }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await loadInterview(db, String(interviewId));
        if (!s || s.status === 'discarded') throw new Refusal('not_found');
        if (s.status === 'draft') {
            if (s.conductedBy !== actor) throw new Refusal('forbidden');
            const candidates = await hydrateCandidates(db, s.candidateIds, actor, g.actorIsAdmin);
            return { ok: true, view: await toView(s, candidates, true) };
        }
        const owner = s.adopterId
            ? (await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, s.adopterId)).get())?.addedBy ?? null
            : null;
        const { isOrgMate } = await import('@/lib/orgMembership');
        const allowed = canViewInterviewAnswers({
            viewer: actor, conductedBy: s.conductedBy, ownerEmail: owner,
            viewerIsAdmin: g.actorIsAdmin, viewerIsOrgMate: owner ? await isOrgMate(actor, owner) : false,
        });
        if (!allowed) throw new Refusal('forbidden');
        return { ok: true, view: await toView(s, [], false) };
    } catch (e) {
        return refuse(e, 'get', { actor, interviewId });
    }
}

export async function listMyInterviewDrafts(): Promise<ActionResult<{ drafts: DraftSummary[] }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const rows = await db.select().from(interviews)
            .where(and(eq(interviews.conductedBy, actor), eq(interviews.status, 'draft')))
            .orderBy(desc(interviews.updatedAt)).limit(10).all();
        const drafts: DraftSummary[] = rows.map((row: typeof interviews.$inferSelect) => {
            const s = parseInterviewRow(row);
            return {
                id: s.id, name: s.prep.name,
                answeredCount: Object.values(s.answers).filter(a => a.status === 'answered').length,
                updatedAt: s.updatedAt ? Math.floor(s.updatedAt.getTime() / 1000) : null,
            };
        });
        return { ok: true, drafts };
    } catch (e) {
        return refuse(e, 'listDrafts', { actor });
    }
}

export async function verifyInterviewFact(interviewId: string, candidateId: string, fact: VerifiableFact): Promise<ActionResult<{ match: boolean }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        if (!VERIFIABLE_FACTS.includes(fact)) throw new Refusal('invalid');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        if (!s.candidateIds.includes(String(candidateId))) throw new Refusal('forbidden');
        const row = await db.select({ contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo, addressInfo: adopters.addressInfo })
            .from(adopters).where(eq(adopters.id, String(candidateId))).get();
        if (!row) throw new Refusal('not_found');
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const given = fact === 'address' ? (known.address ? [known.address] : []) : known[fact];
        return { ok: true, match: factMatches(fact, storedFactValues(row, fact), given) };
    } catch (e) {
        return refuse(e, 'verify', { actor, interviewId, candidateId, fact });
    }
}

export async function discardInterviewDraft(interviewId: string): Promise<ActionResult<object>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        await db.update(interviews).set({ status: 'discarded', updatedAt: new Date() }).where(eq(interviews.id, s.id));
        logger.info('interviews.discard', { interviewId: s.id, actor });
        return { ok: true };
    } catch (e) {
        return refuse(e, 'discard', { actor, interviewId });
    }
}
```

Notes for the implementer:
- `ownDraft` throws `invalid` for a completed draft. That is what makes the "never revives a completed interview" test pass.
- If `./userNames` exports a different function, adapt `conductorName`. It is imported by `src/app/adopter/[id]/page.tsx` as `resolveUserNames`. Run `grep -n "export" src/app/actions/userNames.ts` and update the mock in the test to match.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/app/actions/interviews.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole vitest suite** (catches the `serverActionSurface.test.ts` rule)

Run: `npm test`
Expected: PASS. If `serverActionSurface.test.ts` complains, a non-action helper was exported from `interviews.ts`. Make it non-exported or move it to `src/lib/interviews/`.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/interviewTypes.ts src/app/actions/interviews.ts src/app/actions/interviews.test.ts
git commit -m "feat(interview): draft lifecycle actions (start, autosave, candidates, verify, discard)"
```

---

### Task 8: `completeInterview`

**Files:**
- Create: `src/app/actions/interviewComplete.ts` (`'use server'`)
- Test: `src/app/actions/interviewComplete.test.ts`

**Interfaces:**
- Consumes: `saveAdopter`, `appendToExistingAdopter` (`./adopters`), `addHouseholdMember` (`./householdMembers`), `saveAdoption` (`./adoptions`), `buildContactEntries` (`@/lib/contactEntries`), store helpers (Task 6), `completeInputSchema`.
- Produces: `completeInterview(interviewId: string, input: CompleteInput): Promise<ActionResult<{ adopterId: string }>>`.

Order (spec §5.2), with status flipped last so any failure leaves a recoverable draft:
1. Gate and load the draft. A completed one returns its `adopterId` (idempotent).
2. Resolve the target:
   - `'new'`: reuse `s.adopterId` if a previous attempt already created it. Otherwise create via `saveAdopter` and **persist `adopter_id` immediately**.
   - An id: it must be in `candidateIds`. Persist `adopter_id`.
3. Additions (only values the interview actually collected; only when the actor may edit) go through `appendToExistingAdopter` / `addHouseholdMember`. A new profile is the actor's own, so it is always editable.
4. If `event_id` is null, `saveAdoption({ recordType: 'observation', … })` and persist `event_id`.
5. `status = 'completed'`, `completed_at = now`.

- [ ] **Step 1: Write the failing tests** `src/app/actions/interviewComplete.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';

const { state, calls } = vi.hoisted(() => ({
    state: { db: null as unknown, flag: true, failObservation: false },
    calls: { saveAdopter: [] as unknown[], append: [] as unknown[], household: [] as unknown[], saveAdoption: [] as unknown[] },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => state.flag }));
vi.mock('./adopters', () => ({
    saveAdopter: vi.fn(async (d: unknown) => { calls.saveAdopter.push(d); return { success: true, id: 'new-1' }; }),
    appendToExistingAdopter: vi.fn(async (id: string, f: unknown) => { calls.append.push([id, f]); return { success: true, adopterId: id }; }),
}));
vi.mock('./householdMembers', () => ({
    addHouseholdMember: vi.fn(async (i: unknown) => { calls.household.push(i); return { ok: true, memberId: 'm1' }; }),
}));
vi.mock('./adoptions', () => ({
    saveAdoption: vi.fn(async (d: unknown) => {
        if (state.failObservation) throw new Error('D1 down');
        calls.saveAdoption.push(d); return { success: true, id: 'ev-1' };
    }),
}));

import { completeInterview } from './interviewComplete';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

function seedDraft(over: { candidateIds?: string[]; answers?: unknown; prep?: unknown; conductedBy?: string } = {}) {
    sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, prep_json, answers_json, candidate_ids_json)
        VALUES ('i1', ?, 'draft', 'standalone', ?, ?, ?)`).run(
        over.conductedBy ?? OWNER,
        JSON.stringify({ prep: over.prep ?? { name: 'Juan Pérez', phones: ['1165851333'], emails: [], socials: [], address: '' }, leadCandidateId: null, confirmedAdopterId: null }),
        JSON.stringify({ answers: over.answers ?? {
            story_household: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] },
            details_email: { status: 'answered', contacts: [{ type: 'email', value: 'juan@x.com' }] },
        }, visited: ['story_household', 'details_email'], custom: [] }),
        JSON.stringify(over.candidateIds ?? ['a-owned', 'a-foreign']),
    );
}
const ADD = {
    contacts: [{ type: 'phone' as const, value: '1165851333' }, { type: 'email' as const, value: 'juan@x.com' }],
    address: null, household: [{ name: 'Ana', relationship: 'partner' as const }],
};

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db; sqlite = m.sqlite as unknown as Sqlite;
    state.flag = true; state.failObservation = false;
    for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = [];
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo) VALUES ('a-owned', 'Juan', '5', ?, 1, 1, NULL, 0)`).run(OWNER);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo) VALUES ('a-foreign', 'Juan', '5', ?, 1, 1, NULL, 0)`).run(STRANGER);
});

describe('completeInterview', () => {
    it('new person: creates the profile with collected contacts, adds household, writes the observation, completes', async () => {
        seedDraft();
        const r = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: 4, summary: 'Buena predisposición' });
        expect(r).toEqual({ ok: true, adopterId: 'new-1' });
        expect(JSON.parse((calls.saveAdopter[0] as { contactEntries: string }).contactEntries).map((e: { type: string }) => e.type).sort()).toEqual(['email', 'phone']);
        expect(calls.household).toEqual([{ adopterId: 'new-1', name: 'Ana', relationship: 'partner' }]);
        expect(calls.saveAdoption[0]).toMatchObject({ recordType: 'observation', adopterId: 'new-1', rating: 4, details: 'Buena predisposición' });
        const row = sqlite.prepare(`SELECT status, adopter_id, event_id FROM interviews WHERE id = 'i1'`).get()!;
        expect(row).toEqual({ status: 'completed', adopter_id: 'new-1', event_id: 'ev-1' });
    });

    it('a retry after a failed observation does not create a second profile', async () => {
        seedDraft();
        state.failObservation = true;
        const first = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null });
        expect(first.ok).toBe(false);
        expect(sqlite.prepare(`SELECT status, adopter_id FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'draft', adopter_id: 'new-1' });
        state.failObservation = false;
        const second = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null });
        expect(second).toEqual({ ok: true, adopterId: 'new-1' });
        expect(calls.saveAdopter).toHaveLength(1);
    });

    it('completing twice is idempotent', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        const again = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(again).toEqual({ ok: true, adopterId: 'a-owned' });
        expect(calls.saveAdoption).toHaveLength(1);
    });

    it('my own candidate: additions are appended; skipped rating is stored as null', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(calls.append[0]).toEqual(['a-owned', expect.objectContaining({ contactEntries: expect.any(String) })]);
        expect(calls.saveAdoption[0]).toMatchObject({ rating: null, details: null });
    });

    it("someone else's profile: nothing is added to it, the observation still lands", async () => {
        seedDraft();
        const r = await completeInterview('i1', { adopterId: 'a-foreign', additions: ADD, rating: 3, summary: null });
        expect(r.ok).toBe(true);
        expect(calls.append).toEqual([]);
        expect(calls.household).toEqual([]);
        expect(calls.saveAdoption).toHaveLength(1);
    });

    it('refuses a target that is not one of the interview candidates', async () => {
        seedDraft({ candidateIds: ['a-owned'] });
        expect(await completeInterview('i1', { adopterId: 'a-foreign', additions: ADD, rating: null, summary: null })).toEqual({ ok: false, error: 'forbidden' });
        expect(calls.saveAdoption).toEqual([]);
    });

    it('drops additions the interview never collected', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: { ...ADD, contacts: [{ type: 'phone', value: '1199998888' }] }, rating: null, summary: null });
        expect(calls.append).toEqual([]);
    });

    it("another rescuer cannot complete my interview", async () => {
        seedDraft();
        session.user = STRANGER;
        expect(await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null })).toEqual({ ok: false, error: 'forbidden' });
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/actions/interviewComplete.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/app/actions/interviewComplete.ts`**

```ts
'use server';

/**
 * Saves a finished interview to the profile the rescuer chose (spec §3.5,
 * §5.2, D1/D2/D8). Reuses the existing write paths so tokens, history,
 * audit and pending-search closure behave as everywhere else. The status
 * flips LAST; adopter_id and event_id are persisted as soon as they exist,
 * so a retry after a partial failure resumes instead of duplicating.
 */
import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { adopters, interviews } from '@/db/schema';
import { buildContactEntries } from '@/lib/contactEntries';
import { contactKey, deriveKnownFacts } from '@/domain/interview/facts';
import { QUESTION_BANK } from '@/domain/interview/bank';
import { contextFor, loadInterview } from '@/lib/interviews/store';
import { completeInputSchema, type CompleteInput } from '@/lib/interviews/validation';
import type { ActionResult } from './interviewTypes';

export async function completeInterview(interviewId: string, input: CompleteInput): Promise<ActionResult<{ adopterId: string }>> {
    let actor: string | undefined;
    const id = String(interviewId);
    try {
        if (!(await getFeatureFlag('ENABLE_INTERVIEW_GUIDE'))) return { ok: false, error: 'disabled' };
        actor = await getUser();
        const parsed = completeInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid' };
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        const s = await loadInterview(db, id);
        if (!s || s.status === 'discarded') return { ok: false, error: 'not_found' };
        if (s.conductedBy !== actor) return { ok: false, error: 'forbidden' };
        if (s.status === 'completed' && s.adopterId) return { ok: true, adopterId: s.adopterId };

        const { adopterId: target, rating, summary } = parsed.data;
        if (target !== 'new' && !s.candidateIds.includes(target)) return { ok: false, error: 'forbidden' };

        // Only what this interview actually collected may be written (no free-form injection).
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const knownKeys = new Set([
            ...known.phones.map(v => `phone:${contactKey('phone', v)}`),
            ...known.emails.map(v => `email:${contactKey('email', v)}`),
            ...known.socials.map(v => `social:${contactKey('social', v)}`),
        ]);
        const contacts = parsed.data.additions.contacts.filter(c => knownKeys.has(`${c.type}:${contactKey(c.type, c.value)}`));
        const household = parsed.data.additions.household.filter(h =>
            known.household.some(k => k.name === h.name.trim() && k.relationship === h.relationship));
        const address = parsed.data.additions.address && known.address === parsed.data.additions.address.trim() ? known.address : null;
        const entriesJson = () => JSON.stringify(buildContactEntries({
            phones: contacts.filter(c => c.type === 'phone').map(c => c.value),
            emails: contacts.filter(c => c.type === 'email').map(c => c.value),
            socials: contacts.filter(c => c.type === 'social').map(c => c.value),
        }));

        const { saveAdopter, appendToExistingAdopter } = await import('./adopters');
        const { addHouseholdMember } = await import('./householdMembers');
        const { saveAdoption } = await import('./adoptions');

        // 1. Target profile.
        let adopterId = s.adopterId;
        let created = false;
        if (!adopterId) {
            if (target === 'new') {
                const res = await saveAdopter({ name: s.prep.name, contactEntries: entriesJson(), addressInfo: address ?? undefined } as never);
                if (!res.success) throw new Error(`saveAdopter refused: ${res.error}`);
                adopterId = res.id;
                created = true;
            } else {
                adopterId = target;
            }
            await db.update(interviews).set({ adopterId, updatedAt: new Date() }).where(eq(interviews.id, id));
        }

        // 2. Additions. A new profile already holds the contacts/address from its create.
        if (created || target !== 'new') {
            const owner = (await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, adopterId)).get())?.addedBy ?? null;
            const { isAdminAsync } = await import('@/config/admins');
            const { isOrgMate } = await import('@/lib/orgMembership');
            const canEdit = created || owner === actor || (await isAdminAsync(actor)) || (await isOrgMate(actor, owner));
            if (canEdit) {
                if (!created && (contacts.length || address)) {
                    const r = await appendToExistingAdopter(adopterId, { contactEntries: entriesJson(), ...(address ? { addressInfo: address } : {}) });
                    if (!r.success) logger.warn('interviews.complete: append refused', { interviewId: id, adopterId, error: r.error });
                }
                for (const h of household) {
                    const r = await addHouseholdMember({ adopterId, name: h.name, relationship: h.relationship });
                    if (!r.ok) logger.warn('interviews.complete: household add refused', { interviewId: id, adopterId });
                }
            }
        }

        // 3. The observation that anchors the interview on the timeline (D8).
        if (!s.eventId) {
            const res = await saveAdoption({
                recordType: 'observation', adopterId, rating: rating ?? null, details: summary?.trim() || null, date: new Date(),
            } as never);
            await db.update(interviews).set({ eventId: res.id, updatedAt: new Date() }).where(eq(interviews.id, id));
        }

        // 4. Done — last.
        const now = new Date();
        await db.update(interviews).set({ status: 'completed', completedAt: now, updatedAt: now }).where(eq(interviews.id, id));
        logger.info('interviews.complete', {
            interviewId: id, adopterId, actor, created,
            answeredCount: Object.values(s.answers).filter(a => a.status === 'answered').length,
            addedContacts: contacts.length, addedHousehold: household.length,
        });
        return { ok: true, adopterId };
    } catch (e) {
        if (e instanceof Error && e.message === 'Authentication required') return { ok: false, error: 'forbidden' };
        return { ok: false, error: 'generic', errorId: logger.error('interviews.complete failed', e, { interviewId: id, actor }) };
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/actions/interviewComplete.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the suite and tsc**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/interviewComplete.ts src/app/actions/interviewComplete.test.ts
git commit -m "feat(interview): completeInterview — confirmed target, idempotent, reuses write paths"
```

---

### Task 9: Action-surface sign-off and build

**Files:**
- Modify: `scripts/check-action-surface.mjs` (`EXPECTED_ACTIONS` at ~L155 and a sign-off note above it)

- [ ] **Step 1: Build and measure**

Run: `npm run build && node scripts/check-action-surface.mjs`
Expected: the build passes. The check FAILS reporting the measured count (expected `155` = 146 + 9). Use the number it prints.

- [ ] **Step 2: Add the sign-off note and raise the count**

Above `const EXPECTED_ACTIONS`, add:

```js
// 155 since the interview guide (ENABLE_INTERVIEW_GUIDE): nine doors in
// src/app/actions/interviews.ts + interviewComplete.ts. Checked against the
// rule above — what a stranger can do with arguments they choose:
//   previewInterviewCandidates(prep)  — session + flag; the same masked duplicate
//                                       search the add-adopter form already exposes.
//   startInterview(input)             — session + flag; creates a draft owned by the
//                                       caller; candidates come from the server-side
//                                       match, a forged lead id is dropped.
//   saveInterviewDraft(id, patch)     — interviewer only, drafts only (a completed
//                                       interview is never revived); zod caps sizes.
//   refreshInterviewCandidates(id)    — interviewer only; re-matches from the STORED
//                                       draft, no caller-supplied identifiers.
//   getInterview(id)                  — drafts: interviewer only; completed: D7
//                                       (interviewer, owner, owner's org-mates, admins).
//   listMyInterviewDrafts()           — the caller's own drafts only.
//   verifyInterviewFact(id, cand, f)  — interviewer only, candidate must be in the
//                                       interview's server-recorded list; compares the
//                                       stored answers with the raw row and returns only
//                                       a boolean — no value leaves the server.
//   discardInterviewDraft(id)         — interviewer only, drafts only.
//   completeInterview(id, input)      — interviewer only; target ∈ server-recorded
//                                       candidates or 'new'; only collected values are
//                                       written, through saveAdopter / appendToExisting-
//                                       Adopter / addHouseholdMember / saveAdoption with
//                                       their own gates. Audited.
const EXPECTED_ACTIONS = 155;
```

(If the measured count differs, use the measured value and explain the difference in the note.)

- [ ] **Step 3: Re-run the check and lint**

Run: `node scripts/check-action-surface.mjs && npm run lint 2>&1 | tail -3`
Expected: the check passes; lint warnings ≤ 125.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-action-surface.mjs
git commit -m "chore(interview): sign off nine interview actions in the action-surface ratchet"
```

---

### Task 10: Route gating and page shells

**Files:**
- Modify: `src/middleware.ts:61` (`PROTECTED_ROUTES`)
- Create: `src/app/interview/page.tsx`
- Create: `src/app/interview/[id]/page.tsx`

**Interfaces:**
- Consumes: `listMyInterviewDrafts`, `getInterview` (Task 7).
- Produces: `/interview?adopterId=<id>` and `/interview?resume=<id>` mount `InterviewApp` (Task 11) with `{ initialDrafts: DraftSummary[]; fromAdopterId: string | null; resumeId: string | null }`. `/interview/<id>` mounts `InterviewReadOnly` (Task 15) with `{ view: InterviewView }`.

- [ ] **Step 1: Protect the route**

```ts
const PROTECTED_ROUTES = ['/my-animals', '/my-adopters', '/my-adoptions', '/settings', '/admin', '/import/sheet', '/interview'];
```

- [ ] **Step 2: Create `src/app/interview/page.tsx`**

```tsx
export const runtime = 'edge';
import { notFound, redirect } from 'next/navigation';
import { getFeatureFlag } from '@/config/features';
import { listMyInterviewDrafts } from '@/app/actions/interviews';
import InterviewApp from '@/components/interview/InterviewApp';

export const metadata = { title: 'Entrevista' };

export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ adopterId?: string; resume?: string }> }) {
    const enabled = await getFeatureFlag('ENABLE_INTERVIEW_GUIDE').catch(() => false);
    if (!enabled) notFound();
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email) redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent('/interview')}`);
    const sp = await searchParams;
    const drafts = await listMyInterviewDrafts();
    return (
        <div className="min-h-screen bg-stone-50 py-6">
            <InterviewApp
                initialDrafts={drafts.ok ? drafts.drafts : []}
                fromAdopterId={sp.adopterId ?? null}
                resumeId={sp.resume ?? null}
            />
        </div>
    );
}
```

- [ ] **Step 3: Create `src/app/interview/[id]/page.tsx`**

```tsx
export const runtime = 'edge';
import { notFound, redirect } from 'next/navigation';
import { getFeatureFlag } from '@/config/features';
import { getInterview } from '@/app/actions/interviews';
import InterviewReadOnly from '@/components/interview/InterviewReadOnly';

export const metadata = { title: 'Entrevista' };

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const enabled = await getFeatureFlag('ENABLE_INTERVIEW_GUIDE').catch(() => false);
    if (!enabled) notFound();
    const { auth } = await import('@/auth');
    const session = await auth();
    if (!session?.user?.email) redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/interview/${id}`)}`);
    const r = await getInterview(id);
    if (!r.ok) notFound();
    if (r.view.status === 'draft') redirect(`/interview?resume=${encodeURIComponent(id)}`);
    return (
        <div className="min-h-screen bg-stone-50 py-6">
            <InterviewReadOnly view={r.view} />
        </div>
    );
}
```

(These won't compile until Tasks 11/15 create the components. Commit them together with Task 11; Step 4 is a reminder.)

- [ ] **Step 4: Stage now, commit with Task 11**

```bash
git add src/middleware.ts src/app/interview/page.tsx "src/app/interview/[id]/page.tsx"
```

---

### Task 11: Client shell, state, autosave and preparation

**Files:**
- Create: `src/components/interview/autosaveQueue.ts` (DOM-free, no imports — unit-tested)
- Create: `src/components/interview/useInterviewAutosave.ts`
- Create: `src/components/interview/questionText.ts`
- Create: `src/components/interview/CandidateCard.tsx`
- Create: `src/components/interview/InterviewPrep.tsx`
- Create: `src/components/interview/InterviewApp.tsx`
- Create (stubs filled in by Tasks 12–15, so this task compiles): `InterviewTechnique.tsx`, `InterviewRail.tsx`, `InterviewFocusPanel.tsx`, `InterviewReview.tsx`, `InterviewReadOnly.tsx`, each exporting a component that returns `null`. Each stub's props type must match the one defined in its task.
- Test: `src/components/interview/useInterviewAutosave.test.ts`

**Interfaces:**
- Consumes: actions (Tasks 7–8), domain (Tasks 2–5).
- Produces:
  - `useInterviewAutosave(opts: { interviewId: string | null; payload: DraftPatch; enabled: boolean; save?: typeof saveInterviewDraft; delayMs?: number }): { status: 'idle' | 'saving' | 'saved' | 'offline'; flush: () => Promise<boolean> }`
  - `CandidateCard({ c, selected?, onSelect?, selectLabel?, badge? })`
  - `questionText(t, id, custom): string` in `questionText.ts`, used by the rail, the panel and the read-only view. It is a separate module so the children never import `InterviewApp` (no import cycle).

- [ ] **Step 1: Write the failing autosave test** `src/components/interview/useInterviewAutosave.test.ts`

The hook's timing logic lives in a plain class so it is testable without a DOM.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutosaveQueue } from './autosaveQueue';

describe('AutosaveQueue', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('debounces changes into one save', async () => {
        const save = vi.fn(async () => true);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a'); q.schedule('b'); q.schedule('c');
        await vi.advanceTimersByTimeAsync(800);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith('c');
    });

    it('flush saves immediately and skips an unchanged payload', async () => {
        const save = vi.fn(async () => true);
        const q = new AutosaveQueue(save, 800, () => {});
        q.schedule('a');
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
        expect(await q.flush()).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('goes offline on failure and retries until it succeeds', async () => {
        const statuses: string[] = [];
        const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const q = new AutosaveQueue(save, 100, s => statuses.push(s));
        q.schedule('a');
        await vi.advanceTimersByTimeAsync(100);
        expect(statuses).toContain('offline');
        await vi.advanceTimersByTimeAsync(3000);
        expect(save).toHaveBeenCalledTimes(2);
        expect(statuses.at(-1)).toBe('saved');
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/interview/useInterviewAutosave.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `autosaveQueue.ts` (no imports, so the test never loads server code) and `useInterviewAutosave.ts`**

`src/components/interview/autosaveQueue.ts`:

```ts
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline';
const RETRY_MS = 3000;

/** Debounced, retrying save of a serialized payload. DOM-free so it is unit-testable. */
export class AutosaveQueue {
    private pending: string | null = null;
    private lastSaved: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inflight: Promise<boolean> | null = null;
    constructor(private save: (payload: string) => Promise<boolean>, private delayMs: number, private onStatus: (s: AutosaveStatus) => void) {}

    schedule(payload: string) {
        if (payload === this.lastSaved) return;
        this.pending = payload;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
    }

    async flush(): Promise<boolean> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.inflight) await this.inflight;
        const payload = this.pending;
        if (payload === null || payload === this.lastSaved) return true;
        this.onStatus('saving');
        this.inflight = this.save(payload).catch(() => false);
        const ok = await this.inflight;
        this.inflight = null;
        if (ok) {
            this.lastSaved = payload;
            if (this.pending === payload) this.pending = null;
            this.onStatus('saved');
        } else {
            this.onStatus('offline');
            this.timer = setTimeout(() => { void this.flush(); }, RETRY_MS);
        }
        return ok;
    }

    dispose() { if (this.timer) clearTimeout(this.timer); }
}
```

`src/components/interview/useInterviewAutosave.ts`:

```ts
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveInterviewDraft } from '@/app/actions/interviews';
import type { DraftPatch } from '@/lib/interviews/validation';
import { AutosaveQueue, type AutosaveStatus } from './autosaveQueue';

export function useInterviewAutosave(opts: {
    interviewId: string | null;
    payload: DraftPatch;
    enabled: boolean;
    save?: typeof saveInterviewDraft;
    delayMs?: number;
}): { status: AutosaveStatus; flush: () => Promise<boolean> } {
    const [status, setStatus] = useState<AutosaveStatus>('idle');
    const idRef = useRef(opts.interviewId);
    idRef.current = opts.interviewId;
    const saveFn = opts.save ?? saveInterviewDraft;
    const queue = useMemo(() => new AutosaveQueue(async (payload) => {
        const id = idRef.current;
        if (!id) return true;
        const r = await saveFn(id, JSON.parse(payload) as DraftPatch);
        return r.ok;
    }, opts.delayMs ?? 800, setStatus), [saveFn, opts.delayMs]);

    const serialized = JSON.stringify(opts.payload);
    useEffect(() => { if (opts.enabled && opts.interviewId) queue.schedule(serialized); }, [serialized, opts.enabled, opts.interviewId, queue]);
    useEffect(() => () => queue.dispose(), [queue]);

    return { status, flush: () => queue.flush() };
}
```

- [ ] **Step 4: Run the autosave test**

Run: `npx vitest run src/components/interview/useInterviewAutosave.test.ts`
Expected: PASS.

- [ ] **Step 4b: Implement `questionText.ts`**

```ts
import type { CustomQuestion } from '@/domain/interview/types';

export function questionText(t: (k: string) => string, id: string, custom: CustomQuestion[]): string {
    const c = custom.find(x => x.id === id);
    return c ? c.text : t(`interview.q.${id}`);
}
```

- [ ] **Step 5: Implement `CandidateCard.tsx`**

```tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import type { CandidateSummary } from '@/domain/interview/types';

export default function CandidateCard({ c, selected = false, onSelect, selectLabel, badge }: {
    c: CandidateSummary;
    selected?: boolean;
    onSelect?: () => void;
    selectLabel?: string;
    badge?: string;
}) {
    const { t } = useLanguage();
    return (
        <div data-testid="interview-candidate" className={`rounded-xl border p-3 bg-white ${selected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-stone-200'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 break-words">{c.displayName}</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                        {c.relevancePercent > 0 && <span>{c.relevancePercent}% · </span>}
                        {t('interview.adoptions_count').replace('{n}', String(c.adoptionCount))}
                    </p>
                    {badge && <span className="mt-1 inline-flex text-[11px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-800">{badge}</span>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {c.avgRating != null && <RatingBadge rating={c.avgRating} size="sm" />}
                    <a href={`/adopter/${c.adopterId}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-teal-700 hover:underline">
                        {t('interview.view_profile')}
                    </a>
                </div>
            </div>
            {onSelect && (
                <button type="button" onClick={onSelect} aria-pressed={selected}
                    className={`mt-2 w-full px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${selected ? 'bg-teal-700 text-white' : 'text-teal-700 bg-teal-50 hover:bg-teal-100'}`}>
                    {selectLabel}
                </button>
            )}
        </div>
    );
}
```

Check the `RatingBadge` import path: `grep -rn "export.*RatingBadge" src/components`. If it is a default export, adjust the import.

- [ ] **Step 6: Implement `InterviewPrep.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { previewInterviewCandidates } from '@/app/actions/interviews';
import type { CandidateSummary, PrepFacts } from '@/domain/interview/types';
import CandidateCard from './CandidateCard';

const LABEL = 'block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider';
const INPUT = 'w-full h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm';

function RowList({ label, values, onChange, testId, inputMode }: {
    label: string; values: string[]; onChange: (v: string[]) => void; testId: string; inputMode?: 'tel' | 'email' | 'text';
}) {
    const { t } = useLanguage();
    const rows = values.length ? values : [''];
    return (
        <div>
            <label className={LABEL}>{label}</label>
            <div className="space-y-2">
                {rows.map((v, i) => (
                    <input key={i} data-testid={`${testId}-${i}`} className={INPUT} value={v} inputMode={inputMode}
                        onChange={e => { const next = [...rows]; next[i] = e.target.value; onChange(next); }} />
                ))}
            </div>
            <button type="button" onClick={() => onChange([...rows, ''])} className="mt-1 text-xs font-semibold text-teal-700 hover:underline">{t('interview.prep_add_row')}</button>
        </div>
    );
}

export default function InterviewPrep({ prep, onPrepChange, leadCandidateId, onLeadChange, onStart, starting }: {
    prep: PrepFacts;
    onPrepChange: (p: PrepFacts) => void;
    leadCandidateId: string | null;
    onLeadChange: (id: string | null) => void;
    onStart: () => void;
    starting: boolean;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const canStart = prep.name.trim().length >= 2 && !starting;

    useEffect(() => {
        if (prep.name.trim().length < 2) { setCandidates([]); return; }
        let active = true;
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const clean = { ...prep, phones: prep.phones.filter(Boolean), emails: prep.emails.filter(Boolean), socials: prep.socials.filter(Boolean) };
                const r = await previewInterviewCandidates(clean);
                if (active && r.ok) setCandidates(r.candidates);
            } catch (e) {
                if (!handledAsStale(e)) toast.error(t('interview.load_failed'), userFacingMessage(e, t('interview.load_failed')), resolveErrorId(e, 'InterviewPrep.preview'));
            } finally {
                if (active) setSearching(false);
            }
        }, 500);
        return () => { active = false; clearTimeout(timer); };
    }, [prep, t, toast]);

    return (
        <section className="grid gap-6 md:grid-cols-[1fr_20rem]">
            <div className="bg-white rounded-2xl border border-stone-200 p-4 md:p-6 space-y-4">
                <div>
                    <h1 className="text-xl font-bold text-stone-900">{t('interview.prep_title')}</h1>
                    <p className="text-sm text-stone-600 mt-1">{t('interview.prep_intro')}</p>
                </div>
                <div>
                    <label className={LABEL} htmlFor="interview-prep-name">{t('interview.prep_name')}</label>
                    <input id="interview-prep-name" data-testid="interview-prep-name" className={INPUT} value={prep.name}
                        onChange={e => onPrepChange({ ...prep, name: e.target.value })} autoFocus />
                </div>
                <RowList label={t('interview.prep_phones')} values={prep.phones} onChange={phones => onPrepChange({ ...prep, phones })} testId="interview-prep-phone" inputMode="tel" />
                <RowList label={t('interview.prep_socials')} values={prep.socials} onChange={socials => onPrepChange({ ...prep, socials })} testId="interview-prep-social" />
                <RowList label={t('interview.prep_emails')} values={prep.emails} onChange={emails => onPrepChange({ ...prep, emails })} testId="interview-prep-email" inputMode="email" />
                <div>
                    <label className={LABEL} htmlFor="interview-prep-address">{t('interview.prep_address')}</label>
                    <input id="interview-prep-address" className={INPUT} value={prep.address} onChange={e => onPrepChange({ ...prep, address: e.target.value })} />
                </div>
                <div className="flex justify-end pt-2">
                    <button type="button" data-testid="interview-start" disabled={!canStart} onClick={onStart}
                        className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all">
                        {t('interview.prep_start')} →
                    </button>
                </div>
            </div>
            <aside className="space-y-2" aria-live="polite">
                <h2 className={LABEL}>{t('interview.prep_candidates')}</h2>
                {searching && <p className="text-sm text-stone-500">{t('interview.prep_searching')}</p>}
                {!searching && prep.name.trim().length >= 2 && candidates.length === 0 && <p className="text-sm text-stone-500">{t('interview.prep_no_matches')}</p>}
                {candidates.map(c => (
                    <CandidateCard key={c.adopterId} c={c} selected={leadCandidateId === c.adopterId}
                        onSelect={() => onLeadChange(leadCandidateId === c.adopterId ? null : c.adopterId)}
                        selectLabel={leadCandidateId === c.adopterId ? t('interview.prep_lead_selected') : t('interview.prep_lead')} />
                ))}
            </aside>
        </section>
    );
}
```

- [ ] **Step 7: Implement `InterviewApp.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { buildQueue, nextUpcomingId } from '@/domain/interview/queue';
import { QUESTION_BANK } from '@/domain/interview/bank';
import { answerHasContent, deriveKnownFacts, identifierSignature } from '@/domain/interview/facts';
import { EMPTY_PREP, type Answer, type CandidateSummary, type CustomQuestion, type InterviewContext, type PrepFacts, type Stage } from '@/domain/interview/types';
import { discardInterviewDraft, getInterview, refreshInterviewCandidates, startInterview } from '@/app/actions/interviews';
import type { DraftSummary, InterviewView } from '@/app/actions/interviewTypes';
import { useInterviewAutosave } from './useInterviewAutosave';
import InterviewPrep from './InterviewPrep';
import InterviewTechnique, { techniqueHidden } from './InterviewTechnique';
import InterviewRail from './InterviewRail';
import InterviewFocusPanel from './InterviewFocusPanel';
import InterviewReview from './InterviewReview';

type Phase = 'loading' | 'prep' | 'technique' | 'interview' | 'review';

export default function InterviewApp({ initialDrafts, fromAdopterId, resumeId }: {
    initialDrafts: DraftSummary[];
    fromAdopterId: string | null;
    resumeId: string | null;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [phase, setPhase] = useState<Phase>(fromAdopterId || resumeId ? 'loading' : 'prep');
    const [drafts, setDrafts] = useState(initialDrafts);
    const [interviewId, setInterviewId] = useState<string | null>(null);
    const [prep, setPrep] = useState<PrepFacts>(EMPTY_PREP);
    const [leadCandidateId, setLead] = useState<string | null>(null);
    const [confirmedAdopterId, setConfirmed] = useState<string | null>(null);
    const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
    const [newCandidateIds, setNewCandidateIds] = useState<string[]>([]);
    const [answers, setAnswers] = useState<Record<string, Answer>>({});
    const [visited, setVisited] = useState<string[]>([]);
    const [custom, setCustom] = useState<CustomQuestion[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [showTechnique, setShowTechnique] = useState(false);

    const fail = useCallback((e: unknown, title: string, source: string) => {
        if (!handledAsStale(e)) toast.error(title, userFacingMessage(e, title), resolveErrorId(e, source));
    }, [toast]);

    const applyView = useCallback((id: string, v: InterviewView) => {
        setInterviewId(id);
        setPrep(v.prep);
        setLead(v.leadCandidateId);
        setConfirmed(v.confirmedAdopterId);
        setCandidates(v.candidates);
        setAnswers(v.answers);
        setVisited(v.visited);
        setCustom(v.custom);
        setPhase(Object.keys(v.answers).length || techniqueHidden() ? 'interview' : 'technique');
    }, []);

    // Entry: from a profile, or resuming a draft.
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (resumeId) {
                    const r = await getInterview(resumeId);
                    if (!active) return;
                    if (r.ok) applyView(resumeId, r.view); else { toast.error(t('interview.load_failed')); setPhase('prep'); }
                } else if (fromAdopterId) {
                    const r = await startInterview({ adopterId: fromAdopterId });
                    if (!active) return;
                    if (r.ok) applyView(r.interviewId, r.view); else { toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.load_failed')); setPhase('prep'); }
                }
            } catch (e) {
                fail(e, t('interview.load_failed'), 'InterviewApp.entry');
                if (active) setPhase('prep');
            }
        })();
        return () => { active = false; };
    }, [resumeId, fromAdopterId, applyView, fail, t, toast]);

    const ctx: InterviewContext = useMemo(() => ({
        prep, answers, visited, custom, candidates, ...(confirmedAdopterId ? { confirmedAdopterId } : {}),
    }), [prep, answers, visited, custom, candidates, confirmedAdopterId]);
    const queue = useMemo(() => buildQueue(ctx), [ctx]);
    const known = useMemo(() => deriveKnownFacts(ctx, QUESTION_BANK), [ctx]);
    const current = (currentId && queue.some(i => i.id === currentId)) ? currentId : nextUpcomingId(queue);

    const { status, flush } = useInterviewAutosave({
        interviewId,
        payload: { answers, visited, custom, leadCandidateId },
        enabled: phase === 'interview' || phase === 'review',
    });

    // New identifier → save, then let the server re-match from the stored draft.
    const signature = identifierSignature(known);
    const lastSignature = useRef<string | null>(null);
    useEffect(() => {
        if (!interviewId || phase !== 'interview') return;
        if (lastSignature.current === null) { lastSignature.current = signature; return; }
        if (lastSignature.current === signature) return;
        lastSignature.current = signature;
        let active = true;
        (async () => {
            try {
                if (!(await flush())) return;
                const r = await refreshInterviewCandidates(interviewId);
                if (!active || !r.ok) return;
                setCandidates(prev => {
                    const before = new Set(prev.map(c => c.adopterId));
                    const added = r.candidates.filter(c => !before.has(c.adopterId)).map(c => c.adopterId);
                    if (added.length) setNewCandidateIds(ids => [...ids, ...added]);
                    return r.candidates;
                });
            } catch (e) {
                fail(e, t('interview.load_failed'), 'InterviewApp.refreshCandidates');
            }
        })();
        return () => { active = false; };
    }, [signature, interviewId, phase, flush, fail, t]);

    const recordAnswer = useCallback((id: string, a: Answer | null) => {
        const keep = a && (a.status !== 'answered' || answerHasContent(a));
        setAnswers(prev => {
            const next = { ...prev };
            if (keep) next[id] = a!; else delete next[id];
            return next;
        });
        setVisited(prev => keep ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter(v => v !== id));
    }, []);

    const goNext = useCallback((fromId: string | null) => setCurrentId(nextUpcomingId(queue, fromId)), [queue]);

    const addCustom = useCallback((text: string, stage: Stage) => {
        const n = custom.reduce((m, c) => Math.max(m, Number(c.id.split(':')[1]) || 0), 0) + 1;
        const q = { id: `custom:${n}`, stage, text: text.trim() };
        setCustom(prev => [...prev, q]);
        setCurrentId(q.id);
    }, [custom]);

    async function begin() {
        setStarting(true);
        try {
            const clean = { ...prep, phones: prep.phones.filter(Boolean), emails: prep.emails.filter(Boolean), socials: prep.socials.filter(Boolean) };
            const r = await startInterview({ prep: clean, leadCandidateId });
            if (!r.ok) { toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.save_failed'), undefined, r.errorId); return; }
            applyView(r.interviewId, r.view);
        } catch (e) {
            fail(e, t('interview.save_failed'), 'InterviewApp.start');
        } finally {
            setStarting(false);
        }
    }

    async function discard(id: string) {
        try {
            const r = await discardInterviewDraft(id);
            if (r.ok) setDrafts(ds => ds.filter(d => d.id !== id));
        } catch (e) {
            fail(e, t('interview.save_failed'), 'InterviewApp.discard');
        }
    }

    if (phase === 'loading') {
        return <div className="max-w-6xl mx-auto px-4 text-sm text-stone-500" role="status">{t('interview.saving')}</div>;
    }

    return (
        <div className="max-w-6xl mx-auto px-4">
            {phase === 'prep' && (
                <>
                    {drafts.length > 0 && (
                        <section className="mb-6 bg-white rounded-2xl border border-stone-200 p-4" data-testid="interview-drafts">
                            <h2 className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider">{t('interview.drafts_title')}</h2>
                            <ul className="divide-y divide-stone-100">
                                {drafts.map(d => (
                                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                                        <span className="text-sm text-stone-800 min-w-0 break-words">{d.name}</span>
                                        <span className="flex gap-2 flex-shrink-0">
                                            <button type="button" onClick={() => router.push(`/interview?resume=${d.id}`)} className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">{t('interview.draft_continue')}</button>
                                            <button type="button" onClick={() => discard(d.id)} className="px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.draft_discard')}</button>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    <InterviewPrep prep={prep} onPrepChange={setPrep} leadCandidateId={leadCandidateId} onLeadChange={setLead} onStart={begin} starting={starting} />
                </>
            )}

            {phase === 'technique' && <InterviewTechnique mode="screen" onContinue={() => setPhase('interview')} />}

            {phase === 'interview' && (
                <>
                    <header className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-stone-900 break-words">{t('interview.title')} · {prep.name}</h1>
                            <p className="text-xs text-stone-600" data-testid="interview-candidate-status">
                                {confirmedAdopterId
                                    ? t('interview.candidate_confirmed').replace('{name}', candidates.find(c => c.adopterId === confirmedAdopterId)?.displayName ?? '')
                                    : candidates.length === 1 ? t('interview.candidate_one') : t('interview.candidates_count').replace('{n}', String(candidates.length))}
                                {newCandidateIds.length > 0 && <span className="ml-2 font-semibold text-teal-700 motion-safe:animate-pulse">{t('interview.new_candidate')}</span>}
                                <span className="ml-2 text-stone-500" aria-live="polite" data-testid="interview-save-status">
                                    {status === 'saving' ? t('interview.saving') : status === 'saved' ? t('interview.saved') : status === 'offline' ? t('interview.offline') : ''}
                                </span>
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setShowTechnique(true)} className="px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.technique_button')}</button>
                            <button type="button" data-testid="interview-finish" onClick={async () => { await flush(); setPhase('review'); }}
                                className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">{t('interview.finish')}</button>
                        </div>
                    </header>
                    <div className="md:grid md:grid-cols-[18rem_1fr] md:gap-6">
                        <InterviewRail queue={queue} answers={answers} custom={custom} currentId={current} onSelect={setCurrentId} onAddCustom={addCustom} />
                        <InterviewFocusPanel
                            interviewId={interviewId!}
                            item={queue.find(i => i.id === current) ?? null}
                            answer={current ? answers[current] ?? null : null}
                            custom={custom}
                            candidates={candidates}
                            onAnswer={recordAnswer}
                            onNext={goNext}
                            flush={flush}
                        />
                    </div>
                    {showTechnique && <InterviewTechnique mode="sheet" onClose={() => setShowTechnique(false)} />}
                </>
            )}

            {phase === 'review' && interviewId && (
                <InterviewReview
                    interviewId={interviewId}
                    known={known}
                    candidates={candidates}
                    confirmedAdopterId={confirmedAdopterId}
                    leadCandidateId={leadCandidateId}
                    flush={flush}
                    onBack={() => setPhase('interview')}
                    onSaved={(adopterId) => { toast.success(t('interview.saved_toast')); router.push(`/adopter/${adopterId}`); }}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 8: Create the five stubs** so tsc passes. Each is filled in by its own task.

```tsx
// src/components/interview/InterviewTechnique.tsx (stub — Task 12)
'use client';
export function techniqueHidden(): boolean { return false; }
export default function InterviewTechnique(_: { mode: 'screen' | 'sheet'; onContinue?: () => void; onClose?: () => void }) { return null; }
```
```tsx
// src/components/interview/InterviewRail.tsx (stub — Task 13)
'use client';
import type { Answer, CustomQuestion, QueueItem, Stage } from '@/domain/interview/types';
export default function InterviewRail(_: { queue: QueueItem[]; answers: Record<string, Answer>; custom: CustomQuestion[]; currentId: string | null; onSelect: (id: string) => void; onAddCustom: (text: string, stage: Stage) => void }) { return null; }
```
```tsx
// src/components/interview/InterviewFocusPanel.tsx (stub — Task 13)
'use client';
import type { Answer, CandidateSummary, CustomQuestion, QueueItem } from '@/domain/interview/types';
export default function InterviewFocusPanel(_: { interviewId: string; item: QueueItem | null; answer: Answer | null; custom: CustomQuestion[]; candidates: CandidateSummary[]; onAnswer: (id: string, a: Answer | null) => void; onNext: (fromId: string | null) => void; flush: () => Promise<boolean> }) { return null; }
```
```tsx
// src/components/interview/InterviewReview.tsx (stub — Task 14)
'use client';
import type { CandidateSummary, KnownFacts } from '@/domain/interview/types';
export default function InterviewReview(_: { interviewId: string; known: KnownFacts; candidates: CandidateSummary[]; confirmedAdopterId: string | null; leadCandidateId: string | null; flush: () => Promise<boolean>; onBack: () => void; onSaved: (adopterId: string) => void }) { return null; }
```
```tsx
// src/components/interview/InterviewReadOnly.tsx (stub — Task 15)
'use client';
import type { InterviewView } from '@/app/actions/interviewTypes';
export default function InterviewReadOnly(_: { view: InterviewView }) { return null; }
```

- [ ] **Step 9: Type-check, lint and test**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test`
Expected: PASS; lint ≤ 125.

- [ ] **Step 10: Commit** (includes Task 10's staged files)

```bash
git add src/components/interview/ src/middleware.ts src/app/interview/page.tsx "src/app/interview/[id]/page.tsx"
git commit -m "feat(interview): /interview page, preparation step, client state + autosave"
```

---

### Task 12: Technique screen and sheet

**Files:**
- Modify (replace stub): `src/components/interview/InterviewTechnique.tsx`

**Interfaces:**
- Produces: `techniqueHidden(): boolean`; `InterviewTechnique({ mode: 'screen' | 'sheet'; onContinue?: () => void; onClose?: () => void })`.

- [ ] **Step 1: Implement**

```tsx
'use client';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { STAGES } from '@/domain/interview/types';

const KEY = 'interview.technique.hidden';

/** Per-viewer convenience only; storage can throw in private mode, so default to showing. */
export function techniqueHidden(): boolean {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === '1'; } catch { return false; } // SSR-safe localStorage read
}
function setHidden(v: boolean) {
    try { if (v) window.localStorage.setItem(KEY, '1'); else window.localStorage.removeItem(KEY); } catch { /* storage unavailable: preference just isn't remembered */ }
}

function Stages() {
    const { t } = useLanguage();
    return (
        <ol className="grid gap-3 md:grid-cols-3">
            {STAGES.map((s, i) => (
                <li key={s} className="rounded-xl border border-stone-200 bg-white p-4">
                    <p className="text-xs font-semibold text-teal-800 uppercase tracking-wider">{i + 1}. {t(`interview.technique.${s}.title`)}</p>
                    <p className="text-sm font-medium text-stone-900 mt-1">{t(`interview.technique.${s}.goal`)}</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-stone-700 list-disc pl-5">
                        {[1, 2, 3, 4].map(n => <li key={n}>{t(`interview.technique.${s}.tip${n}`)}</li>)}
                    </ul>
                </li>
            ))}
        </ol>
    );
}

export default function InterviewTechnique({ mode, onContinue, onClose }: { mode: 'screen' | 'sheet'; onContinue?: () => void; onClose?: () => void }) {
    const { t } = useLanguage();
    const [dontShow, setDontShow] = useState(false);

    if (mode === 'sheet') {
        return (
            <div className="fixed inset-x-0 top-16 bottom-0 z-40 bg-stone-900/30 flex items-end md:items-center justify-center p-0 md:p-6" role="dialog" aria-modal="true" aria-label={t('interview.technique_title')} onClick={onClose}>
                <div className="w-full max-w-4xl max-h-full overflow-y-auto bg-stone-50 rounded-t-2xl md:rounded-2xl p-4 md:p-6" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-stone-900">{t('interview.technique_title')}</h2>
                        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.close')}</button>
                    </div>
                    <Stages />
                </div>
            </div>
        );
    }

    return (
        <section className="space-y-4" data-testid="interview-technique">
            <h1 className="text-xl font-bold text-stone-900">{t('interview.technique_title')}</h1>
            <Stages />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} className="h-4 w-4 accent-teal-700" />
                    {t('interview.technique_dont_show')}
                </label>
                <button type="button" data-testid="interview-technique-continue" onClick={() => { setHidden(dontShow); onContinue?.(); }}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">
                    {t('interview.technique_continue')} →
                </button>
            </div>
        </section>
    );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/interview/InterviewTechnique.tsx
git commit -m "feat(interview): technique screen and in-call sheet"
```

---

### Task 13: Rail and focus panel (interview phase)

**Files:**
- Modify (replace stubs): `src/components/interview/InterviewRail.tsx`, `src/components/interview/InterviewFocusPanel.tsx`
- Create: `src/components/interview/InterviewAnswerInput.tsx`
- Create: `src/components/interview/icons.tsx`

**Interfaces:**
- Consumes: the props declared by the Task 11 stubs; `verifyInterviewFact` (Task 7); `questionText` (Task 11).
- Produces: `InterviewAnswerInput({ kind, choices?, value, onChange })` with `value: Answer | null`, `onChange: (a: Answer | null) => void`; `StateIcon({ state })`.

- [ ] **Step 1: Implement `icons.tsx`**

```tsx
import type { QueueItem } from '@/domain/interview/types';

export function StateIcon({ state, added }: { state: QueueItem['state'] | 'current'; added?: boolean }) {
    const common = { className: 'w-4 h-4 flex-shrink-0', viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const;
    if (state === 'current') return <svg {...common}><path d="M7 5l6 5-6 5V5z" fill="currentColor" stroke="none" /></svg>;
    if (state === 'answered') return <svg {...common}><path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (state === 'skipped') return <svg {...common}><path d="M5 5l5 5-5 5M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (state === 'no_answer') return <svg {...common}><circle cx="10" cy="10" r="6" /><path d="M6 14L14 6" /></svg>;
    if (added) return <svg {...common}><path d="M10 4v12M4 10h12" strokeLinecap="round" /></svg>;
    return <svg {...common}><circle cx="10" cy="10" r="5" /></svg>;
}
```

- [ ] **Step 2: Implement `InterviewAnswerInput.tsx`**

```tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import type { Answer, AnswerKind, ContactType } from '@/domain/interview/types';

const INPUT = 'w-full h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm';
const TEXTAREA = 'w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y text-base md:text-sm';
const CONTACT_TYPES: ContactType[] = ['phone', 'email', 'social'];

export default function InterviewAnswerInput({ kind, choices, value, onChange, onSubmit }: {
    kind: AnswerKind;
    choices?: readonly string[];
    value: Answer | null;
    onChange: (a: Answer | null) => void;
    onSubmit: () => void;
}) {
    const { t } = useLanguage();
    const answered = (patch: Partial<Answer>): Answer => ({ status: 'answered', ...patch });

    if (kind === 'text') {
        return (
            <textarea data-testid="interview-answer" className={TEXTAREA} rows={4} placeholder={t('interview.answer_placeholder')}
                value={value?.text ?? ''} onChange={e => onChange(answered({ text: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} />
        );
    }
    if (kind === 'number') {
        return (
            <input data-testid="interview-answer" type="number" inputMode="numeric" min={0} max={1000} className={`${INPUT} max-w-[10rem]`}
                value={value?.number ?? ''} onChange={e => onChange(e.target.value === '' ? null : answered({ number: Number(e.target.value) }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }} />
        );
    }
    if (kind === 'choice') {
        return (
            <div className="flex flex-wrap gap-2" role="radiogroup">
                {(choices ?? []).map(c => (
                    <button key={c} type="button" role="radio" aria-checked={value?.choice === c} data-testid={`interview-choice-${c}`}
                        onClick={() => onChange(answered({ choice: c }))}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${value?.choice === c ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-teal-800 border-teal-200 hover:bg-teal-50'}`}>
                        {t(`interview.choice.${c}`)}
                    </button>
                ))}
            </div>
        );
    }
    if (kind === 'contact') {
        const rows = value?.contacts?.length ? value.contacts : [{ type: 'phone' as ContactType, value: '' }];
        const set = (next: typeof rows) => onChange(answered({ contacts: next }));
        return (
            <div className="space-y-2">
                {rows.map((r, i) => (
                    <div key={i} className="flex gap-2">
                        <select aria-label={t('interview.answer_label')} className={`${INPUT} max-w-[9rem] px-2`} value={r.type}
                            onChange={e => set(rows.map((x, j) => j === i ? { ...x, type: e.target.value as ContactType } : x))}>
                            {CONTACT_TYPES.map(ct => <option key={ct} value={ct}>{t(`interview.contact_type_${ct}`)}</option>)}
                        </select>
                        <input data-testid={`interview-contact-${i}`} className={INPUT} value={r.value}
                            inputMode={r.type === 'phone' ? 'tel' : r.type === 'email' ? 'email' : 'text'}
                            onChange={e => set(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                        {rows.length > 1 && (
                            <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="px-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.remove')}</button>
                        )}
                    </div>
                ))}
                <button type="button" onClick={() => set([...rows, { type: rows.at(-1)!.type, value: '' }])} className="text-xs font-semibold text-teal-700 hover:underline">{t('interview.prep_add_row')}</button>
            </div>
        );
    }
    // household
    const rows = value?.household?.length ? value.household : [{ name: '', relationship: null as Relationship | null }];
    const set = (next: typeof rows) => onChange(answered({ household: next }));
    return (
        <div className="space-y-2">
            {rows.map((r, i) => (
                <div key={i} className="flex gap-2">
                    <input data-testid={`interview-household-${i}`} aria-label={t('interview.household_name')} placeholder={t('interview.household_name')} className={INPUT} value={r.name}
                        onChange={e => set(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <select aria-label={t('adopter.hh_rel')} className={`${INPUT} max-w-[11rem] px-2`} value={r.relationship ?? ''}
                        onChange={e => set(rows.map((x, j) => j === i ? { ...x, relationship: (e.target.value || null) as Relationship | null } : x))}>
                        <option value="">{t('adopter.hh_rel_choose')}</option>
                        {RELATIONSHIPS.map(rel => <option key={rel} value={rel}>{t(`adopter.hh_rel_${rel}`)}</option>)}
                    </select>
                    {rows.length > 1 && (
                        <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="px-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-lg">{t('interview.remove')}</button>
                    )}
                </div>
            ))}
            <button type="button" onClick={() => set([...rows, { name: '', relationship: null }])} className="text-xs font-semibold text-teal-700 hover:underline">{t('interview.household_add')}</button>
        </div>
    );
}
```

- [ ] **Step 3: Implement `InterviewRail.tsx`**

The rail is **one DOM tree**. On `md+` it is a sticky column; below `md` the same element becomes a sheet under the `h-16` nav, toggled by a button. The button is not a copy of the rail's content.

```tsx
'use client';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { STAGES, type Answer, type CustomQuestion, type QueueItem, type Stage } from '@/domain/interview/types';
import { questionText } from './questionText';
import { StateIcon } from './icons';

function preview(a: Answer | undefined, t: (k: string) => string): string {
    if (!a) return '';
    if (a.status === 'skipped') return t('interview.skipped');
    if (a.status === 'no_answer') return t('interview.not_answered');
    if (a.text) return a.text;
    if (a.choice) return t(`interview.choice.${a.choice}`);
    if (typeof a.number === 'number') return String(a.number);
    if (a.contacts?.length) return a.contacts.map(c => c.value).filter(Boolean).join(', ');
    if (a.household?.length) return a.household.map(h => h.name).filter(Boolean).join(', ');
    return '';
}

export default function InterviewRail({ queue, answers, custom, currentId, onSelect, onAddCustom }: {
    queue: QueueItem[];
    answers: Record<string, Answer>;
    custom: CustomQuestion[];
    currentId: string | null;
    onSelect: (id: string) => void;
    onAddCustom: (text: string, stage: Stage) => void;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const done = queue.filter(i => i.state !== 'upcoming').length;
    const currentStage = queue.find(i => i.id === currentId)?.stage ?? 'rapport';

    return (
        <>
            <button type="button" data-testid="interview-rail-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
                className="md:hidden mb-3 w-full px-4 py-2 text-sm font-semibold text-teal-800 bg-white border border-teal-200 rounded-lg">
                {t('interview.questions_drawer').replace('{done}', String(done)).replace('{total}', String(queue.length))}
            </button>
            <aside data-testid="interview-rail" aria-label={t('interview.title')}
                className={`${open ? 'fixed inset-x-0 top-16 bottom-0 z-30 overflow-y-auto p-4' : 'hidden'} bg-stone-50 md:block md:static md:p-0 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:sticky md:top-20`}>
                {STAGES.map(stage => {
                    const items = queue.filter(i => i.stage === stage);
                    if (!items.length) return null;
                    return (
                        <div key={stage} className="mb-4">
                            <h3 className="text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">{t(`interview.stage.${stage}`)}</h3>
                            <ul className="space-y-0.5">
                                {items.map(i => {
                                    const isCurrent = i.id === currentId;
                                    return (
                                        <li key={i.id}>
                                            <button type="button" data-testid={`interview-rail-item-${i.id}`} aria-current={isCurrent ? 'step' : undefined}
                                                onClick={() => { onSelect(i.id); setOpen(false); }}
                                                className={`w-full text-left flex gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${isCurrent ? 'bg-teal-700 text-white' : i.state === 'upcoming' ? 'text-stone-500 hover:bg-white' : 'text-stone-800 hover:bg-white'}`}>
                                                <StateIcon state={isCurrent ? 'current' : i.state} added={!!i.added} />
                                                <span className="min-w-0">
                                                    <span className="block break-words">{questionText(t, i.id, custom)}</span>
                                                    {i.state !== 'upcoming' && !isCurrent && <span className="block text-xs text-stone-500 truncate">{preview(answers[i.id], t)}</span>}
                                                    {i.added && i.state === 'upcoming' && !isCurrent && <span className="block text-xs text-teal-700">{t(i.added.reasonKey)}</span>}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
                <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim()) { onAddCustom(draft, currentStage); setDraft(''); setOpen(false); } }}>
                    <input aria-label={t('interview.add_question')} placeholder={t('interview.add_question_placeholder')} value={draft} onChange={e => setDraft(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-teal-200 bg-white text-base md:text-sm outline-none focus:border-teal-500" />
                    <button type="submit" className="px-3 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">{t('interview.add_question_save')}</button>
                </form>
            </aside>
        </>
    );
}
```

- [ ] **Step 4: Implement `InterviewFocusPanel.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { questionById } from '@/domain/interview/bank';
import { answerHasContent } from '@/domain/interview/facts';
import type { Answer, CandidateSummary, CustomQuestion, QueueItem } from '@/domain/interview/types';
import { verifyInterviewFact } from '@/app/actions/interviews';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { questionText } from './questionText';
import InterviewAnswerInput from './InterviewAnswerInput';

function VerifyHints({ interviewId, item, answer, candidates, flush }: {
    interviewId: string; item: QueueItem; answer: Answer | null; candidates: CandidateSummary[]; flush: () => Promise<boolean>;
}) {
    const { t } = useLanguage();
    const [results, setResults] = useState<Record<string, boolean>>({});
    const fact = item.verify!.fact;
    const targets = candidates.filter(c => item.verify!.candidateIds.includes(c.adopterId));
    const protectedIds = targets.filter(c => !c.visible[fact]?.length).map(c => c.adopterId);
    const answerKey = JSON.stringify(answer ?? null);

    useEffect(() => {
        setResults({});
        if (!answer || !answerHasContent(answer) || !protectedIds.length) return;
        let active = true;
        const timer = setTimeout(async () => {
            if (!(await flush())) return;
            for (const id of protectedIds) {
                try {
                    const r = await verifyInterviewFact(interviewId, id, fact);
                    if (active && r.ok) setResults(prev => ({ ...prev, [id]: r.match }));
                } catch (e) {
                    resolveErrorId(e, 'InterviewFocusPanel.verify');
                }
            }
        }, 1000);
        return () => { active = false; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the answer or the target set changes
    }, [answerKey, protectedIds.join(','), interviewId, fact]);

    return (
        <div className="mt-3 space-y-1.5" data-testid="interview-verify">
            {targets.map(c => {
                const shown = c.visible[fact];
                if (shown?.length) {
                    return (
                        <p key={c.adopterId} className="text-xs text-stone-700 bg-stone-100 rounded-lg px-3 py-2">
                            {t('interview.verify_on_profile').replace('{name}', c.displayName)} <strong className="font-semibold break-all">{shown.join(', ')}</strong>
                        </p>
                    );
                }
                const r = results[c.adopterId];
                return (
                    <p key={c.adopterId} data-testid={`interview-verify-${c.adopterId}`}
                        className={`text-xs rounded-lg px-3 py-2 ${r === true ? 'bg-teal-50 text-teal-800' : r === false ? 'bg-stone-100 text-stone-700' : 'text-stone-500'}`}>
                        {r === true ? t('interview.verify_match').replace('{name}', c.displayName)
                            : r === false ? t('interview.verify_nomatch').replace('{name}', c.displayName)
                            : t('interview.verify_pending')}
                    </p>
                );
            })}
        </div>
    );
}

export default function InterviewFocusPanel({ interviewId, item, answer, custom, candidates, onAnswer, onNext, flush }: {
    interviewId: string;
    item: QueueItem | null;
    answer: Answer | null;
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    onAnswer: (id: string, a: Answer | null) => void;
    onNext: (fromId: string | null) => void;
    flush: () => Promise<boolean>;
}) {
    const { t } = useLanguage();
    if (!item) {
        return <section className="bg-white rounded-2xl border border-stone-200 p-6 text-sm text-stone-600">{t('interview.finish')} →</section>;
    }
    const def = questionById(item.id);
    const kind = def?.kind ?? 'text';
    return (
        <section className="bg-white rounded-2xl border border-stone-200 p-4 md:p-6" data-testid="interview-focus">
            <p className="text-xs font-semibold text-teal-800 uppercase tracking-wider">{t('interview.now')} · {t(`interview.stage.${item.stage}`)}</p>
            <h2 className="mt-2 text-lg md:text-xl font-semibold text-stone-900 break-words" data-testid="interview-question">{questionText(t, item.id, custom)}</h2>
            {def?.hint && <p className="mt-1 text-sm text-stone-600">{t(`interview.h.${item.id}`)}</p>}
            {item.added && <p className="mt-1 text-xs text-teal-700">{t(item.added.reasonKey)}</p>}
            <div className="mt-4">
                <label className="sr-only">{t('interview.answer_label')}</label>
                <InterviewAnswerInput key={item.id} kind={kind} choices={def?.choices} value={answer} onChange={a => onAnswer(item.id, a)} onSubmit={() => onNext(item.id)} />
            </div>
            {item.verify && <VerifyHints interviewId={interviewId} item={item} answer={answer} candidates={candidates} flush={flush} />}
            <div className="mt-4 flex flex-wrap justify-between gap-2 pt-4 border-t border-teal-100/50">
                <div className="flex gap-2">
                    <button type="button" data-testid="interview-skip" onClick={() => { onAnswer(item.id, { status: 'skipped' }); onNext(item.id); }}
                        className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.skip')}</button>
                    <button type="button" data-testid="interview-no-answer" onClick={() => { onAnswer(item.id, { status: 'no_answer' }); onNext(item.id); }}
                        className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('interview.no_answer')}</button>
                </div>
                <button type="button" data-testid="interview-next" onClick={() => onNext(item.id)}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20">{t('interview.next')} →</button>
            </div>
        </section>
    );
}
```

- [ ] **Step 5: Type-check, lint and test**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test`
Expected: PASS; lint ≤ 125.

- [ ] **Step 6: Commit**

```bash
git add src/components/interview/InterviewRail.tsx src/components/interview/InterviewFocusPanel.tsx src/components/interview/InterviewAnswerInput.tsx src/components/interview/icons.tsx
git commit -m "feat(interview): rail + focus panel with typed answers and private verification hints"
```

---

### Task 14: Review and save

**Files:**
- Modify (replace stub): `src/components/interview/InterviewReview.tsx`

**Interfaces:**
- Consumes: `completeInterview` (Task 8), `contactKey` (Task 2), `StarRating` (`src/components/StarRating.tsx`), `CandidateCard` (Task 11).

- [ ] **Step 1: Implement**

```tsx
'use client';
import { useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { StarRating } from '@/components/StarRating';
import { completeInterview } from '@/app/actions/interviewComplete';
import { contactKey } from '@/domain/interview/facts';
import type { CandidateSummary, ContactValue, HouseholdValue, KnownFacts } from '@/domain/interview/types';
import CandidateCard from './CandidateCard';

const LABEL = 'block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider';
type Item = { key: string; label: string; contact?: ContactValue; address?: string; household?: HouseholdValue };

export default function InterviewReview({ interviewId, known, candidates, confirmedAdopterId, leadCandidateId, flush, onBack, onSaved }: {
    interviewId: string;
    known: KnownFacts;
    candidates: CandidateSummary[];
    confirmedAdopterId: string | null;
    leadCandidateId: string | null;
    flush: () => Promise<boolean>;
    onBack: () => void;
    onSaved: (adopterId: string) => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [target, setTarget] = useState<string | null>(confirmedAdopterId); // D2: no default unless started from a profile
    const [unticked, setUnticked] = useState<Set<string>>(new Set());
    const [rating, setRating] = useState(0);
    const [summary, setSummary] = useState('');
    const [saving, setSaving] = useState(false);
    const chosen = candidates.find(c => c.adopterId === target) ?? null;
    const canEdit = target === 'new' || !!chosen?.canEdit;

    const items: Item[] = useMemo(() => {
        const visibleKeys = new Set<string>();
        if (chosen) {
            chosen.visible.phones?.forEach(v => visibleKeys.add(`phone:${contactKey('phone', v)}`));
            chosen.visible.emails?.forEach(v => visibleKeys.add(`email:${contactKey('email', v)}`));
            chosen.visible.socials?.forEach(v => visibleKeys.add(`social:${contactKey('social', v)}`));
        }
        const contacts: ContactValue[] = [
            ...known.phones.map(value => ({ type: 'phone' as const, value })),
            ...known.emails.map(value => ({ type: 'email' as const, value })),
            ...known.socials.map(value => ({ type: 'social' as const, value })),
        ];
        return [
            ...contacts.map(c => {
                const k = `${c.type}:${contactKey(c.type, c.value)}`;
                return { key: k, label: `${t(`interview.contact_type_${c.type}`)}: ${c.value}${visibleKeys.has(k) ? ` (${t('interview.review_already')})` : ''}`, contact: c };
            }),
            ...(known.address ? [{ key: 'address', label: `${t('interview.prep_address')}: ${known.address}`, address: known.address }] : []),
            ...known.household.map((h, i) => ({ key: `hh:${i}`, label: `${h.name || '—'}${h.relationship ? ` · ${t(`adopter.hh_rel_${h.relationship}`)}` : ''}`, household: h })),
        ];
    }, [known, chosen, t]);

    async function save() {
        if (!target) { toast.warning(t('interview.review_pick_required')); return; }
        setSaving(true);
        try {
            await flush();
            const ticked = items.filter(i => !unticked.has(i.key));
            const r = await completeInterview(interviewId, {
                adopterId: target,
                additions: {
                    contacts: ticked.flatMap(i => i.contact ? [i.contact] : []),
                    address: ticked.find(i => i.address)?.address ?? null,
                    household: ticked.flatMap(i => i.household ? [i.household] : []),
                },
                rating: rating > 0 ? rating : null,
                summary: summary.trim() || null,
            });
            if (r.ok) onSaved(r.adopterId);
            else toast.error(t(r.error === 'disabled' ? 'interview.disabled' : 'interview.save_failed'), undefined, r.errorId);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('interview.save_failed'), userFacingMessage(e, t('interview.save_failed')), resolveErrorId(e, 'InterviewReview.save'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="max-w-3xl mx-auto space-y-6" data-testid="interview-review">
            <h1 className="text-xl font-bold text-stone-900">{t('interview.review_title')}</h1>

            <div>
                <h2 className={LABEL}>{t('interview.review_who')}</h2>
                <div className="grid gap-2 md:grid-cols-2" role="radiogroup">
                    {candidates.map(c => (
                        <CandidateCard key={c.adopterId} c={c} selected={target === c.adopterId} onSelect={() => setTarget(c.adopterId)}
                            selectLabel={c.displayName} badge={c.adopterId === leadCandidateId ? t('interview.prep_lead_selected') : undefined} />
                    ))}
                    {!confirmedAdopterId && (
                        <button type="button" data-testid="interview-review-new" role="radio" aria-checked={target === 'new'} onClick={() => setTarget('new')}
                            className={`text-left rounded-xl border p-3 bg-white ${target === 'new' ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-stone-200'}`}>
                            <span className="block text-sm font-semibold text-stone-900">{t('interview.review_new_person')}</span>
                            <span className="block text-xs text-stone-500 mt-0.5">{t('interview.review_new_person_desc')}</span>
                        </button>
                    )}
                </div>
            </div>

            {target && (
                <div>
                    <h2 className={LABEL}>{t('interview.review_add_title')}</h2>
                    {!canEdit ? <p className="text-sm text-stone-600">{t('interview.review_cannot_edit')}</p>
                        : items.length === 0 ? <p className="text-sm text-stone-600">{t('interview.review_nothing_new')}</p>
                        : (
                            <ul className="space-y-1.5">
                                {items.map(i => (
                                    <li key={i.key}>
                                        <label className="flex items-start gap-2 text-sm text-stone-800">
                                            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-700" checked={!unticked.has(i.key)}
                                                onChange={e => setUnticked(prev => { const n = new Set(prev); if (e.target.checked) n.delete(i.key); else n.add(i.key); return n; })} />
                                            <span className="break-all">{i.label}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                </div>
            )}

            <div>
                <label className={LABEL}>{t('interview.review_rating')}</label>
                <StarRating value={rating} onChange={setRating} size="lg" showLabel />
            </div>
            <div>
                <label className={LABEL} htmlFor="interview-summary">{t('interview.review_summary')}</label>
                <textarea id="interview-summary" rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000}
                    className="w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none resize-none text-base md:text-sm" />
                <p className="text-xs text-stone-500 mt-1">{t('interview.review_summary_public')}</p>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-teal-100/50">
                <button type="button" onClick={onBack} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">← {t('interview.review_back')}</button>
                <button type="button" data-testid="interview-review-save" disabled={saving || !target} onClick={save}
                    className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all">
                    {saving ? t('interview.saving') : t('interview.review_save')}
                </button>
            </div>
        </section>
    );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/interview/InterviewReview.tsx
git commit -m "feat(interview): review screen — explicit profile choice, additions, optional rating"
```

---

### Task 15: Read-only interview view

**Files:**
- Modify (replace stub): `src/components/interview/InterviewReadOnly.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import type { InterviewView } from '@/app/actions/interviewTypes';
import type { Answer } from '@/domain/interview/types';
import { questionText } from './questionText';

function formatAnswer(a: Answer, t: (k: string) => string): string {
    if (a.status === 'skipped') return t('interview.skipped');
    if (a.status === 'no_answer') return t('interview.not_answered');
    if (a.text) return a.text;
    if (a.choice) return t(`interview.choice.${a.choice}`);
    if (typeof a.number === 'number') return String(a.number);
    if (a.contacts?.length) return a.contacts.map(c => `${t(`interview.contact_type_${c.type}`)}: ${c.value}`).join(' · ');
    if (a.household?.length) return a.household.map(h => `${h.name}${h.relationship ? ` (${t(`adopter.hh_rel_${h.relationship}`)})` : ''}`).join(', ');
    return t('interview.not_answered');
}

export default function InterviewReadOnly({ view }: { view: InterviewView }) {
    const { t, locale } = useLanguage();
    const date = view.completedAt ? new Date(view.completedAt * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }) : '';
    const prepLines = [
        ...view.prep.phones, ...view.prep.emails, ...view.prep.socials, ...(view.prep.address ? [view.prep.address] : []),
    ];
    return (
        <article className="max-w-3xl mx-auto px-4 space-y-4" data-testid="interview-readonly">
            {view.adopterId && <a href={`/adopter/${view.adopterId}`} className="text-sm font-semibold text-teal-700 hover:underline">← {view.prep.name}</a>}
            <header>
                <h1 className="text-xl font-bold text-stone-900 break-words">{t('interview.readonly_title').replace('{name}', view.prep.name)}</h1>
                <p className="text-sm text-stone-600">{t('interview.readonly_by').replace('{who}', view.conductedByName).replace('{date}', date)}</p>
            </header>
            {prepLines.length > 0 && (
                <section className="bg-white rounded-2xl border border-stone-200 p-4">
                    <h2 className="text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">{t('interview.prep_section')}</h2>
                    <p className="text-sm text-stone-800 break-all">{prepLines.join(' · ')}</p>
                </section>
            )}
            <ol className="space-y-2">
                {view.visited.filter(id => view.answers[id]).map(id => (
                    <li key={id} className="bg-white rounded-2xl border border-stone-200 p-4">
                        <p className="text-sm font-semibold text-stone-900 break-words">{questionText(t, id, view.custom)}</p>
                        <p className="text-sm text-stone-700 mt-1 whitespace-pre-wrap break-words">{formatAnswer(view.answers[id], t)}</p>
                    </li>
                ))}
            </ol>
        </article>
    );
}
```

`DEFAULT_TIMEZONE` lives in `@/lib/dates`. Import and use it instead of the literal if it is exported (`grep -n "DEFAULT_TIMEZONE" src/lib/dates.ts`). Either way, always pass an explicit `timeZone`: the vitest TZ guard exists because of hydration bugs.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/interview/InterviewReadOnly.tsx
git commit -m "feat(interview): read-only completed interview view"
```

---

### Task 16: Entry points and timeline badge

**Files:**
- Create: `src/lib/interviews/links.ts`
- Test: `src/lib/interviews/links.test.ts`
- Modify: `src/app/adopter/[id]/page.tsx` (flag read ~L186, prop pass ~L212, attach links after `isOrgMateOfOwner` is resolved ~L147-164)
- Modify: `src/components/AdopterProfileV2.tsx` (props ~L73-77; pass to `<AdopterForm>` ~L442-470)
- Modify: `src/components/AdopterForm.tsx` (props interface L44; signature L123; overflow menu ~L1262-1342)
- Modify: `src/components/AdoptionHistory.tsx` (`Adoption` interface L23-45; header line ~L346-401)
- Modify: `src/types/adopter.ts` (`AdoptionRecord` L55-76)
- Modify: `src/components/UserMenu.tsx` (config effect L54-66; link next to `/my-adopters` L147-157)

**Interfaces:**
- Produces: `attachInterviewLinks<T extends { id: string; recordType?: string | null }>(db, rows: T[], ctx: { viewer: string; ownerEmail: string | null; viewerIsAdmin: boolean; viewerIsOrgMate: boolean }): Promise<Array<T & { interview?: { id: string; canViewAnswers: boolean } }>>`.

- [ ] **Step 1: Write the failing test** `src/lib/interviews/links.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { attachInterviewLinks } from './links';

describe('attachInterviewLinks', () => {
    it('marks completed-interview observations; answers link only for D7 viewers', async () => {
        const { db, sqlite } = migratedDb();
        sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, event_id) VALUES ('i1', 'ana@x.com', 'completed', 'standalone', 'ev1')`).run();
        sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, event_id) VALUES ('i2', 'ana@x.com', 'draft', 'standalone', 'ev2')`).run();
        const rows = [{ id: 'ev1', recordType: 'observation' }, { id: 'ev2', recordType: 'observation' }, { id: 'p1', recordType: 'adoption' }];

        const asStranger = await attachInterviewLinks(db, rows, { viewer: 'other@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false });
        expect(asStranger[0].interview).toEqual({ id: 'i1', canViewAnswers: false });
        expect(asStranger[1].interview).toBeUndefined();
        expect(asStranger[2].interview).toBeUndefined();

        const asOwner = await attachInterviewLinks(db, rows, { viewer: 'owner@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false });
        expect(asOwner[0].interview).toEqual({ id: 'i1', canViewAnswers: true });
    });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/interviews/links.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/interviews/links.ts`**

```ts
/**
 * Marks timeline observations that anchor a completed interview (spec §5.3).
 * One lookup per observation row (D1: no IN lists). A failed lookup degrades
 * to "no badge" and is logged.
 */
import { and, eq } from 'drizzle-orm';
import { interviews } from '@/db/schema';
import { canViewInterviewAnswers } from '@/domain/interview/access';
import { logger } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Db handle type the other action helpers take
type Db = any;

export async function attachInterviewLinks<T extends { id: string; recordType?: string | null }>(
    db: Db,
    rows: T[],
    ctx: { viewer: string; ownerEmail: string | null; viewerIsAdmin: boolean; viewerIsOrgMate: boolean },
): Promise<Array<T & { interview?: { id: string; canViewAnswers: boolean } }>> {
    return Promise.all(rows.map(async (row) => {
        if (row.recordType !== 'observation') return row;
        const hit = await db.select({ id: interviews.id, conductedBy: interviews.conductedBy })
            .from(interviews)
            .where(and(eq(interviews.eventId, row.id), eq(interviews.status, 'completed')))
            .get()
            .catch((e: unknown) => {
                logger.warn('attachInterviewLinks: D1 fallback hit', { eventId: row.id, error: e instanceof Error ? e.message : String(e) });
                return undefined;
            });
        if (!hit) return row;
        return {
            ...row,
            interview: {
                id: hit.id,
                canViewAnswers: canViewInterviewAnswers({ viewer: ctx.viewer, conductedBy: hit.conductedBy, ownerEmail: ctx.ownerEmail, viewerIsAdmin: ctx.viewerIsAdmin, viewerIsOrgMate: ctx.viewerIsOrgMate }),
            },
        };
    }));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/interviews/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the profile page** (`src/app/adopter/[id]/page.tsx`)

Next to the `pinnedVisitIntent` read (~L186):

```ts
    const interviewEnabled = !isNew && await getFeatureFlag('ENABLE_INTERVIEW_GUIDE');
```

After `isOrgMateOfOwner` is resolved (after the block ending ~L164), and before rendering:

```ts
    if (interviewEnabled && adopter && adoptions.length) {
        const { getDb } = await import('@/lib/db');
        const { attachInterviewLinks } = await import('@/lib/interviews/links');
        const db = await getDb();
        if (db) {
            adoptions = await attachInterviewLinks(db, adoptions, {
                viewer: currentUser, ownerEmail: adopter.addedBy ?? null, viewerIsAdmin: isAdmin, viewerIsOrgMate: isOrgMateOfOwner,
            });
        }
    }
```

Pass the flag down next to `pinnedVisitIntent={pinnedVisitIntent}`:

```tsx
            interviewEnabled={interviewEnabled}
```

- [ ] **Step 6: Thread the prop through `AdopterProfileV2` → `AdopterForm`**

`AdopterProfileV2Props` (next to `pinnedVisitIntent`):

```ts
    /** ENABLE_INTERVIEW_GUIDE — «Entrevistar» in the profile's ⋯ menu. */
    interviewEnabled?: boolean;
```

Add `interviewEnabled = false` to the destructured props, and pass `interviewEnabled={interviewEnabled}` to `<AdopterForm … />`.

`AdopterFormProps` (L44):

```ts
    /** ENABLE_INTERVIEW_GUIDE — adds «Entrevistar» to the overflow menu. */
    interviewEnabled?: boolean;
```

Add `interviewEnabled = false` to the signature at L123. In the overflow menu, add the first item before Share (same pattern as the Share button at ~L1277):

```tsx
                                                    {interviewEnabled && initialData?.id && (
                                                        <a href={`/interview?adopterId=${encodeURIComponent(initialData.id)}`} data-testid="profile-interview"
                                                            onClick={() => setShowReportMenu(false)}
                                                            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left">
                                                            <svg className="w-5 h-5 mt-0.5 text-teal-700" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                                                                <path d="M5.5 3h2l1 4-1.5 1a9 9 0 004.5 4.5l1-1.5 4 1v2a2 2 0 01-2 2A13 13 0 013.5 5a2 2 0 012-2z" strokeLinejoin="round" />
                                                            </svg>
                                                            <div>
                                                                <div className="text-sm font-semibold text-stone-900">{t('interview.start_from_profile')}</div>
                                                                <div className="text-xs text-stone-500 mt-0.5">{t('interview.start_from_profile_desc')}</div>
                                                            </div>
                                                        </a>
                                                    )}
```

(The surrounding menu items still use emoji for Share and others. Leave them alone; that is out of scope. The new item uses SVG.)

- [ ] **Step 7: The timeline badge** (`src/components/AdoptionHistory.tsx`)

Add to the local `Adoption` interface:

```ts
    interview?: { id: string; canViewAnswers: boolean };
```

Add the same optional field to `AdoptionRecord` in `src/types/adopter.ts`.

In the header `<p>` (after `{summary}` and the existing pills, before the `canEdit` pencil):

```tsx
                                                {adoption.interview && (
                                                    <span data-testid="interview-badge" className="ml-2 inline-flex items-center text-xs px-1.5 py-0.5 rounded font-medium bg-teal-50 text-teal-800 align-middle">
                                                        {t('interview.badge')}
                                                    </span>
                                                )}
                                                {adoption.interview?.canViewAnswers && (
                                                    <a href={`/interview/${adoption.interview.id}`} onClick={e => e.stopPropagation()} data-testid="interview-view-answers"
                                                        className="ml-2 inline-flex items-center text-xs font-semibold text-teal-700 hover:underline align-middle">
                                                        {t('interview.view_answers')}
                                                    </a>
                                                )}
```

- [ ] **Step 8: User menu link** (`src/components/UserMenu.tsx`)

Add state `const [interviewEnabled, setInterviewEnabled] = useState(false);`. In the existing `/api/config` effect, add:

```ts
                    if (cfg.config?.ENABLE_INTERVIEW_GUIDE === 'true') setInterviewEnabled(true);
```

Replace the effect's `.catch(() => { })` with a logged one (the house rule forbids silent catches, and you are touching this line):

```ts
            .catch((e) => { resolveErrorId(e, 'UserMenu.config'); });
```

Import `resolveErrorId` from `@/lib/clientErrorReporter` if it isn't imported already. After the `/my-adopters` `<Link>`:

```tsx
                            {interviewEnabled && (
                                <Link
                                    href="/interview"
                                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                                    onClick={() => setIsOpen(false)}
                                    data-testid="menu-interview"
                                >
                                    <svg className="w-4 h-4 text-stone-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                                        <path d="M5.5 3h2l1 4-1.5 1a9 9 0 004.5 4.5l1-1.5 4 1v2a2 2 0 01-2 2A13 13 0 013.5 5a2 2 0 012-2z" strokeLinejoin="round" />
                                    </svg>
                                    <span className="flex-1">{t('interview.menu')}</span>
                                </Link>
                            )}
```

- [ ] **Step 9: Type-check, lint, test, build**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test && npm run build && node scripts/check-action-surface.mjs`
Expected: all PASS. The action count is unchanged from Task 9, since `links.ts` is not `'use server'`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/interviews/links.ts src/lib/interviews/links.test.ts "src/app/adopter/[id]/page.tsx" src/components/AdopterProfileV2.tsx src/components/AdopterForm.tsx src/components/AdoptionHistory.tsx src/types/adopter.ts src/components/UserMenu.tsx
git commit -m "feat(interview): entry points (menu, profile) and Entrevista badge on the timeline"
```

---

### Task 17: End-to-end tests

**Files:**
- Create: `tests/interview-guide.authed.spec.ts` (runs in the `authed` project; one nested describe switches to the regular user's storage state)

**Interfaces:**
- Consumes: the `data-testid`s from Tasks 11–16, plus `dismissCountryBanner` from `tests/helpers.ts`.

Why one file, run serially:
- The flag lives in the shared local D1. Two spec files in different projects would toggle it concurrently and race.
- The duplicate engine finds profiles through `duplicate_tokens`, which raw SQL fixtures don't have. So the candidate test reuses the profile that test 1 creates through the real save path (tokenized), and the profile-entry tests use a raw fixture looked up by id (no tokens needed).

Before writing anything, grep all of `tests/` for anything the new menu or timeline items could shift: `grep -rn "menu-\|overflow\|nth(\|\.first()" tests/ | grep -i "menu\|history\|adoption"`.

- [ ] **Step 1: Write the spec** `tests/interview-guide.authed.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { dismissCountryBanner } from './helpers';

/**
 * ENABLE_INTERVIEW_GUIDE is off in the seed; this file turns it on for itself
 * and is the ONLY spec that touches it (serial, so toggles never race).
 * Fixtures: test-interview-fixture-* rows and a uniquely named created person.
 */
function execD1(sql: string): string {
    return execSync(`npx wrangler d1 execute DB --local --command="${sql.replace(/"/g, '\\"')}" --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const flagOn = () => execD1(`INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES ('ENABLE_INTERVIEW_GUIDE', 'true', strftime('%s','now'), 'e2e')`);
const flagOff = () => execD1(`DELETE FROM app_config WHERE key = 'ENABLE_INTERVIEW_GUIDE'`);

const FIXTURE = 'test-interview-fixture-1';
const FIXTURE_NAME = 'Rodolfo Entrevistafixture';
const FOREIGN = 'test-interview-fixture-2';
const FOREIGN_EVENT = 'test-interview-fixture-ev-2';
const FOREIGN_INTERVIEW = 'test-interview-fixture-iv-2';
const NEW_NAME = `Persona Entrevista ${Date.now()}`;
const NEW_PHONE = '11 7777 2233';

async function pastTechnique(page: Page) {
    const go = page.getByTestId('interview-technique-continue');
    if (await go.isVisible({ timeout: 15000 }).catch(() => false)) await go.click();
}

test.describe.configure({ mode: 'serial' });

test.describe('interview guide', () => {
    test.beforeAll(() => {
        flagOn();
        execD1(`INSERT OR REPLACE INTO adopters (id, name, contact_info, contact_entries, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${FIXTURE}', '${FIXTURE_NAME}', 'Tel: 11 4444 9911', '[{"type":"phone","value":"1144449911"}]', 'AR', '4', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`);
        // A completed interview by the ADMIN on a profile the regular user doesn't own.
        execD1(`INSERT OR REPLACE INTO adopters (id, name, country, status, added_by, deleted_at, created_at, updated_at) VALUES ('${FOREIGN}', 'Marta Entrevistada', 'AR', '4', 'gatitosolivos@gmail.com', NULL, strftime('%s','now'), strftime('%s','now'))`);
        execD1(`INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, rating, details, date, recorded_by) VALUES ('${FOREIGN_EVENT}', '${FOREIGN}', 'observation', 4, 'Resumen visible', strftime('%s','now'), 'gatitosolivos@gmail.com')`);
        execD1(`INSERT OR REPLACE INTO interviews (id, conducted_by, status, source_kind, prep_json, answers_json, candidate_ids_json, adopter_id, event_id, completed_at) VALUES ('${FOREIGN_INTERVIEW}', 'gatitosolivos@gmail.com', 'completed', 'standalone', '{}', '{}', '[]', '${FOREIGN}', '${FOREIGN_EVENT}', strftime('%s','now'))`);
    });

    test.afterAll(() => {
        execD1(`DELETE FROM adopter_events WHERE id = '${FOREIGN_EVENT}' OR adopter_id IN (SELECT id FROM adopters WHERE name = '${NEW_NAME}' OR id = '${FIXTURE}')`);
        execD1(`DELETE FROM interviews WHERE id = '${FOREIGN_INTERVIEW}' OR conducted_by = 'gatitosolivos@gmail.com'`);
        execD1(`DELETE FROM duplicate_tokens WHERE adopter_id IN (SELECT id FROM adopters WHERE name = '${NEW_NAME}')`);
        execD1(`DELETE FROM adopters WHERE name = '${NEW_NAME}' OR id IN ('${FIXTURE}', '${FOREIGN}')`);
        flagOff();
    });

    test('standalone: prep → technique → answers survive reload → save as new person → badge on profile', async ({ page }) => {
        await page.goto('/interview');
        await dismissCountryBanner(page);
        await page.getByTestId('interview-prep-name').fill(NEW_NAME);
        await page.getByTestId('interview-prep-phone-0').fill(NEW_PHONE);
        await page.getByTestId('interview-start').click();

        await expect(page.getByTestId('interview-technique')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('interview-technique-continue').click();

        await expect(page.getByTestId('interview-question')).toBeVisible();
        await page.getByTestId('interview-choice-yes').click();
        await page.getByTestId('interview-next').click();
        await page.getByTestId('interview-answer').fill('Por Instagram');
        await expect(page.getByTestId('interview-save-status')).toHaveText(/Guardado|Saved|Salvo/, { timeout: 15000 });

        await page.goto('/interview');
        await expect(page.getByTestId('interview-drafts')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('interview-drafts').getByRole('button', { name: /^(Continuar|Continue)$/ }).first().click();
        await expect(page.getByTestId('interview-rail-item-rapport_how_found')).toContainText(/Por Instagram/, { timeout: 30000 });

        await page.getByTestId('interview-finish').click();
        await page.getByTestId('interview-review-new').click();
        await page.getByTestId('interview-review-save').click();

        await expect(page).toHaveURL(/\/adopter\//, { timeout: 30000 });
        await expect(page.getByTestId('interview-badge').first()).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('interview-view-answers').first()).toBeVisible();
    });

    test('the same phone now surfaces that profile as a candidate', async ({ page }) => {
        await page.goto('/interview');
        await dismissCountryBanner(page);
        await page.getByTestId('interview-prep-name').fill(NEW_NAME);
        await page.getByTestId('interview-prep-phone-0').fill(NEW_PHONE);
        await expect(page.getByTestId('interview-candidate').filter({ hasText: NEW_NAME })).toBeVisible({ timeout: 30000 });
    });

    test('from a profile: starts confirmed and skips preparation', async ({ page }) => {
        await page.goto(`/interview?adopterId=${FIXTURE}`);
        await dismissCountryBanner(page);
        await pastTechnique(page);
        await expect(page.getByTestId('interview-candidate-status')).toContainText(FIXTURE_NAME, { timeout: 30000 });
        await expect(page.getByTestId('interview-prep-name')).toHaveCount(0);
    });

    test.describe('phone width', () => {
        test.use({ viewport: { width: 390, height: 844 } });
        test('no horizontal scroll; the rail opens as a drawer', async ({ page }) => {
            await page.goto(`/interview?adopterId=${FIXTURE}`);
            await dismissCountryBanner(page);
            await pastTechnique(page);
            await expect(page.getByTestId('interview-focus')).toBeVisible({ timeout: 30000 });
            await expect(page.getByTestId('interview-rail')).toBeHidden();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);
            await page.getByTestId('interview-rail-toggle').click();
            await expect(page.getByTestId('interview-rail')).toBeVisible();
        });
    });

    test.describe('another rescuer', () => {
        test.use({ storageState: '.auth/user.json' });
        test('sees that an interview happened (summary + rating) but cannot open the answers', async ({ page }) => {
            await page.goto(`/adopter/${FOREIGN}`);
            await dismissCountryBanner(page);
            await expect(page.getByTestId('interview-badge').first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText('Resumen visible')).toBeVisible();
            await expect(page.getByTestId('interview-view-answers')).toHaveCount(0);
            const res = await page.goto(`/interview/${FOREIGN_INTERVIEW}`);
            expect(res?.status()).toBe(404);
        });
    });

    test('flag off: /interview does not exist and the profile shows no entry point', async ({ page }) => {
        flagOff();
        const res = await page.goto('/interview');
        expect(res?.status()).toBe(404);
        await page.goto(`/adopter/${FIXTURE}`);
        await dismissCountryBanner(page);
        await expect(page.getByTestId('interview-badge')).toHaveCount(0);
        await expect(page.getByTestId('profile-interview')).toHaveCount(0);
    });
});
```

- [ ] **Step 3: Run the specs locally**

The local harness uses Node 20, a rebuilt better-sqlite3 and its own port (see the project memory "Playwright RUNS locally now"). From the worktree:

Run: `npx playwright test tests/interview-guide.authed.spec.ts --project=authed`
Expected: PASS.
- If the profile test can't find the badge, confirm the observation row's `id` in the `adoptions` view equals `adopter_events.id` (view in `drizzle/0076_animal_listed.sql`).
- If `/interview` returns 200 with the flag off, check that no env var `ENABLE_INTERVIEW_GUIDE` is set: env wins over DB in `getFeatureFlag`.
- If the candidate test finds nothing, check that the created person was tokenized: `SELECT count(*) FROM duplicate_tokens WHERE adopter_id = (SELECT id FROM adopters WHERE name LIKE 'Persona Entrevista%')`. `saveAdopter` tokenizes synchronously.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test && npm run build && node scripts/check-action-surface.mjs`
Expected: all PASS; lint ≤ 125.

- [ ] **Step 5: Commit**

```bash
git add tests/interview-guide.authed.spec.ts
git commit -m "test(interview): e2e — standalone flow, resume, profile entry, phone width, D7 visibility, flag off"
```

---

## After the plan (not part of execution)

- **Before any push:** an independent review of the server actions (`interviews.ts`, `interviewComplete.ts`, `links.ts`, `candidates.ts`), since they are auth- and PII-adjacent. Then rebase on the latest `origin/staging`, bump the version above `origin/staging`'s, add a CHANGELOG entry, and follow `.agents/workflows/deploy.md`.
- **Before flag-on:**
  - Jon edits the Spanish question bank and coaching text (D5).
  - A staging walkthrough with `ENABLE_PII_ACCESS_GATING=true`: interview someone whose profile another test rescuer owns, and confirm no protected value appears in the candidate card or the hint.
