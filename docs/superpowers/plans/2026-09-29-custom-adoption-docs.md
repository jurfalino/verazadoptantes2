# Custom Adoption Form & Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each rescuer and each group turn predefined PetShield form questions on or off and rewrite contract sections 2–4 in a small rich-text editor, choosing in /settings whose documents they share, behind `ENABLE_CUSTOM_ADOPTION_DOCS`, without changing anything for anyone who hasn't customized.

**Architecture:**
- Settings live in two D1 tables: one row of settings per owner, and contract versions that become immutable once signed.
- The public contract-app asks the Next API for the resolved configuration, which is additive JSON fields. It falls back to today's hardcoded standard when a field is absent or anything fails.
- Pure logic lives in `src/domain/adoptionDocs.ts` (Next) and `contract-app/src/lib/adoptionDocs.ts` (Vite), both unit-tested. Mirror tests keep the two copies in sync.

**Tech Stack:** Next.js 15 (App Router, edge runtime), Cloudflare D1 + Drizzle, zod, vitest, TipTap v3 (Next app only), Vite + React 19 + jsPDF (contract-app), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-custom-adoption-docs-design.md` (read it first). Research: `docs/research/2026-09-28-adoption-forms-contracts.md`.

**Working directory:** `/Users/jurfalino/Developer/Personal/verazadoptantes2-custom-forms` (git worktree, branch `feature/custom-form-contract`). Never touch `/Users/jurfalino/Developer/Personal/verazadoptantes2` (another branch with uncommitted work).

## Global Constraints

- **With no settings row, or the flag off, the form and contract are byte-identical to today.** Characterization tests (Task 1, Task 7) must pass before and after every change.
- **Flag:** `ENABLE_CUSTOM_ADOPTION_DOCS`, default `false`.
- **D1:** never use `inArray()` or `sql\`IN ${array}\``. Fan out with `Promise.all`.
- **Every catch logs with operation context.** Never swallow silently. `.catch(() => [])` is forbidden; log at `warn` first.
- **Server actions** return `{ success, data?, error?, errorId? }`, with `errorId = logger.error(...)`.
- **i18n:** every new Next string goes into `src/i18n/locales/es.ts`, `en.ts` and `pt.ts` (a missing pt key fails `tsc` with TS2719). Every new contract-app string goes into its catalogs for es, en and pt.
- **UI rules:**
  - 8px grid; theme-safe colors only (stone/teal or CSS vars; no `bg-blue-*`, no hex).
  - SVG icons, never emoji.
  - Buttons follow the matrix in `docs/design-style-guide.md`: `rounded-xl`, primary `py-3 px-6`, compact `py-2 px-4`.
  - Inputs `text-base` (16px); tap targets ≥ 44px.
- **Git:**
  - **Never `git add -A` / `git add .` / `git add -u`.** `.wrangler/**.sqlite` and `local.db` are tracked seed DBs. Stage explicit paths only.
  - Never `--no-verify`.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Migrations are hand-written SQL** in `drizzle/`. Do not run `drizzle-kit generate` (it hangs). Mirror every change in `src/db/schema.ts`.
- **Legal copy:** the standard contract `es` text is authoritative. Never alter it; en and pt stay as-is.
- **Locked form steps:** `legal`, `identity-name`, `identity-email`, `identity-phone`, `identity-address`.
- **Locked contract parts:** intro, parties, section 1, section 5, signatures.
- **Lint warnings must not exceed the ratchet**, currently 125 (`npm run lint`).

## Review Focus

1. **A stale localStorage draft from before this change** (global key `petshield_draft`, restored by index) opens a form whose steps differ. The adopter should keep their answers and land on a sensible step, never a blank or crashing form. Covered by `restoreStepIndex` tests in Task 7.
2. **The rescuer edits the contract while an adopter has it open, and the adopter then signs.** The signature must succeed and record the version they saw; that version must not be deleted for 30 days. Covered by the `planContractSave` tests (Task 1) and the submit-route rule "missing version → warn + still record" (Task 6).
3. **Pasted rich text with unexpected nodes** (headings, links, images, code, tables from Word or Docs) must be reduced to the allowed formats, never rejected or rendered raw. Covered by the `tiptapToRichDoc` tests (Task 10) and the `richDocSchema` normalization tests (Task 1).
4. **A user picks a group, then leaves it,** or the group is deleted. Their links must keep working, with their own documents. Covered by `resolveDocsOwner` tests (Task 1).
5. **The server says to hide a locked step** (bad data or a forged row). The form must still ask for name, email, phone, address and terms. Covered by `applyHiddenSteps` tests (Task 7) and `sanitizeHiddenSteps` tests (Task 1).

---

## File Structure

**Next app (create):**
- `drizzle/0069_adoption_docs.sql`: `adoption_doc_settings`, `contract_versions`, `signed_contracts`
- `drizzle/0070_adoption_docs_columns.sql`: `user_profiles.adoption_docs_source`, `form_submissions.shown_steps`
- `src/domain/adoptionDocs.ts` + `src/domain/adoptionDocs.test.ts`: pure rules
- `src/domain/standardContractText.ts` + `src/domain/standardContractText.test.ts`: es sections 2 to 5 and conversion to RichDoc; mirror test against contract-app
- `src/lib/adoptionDocsRepo.ts`: D1 reads and writes, resolution for public routes
- `src/app/actions/adoptionDocs.ts`: authenticated server actions
- `src/lib/tiptapRichDoc.ts` + `src/lib/tiptapRichDoc.test.ts`: conversion between TipTap JSON and RichDoc
- `src/components/adoptionDocs/RichTextEditor.tsx`: TipTap editor with a B/I/U/bullets toolbar
- `src/components/adoptionDocs/FormStepsEditor.tsx`: Formulario tab
- `src/components/adoptionDocs/ContractSectionsEditor.tsx`: Contrato tab
- `src/components/adoptionDocs/RichDocPreview.tsx`: read-only rendering of a RichDoc (preview of sections 1 and 5 uses plain text)
- `src/components/AdoptionDocsSettingsSection.tsx`: the card on /settings
- `src/app/settings/adoption-docs/page.tsx`: the editor page
- `tests/adoption-docs.spec.ts`: API-level E2E

**Next app (modify):**
- `src/db/schema.ts`
- `src/config/features.ts`, `src/lib/publicConfig.ts`
- `src/app/admin/(admin-only)/config/page.tsx`, `src/app/api/admin/config/route.ts`
- `src/i18n/locales/{es,en,pt}.ts`
- `src/app/api/form/[userId]/route.ts`, `src/app/api/form/[userId]/submit/route.ts`
- `src/app/api/contract/[id]/route.ts`, `src/app/api/contract/by-token/[token]/route.ts`, `src/app/api/contract/[id]/submit/route.ts`
- `src/app/settings/page.tsx`, `src/app/organizations/page.tsx`
- `src/app/actions/activity.ts`, `src/components/OrgActivityFeed.tsx`
- `tests/seed.sql`, only if it lists flags

**contract-app (create):**
- `contract-app/src/lib/adoptionDocs.ts` + `contract-app/src/lib/adoptionDocs.test.ts`
- `contract-app/src/lib/pdfRichDoc.ts` + `contract-app/src/lib/pdfRichDoc.test.ts`: word-level layout for jsPDF
- `contract-app/src/components/RichDocView.tsx`
- `contract-app/vitest.config.ts`

**contract-app (modify):**
- `contract-app/package.json`
- `contract-app/src/PetShieldForm.tsx`, `contract-app/src/ContractPage.tsx`, `contract-app/src/contractPdf.ts`
- `.github/workflows/contract-app.yml`

---

## Task 0: Environment

- [ ] **Step 1: Install dependencies in the worktree**

```bash
cd /Users/jurfalino/Developer/Personal/verazadoptantes2-custom-forms
npm ci
(cd contract-app && npm ci)
```

- [ ] **Step 2: Baseline checks, and record the numbers**

```bash
npx tsc --noEmit 2>&1 | tail -3
npx vitest run 2>&1 | tail -5
npm run lint 2>&1 | grep -E "problems|warnings" | tail -2
```

Expected: tsc clean and vitest green. Note the lint warning count; it must not grow past 125.

---

## Task 1: Domain rules (Next)

**Files:**
- Create: `src/domain/adoptionDocs.ts`
- Test: `src/domain/adoptionDocs.test.ts`

**Interfaces (Produces):**

```ts
export const FORM_STEP_IDS: readonly string[]            // 23 ids, form order
export const LOCKED_FORM_STEPS: readonly string[]
export const TOGGLEABLE_FORM_STEPS: readonly string[]    // FORM_STEP_IDS minus locked
export const FORM_STEP_GROUPS: ReadonlyArray<{ key: 'what'|'home'|'commitments'|'person'; steps: readonly string[] }>
export function sanitizeHiddenSteps(input: unknown): string[]
export function sanitizeShownSteps(input: unknown): string[] | null
export type DocsSource = { type: 'self' } | { type: 'org'; orgId: string }
export function parseDocsSource(raw: string | null | undefined): DocsSource
export function serializeDocsSource(s: DocsSource): string | null   // self → null, org → 'org:<id>'
export type DocsOwner = { ownerType: 'user' | 'org'; ownerId: string }
export function resolveDocsOwner(userEmail: string, source: DocsSource, memberOrgIds: readonly string[]): DocsOwner
export function normalizeEmail(e: string): string
export type Mark = 'bold' | 'italic' | 'underline'
export type Inline = { text: string; marks?: Mark[] }
export type Block = { type: 'paragraph'; content: Inline[] } | { type: 'bulletList'; items: Inline[][] }
export type RichDoc = { type: 'doc'; content: Block[] }
export type SectionKey = '2' | '3' | '4'
export const SECTION_KEYS: readonly SectionKey[]
export type ContractSections = Partial<Record<SectionKey, RichDoc>>
export const richDocSchema: z.ZodType<RichDoc>
export const contractSectionsSchema: z.ZodType<ContractSections>
export function normalizeRichDoc(doc: RichDoc): RichDoc | null    // null = no text
export function normalizeSections(input: ContractSections): ContractSections
export function isStandardSections(s: ContractSections): boolean
export function canonicalSectionsJson(s: ContractSections): string
export function planContractSave(current: { contentHash: string } | null, nextHash: string | null): 'noop' | 'setStandard' | 'insert'
export function deriveSpecialNeeds(body: { specialNeeds?: unknown; shownSteps?: unknown; animalId?: unknown }): 0 | 1 | null
export const RICH_DOC_LIMITS: { maxChars: 8000; maxBlocks: 200 }
export const UNSIGNED_VERSION_TTL_SECONDS = 30 * 24 * 3600
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/adoptionDocs.test.ts
import { describe, it, expect } from 'vitest';
import {
    FORM_STEP_IDS, LOCKED_FORM_STEPS, TOGGLEABLE_FORM_STEPS, FORM_STEP_GROUPS,
    sanitizeHiddenSteps, sanitizeShownSteps, parseDocsSource, serializeDocsSource,
    resolveDocsOwner, normalizeRichDoc, normalizeSections, isStandardSections,
    canonicalSectionsJson, planContractSave, deriveSpecialNeeds, richDocSchema,
    contractSectionsSchema, type RichDoc,
} from './adoptionDocs';

const doc = (...texts: string[]): RichDoc => ({ type: 'doc', content: texts.map(t => ({ type: 'paragraph', content: [{ text: t }] })) });

describe('form steps', () => {
    it('lists the 23 PetShield steps in form order', () => {
        expect(FORM_STEP_IDS).toEqual([
            'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'children', 'existingPets',
            'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience', 'willingToSterilize',
            'vetCommitment', 'movingPlans', 'vacationPlan', 'identity-name', 'identity-email',
            'identity-phone', 'identity-address', 'ageRange', 'geo', 'selfie',
        ]);
    });
    it('locks terms + identity', () => {
        expect(LOCKED_FORM_STEPS).toEqual(['legal', 'identity-name', 'identity-email', 'identity-phone', 'identity-address']);
        expect(TOGGLEABLE_FORM_STEPS).toHaveLength(18);
    });
    it('groups cover every toggleable step exactly once', () => {
        const all = FORM_STEP_GROUPS.flatMap(g => g.steps).filter(s => !LOCKED_FORM_STEPS.includes(s));
        expect([...all].sort()).toEqual([...TOGGLEABLE_FORM_STEPS].sort());
    });
    it('sanitizeHiddenSteps drops unknown, locked, duplicates and non-strings; keeps form order', () => {
        expect(sanitizeHiddenSteps(['selfie', 'legal', 'nope', 'children', 'selfie', 3])).toEqual(['children', 'selfie']);
        expect(sanitizeHiddenSteps('children')).toEqual([]);
        expect(sanitizeHiddenSteps(null)).toEqual([]);
    });
    it('sanitizeShownSteps keeps known ids (locked included), null when not an array', () => {
        expect(sanitizeShownSteps(['legal', 'x', 'intent'])).toEqual(['legal', 'intent']);
        expect(sanitizeShownSteps(undefined)).toBeNull();
    });
});

describe('docs source', () => {
    it('parses and serializes', () => {
        expect(parseDocsSource(null)).toEqual({ type: 'self' });
        expect(parseDocsSource('self')).toEqual({ type: 'self' });
        expect(parseDocsSource('org:abc')).toEqual({ type: 'org', orgId: 'abc' });
        expect(parseDocsSource('org:')).toEqual({ type: 'self' });
        expect(parseDocsSource('garbage')).toEqual({ type: 'self' });
        expect(serializeDocsSource({ type: 'self' })).toBeNull();
        expect(serializeDocsSource({ type: 'org', orgId: 'abc' })).toBe('org:abc');
    });
    it('resolves to the org only while the user is a member', () => {
        expect(resolveDocsOwner('Ana@X.com ', { type: 'org', orgId: 'o1' }, ['o1'])).toEqual({ ownerType: 'org', ownerId: 'o1' });
        expect(resolveDocsOwner('Ana@X.com', { type: 'org', orgId: 'o1' }, [])).toEqual({ ownerType: 'user', ownerId: 'ana@x.com' });
        expect(resolveDocsOwner('ana@x.com', { type: 'self' }, ['o1'])).toEqual({ ownerType: 'user', ownerId: 'ana@x.com' });
    });
});

describe('rich doc', () => {
    it('normalizes: drops empty runs, empty paragraphs at the edges, empty list items; sorts marks', () => {
        const input: RichDoc = { type: 'doc', content: [
            { type: 'paragraph', content: [] },
            { type: 'paragraph', content: [{ text: '' }, { text: 'Hola', marks: ['underline', 'bold', 'bold'] }] },
            { type: 'bulletList', items: [[{ text: '' }], [{ text: 'uno' }]] },
            { type: 'bulletList', items: [[{ text: '' }]] },
            { type: 'paragraph', content: [{ text: '' }] },
        ] };
        expect(normalizeRichDoc(input)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Hola', marks: ['bold', 'underline'] }] },
            { type: 'bulletList', items: [[{ text: 'uno' }]] },
        ] });
    });
    it('keeps an empty paragraph between two texts (spacing)', () => {
        const n = normalizeRichDoc(doc('a', '', 'b'))!;
        expect(n.content).toHaveLength(3);
    });
    it('returns null for a doc with no text', () => {
        expect(normalizeRichDoc(doc('', '   '))).toBeNull();
    });
    it('schema rejects unknown node types, marks and oversize docs', () => {
        expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'heading', content: [] }] }).success).toBe(false);
        expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x', marks: ['link'] }] }] }).success).toBe(false);
        expect(richDocSchema.safeParse(doc('x'.repeat(8001))).success).toBe(false);
        expect(richDocSchema.safeParse(doc(...Array(201).fill('x'))).success).toBe(false);
        expect(richDocSchema.safeParse(doc('ok')).success).toBe(true);
    });
    it('sections schema only allows keys 2, 3, 4', () => {
        expect(contractSectionsSchema.safeParse({ '5': doc('x') }).success).toBe(false);
        expect(contractSectionsSchema.safeParse({ '2': doc('x') }).success).toBe(true);
    });
    it('normalizeSections drops empty sections; isStandardSections when none remain', () => {
        const s = normalizeSections({ '2': doc('  '), '3': doc('x') });
        expect(Object.keys(s)).toEqual(['3']);
        expect(isStandardSections(normalizeSections({ '2': doc('') }))).toBe(true);
    });
    it('canonical JSON is key-order independent', () => {
        expect(canonicalSectionsJson({ '4': doc('b'), '2': doc('a') })).toBe(canonicalSectionsJson({ '2': doc('a'), '4': doc('b') }));
    });
});

describe('planContractSave', () => {
    it('standard → standard is a no-op', () => expect(planContractSave(null, null)).toBe('noop'));
    it('custom → standard resets', () => expect(planContractSave({ contentHash: 'h1' }, null)).toBe('setStandard'));
    it('same content is a no-op', () => expect(planContractSave({ contentHash: 'h1' }, 'h1')).toBe('noop'));
    it('new content inserts a version', () => {
        expect(planContractSave(null, 'h1')).toBe('insert');
        expect(planContractSave({ contentHash: 'h1' }, 'h2')).toBe('insert');
    });
});

describe('deriveSpecialNeeds', () => {
    it('null when the step was not shown', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true, shownSteps: ['legal'] })).toBeNull();
    });
    it('0/1 when shown', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true, shownSteps: ['specialNeeds'] })).toBe(1);
        expect(deriveSpecialNeeds({ shownSteps: ['specialNeeds'] })).toBe(0);
    });
    it('old client for a specific animal (no shownSteps) never saw the step', () => {
        expect(deriveSpecialNeeds({ animalId: 'a1' })).toBeNull();
    });
    it('old client, generic form: today’s behaviour', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true })).toBe(1);
        expect(deriveSpecialNeeds({})).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/adoptionDocs.test.ts`
Expected: FAIL, "Cannot find module './adoptionDocs'"

- [ ] **Step 3: Implement**

```ts
// src/domain/adoptionDocs.ts
/**
 * Custom adoption form + contract — pure rules (spec:
 * docs/superpowers/specs/2026-09-29-custom-adoption-docs-design.md).
 * NO DB / server imports. contract-app mirrors FORM_STEP_IDS in
 * contract-app/src/lib/adoptionDocs.ts (mirror test guards drift).
 */
import { z } from 'zod';

export const FORM_STEP_IDS = [
    'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'children', 'existingPets',
    'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience', 'willingToSterilize',
    'vetCommitment', 'movingPlans', 'vacationPlan', 'identity-name', 'identity-email',
    'identity-phone', 'identity-address', 'ageRange', 'geo', 'selfie',
] as const;

/** Terms consent + identity feed the adopter record and dedup — never hideable. */
export const LOCKED_FORM_STEPS = ['legal', 'identity-name', 'identity-email', 'identity-phone', 'identity-address'] as const;

const LOCKED = new Set<string>(LOCKED_FORM_STEPS);
const KNOWN = new Set<string>(FORM_STEP_IDS);

export const TOGGLEABLE_FORM_STEPS = FORM_STEP_IDS.filter(id => !LOCKED.has(id));

export const FORM_STEP_GROUPS = [
    { key: 'what', steps: ['species', 'lifeStage', 'specialNeeds', 'intent'] },
    { key: 'home', steps: ['children', 'existingPets', 'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience'] },
    { key: 'commitments', steps: ['willingToSterilize', 'vetCommitment', 'movingPlans', 'vacationPlan'] },
    { key: 'person', steps: ['identity-name', 'identity-email', 'identity-phone', 'identity-address', 'ageRange', 'geo', 'selfie'] },
] as const;

function inFormOrder(ids: Set<string>): string[] {
    return FORM_STEP_IDS.filter(id => ids.has(id));
}

export function sanitizeHiddenSteps(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const keep = new Set<string>();
    for (const v of input) if (typeof v === 'string' && KNOWN.has(v) && !LOCKED.has(v)) keep.add(v);
    return inFormOrder(keep);
}

export function sanitizeShownSteps(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;
    const keep = new Set<string>();
    for (const v of input) if (typeof v === 'string' && KNOWN.has(v)) keep.add(v);
    return inFormOrder(keep);
}

export type DocsSource = { type: 'self' } | { type: 'org'; orgId: string };

export function parseDocsSource(raw: string | null | undefined): DocsSource {
    if (raw && raw.startsWith('org:') && raw.length > 4) return { type: 'org', orgId: raw.slice(4) };
    return { type: 'self' };
}

export function serializeDocsSource(s: DocsSource): string | null {
    return s.type === 'org' ? `org:${s.orgId}` : null;
}

export type DocsOwner = { ownerType: 'user' | 'org'; ownerId: string };

export function normalizeEmail(e: string): string {
    return e.trim().toLowerCase();
}

/** A group the user no longer belongs to silently falls back to their own docs. */
export function resolveDocsOwner(userEmail: string, source: DocsSource, memberOrgIds: readonly string[]): DocsOwner {
    if (source.type === 'org' && memberOrgIds.includes(source.orgId)) return { ownerType: 'org', ownerId: source.orgId };
    return { ownerType: 'user', ownerId: normalizeEmail(userEmail) };
}

// ── Rich text ──────────────────────────────────────────────────────
export type Mark = 'bold' | 'italic' | 'underline';
export type Inline = { text: string; marks?: Mark[] };
export type Block = { type: 'paragraph'; content: Inline[] } | { type: 'bulletList'; items: Inline[][] };
export type RichDoc = { type: 'doc'; content: Block[] };
export type SectionKey = '2' | '3' | '4';
export const SECTION_KEYS: readonly SectionKey[] = ['2', '3', '4'];
export type ContractSections = Partial<Record<SectionKey, RichDoc>>;

export const RICH_DOC_LIMITS = { maxChars: 8000, maxBlocks: 200 } as const;
export const UNSIGNED_VERSION_TTL_SECONDS = 30 * 24 * 3600;

const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline'];
const markSchema = z.enum(['bold', 'italic', 'underline']);
const inlineSchema = z.object({ text: z.string(), marks: z.array(markSchema).optional() }).strict();
const blockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('paragraph'), content: z.array(inlineSchema) }).strict(),
    z.object({ type: z.literal('bulletList'), items: z.array(z.array(inlineSchema)) }).strict(),
]);

function docChars(d: RichDoc): number {
    let n = 0;
    for (const b of d.content) {
        if (b.type === 'paragraph') for (const i of b.content) n += i.text.length;
        else for (const item of b.items) for (const i of item) n += i.text.length;
    }
    return n;
}

export const richDocSchema = z.object({ type: z.literal('doc'), content: z.array(blockSchema).max(RICH_DOC_LIMITS.maxBlocks) }).strict()
    .refine(d => docChars(d as RichDoc) <= RICH_DOC_LIMITS.maxChars, { message: 'too_long' }) as unknown as z.ZodType<RichDoc>;

export const contractSectionsSchema = z.object({
    '2': richDocSchema.optional(),
    '3': richDocSchema.optional(),
    '4': richDocSchema.optional(),
}).strict() as unknown as z.ZodType<ContractSections>;

function normInlines(runs: Inline[]): Inline[] {
    const out: Inline[] = [];
    for (const r of runs) {
        if (!r.text) continue;
        const marks = MARK_ORDER.filter(m => r.marks?.includes(m));
        out.push(marks.length ? { text: r.text, marks } : { text: r.text });
    }
    return out;
}

const hasText = (runs: Inline[]) => runs.some(r => r.text.trim().length > 0);

export function normalizeRichDoc(doc: RichDoc): RichDoc | null {
    const blocks: Block[] = [];
    for (const b of doc.content) {
        if (b.type === 'paragraph') {
            blocks.push({ type: 'paragraph', content: normInlines(b.content) });
        } else {
            const items = b.items.map(normInlines).filter(hasText);
            if (items.length) blocks.push({ type: 'bulletList', items });
        }
    }
    const isBlank = (b: Block) => b.type === 'paragraph' && !hasText(b.content);
    while (blocks.length && isBlank(blocks[0])) blocks.shift();
    while (blocks.length && isBlank(blocks[blocks.length - 1])) blocks.pop();
    if (!blocks.length) return null;
    return { type: 'doc', content: blocks };
}

export function normalizeSections(input: ContractSections): ContractSections {
    const out: ContractSections = {};
    for (const k of SECTION_KEYS) {
        const d = input[k];
        if (!d) continue;
        const n = normalizeRichDoc(d);
        if (n) out[k] = n;
    }
    return out;
}

export function isStandardSections(s: ContractSections): boolean {
    return SECTION_KEYS.every(k => !s[k]);
}

/** Stable JSON for hashing: fixed section-key order, fixed property order. */
export function canonicalSectionsJson(s: ContractSections): string {
    const ordered: Record<string, unknown> = {};
    for (const k of SECTION_KEYS) {
        const d = s[k];
        if (!d) continue;
        ordered[k] = {
            type: 'doc',
            content: d.content.map(b => b.type === 'paragraph'
                ? { type: 'paragraph', content: b.content.map(i => (i.marks?.length ? { text: i.text, marks: i.marks } : { text: i.text })) }
                : { type: 'bulletList', items: b.items.map(it => it.map(i => (i.marks?.length ? { text: i.text, marks: i.marks } : { text: i.text }))) }),
        };
    }
    return JSON.stringify(ordered);
}

/**
 * What a contract save does. Versions are never updated in place: an adopter
 * may have the current one open. 'insert' marks the current one replaced and
 * adds a new row; 'setStandard' marks it replaced and points back to standard.
 */
export function planContractSave(current: { contentHash: string } | null, nextHash: string | null): 'noop' | 'setStandard' | 'insert' {
    if (nextHash === null) return current ? 'setStandard' : 'noop';
    if (current && current.contentHash === nextHash) return 'noop';
    return 'insert';
}

/**
 * form_submissions.special_needs. A step the adopter never saw is NULL, not
 * "no" — otherwise the adoption request reads "No busca animales con
 * necesidades especiales" for a question nobody asked. An old contract-app
 * sends no shownSteps; for a specific animal it always hid this step.
 */
export function deriveSpecialNeeds(body: { specialNeeds?: unknown; shownSteps?: unknown; animalId?: unknown }): 0 | 1 | null {
    const shown = sanitizeShownSteps(body.shownSteps);
    if (shown) return shown.includes('specialNeeds') ? (body.specialNeeds ? 1 : 0) : null;
    if (typeof body.animalId === 'string' && body.animalId.trim()) return null;
    return body.specialNeeds ? 1 : 0;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/domain/adoptionDocs.test.ts`
Expected: PASS. If the zod `.strict()` on a discriminated union member errors in this zod version, use `z.object({...})` without `.strict()` for block members and keep `.strict()` on the doc. The "unknown node type" test must still fail parsing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/adoptionDocs.ts src/domain/adoptionDocs.test.ts
git commit -m "feat(adoption-docs): pure rules for form steps, sources and contract rich text"
```

---

## Task 2: Standard contract text in the Next app, plus the mirror guard

**Files:**
- Create: `src/domain/standardContractText.ts`
- Test: `src/domain/standardContractText.test.ts`

**Interfaces:**
- Consumes: `RichDoc`, `SectionKey` from Task 1.
- Produces:
  ```ts
  export interface StdClause { title?: string; body: string }
  export interface StdSection { title: string; intro?: string; clauses: StdClause[] }
  export const STANDARD_SECTIONS_ES: { '2': StdSection; '3': StdSection; '4': StdSection; '5': StdSection }
  export function standardSectionToRichDoc(s: StdSection): RichDoc
  export const STANDARD_RICH_DOCS: Record<SectionKey, RichDoc>
  ```

- [ ] **Step 1: Failing test**

```ts
// src/domain/standardContractText.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARD_SECTIONS_ES, standardSectionToRichDoc, STANDARD_RICH_DOCS } from './standardContractText';
import { normalizeRichDoc, canonicalSectionsJson } from './adoptionDocs';

const contractAppSource = readFileSync(join(__dirname, '../../contract-app/src/i18n/contractContent.ts'), 'utf8');

describe('standard contract text mirror', () => {
    it('every es title/intro/clause string exists verbatim in contract-app contractContent.ts', () => {
        for (const s of Object.values(STANDARD_SECTIONS_ES)) {
            const strings = [s.title, s.intro, ...s.clauses.flatMap(c => [c.title, c.body])].filter(Boolean) as string[];
            for (const str of strings) expect(contractAppSource).toContain(`'${str}'`);
        }
    });
});

describe('standardSectionToRichDoc', () => {
    it('intro paragraph, then one paragraph per clause with a bold title run', () => {
        const d = standardSectionToRichDoc(STANDARD_SECTIONS_ES['2']);
        expect(d.content[0]).toEqual({ type: 'paragraph', content: [{ text: STANDARD_SECTIONS_ES['2'].intro }] });
        expect(d.content[1]).toEqual({ type: 'paragraph', content: [
            { text: 'Bienestar y Trato:', marks: ['bold'] },
            { text: ' ' + STANDARD_SECTIONS_ES['2'].clauses[0].body },
        ] });
    });
    it('untitled clauses are plain paragraphs', () => {
        const d = standardSectionToRichDoc(STANDARD_SECTIONS_ES['4']);
        expect(d.content[0]).toEqual({ type: 'paragraph', content: [{ text: STANDARD_SECTIONS_ES['4'].clauses[0].body }] });
    });
    it('standard docs are already normalized (so "unchanged" compares equal)', () => {
        for (const k of ['2', '3', '4'] as const) {
            expect(canonicalSectionsJson({ [k]: normalizeRichDoc(STANDARD_RICH_DOCS[k])! })).toBe(canonicalSectionsJson({ [k]: STANDARD_RICH_DOCS[k] }));
        }
    });
});
```

- [ ] **Step 2: Run it.** `npx vitest run src/domain/standardContractText.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Copy the `es` `sections` array **verbatim** from `contract-app/src/i18n/contractContent.ts` (the `es` object, `sections:` at about line 92). Section 2 is index 0, 3 is index 1, 4 is index 2, 5 is index 3.

```ts
// src/domain/standardContractText.ts
/**
 * The authoritative Spanish text of contract sections 2–5, mirrored from
 * contract-app/src/i18n/contractContent.ts (the contract-app is a separate
 * package and can't be imported). standardContractText.test.ts fails if the
 * two drift. Used by the editor (pre-fill + read-only preview) only — the
 * public contract still renders from contract-app's own copy.
 */
import type { RichDoc, SectionKey } from './adoptionDocs';

export interface StdClause { title?: string; body: string }
export interface StdSection { title: string; intro?: string; clauses: StdClause[] }

export const STANDARD_SECTIONS_ES: { '2': StdSection; '3': StdSection; '4': StdSection; '5': StdSection } = {
    '2': {
        title: '2. COMPROMISOS DEL ADOPTANTE',
        intro: 'El adoptante declara aceptar la tenencia del animal bajo las siguientes cláusulas obligatorias:',
        clauses: [
            // …copy the 5 clauses verbatim (title + body)…
        ],
    },
    '3': { title: '3. SEGUIMIENTO Y NO ABANDONO', clauses: [ /* 2 clauses verbatim */ ] },
    '4': { title: '4. INCUMPLIMIENTO Y PROTECCIÓN ANIMAL', clauses: [ /* 2 untitled clauses verbatim */ ] },
    '5': { title: '5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO', clauses: [ /* 1 clause verbatim */ ] },
};

export function standardSectionToRichDoc(s: StdSection): RichDoc {
    const content: RichDoc['content'] = [];
    if (s.intro) content.push({ type: 'paragraph', content: [{ text: s.intro }] });
    for (const c of s.clauses) {
        content.push({
            type: 'paragraph',
            content: c.title ? [{ text: c.title, marks: ['bold'] }, { text: ' ' + c.body }] : [{ text: c.body }],
        });
    }
    return { type: 'doc', content };
}

export const STANDARD_RICH_DOCS: Record<SectionKey, RichDoc> = {
    '2': standardSectionToRichDoc(STANDARD_SECTIONS_ES['2']),
    '3': standardSectionToRichDoc(STANDARD_SECTIONS_ES['3']),
    '4': standardSectionToRichDoc(STANDARD_SECTIONS_ES['4']),
};
```

The comment placeholders above are instructions to copy text. The committed file must contain the full verbatim clauses, and the mirror test enforces this.

- [ ] **Step 4: Run it.** Expected: PASS. If the mirror test fails because contract-app escapes a quote differently, compare the exact characters. Do not change contract-app.

- [ ] **Step 5: Commit**

```bash
git add src/domain/standardContractText.ts src/domain/standardContractText.test.ts
git commit -m "feat(adoption-docs): mirror standard contract sections for the editor"
```

---

## Task 3: Migrations, schema, and flag registration

**Files:**
- Create: `drizzle/0069_adoption_docs.sql`, `drizzle/0070_adoption_docs_columns.sql`
- Modify:
  - `src/db/schema.ts`
  - `src/config/features.ts` (both `FEATURE_FLAGS` and the `getAllFeatureFlags` literal)
  - `src/lib/publicConfig.ts` (`PUBLIC_FLAG_KEYS` + `PUBLIC_FLAG_DEFAULTS`)
  - `src/app/admin/(admin-only)/config/page.tsx` (interface, toggle array, useState init, hydration)
  - `src/app/api/admin/config/route.ts` (GET echo)
  - `src/i18n/locales/{es,en,pt}.ts` (`admin.flag_label_ENABLE_CUSTOM_ADOPTION_DOCS` / `flag_desc_…`; copy the exact naming convention of neighbouring flags)
  - `tests/seed.sql` (only if it inserts other flags; add `ENABLE_CUSTOM_ADOPTION_DOCS` = `'true'` so E2E can exercise it; check how the seed sets e.g. `ENABLE_FOLLOWUPS`)
- Test: `src/config/featureFlagRegistration.test.ts` (existing)

**Interfaces (Produces, in schema.ts):**

```ts
export const adoptionDocSettings = sqliteTable('adoption_doc_settings', {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),       // 'user' | 'org'
    ownerId: text('owner_id').notNull(),           // lower-cased email | organizations.id
    hiddenSteps: text('hidden_steps'),             // JSON string[]
    contractVersionId: text('contract_version_id'),
    updatedAt: integer('updated_at').notNull(),    // unix seconds
    updatedBy: text('updated_by').notNull(),
}, (t) => ({ ownerIdx: uniqueIndex('idx_adoption_doc_settings_owner').on(t.ownerType, t.ownerId) }));

export const contractVersions = sqliteTable('contract_versions', {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    sectionsJson: text('sections_json').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    firstSignedAt: integer('first_signed_at'),
    replacedAt: integer('replaced_at'),
}, (t) => ({ ownerIdx: index('idx_contract_versions_owner').on(t.ownerType, t.ownerId) }));

export const signedContracts = sqliteTable('signed_contracts', {
    id: text('id').primaryKey(),
    animalId: text('animal_id').notNull(),
    adopterId: text('adopter_id'),
    contractVersionId: text('contract_version_id'),
    standardVersion: text('standard_version'),
    locale: text('locale'),
    contentHash: text('content_hash'),
    fileKey: text('file_key'),
    via: text('via').notNull(),                    // 'token' | 'open'
    signedAt: integer('signed_at').notNull(),
}, (t) => ({ animalIdx: index('idx_signed_contracts_animal').on(t.animalId) }));
// userProfiles: add   adoptionDocsSource: text('adoption_docs_source'),
// formSubmissions: add shownSteps: text('shown_steps'),
```

Import `uniqueIndex` from `drizzle-orm/sqlite-core` if it isn't already imported.

- [ ] **Step 1: Write the migrations.** Copy the header-comment style from `drizzle/0065_email_otp_codes.sql`. `0069` holds the three `CREATE TABLE IF NOT EXISTS` statements and their indexes, exactly as in spec §1.1, §1.2 and §1.4 (the unique index on `(owner_type, owner_id)`). `0070` holds:

```sql
-- Custom adoption docs: per-user source choice + which form steps a submission showed.
ALTER TABLE user_profiles ADD COLUMN adoption_docs_source TEXT;
ALTER TABLE form_submissions ADD COLUMN shown_steps TEXT;
```

- [ ] **Step 2: Update `schema.ts`** with the interfaces above. Put the new tables after `contractInvitations`, and add the two columns inside the existing tables.

- [ ] **Step 3: Register the flag** in every place listed under **Files**. In `FEATURE_FLAGS`, add a comment in the local style:

```ts
    // Custom adoption form + contract per user/group (2026-09). Off = no
    // settings UI AND public form/contract always serve the standard docs,
    // even when customizations exist. Client-visible (settings card, editor,
    // /organizations button) → also in PUBLIC_FLAG_KEYS. Default off.
    ENABLE_CUSTOM_ADOPTION_DOCS: false,
```

Add it to `PUBLIC_FLAG_DEFAULTS` as `'false'`. For the i18n labels:
- es: label `Formulario y contrato personalizados`, desc `Permite que cada rescatista y grupo elija qué preguntas hace el formulario y edite las secciones 2–4 del contrato.`
- en: label `Custom form & contract`, desc `Lets each rescuer and group choose which form questions to ask and edit contract sections 2–4.`
- pt: label `Formulário e contrato personalizados`, desc `Permite que cada resgatista e grupo escolha quais perguntas o formulário faz e edite as seções 2–4 do contrato.`

- [ ] **Step 4: Apply the migrations to the local DBs.** Follow `.agents/workflows/schema-sync.md`. At minimum:

```bash
npx wrangler d1 migrations apply pet-adoption-db --local 2>&1 | tail -5
```

If the local DB is broken on this Node version, see memory note "Local DBs rot on Node 26": `python3 scripts/sync-local-db.py --seed`. **Do not commit the `.wrangler/**.sqlite` or `local.db` changes.** Afterwards, run `git checkout -- local.db .wrangler` only if they changed and you did not intend it. First check `git status` to see what changed.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx vitest run src/config/featureFlagRegistration.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0069_adoption_docs.sql drizzle/0070_adoption_docs_columns.sql src/db/schema.ts src/config/features.ts src/lib/publicConfig.ts "src/app/admin/(admin-only)/config/page.tsx" src/app/api/admin/config/route.ts src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
# plus tests/seed.sql if changed
git commit -m "feat(adoption-docs): tables, columns and ENABLE_CUSTOM_ADOPTION_DOCS flag"
```

---

## Task 4: Repository and resolution (server)

**Files:**
- Create: `src/lib/adoptionDocsRepo.ts`

**Interfaces:**
- Consumes: Task 1 domain and Task 3 tables. `getDb` from `@/lib/db` (its return type is the Drizzle D1 database; use `type Db = NonNullable<Awaited<ReturnType<typeof import('@/lib/db').getDb>>>`). `getFeatureFlag` from `@/config/features`. `logger`.
- Produces:
  ```ts
  export type ResolvedDocs = { hiddenSteps: string[]; contract: { versionId: string; sections: ContractSections } | null };
  export async function sha256Hex(s: string): Promise<string>
  export async function getMemberOrgIds(db: Db, email: string): Promise<string[]>
  export async function getUserDocsSource(db: Db, email: string): Promise<DocsSource>
  export async function getSettingsRow(db: Db, owner: DocsOwner): Promise<typeof adoptionDocSettings.$inferSelect | null>
  export async function getContractVersion(db: Db, id: string): Promise<typeof contractVersions.$inferSelect | null>
  export async function resolveDocsForRescuer(db: Db, rescuerEmail: string | null | undefined): Promise<ResolvedDocs | null>
  export async function saveHiddenSteps(db: Db, owner: DocsOwner, hiddenSteps: string[], actorEmail: string): Promise<void>
  export async function saveContract(db: Db, owner: DocsOwner, sections: ContractSections, actorEmail: string): Promise<{ action: 'noop'|'setStandard'|'insert'; versionId: string | null }>
  export async function recordSignature(db: Db, row: { animalId: string; adopterId: string | null; contractVersionId: string | null; standardVersion: string | null; locale: string | null; fileKey: string | null; via: 'token' | 'open' }): Promise<void>
  ```

Rules:
- `resolveDocsForRescuer`:
  - Returns `null` when any of the following holds: the flag is off; the email is empty or `'anonymous'`; there is no settings row for the resolved owner; the row has no hidden steps and no contract version; any thrown error (`logger.warn('resolveDocsForRescuer: fell back to standard', { rescuerEmail, error })`).
  - Otherwise it resolves the owner with `resolveDocsOwner(email, await getUserDocsSource(db, email), await getMemberOrgIds(db, email))`.
  - A contract version row that is missing is treated as `contract: null`, with a warning logged.
  - `sections` comes from `JSON.parse(row.sectionsJson)`, run through `contractSectionsSchema.safeParse`. If invalid, log a warning and use `contract: null`.
- `getUserDocsSource`: `user_profiles.adoption_docs_source` joined through `user.email` (users table `email`) to `userProfiles.userId`. Compare case-insensitively: `sql\`lower(${users.email}) = ${normalizeEmail(email)}\``.
- `getMemberOrgIds`: `select orgId from orgMembers where lower(userEmail) = normalizedEmail`.
- `saveHiddenSteps`: upsert keyed on `(ownerType, ownerId)` with `onConflictDoUpdate` targeting `[adoptionDocSettings.ownerType, adoptionDocSettings.ownerId]`. Store `hiddenSteps.length ? JSON.stringify(hiddenSteps) : null`. Set `updatedAt` and `updatedBy`. New ids come from `crypto.randomUUID()`.
- `saveContract`:
  1. `normalized = normalizeSections(sections)`. `nextHash = isStandardSections(normalized) ? null : await sha256Hex(canonicalSectionsJson(normalized))`.
  2. Load the settings row, then the current version if `contractVersionId` is set.
  3. `plan = planContractSave(current ? { contentHash: current.contentHash } : null, nextHash)`.
  4. For `noop`: still upsert `updatedAt/updatedBy`? **No.** A noop changes nothing; return early.
  5. For `setStandard`: `update contractVersions set replacedAt=now where id=current.id`, then upsert settings with `contractVersionId=null`.
  6. For `insert`:
     - insert a new version with `sectionsJson = canonicalSectionsJson(normalized)` and `contentHash = nextHash`;
     - mark the current one replaced, if there is one;
     - upsert settings with the new id.
  7. Lazy cleanup (all plans except `noop`):
     ```sql
     delete from contract_versions
     where owner_type=? and owner_id=?
       and first_signed_at is null
       and replaced_at is not null
       and replaced_at < now - UNSIGNED_VERSION_TTL_SECONDS
     ```
     Use drizzle `and(eq, eq, isNull, isNotNull, lt)`.
- `recordSignature`:
  - When `contractVersionId` is set, look up the version.
    - If found, `update … set firstSignedAt = now where id = ? and firstSignedAt is null`, and use its `contentHash`.
    - If not found, `logger.warn('recordSignature: unknown contract version', { animalId, contractVersionId })` and use `contentHash` null.
  - Then insert into `signed_contracts` with `signedAt = now`.
- `sha256Hex`: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))` → hex.
- **D1:** single-row lookups only; no `IN` lists.

- [ ] **Step 1: Implement the file** with the functions above, in the style of `src/lib/orgMembership.ts`: dynamic schema imports are not needed in lib; import from `@/db/schema` and `drizzle-orm`.
- [ ] **Step 2: Type check.** `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3: Commit**

```bash
git add src/lib/adoptionDocsRepo.ts
git commit -m "feat(adoption-docs): repository + resolution with standard fallback"
```

The repository is exercised end-to-end in Task 11. Its decision logic is already unit-tested through `planContractSave`, `resolveDocsOwner` and `normalizeSections`.

---

## Task 5: Server actions + activity feed

**Files:**
- Create: `src/app/actions/adoptionDocs.ts` (`'use server'`; **only async exports**, because a sync export in a `'use server'` file passes tsc but fails `next build`)
- Modify: `src/app/actions/activity.ts`, `src/components/OrgActivityFeed.tsx`, i18n es/en/pt

**Interfaces:**
- Consumes: Task 4 repo; `getUser` from `./_db`; `getDb`; `getFeatureFlag`; `logAudit` from `@/lib/audit`; `logger`.
- Produces (all `async`):
  ```ts
  export type OwnerRef = { type: 'self' } | { type: 'org'; orgId: string };
  export type DocsSummary = { customized: boolean; updatedAt: number | null; updatedByName: string | null };
  export async function getAdoptionDocsOverview(): Promise<{ success: boolean; data?: { source: string /* 'self' | 'org:<id>' */; self: DocsSummary; orgs: Array<{ id: string; name: string } & DocsSummary> }; error?: string; errorId?: string }>
  export async function setAdoptionDocsSource(source: string): Promise<{ success: boolean; error?: string; errorId?: string }>
  export async function getAdoptionDocs(owner: OwnerRef): Promise<{ success: boolean; data?: { ownerName: string; hiddenSteps: string[]; sections: ContractSections; updatedAt: number | null; updatedByName: string | null }; error?: string; errorId?: string }>
  export async function saveFormSteps(owner: OwnerRef, hiddenSteps: string[]): Promise<{ success: boolean; error?: string; errorId?: string }>
  export async function saveContractSections(owner: OwnerRef, sections: unknown): Promise<{ success: boolean; data?: { standard: boolean }; error?: string; errorId?: string }>
  ```

Rules:
- **Every action** resolves `actorEmail = await getUser()` (it throws if there is no session) outside the `try`, or declares it before the `try` so the catch can log it. Every catch returns `{ success: false, error: 'generic', errorId: logger.error('adoptionDocs.<op> failed', e, { actorEmail, owner }) }`.
- **The flag gates everything:** if `!(await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS'))`, return `{ success: false, error: 'disabled' }` (no errorId; not an error).
- **Owner authorization:**
  - `self` resolves to `{ ownerType: 'user', ownerId: normalizeEmail(actorEmail) }`.
  - `org` requires `(await getMemberOrgIds(db, actorEmail)).includes(orgId)`. Otherwise return `{ success: false, error: 'forbidden' }` and `logger.warn`.
  - Any member may edit (spec D1).
- `setAdoptionDocsSource`:
  - Accepts `'self'` or `'org:<id>'`, with membership verified.
  - Upserts into `user_profiles`, the same way as `saveFollowupSettings`: raw `env.DB` via `getRequestContext()`, `INSERT INTO user_profiles (user_id, adoption_docs_source) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET adoption_docs_source = excluded.adoption_docs_source`. Store null for self.
- `getAdoptionDocs`:
  - `sections` are the current version's sections, or `{}` for standard.
  - `updatedByName` is `users.name` for the `updatedBy` email, falling back to the email's local-part (same rule as the contract route's `rescuerDisplay`).
  - `ownerName` is the org name, or `''` for self.
- `saveFormSteps`: `sanitizeHiddenSteps(hiddenSteps)`, then the repo's `saveHiddenSteps`, then `logAudit({ userEmail: actorEmail, action: 'adoption_docs_form_saved', target: owner.type === 'org' ? owner.orgId : null, details: { ownerType, orgId?, hiddenCount } })`. Check the `AuditEntry` field names in `src/lib/audit.ts` and match them.
- `saveContractSections`:
  - `contractSectionsSchema.safeParse(sections)`. Invalid input returns `{ success: false, error: 'invalid' }` with a `logger.warn` that includes the zod issue paths (not the text).
  - Then the repo's `saveContract`.
  - Then audit `adoption_docs_contract_saved` with `{ ownerType, orgId?, action }`. Skip the audit when the result is `noop`.
  - Return `{ standard: result.versionId === null }`.
- **Activity feed** (`activity.ts`):
  - Add both actions to `ACTIVITY_ACTIONS` and to whichever `CATEGORY_ACTIONS` bucket holds non-adopter team events. If there is none, put them in `all` only.
  - In the row mapping, **drop** rows whose action is one of the two and whose `details.orgId` is not one of the viewer's org ids, including self edits with no orgId. Get the viewer's org ids once with `getMemberOrgIds`.
  - In `OrgActivityFeed.tsx`, render the verb with new i18n keys:
    - `activity.adoption_docs_form_saved`: es "cambió las preguntas del formulario de {org}" / en "changed the form questions of {org}" / pt "alterou as perguntas do formulário de {org}"
    - `activity.adoption_docs_contract_saved`: es "editó el contrato de {org}" / en "edited the contract of {org}" / pt "editou o contrato de {org}"
  - Resolve `{org}` from the entry's existing org context if `getOrgActivity` enriches one. Otherwise add `orgName` into `extra` in `deriveExtra` by looking up `organizations.name` for `details.orgId`, a single-row lookup per distinct org.
  - Read `activity.ts` and `OrgActivityFeed.tsx` fully first and follow their existing verb/icon mapping exactly (icons are SVG, not emoji; use an existing document-like icon key if one exists).

- [ ] **Step 1: Implement the actions and the feed changes.**
- [ ] **Step 2: Type check and build-safety check.** `npx tsc --noEmit`, then `grep -n "^export " src/app/actions/adoptionDocs.ts`. Every export must be `export async function` or `export type`.
- [ ] **Step 3: Commit**

```bash
git add src/app/actions/adoptionDocs.ts src/app/actions/activity.ts src/components/OrgActivityFeed.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
git commit -m "feat(adoption-docs): server actions with group-member auth + activity feed entries"
```

---

## Task 6: Public API changes (all additive)

**Files:**
- Modify:
  - `src/app/api/form/[userId]/route.ts`
  - `src/app/api/form/[userId]/submit/route.ts`
  - `src/app/api/contract/[id]/route.ts`
  - `src/app/api/contract/by-token/[token]/route.ts`
  - `src/app/api/contract/[id]/submit/route.ts`

**Interfaces:**
- Consumes: `resolveDocsForRescuer` and `recordSignature` (Task 4); `deriveSpecialNeeds` and `sanitizeShownSteps` (Task 1).
- Produces (JSON response contracts read by contract-app in Tasks 8 and 9):
  - `GET /api/form/{userId}` gets a new field: `formConfig: { hiddenSteps: string[] } | null`.
  - `GET /api/contract/{id}` gets a new top-level field on the animal object: `customContract: { versionId: string; sections: ContractSections } | null`.
  - `GET /api/contract/by-token/{token}` gets a new top-level field `customContract` (same shape) next to `animal`.
  - `POST /api/contract/{id}/submit` accepts optional `contractVersionId?: string`, `standardVersion?: string` and `locale?: string`.
  - `POST /api/form/{userId}/submit` accepts optional `shownSteps?: string[]`.

Steps:

- [ ] **Step 1: Form GET.** Also select `users.email`. After validating the user, `formConfig = resolved ? { hiddenSteps: resolved.hiddenSteps } : null`, where `resolved = await resolveDocsForRescuer(db, user.email)`. `resolveDocsForRescuer` never throws; it handles its own fallback.
- [ ] **Step 2: Form submit.**
  - Replace `const specialNeeds = body.specialNeeds ? 1 : 0;` with `const specialNeeds = deriveSpecialNeeds(body);`.
  - Add `const shownSteps = sanitizeShownSteps(body.shownSteps);`.
  - Write `shownSteps: shownSteps ? JSON.stringify(shownSteps) : null` in the insert.
  - Log `shownCount` in the existing info log if there is one.
  - Check that `answers_json` still stores the raw body; it does, since it's built from `body`.
  - Also grep for readers of `specialNeeds` expecting a number: `src/app/actions/formSubmission.ts` handles `=== 1` / `=== 0`, so null prints nothing, which is correct. `FormResultsContent.tsx` and `FormAnswersPanel.tsx` read `answersJson`; confirm a null column doesn't break them. Adjust only if a reader does `specialNeeds ? … : …` in a way that would now show "No" for null.
- [ ] **Step 3: Contract GET routes.**
  - After computing `rescuerDisplay`, `const resolved = await resolveDocsForRescuer(db, animal.addedBy);` and `customContract: resolved?.contract ?? null` in the JSON.
  - In the by-token route, add it at the top level of the response.
- [ ] **Step 4: Contract submit.**
  - Destructure `contractVersionId, standardVersion, locale` from the body.
  - Validate each: a string of at most 100 characters, else treat it as undefined. For `locale`, accept only `'es'|'en'|'pt'`.
  - Keep the R2 `key` in a variable declared outside the upload block, so it can be passed on.
  - After `updateRecord(...)` succeeds and before the notification block:

```ts
        // Record exactly which contract text was signed (spec §1.4). Never fails
        // the signature: the adopter has signed and the PDF is stored.
        try {
            const { recordSignature } = await import('@/lib/adoptionDocsRepo');
            await recordSignature(db, {
                animalId, adopterId,
                contractVersionId: contractVersionId || null,
                standardVersion: contractVersionId ? null : (standardVersion || null),
                locale: locale || null,
                fileKey: contractKey,
                via: invitation ? 'token' : 'open',
            });
        } catch (e) {
            logger.error('Contract submit: signed_contracts insert failed', e, { animalId, adopterId, contractVersionId });
        }
```

  - `recordSignature` is **not** flag-gated. It records "standard" signatures too (spec D10).
- [ ] **Step 5: Type check and run the existing unit tests.** `npx tsc --noEmit && npx vitest run`. Expected: pass.
- [ ] **Step 6: Commit**

```bash
git add "src/app/api/form/[userId]/route.ts" "src/app/api/form/[userId]/submit/route.ts" "src/app/api/contract/[id]/route.ts" "src/app/api/contract/by-token/[token]/route.ts" "src/app/api/contract/[id]/submit/route.ts"
git commit -m "feat(adoption-docs): public API serves resolved docs; record signed version; unasked specialNeeds is null"
```

---

## Task 7: contract-app pure logic + test runner

**Files:**
- Create:
  - `contract-app/vitest.config.ts`
  - `contract-app/src/lib/adoptionDocs.ts` + `contract-app/src/lib/adoptionDocs.test.ts`
  - `contract-app/src/lib/pdfRichDoc.ts` + `contract-app/src/lib/pdfRichDoc.test.ts`
  - Next side: `src/domain/adoptionDocs.mirror.test.ts`
- Modify: `contract-app/package.json`, `.github/workflows/contract-app.yml`

**Interfaces (Produces):**

```ts
// contract-app/src/lib/adoptionDocs.ts
export const FORM_STEP_IDS: readonly string[]      // identical literal to Next
export const LOCKED_FORM_STEPS: readonly string[]
export type Mark = 'bold'|'italic'|'underline'; export type Inline = { text: string; marks?: Mark[] }
export type Block = { type: 'paragraph'; content: Inline[] } | { type: 'bulletList'; items: Inline[][] }
export type RichDoc = { type: 'doc'; content: Block[] }
export type SectionKey = '2'|'3'|'4'
export type CustomContract = { versionId: string; sections: Partial<Record<SectionKey, RichDoc>> }
export function applyHiddenSteps<T extends { id: string }>(schema: T[], hiddenSteps: readonly string[] | null | undefined): T[]
export function draftKey(userId: string | null, animalId: string | null | undefined): string
export const LEGACY_DRAFT_KEY = 'petshield_draft'
export type Draft = { answers: Record<string, unknown>; stepId?: string; step?: number }
export function restoreStepIndex(schema: { id: string }[], draft: Draft, baseOrder: readonly string[]): number
export function stripHiddenAnswers(answers: Record<string, unknown>, hiddenSteps: readonly string[]): Record<string, unknown>
export function isValidCustomContract(x: unknown): x is CustomContract
export function contractVersionLabel(custom: CustomContract | null): string   // 'v:<8>' | 'v:std-<STANDARD_CONTRACT_VERSION>'
export function fnv1a(s: string): string                                      // 8 hex chars
export const STANDARD_CONTRACT_VERSION: string
// contract-app/src/lib/pdfRichDoc.ts
export type Measure = (text: string, style: 'normal'|'bold'|'italic'|'bolditalic') => number
export type LaidWord = { text: string; x: number; style: 'normal'|'bold'|'italic'|'bolditalic'; underline: boolean; width: number }
export type LaidLine = { words: LaidWord[]; indent: number; bullet: boolean }
export function layoutRichDoc(doc: RichDoc, maxWidth: number, measure: Measure, opts: { bulletIndent: number }): Array<LaidLine | 'gap'>
```

Behaviours:
- `applyHiddenSteps` removes ids in `hiddenSteps` **unless** they are locked; null or empty returns the same array reference.
- `restoreStepIndex`:
  - If `draft.stepId` is present and in the schema, return its index.
  - Otherwise, if `draft.stepId` exists in `baseOrder` (the full `FORM_STEP_IDS`), return the index of the first schema step that comes at or after it in `baseOrder`, clamped to `schema.length - 1`.
  - Otherwise, for a legacy draft (only a numeric `step`), return 0. Legacy indices are meaningless across schemas, so the answers are kept and the adopter walks forward; answered steps are pre-filled.
- `stripHiddenAnswers`:
  - Removes the keys of hidden steps.
  - For `identity-*` ids the answer key differs; they're locked anyway, so ignore them.
  - Special keys: `species` also removes `speciesOther`; `geo` also removes `latitude` and `longitude`.
- `isValidCustomContract`: `versionId` is a non-empty string; `sections` is an object whose keys are a subset of 2, 3 and 4; each value has `type === 'doc'` and an array `content`.
- `layoutRichDoc`:
  - Tokenizes runs into words, keeping styles, and splitting on spaces while preserving the single spaces between words.
  - Greedy line-fills up to `maxWidth - indent`.
  - Bullets get `bullet: true` on the first line of each item and `indent = bulletIndent` on all its lines.
  - Emits `'gap'` between blocks.
  - A single word longer than the line is placed alone on its line (no infinite loop).
- `STANDARD_CONTRACT_VERSION` = `fnv1a(JSON.stringify(['es','en','pt'].map(l => CONTRACT_CONTENT[l].sections)))`. Compute it at module load: import `CONTRACT_CONTENT`. The **test pins the literal value**, so a change to the standard text forces a deliberate update.

- [ ] **Step 1: Add vitest**

```bash
cd contract-app && npm i -D vitest@^4.1.7 && cd ..
```

In `contract-app/package.json` scripts, add `"test": "vitest run"`.

`contract-app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } })
```

- [ ] **Step 2: Write the failing tests**

```ts
// contract-app/src/lib/adoptionDocs.test.ts
import { describe, it, expect } from 'vitest'
import { FORM_STEP_IDS, applyHiddenSteps, restoreStepIndex, stripHiddenAnswers, draftKey, isValidCustomContract, contractVersionLabel, STANDARD_CONTRACT_VERSION, fnv1a } from './adoptionDocs'

const schema = FORM_STEP_IDS.map(id => ({ id }))

describe('applyHiddenSteps', () => {
    it('no config → identical schema (same reference)', () => {
        expect(applyHiddenSteps(schema, null)).toBe(schema)
        expect(applyHiddenSteps(schema, [])).toBe(schema)
    })
    it('hides toggleable steps, never locked ones', () => {
        const out = applyHiddenSteps(schema, ['children', 'legal', 'identity-email', 'selfie'])
        expect(out.map(s => s.id)).not.toContain('children')
        expect(out.map(s => s.id)).not.toContain('selfie')
        expect(out.map(s => s.id)).toContain('legal')
        expect(out.map(s => s.id)).toContain('identity-email')
    })
})

describe('restoreStepIndex', () => {
    const shortSchema = schema.filter(s => !['children', 'existingPets'].includes(s.id))
    it('restores by id', () => expect(restoreStepIndex(shortSchema, { answers: {}, stepId: 'hoursAlone' }, FORM_STEP_IDS)).toBe(shortSchema.findIndex(s => s.id === 'hoursAlone')))
    it('hidden stepId → next visible step', () => expect(restoreStepIndex(shortSchema, { answers: {}, stepId: 'children' }, FORM_STEP_IDS)).toBe(shortSchema.findIndex(s => s.id === 'housingType')))
    it('legacy numeric draft → start', () => expect(restoreStepIndex(shortSchema, { answers: { legal: true }, step: 14 }, FORM_STEP_IDS)).toBe(0))
    it('stepId past the end clamps', () => expect(restoreStepIndex([{ id: 'legal' }], { answers: {}, stepId: 'selfie' }, FORM_STEP_IDS)).toBe(0))
})

describe('drafts and answers', () => {
    it('draft key is scoped per rescuer and animal', () => {
        expect(draftKey('u1', null)).toBe('petshield_draft:u1:-')
        expect(draftKey('u1', 'a1')).toBe('petshield_draft:u1:a1')
        expect(draftKey(null, null)).toBe('petshield_draft:-:-')
    })
    it('strips answers of hidden steps, with their companion keys', () => {
        expect(stripHiddenAnswers({ species: 'other', speciesOther: 'x', geo: 'yes', latitude: '1', longitude: '2', name: 'A' }, ['species', 'geo']))
            .toEqual({ name: 'A' })
    })
})

describe('custom contract', () => {
    it('validates shape', () => {
        expect(isValidCustomContract(null)).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '5': { type: 'doc', content: [] } } })).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '2': { type: 'doc', content: [] } } })).toBe(true)
    })
    it('labels versions', () => {
        expect(contractVersionLabel({ versionId: 'abcdef1234567', sections: {} })).toBe('v:abcdef12')
        expect(contractVersionLabel(null)).toBe(`v:std-${STANDARD_CONTRACT_VERSION}`)
    })
    it('fnv1a is 8 hex chars and stable', () => {
        expect(fnv1a('hola')).toMatch(/^[0-9a-f]{8}$/)
        expect(fnv1a('hola')).toBe(fnv1a('hola'))
    })
    it('STANDARD_CONTRACT_VERSION is pinned — bump deliberately when the standard text changes', () => {
        expect(STANDARD_CONTRACT_VERSION).toBe('REPLACE_WITH_FIRST_RUN_VALUE')
    })
})
```

```ts
// contract-app/src/lib/pdfRichDoc.test.ts
import { describe, it, expect } from 'vitest'
import { layoutRichDoc } from './pdfRichDoc'
const measure = (t: string) => t.length   // 1 unit per char
describe('layoutRichDoc', () => {
    it('wraps words greedily and keeps styles', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'aaa ', marks: ['bold'] }, { text: 'bbb ccc' }] }] }, 7, measure, { bulletIndent: 2 })
        const text = lines.filter(l => l !== 'gap').map(l => (l as any).words.map((w: any) => w.text).join(' '))
        expect(text).toEqual(['aaa bbb', 'ccc'])
        expect((lines[0] as any).words[0].style).toBe('bold')
    })
    it('bullets indent and mark only the first line of each item', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'uno dos tres' }]] }] }, 9, measure, { bulletIndent: 2 })
        const real = lines.filter(l => l !== 'gap') as any[]
        expect(real[0].bullet).toBe(true); expect(real[0].indent).toBe(2)
        expect(real[1].bullet).toBe(false); expect(real[1].indent).toBe(2)
    })
    it('a word longer than the line does not loop forever', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x'.repeat(50) }] }] }, 10, measure, { bulletIndent: 2 })
        expect(lines.filter(l => l !== 'gap')).toHaveLength(1)
    })
    it('underline is carried per word', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'u', marks: ['underline', 'italic'] }] }] }, 10, measure, { bulletIndent: 2 })
        expect((lines[0] as any).words[0]).toMatchObject({ underline: true, style: 'italic' })
    })
    it('gap between blocks', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'a' }] }, { type: 'paragraph', content: [{ text: 'b' }] }] }, 10, measure, { bulletIndent: 2 })
        expect(lines[1]).toBe('gap')
    })
})
```

- [ ] **Step 3: Run the tests.** `cd contract-app && npx vitest run`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement both modules.** `adoptionDocs.ts` must copy `FORM_STEP_IDS` as the exact multi-line literal used in `src/domain/adoptionDocs.ts` (same order, same quotes), so the mirror test can compare. Implementation notes:
  - `fnv1a`: 32-bit FNV-1a over UTF-16 code units, `>>> 0`, `.toString(16).padStart(8, '0')`.
  - `layoutRichDoc`: build a flat list of `{ text, style, underline }` words per block, measure `word` and the space using the word's style, and fill lines.
- [ ] **Step 5: Pin `STANDARD_CONTRACT_VERSION`.** Run the tests once and read the actual value from the failing pin test. Replace `'REPLACE_WITH_FIRST_RUN_VALUE'` with it. Run again: PASS.
- [ ] **Step 6: Mirror test (Next side).**

```ts
// src/domain/adoptionDocs.mirror.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORM_STEP_IDS, LOCKED_FORM_STEPS } from './adoptionDocs';

const src = readFileSync(join(__dirname, '../../contract-app/src/lib/adoptionDocs.ts'), 'utf8');
const ids = (name: string) => {
    const m = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
};

describe('contract-app mirror', () => {
    it('FORM_STEP_IDS match', () => expect(ids('FORM_STEP_IDS')).toEqual([...FORM_STEP_IDS]));
    it('LOCKED_FORM_STEPS match', () => expect(ids('LOCKED_FORM_STEPS')).toEqual([...LOCKED_FORM_STEPS]));
});
```

Also add a characterization test in `contract-app/src/lib/adoptionDocs.test.ts` that the step ids in `PetShieldForm.tsx` equal `FORM_STEP_IDS`: read the file text and extract `id: '<x>'` occurrences inside `DEFAULT_SCHEMA` in order. Use `readFileSync(new URL('../PetShieldForm.tsx', import.meta.url), 'utf8')`, take the slice between `const DEFAULT_SCHEMA` and `], [t])`, and `matchAll(/\bid: '([^']+)'/g)`. Field entries inside `text-fields` use `name:`, not `id:`, so they won't match. Verify by running.

- [ ] **Step 7: CI.** In `.github/workflows/contract-app.yml`, add a step `- run: npm test` (with the same `working-directory` the build step uses) immediately before the build step. Read the file first and match its indentation and `working-directory` usage.
- [ ] **Step 8: Run everything.** `(cd contract-app && npx vitest run && npx tsc --noEmit) && npx vitest run src/domain`. Expected: PASS.

Note: `contract-app/tsconfig` may include test files in `tsc`; if `vitest` types break `tsc`, exclude `src/**/*.test.ts` in contract-app's tsconfig `exclude`.

- [ ] **Step 9: Commit**

```bash
git add contract-app/package.json contract-app/package-lock.json contract-app/vitest.config.ts contract-app/src/lib/adoptionDocs.ts contract-app/src/lib/adoptionDocs.test.ts contract-app/src/lib/pdfRichDoc.ts contract-app/src/lib/pdfRichDoc.test.ts src/domain/adoptionDocs.mirror.test.ts .github/workflows/contract-app.yml
# plus contract-app/tsconfig*.json if changed
git commit -m "feat(contract-app): step/draft/contract helpers with tests; vitest in CI"
```

---

## Task 8: contract-app form integration

**Files:**
- Modify: `contract-app/src/PetShieldForm.tsx` (plus catalogs only if a new string is needed; the submit label `form.submit` already exists)

**Interfaces:** consumes `applyHiddenSteps`, `draftKey`, `LEGACY_DRAFT_KEY`, `restoreStepIndex`, `stripHiddenAnswers` and `FORM_STEP_IDS` (Task 7), and `GET /api/form/{userId}` `formConfig` (Task 6).

Changes (read the whole file first; line numbers are approximate):

- [ ] **Step 1: Config fetch.** Add `const [hiddenSteps, setHiddenSteps] = useState<string[] | null>(null)`, plus an effect on `[userId]`:

```ts
    useEffect(() => {
        if (!userId) return
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 3000)
        fetch(`${API_URL}/api/form/${encodeURIComponent(userId)}`, { signal: ctrl.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((data: { formConfig?: { hiddenSteps?: unknown } | null } | null) => {
                const hs = data?.formConfig?.hiddenSteps
                if (Array.isArray(hs)) setHiddenSteps(hs.filter((x): x is string => typeof x === 'string'))
            })
            // Standard form is the safe fallback — never block the adopter.
            .catch(err => console.warn('[PetShield] form config unavailable, using standard form', err))
            .finally(() => clearTimeout(timer))
        return () => { clearTimeout(timer); ctrl.abort() }
    }, [userId])
```

- [ ] **Step 2: Schema.** After the existing `ANIMAL_QUESTION_STEPS` filter: `const schema = applyHiddenSteps(baseSchema, hiddenSteps)`. Rename the existing `schema` const to `baseSchema`.
  - Config arrives asynchronously while the user is on step 0 (`legal`, which is locked, so it's always index 0 in both schemas). When `hiddenSteps` changes and `step > 0`, re-map the step by id: keep a ref of the current step id and set `step` to `restoreStepIndex(schema, { answers, stepId: currentId }, FORM_STEP_IDS)`.
- [ ] **Step 3: Drafts.**
  - `const DRAFT_KEY = draftKey(userId, animalId)`.
  - **Hydrate:**
    - Read `DRAFT_KEY`. If absent, read `LEGACY_DRAFT_KEY`; if it exists, parse it, use its answers with `{ step }` (so the index becomes 0 via `restoreStepIndex`), then `localStorage.removeItem(LEGACY_DRAFT_KEY)`.
    - Set `answers`, and set `step` to `restoreStepIndex(schema, parsed, FORM_STEP_IDS)`.
    - Keep the `try/catch`, but log: `catch (e) { console.warn('[PetShield] draft restore failed', e) }`. SSR-safe localStorage reads are the documented exception, but a warn is still better.
  - **Persist:** store `{ answers, stepId: schema[nextStep].id }` under `DRAFT_KEY`.
  - **On success:** `localStorage.removeItem(DRAFT_KEY)`.
- [ ] **Step 4: No auto-submit on the last step.** In the icon-cards click handler (~line 943: `if (!isSpeciesOther) goNext({ [currentStep.id]: opt.value })`) and the segmented-cards handler (~line 989: `goNext({ [currentStep.id]: opt.value })`), wrap them:

```ts
                                    if (isLastStep) setAnswer(currentStep.id, opt.value)
                                    else goNext({ [currentStep.id]: opt.value })
```

For icon-cards, keep the `isSpeciesOther` guard: `if (!isSpeciesOther) { isLastStep ? setAnswer(...) : goNext(...) }`. Make sure a selected option still shows as selected, which already happens via `answers[currentStep.id]`. The bottom "Enviar" button (`isLastStep ? t('form.submit')`) already exists.
- [ ] **Step 5: Submit.** In `handleSubmit`, build the body as `const cleaned = stripHiddenAnswers(finalAnswers, hiddenSteps ?? [])`, then `const submitBody = { ...cleaned, ...(animalId ? { animalId } : {}), shownSteps: schema.map(s => s.id) }`.
- [ ] **Step 6: Verify.**

```bash
cd contract-app && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | tail -3
```

Expected: clean, PASS, and the build succeeds. The characterization test from Task 7 must still pass: `DEFAULT_SCHEMA` ids are unchanged.
- [ ] **Step 7: Commit**

```bash
git add contract-app/src/PetShieldForm.tsx
git commit -m "feat(contract-app): form honours hidden steps, scoped drafts restored by step, no tap-to-submit"
```

---

## Task 9: contract-app contract integration (screen + PDF)

**Files:**
- Create: `contract-app/src/components/RichDocView.tsx`
- Modify: `contract-app/src/ContractPage.tsx`, `contract-app/src/contractPdf.ts`

**Interfaces:** consumes `CustomContract`, `isValidCustomContract`, `contractVersionLabel` and `STANDARD_CONTRACT_VERSION` (Task 7), `layoutRichDoc` (Task 7), and the `customContract` API field (Task 6).

- [ ] **Step 1: `RichDocView`**

```tsx
// contract-app/src/components/RichDocView.tsx
import type { Inline, RichDoc } from '../lib/adoptionDocs'

function Run({ r }: { r: Inline }) {
    let node: React.ReactNode = r.text
    if (r.marks?.includes('underline')) node = <u>{node}</u>
    if (r.marks?.includes('italic')) node = <em>{node}</em>
    if (r.marks?.includes('bold')) node = <strong>{node}</strong>
    return <>{node}</>
}

/** Rescuer-written contract section. Plain React children — never raw HTML. */
export default function RichDocView({ doc }: { doc: RichDoc }) {
    return (
        <div className="space-y-2">
            {doc.content.map((b, i) => b.type === 'paragraph'
                ? <p key={i} className="whitespace-pre-wrap">{b.content.length ? b.content.map((r, j) => <Run key={j} r={r} />) : ' '}</p>
                : <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((it, j) => <li key={j}>{it.map((r, k) => <Run key={k} r={r} />)}</li>)}</ul>)}
        </div>
    )
}
```

- [ ] **Step 2: ContractPage.**
  - Add `const [customContract, setCustomContract] = useState<CustomContract | null>(null)`.
  - In `load()`: in the token branch, `if (isValidCustomContract((data as any).customContract)) setCustomContract(...)`. In the open branch, parse JSON into `const json = await res.json()`, then `setAnimal(json)` and apply the same `customContract` check on `json.customContract`.
  - In the sections render (~line 422, `c.sections.map((section, si) => …)`), index `si` 0, 1 and 2 map to section keys `'2'`, `'3'` and `'4'`. Compute `const custom = si < 3 ? customContract?.sections[String(si + 2) as SectionKey] : undefined`.
    - If `custom` exists, render the same `<section>` and `<h2>{section.title}</h2>`, then `<RichDocView doc={custom} />` in place of the intro and clauses markup.
    - Otherwise, render the existing markup unchanged.
  - Pass `customContract` to `generateContractPdf(animal!, form, locale, customContract)`.
  - Submit body: add `contractVersionId: customContract?.versionId, standardVersion: customContract ? undefined : STANDARD_CONTRACT_VERSION, locale`.
- [ ] **Step 3: contractPdf.**
  - The signature becomes `generateContractPdf(animal, form, locale = 'es', custom: CustomContract | null = null)`.
  - In the sections loop, `const customDoc = i < 3 ? custom?.sections[String(i + 2) as SectionKey] : undefined`.
    - If present: after the bold title, call a new local helper `addRichDoc(customDoc)`.
    - Otherwise, run the existing intro and clauses code unchanged.
  - `addRichDoc` implementation:

```ts
        const styleOf = (s: 'normal'|'bold'|'italic'|'bolditalic') => s
        const addRichDoc = (rd: RichDoc) => {
            const size = 10
            const lineH = size * 0.45
            const x0 = MARGIN_LEFT + 4
            const measure = (t: string, st: 'normal'|'bold'|'italic'|'bolditalic') => { doc.setFont('helvetica', styleOf(st)); doc.setFontSize(size); return doc.getTextWidth(stripAccents(t)) }
            const lines = layoutRichDoc(rd, CONTENT_WIDTH - 4, measure, { bulletIndent: 5 })
            for (const line of lines) {
                if (line === 'gap') { y += 2; continue }
                checkPage(lineH)
                if (line.bullet) { doc.setFont('helvetica', 'normal'); doc.text('-', x0 + 1, y) }
                for (const w of line.words) {
                    doc.setFont('helvetica', w.style); doc.setFontSize(size)
                    const t = stripAccents(w.text)
                    doc.text(t, x0 + line.indent + w.x, y)
                    if (w.underline) { doc.setLineWidth(0.2); doc.line(x0 + line.indent + w.x, y + 0.6, x0 + line.indent + w.x + w.width, y + 0.6) }
                }
                y += lineH + 1
            }
        }
```

  Use `-` for bullets, not `•`: helvetica's WinAnsi encoding in jsPDF can render `•`, but ASCII is safer and consistent with `stripAccents`. `layoutRichDoc` must measure with `stripAccents` applied, as the measure callback above does, so widths match what is drawn.
  - **Footer version:** after the signatures block, before returning the blob:
    - `doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(170, 170, 170)`
    - on every page: `for (let p = 1; p <= doc.getNumberOfPages(); p++) { doc.setPage(p); doc.text(contractVersionLabel(custom), PAGE_WIDTH - MARGIN_RIGHT, 292, { align: 'right' }) }`
- [ ] **Step 4: Verify.**

```bash
cd contract-app && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add contract-app/src/components/RichDocView.tsx contract-app/src/ContractPage.tsx contract-app/src/contractPdf.ts
git commit -m "feat(contract-app): render rescuer-edited sections 2–4 on screen and in the PDF; send signed version"
```

---

## Task 10: Next UI (settings card, editor page, organizations button)

**Files:**
- Create:
  - `src/lib/tiptapRichDoc.ts` + `src/lib/tiptapRichDoc.test.ts`
  - `src/components/adoptionDocs/RichTextEditor.tsx`
  - `src/components/adoptionDocs/RichDocPreview.tsx`
  - `src/components/adoptionDocs/FormStepsEditor.tsx`
  - `src/components/adoptionDocs/ContractSectionsEditor.tsx`
  - `src/components/AdoptionDocsSettingsSection.tsx`
  - `src/app/settings/adoption-docs/page.tsx`
- Modify: `package.json`/lockfile (TipTap), `src/app/settings/page.tsx`, `src/app/organizations/page.tsx`, i18n es/en/pt

**Interfaces:**
- Consumes: the actions from Task 5; `FORM_STEP_GROUPS`, `LOCKED_FORM_STEPS`, `FORM_STEP_IDS`, `normalizeSections`, `canonicalSectionsJson` and `RichDoc` from Task 1; `STANDARD_SECTIONS_ES` and `STANDARD_RICH_DOCS` from Task 2.
- Produces:
  ```ts
  // src/lib/tiptapRichDoc.ts
  export type TipTapNode = { type: string; text?: string; marks?: { type: string }[]; content?: TipTapNode[] }
  export function tiptapToRichDoc(json: TipTapNode): RichDoc
  export function richDocToTiptap(doc: RichDoc): TipTapNode
  ```

- [ ] **Step 1: Install TipTap** (read the versions npm resolves; must be v3.x):

```bash
npm i @tiptap/react @tiptap/pm @tiptap/starter-kit
```

In TipTap v3, StarterKit already includes Underline; confirm in `node_modules/@tiptap/starter-kit/package.json`. If it doesn't, also install `@tiptap/extension-underline`.

- [ ] **Step 2: Converter tests (failing first)**

```ts
// src/lib/tiptapRichDoc.test.ts
import { describe, it, expect } from 'vitest';
import { tiptapToRichDoc, richDocToTiptap } from './tiptapRichDoc';

describe('tiptapToRichDoc', () => {
    it('paragraphs, marks and bullet lists', () => {
        const tt = { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hola ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'mundo', marks: [{ type: 'italic' }, { type: 'underline' }] }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] }] },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Hola ', marks: ['bold'] }, { text: 'mundo', marks: ['italic', 'underline'] }] },
            { type: 'bulletList', items: [[{ text: 'uno' }]] },
        ] });
    });
    it('flattens pasted unknown nodes (heading, blockquote, ordered list, link mark, hardBreak) to allowed ones', () => {
        const tt = { type: 'doc', content: [
            { type: 'heading', content: [{ type: 'text', text: 'Título' }] },
            { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cita', marks: [{ type: 'link' }] }] }] },
            { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }] },
            { type: 'image' },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Título' }] },
            { type: 'paragraph', content: [{ text: 'cita' }] },
            { type: 'bulletList', items: [[{ text: 'a' }, { text: ' ' }, { text: 'b' }]] },
        ] });
    });
    it('nested lists flatten into the parent list', () => {
        const tt = { type: 'doc', content: [{ type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] }] },
        ] }] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'a' }], [{ text: 'b' }]] }] });
    });
    it('round-trips', () => {
        const rd = { type: 'doc' as const, content: [
            { type: 'paragraph' as const, content: [{ text: 'x', marks: ['bold' as const] }] },
            { type: 'bulletList' as const, items: [[{ text: 'y' }]] },
        ] };
        expect(tiptapToRichDoc(richDocToTiptap(rd))).toEqual(rd);
    });
});
```

Run: `npx vitest run src/lib/tiptapRichDoc.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the converter.** Rules:
  - `paragraph`, `heading` and anything else with inline children becomes a paragraph.
  - `blockquote` recurses into its children as blocks.
  - `bulletList` and `orderedList` become one `bulletList`: each `listItem`'s paragraphs become items, nested lists are appended as further items, and consecutive list blocks stay separate as TipTap gives them.
  - `text` keeps the marks in {bold, italic, underline} (order them bold, italic, underline) and drops the rest.
  - `hardBreak` becomes a `' '` run.
  - Nodes with no text and no children (image, horizontalRule) are dropped.
  - `richDocToTiptap` is the inverse: bulletList maps to listItem, and a listItem maps to a paragraph.

  Run the tests: PASS.

- [ ] **Step 4: `RichTextEditor.tsx`** (client).
  - Props: `{ value: RichDoc; onChange: (d: RichDoc) => void; ariaLabel: string }`.
  - Configuration:

```tsx
'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// StarterKit v3 options: disable everything but paragraph/text/bold/italic/underline/bulletList/listItem.
const extensions = [StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false,
    orderedList: false, strike: false, link: false, hardBreak: false, dropcursor: false, gapcursor: false,
    trailingNode: false,
})];
// useEditor({ extensions, content: richDocToTiptap(value), immediatelyRender: false,
//   editorProps: { attributes: { class: 'prose-sm min-h-[160px] px-4 py-3 text-base text-stone-900 focus:outline-none', 'aria-label': ariaLabel } },
//   onUpdate: ({ editor }) => onChange(tiptapToRichDoc(editor.getJSON() as TipTapNode)) })
```

  - Toolbar: four buttons (B, I, U, bullet-list SVG), each `aria-pressed` reflecting `editor.isActive(...)` and at least 44×44 (`min-w-11 min-h-11`). They call `editor.chain().focus().toggleBold().run()` and so on.
  - Wrapper: `rounded-xl border border-stone-200 bg-white focus-within:border-teal-400`.
  - For list styling inside the editor, add `[&_ul]:list-disc [&_ul]:pl-5` on the content wrapper.
  - If a StarterKit option key doesn't exist in the installed version (tsc error), remove that key.
  - To reset from outside ("Restaurar"), the parent passes a `key` that changes to remount the editor.

- [ ] **Step 5: `RichDocPreview.tsx`.** The same rendering as contract-app's `RichDocView`, but with Next styling. It also exports `StandardSectionPreview({ section }: { section: StdSection })`, which renders the title, intro and clauses the way the contract shows them (bold clause titles), muted (`text-stone-500`).

- [ ] **Step 6: `FormStepsEditor.tsx`.**
  - Props: `{ hidden: string[]; onChange(h: string[]): void }`.
  - Renders `FORM_STEP_GROUPS`, with `legal` first as a locked row. Each row shows the label and a switch.
    - The switch is a `role="switch" aria-checked` button, styled like existing toggles; grep for `role="switch"` in `src/components` and reuse the pattern.
    - Locked rows show a lock SVG and `t('adoptionDocs.always_asked')`.
  - Labels:
    - `t('petshield.fields.<id>')` for data steps.
    - For `identity-name`, `identity-email`, `identity-phone`, `identity-address` and `selfie`, use new keys `adoptionDocs.step_identity_name`, `…_email`, `…_phone`, `…_address` and `adoptionDocs.step_selfie`.
    - The `legal` label is `petshield.fields.legal`.
  - Counter: `t('adoptionDocs.form_counter')` with `{shown}` / `{total}` (total = 23). Check how `t()` interpolates in `LanguageContext.tsx`; if it doesn't, use `.replace('{shown}', …)`, as other components do.
  - Group headings: `adoptionDocs.group_what`, `group_home`, `group_commitments`, `group_person`.

- [ ] **Step 7: `ContractSectionsEditor.tsx`.**
  - Props: `{ sections: ContractSections; onChange(s: ContractSections): void }`.
  - Renders:
    - `STANDARD_SECTIONS_ES['5']` stays last, and section 1 comes first as a muted card with `t('adoptionDocs.section1_note')` ("Se completa con los datos del animal"). Section 5 uses `StandardSectionPreview` with `t('adoptionDocs.locked_section')`.
    - For keys 2, 3 and 4: the title from `STANDARD_SECTIONS_ES[k].title`, a `RichTextEditor` whose value is `sections[k] ?? STANDARD_RICH_DOCS[k]`, and a compact link button `t('adoptionDocs.restore_section')` that deletes the key and remounts the editor via a `key` counter.
  - `onChange` stores the edited doc for the key.

- [ ] **Step 8: Editor page `src/app/settings/adoption-docs/page.tsx`** (`'use client'`, like `/settings`).
  - `useSearchParams()` → `org` → `owner: OwnerRef`. Wrap in `<Suspense>` if the Next build requires it for `useSearchParams`; check how other client pages do it.
  - Flag check via `fetch('/api/config')`, same as `FollowupSettingsSection`. When off, render a short notice and a link back to `/settings`.
  - Load with `getAdoptionDocs(owner)`. `error === 'forbidden'` shows a message; other failures show a toast with `errorId`.
  - Header: back-nav to `/settings` (reuse the existing back-nav pattern), H1 `t('adoptionDocs.editing', { name })` (Mine vs group name), and a sub-line `t('adoptionDocs.last_edited')` with name and date when present. Format the date with the existing date helper in `src/lib/dates.ts`, if suitable.
  - Tabs (`Formulario` | `Contrato`) as two buttons, styled like the `/my-adoptions` tabs (grep them). Tab state goes in the URL hash or state.
  - **Formulario tab:** `FormStepsEditor` on local draft state, a Save button (primary) calling `saveFormSteps`, and a "Restaurar por defecto" secondary button that stages `[]`.
  - **Contrato tab:**
    - `ContractSectionsEditor` on local draft state.
    - Save calls `saveContractSections(owner, sanitized)`, where `sanitized` drops any section whose normalized canonical JSON equals that of `STANDARD_RICH_DOCS[k]`, so an unchanged section stays standard and follows the adopter's language.
    - Below the Save button, the disclaimer `t('adoptionDocs.disclaimer')`.
  - Save results:
    - Success toasts `settings.saved`.
    - `disabled` and `forbidden` show specific messages.
    - Other failures use `toast.error(t('errors.generic'), t('adoptionDocs.save_failed'), res.errorId || resolveErrorId(res, 'AdoptionDocsEditor'))`.
    - Thrown errors are caught with `resolveErrorId(error, …)`.
  - Unsaved-changes guard: not required (YAGNI).

- [ ] **Step 9: `AdoptionDocsSettingsSection.tsx`**, a card on `/settings` placed after `<FollowupSettingsSection />`, with `id="adoption-docs"` and the same card classes.
  - Flag-gated via `/api/config` (`ENABLE_CUSTOM_ADOPTION_DOCS === true || === 'true'` shows it; default hidden).
  - Loads `getAdoptionDocsOverview()`.
  - Title: `adoptionDocs.settings_title`. Hint: `adoptionDocs.settings_hint`.
  - Radio group label: `adoptionDocs.use_label`. Options: `adoptionDocs.use_mine`, and `adoptionDocs.use_group` with `{name}` for each org. When a summary is customized, show a small "personalizado" / "estándar" pill (`adoptionDocs.pill_custom` / `pill_standard`). Changing the selection calls `setAdoptionDocsSource` and toasts; on failure it reverts the selection.
  - Links: `adoptionDocs.edit_mine` goes to `/settings/adoption-docs`, and `adoptionDocs.edit_group` goes to `/settings/adoption-docs?org=<id>`, rendered as compact secondary buttons.

- [ ] **Step 10: `/organizations`.** In each group card, next to the existing actions, add a compact secondary `Link` with `t('adoptionDocs.org_button')` → `/settings/adoption-docs?org=<id>`. It is flag-gated with the same `/api/config` read (reuse any flag state the page already loads).

- [ ] **Step 11: i18n.** Add an `adoptionDocs` namespace to es, en and pt with every key used above. Spanish copy is below; write natural en and pt equivalents.
  - `settings_title`: 'Formulario y contrato de adopción'
  - `settings_hint`: 'Elegí qué formulario y contrato se envían cuando compartís un link.'
  - `use_label`: 'Al compartir, usar:'
  - `use_mine`: 'Los míos'
  - `use_group`: 'Los de {name}'
  - `pill_custom`: 'Personalizado'
  - `pill_standard`: 'Estándar'
  - `edit_mine`: 'Editar los míos'
  - `edit_group`: 'Editar los de {name}'
  - `org_button`: 'Formulario y contrato'
  - `editing`: 'Editando: {name}'
  - `mine`: 'Los míos'
  - `last_edited`: 'Última edición: {name}, {date}'
  - `tab_form`: 'Formulario'
  - `tab_contract`: 'Contrato'
  - `always_asked`: 'Siempre se pregunta'
  - `form_counter`: 'El adoptante responde {shown} de {total} preguntas'
  - `group_what`: 'Lo que busca'
  - `group_home`: 'Su hogar'
  - `group_commitments`: 'Sus compromisos'
  - `group_person`: 'Sobre la persona'
  - `step_identity_name`: 'Nombre'
  - `step_identity_email`: 'Email'
  - `step_identity_phone`: 'Teléfono'
  - `step_identity_address`: 'Dirección'
  - `step_selfie`: 'Selfie'
  - `restore_defaults`: 'Restaurar por defecto'
  - `restore_section`: 'Restaurar texto original'
  - `section1_note`: 'Se completa con los datos del animal.'
  - `locked_section`: 'Esta sección no se puede editar.'
  - `disclaimer`: 'Sos responsable del texto de tu contrato. Te recomendamos que lo revise un abogado.'
  - `save_failed`: 'No se pudo guardar.'
  - `forbidden`: 'No sos miembro de este grupo.'
  - `disabled`: 'Esta función todavía no está disponible.'
  - `toolbar_bold`: 'Negrita'
  - `toolbar_italic`: 'Cursiva'
  - `toolbar_underline`: 'Subrayado'
  - `toolbar_bullets`: 'Lista con viñetas'
  - `section_editor_label`: 'Texto de la sección {n}'

- [ ] **Step 12: Verify.** Run `npx tsc --noEmit && npx vitest run && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -15`. Expected: clean, PASS, lint ≤ 125 warnings, and the build succeeds. The build is mandatory because it catches `'use server'` export errors and the `useSearchParams` Suspense requirement.
- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json src/lib/tiptapRichDoc.ts src/lib/tiptapRichDoc.test.ts src/components/adoptionDocs src/components/AdoptionDocsSettingsSection.tsx src/app/settings/adoption-docs/page.tsx src/app/settings/page.tsx src/app/organizations/page.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
git commit -m "feat(adoption-docs): settings card, editor page (form toggles + rich-text sections 2–4), group entry point"
```

---

## Task 11: E2E (API level) and full verification

**Files:**
- Create: `tests/adoption-docs.spec.ts`
- Modify: `tests/seed.sql` if the flag needs seeding (see Task 3)

Read `tests/forms.spec.ts` and `tests/contract-link.spec.ts` first, and reuse their helpers exactly: how they get a `userId`, how they seed animals via wrangler, and the Playwright projects. Put the spec under the project that has an authenticated admin (`authed`). Selectors must be locale-agnostic (bilingual regex).

Tests:
1. **An unasked question is not stored as "no".**
   - POST `/api/form/{userId}/submit` with `{ legal: true, name, email, phone, address, intent: 'self', shownSteps: ['legal','intent','identity-name','identity-email','identity-phone','identity-address'] }`.
   - Then query the row with `npx wrangler d1 execute … --local --command "SELECT special_needs, shown_steps FROM form_submissions WHERE id='<id>'"`, using the same pattern `contract-link.spec.ts` uses for wrangler.
   - Expect `special_needs` to be NULL and `shown_steps` to contain `"intent"`.
2. **Old client behaviour unchanged:** POST without `shownSteps` and without `animalId`, `specialNeeds: true`, expect `special_needs = 1`.
3. **Form config default:** `GET /api/form/{userId}` returns `formConfig: null` for a user with no settings.
4. **Contract signing records the version:**
   - Seed an available animal (copy the fixture approach from `contract-link.spec.ts`).
   - POST `/api/contract/{id}/submit` with a 1×1 PNG `screenshot` (as the existing spec does) and `standardVersion: 'test1234', locale: 'es'`.
   - Expect `signed_contracts` to have one row for the animal with `standard_version='test1234'` and `via='open'`.
5. **The flag gates resolution:** with the flag on (seeded) and a group settings row inserted via wrangler SQL, `GET /api/contract/{id}` for an animal whose `added_by` is a member returns `customContract.versionId`.
   - Insert: an `adoption_doc_settings` row with `owner_type='user'`, `owner_id=<added_by lower>` and `contract_version_id='v-e2e'`, plus a `contract_versions` row with id `v-e2e` and a valid `sections_json` (`{"2":{"type":"doc","content":[{"type":"paragraph","content":[{"text":"E2E"}]}]}}`).
   - Skip this test with `test.skip` and a clear reason if the seeded flag isn't reachable in the local E2E env. Check first how other flag-dependent specs toggle flags; some write `app_config` via wrangler.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run locally.** Follow the memory note "Playwright RUNS locally now": Node 20 keg + rebuild better-sqlite3 + own port. Read `project_local_e2e_harness.md` in the memory directory `/Users/jurfalino/.claude-personal/projects/-Users-jurfalino-Developer-Personal-verazadoptantes2/memory/` for the exact commands. Use a port other than 3000, because another session may be running there.

```bash
npx playwright test tests/adoption-docs.spec.ts tests/forms.spec.ts tests/contract-link.spec.ts
```

Expected: all pass. The two existing specs must pass **unchanged**.
- [ ] **Step 3: Full verification.**

```bash
npx tsc --noEmit
npx vitest run
npm run lint 2>&1 | grep -E "warning|problems" | tail -2   # ≤125 warnings
npm run build 2>&1 | tail -5
(cd contract-app && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | tail -3)
git status --short   # confirm local.db / .wrangler NOT staged
```

- [ ] **Step 4: Commit**

```bash
git add tests/adoption-docs.spec.ts
# plus tests/seed.sql if changed
git commit -m "test(adoption-docs): API-level E2E for unasked answers, signed versions, resolution"
```
