# Nameless Adopter Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow creating and displaying adopter profiles with no name (`name = ''`), identified by contact, on rescuer-authoring paths (manual form, API, import) — with a unified "Sin nombre" fallback and intentional friction, keeping name required on adopter self-submission.

**Architecture:** No DB migration (`name = ''` satisfies the existing `NOT NULL`). Two pure helpers (`isNamelessAdopter`/`adopterDisplayName` in `src/lib/adopterDisplay.ts`; `hasMinimumIdentifier`/`hasAnyContact` in `src/domain/adopterIdentity.ts`), one `<AdopterName>` component, relaxed Zod/import validation (name→optional + a name-OR-contact refine), a friction gate in `AdopterForm`, and a surface-by-surface swap of raw `{adopter.name}` renders.

**Tech Stack:** Next.js 15 (App Router, Cloudflare Pages), TypeScript, Zod, Drizzle (D1), vitest (unit), Playwright (e2e), React client components, i18n via `LanguageContext`.

## Global Constraints

- Update **both/all three** i18n locale files together — `src/i18n/locales/{es,en,pt}.ts`. Default locale is `es`; a key missing in `es.ts` shows the raw key path.
- Lint warnings must not exceed the ratchet (**≤125**); `npx tsc --noEmit` must pass.
- Theme-safe colors only: the placeholder uses `var(--text-muted)` (defined in `globals.css`, remapped per `[data-theme]`). Do NOT use a raw `text-stone-400` for it (not themed → breaks dark mode).
- Layer rules: pure logic in `src/domain/` (no DB/server imports) and `src/lib/`; components in `src/components/`.
- Deploy is staging-first with a version bump; do NOT push to `master`.
- Unit tests run with `npm test` (`vitest run`). Single file: `npx vitest run <path>`.

---

### Task 1: Display helpers — `isNamelessAdopter` / `adopterDisplayName`

**Files:**
- Create: `src/lib/adopterDisplay.ts`
- Test: `src/lib/adopterDisplay.test.ts`

**Interfaces:**
- Produces:
  - `isNamelessAdopter(adopter: { name?: string | null } | null | undefined): boolean`
  - `adopterDisplayName(adopter: { name?: string | null } | null | undefined, fallbackLabel: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/adopterDisplay.test.ts
import { describe, it, expect } from 'vitest';
import { isNamelessAdopter, adopterDisplayName } from './adopterDisplay';

describe('isNamelessAdopter', () => {
    it('is true for empty / whitespace / null name', () => {
        expect(isNamelessAdopter({ name: '' })).toBe(true);
        expect(isNamelessAdopter({ name: '   ' })).toBe(true);
        expect(isNamelessAdopter({ name: null })).toBe(true);
        expect(isNamelessAdopter(null)).toBe(true);
    });
    it('is false when a real name is present', () => {
        expect(isNamelessAdopter({ name: 'Ana' })).toBe(false);
    });
});

describe('adopterDisplayName', () => {
    it('returns the trimmed name when present', () => {
        expect(adopterDisplayName({ name: '  Ana ' }, 'Sin nombre')).toBe('Ana');
    });
    it('returns the fallback when nameless', () => {
        expect(adopterDisplayName({ name: '' }, 'Sin nombre')).toBe('Sin nombre');
        expect(adopterDisplayName(null, 'Sin nombre')).toBe('Sin nombre');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/adopterDisplay.test.ts`
Expected: FAIL — "Cannot find module './adopterDisplay'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/adopterDisplay.ts
/**
 * Nameless-adopter display helpers. An adopter profile may legitimately have no
 * name (name === ''), identified only by contact — see the nameless-profiles
 * design. Use these everywhere the adopter name is shown so the fallback label
 * is consistent and a nameless adopter is never a blank gap.
 */
export function isNamelessAdopter(adopter: { name?: string | null } | null | undefined): boolean {
    return !adopter?.name?.trim();
}

/** The name if present, otherwise `fallbackLabel` (pass the i18n `adopter.nameless`). */
export function adopterDisplayName(
    adopter: { name?: string | null } | null | undefined,
    fallbackLabel: string,
): string {
    return adopter?.name?.trim() || fallbackLabel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/adopterDisplay.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/adopterDisplay.ts src/lib/adopterDisplay.test.ts
git commit -m "feat(adopters): nameless display helpers (isNamelessAdopter, adopterDisplayName)"
```

---

### Task 2: Minimum-identifier domain logic

**Files:**
- Create: `src/domain/adopterIdentity.ts`
- Test: `src/domain/adopterIdentity.test.ts`

**Interfaces:**
- Produces:
  - `hasAnyContact(contactEntriesJson: string | null | undefined, contactInfo?: string | null): boolean` — true if the contactEntries JSON has ≥1 entry of type phone/email/social/id, or `contactInfo` has non-whitespace text.
  - `hasMinimumIdentifier(input: { name?: string | null; contactEntries?: string | null; contactInfo?: string | null }): boolean` — true if name is non-empty OR `hasAnyContact` is true.

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/adopterIdentity.test.ts
import { describe, it, expect } from 'vitest';
import { hasAnyContact, hasMinimumIdentifier } from './adopterIdentity';

const entries = (arr: unknown) => JSON.stringify(arr);

describe('hasAnyContact', () => {
    it('true when a phone/email/social/id entry exists', () => {
        expect(hasAnyContact(entries([{ type: 'phone', value: '4796-3445' }]))).toBe(true);
        expect(hasAnyContact(entries([{ type: 'email', value: 'a@b.com' }]))).toBe(true);
        expect(hasAnyContact(entries([{ type: 'id', value: '12345678' }]))).toBe(true);
    });
    it('false for empty/only-alias/only-other/null, and true for a contactInfo blob', () => {
        expect(hasAnyContact(entries([]))).toBe(false);
        expect(hasAnyContact(entries([{ type: 'alias', value: 'Lucho' }]))).toBe(false);
        expect(hasAnyContact(null)).toBe(false);
        expect(hasAnyContact('not json')).toBe(false);
        expect(hasAnyContact(null, 'Tel: 4796-3445')).toBe(true);
        expect(hasAnyContact(null, '   ')).toBe(false);
    });
});

describe('hasMinimumIdentifier', () => {
    it('true with a name and no contact', () => {
        expect(hasMinimumIdentifier({ name: 'Ana' })).toBe(true);
    });
    it('true with no name but a contact', () => {
        expect(hasMinimumIdentifier({ name: '', contactEntries: entries([{ type: 'email', value: 'a@b.com' }]) })).toBe(true);
    });
    it('false with neither name nor contact', () => {
        expect(hasMinimumIdentifier({ name: '  ', contactEntries: entries([]), contactInfo: '' })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/adopterIdentity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/domain/adopterIdentity.ts
/**
 * Minimum-identifiability rule for nameless adopter profiles (design:
 * nameless-adopter-profiles). A record needs a name OR at least one contact
 * (phone/email/social/id). Pure — no DB/lib imports; parses the contactEntries
 * JSON defensively so it can run in Zod refines and the import validator.
 */
const CONTACT_TYPES = new Set(['phone', 'email', 'social', 'id']);

export function hasAnyContact(
    contactEntriesJson: string | null | undefined,
    contactInfo?: string | null,
): boolean {
    if (contactInfo && contactInfo.trim()) return true;
    if (!contactEntriesJson) return false;
    try {
        const arr = JSON.parse(contactEntriesJson);
        if (!Array.isArray(arr)) return false;
        return arr.some(
            (e) => e && typeof e === 'object' && CONTACT_TYPES.has((e as { type?: string }).type ?? '')
                && !!(e as { value?: string }).value?.trim(),
        );
    } catch {
        return false;
    }
}

export function hasMinimumIdentifier(input: {
    name?: string | null;
    contactEntries?: string | null;
    contactInfo?: string | null;
}): boolean {
    if (input.name?.trim()) return true;
    return hasAnyContact(input.contactEntries, input.contactInfo);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/adopterIdentity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/adopterIdentity.ts src/domain/adopterIdentity.test.ts
git commit -m "feat(adopters): minimum-identifier rule (name OR >=1 contact)"
```

---

### Task 3: `namelessSubIdentifier` helper

**Files:**
- Modify: `src/lib/adopterDisplay.ts` (append)
- Test: `src/lib/adopterDisplay.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `namelessSubIdentifier(contactInfo: string | null | undefined): string | null` — extracts the first email, else first phone, else first non-label line from a `contactInfo` blob (lines like `Email: x`, `Tel: y`, `Dirección: z`). Callers pass the blob ONLY when the viewer has access (unmasked); otherwise pass `null`/omit → returns `null`.

- [ ] **Step 1: Write the failing test (append to `src/lib/adopterDisplay.test.ts`)**

```ts
import { namelessSubIdentifier } from './adopterDisplay';

describe('namelessSubIdentifier', () => {
    it('prefers email, then phone', () => {
        expect(namelessSubIdentifier('Tel: 4796-3445\nEmail: bobp@ciudad.com.ar')).toBe('bobp@ciudad.com.ar');
        expect(namelessSubIdentifier('Tel: 4796-3445')).toBe('4796-3445');
    });
    it('returns null for empty / masked-not-passed', () => {
        expect(namelessSubIdentifier(null)).toBeNull();
        expect(namelessSubIdentifier('')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/adopterDisplay.test.ts`
Expected: FAIL — `namelessSubIdentifier` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `src/lib/adopterDisplay.ts`)**

```ts
/**
 * Best single contact to disambiguate a nameless adopter on NAME-ONLY surfaces.
 * Pass the contactInfo blob ONLY when the viewer has access (unmasked); pass
 * null when masked (a masked hint is useless). Email > phone > first line.
 */
export function namelessSubIdentifier(contactInfo: string | null | undefined): string | null {
    if (!contactInfo || !contactInfo.trim()) return null;
    const lines = contactInfo.split('\n').map((l) => l.trim()).filter(Boolean);
    const val = (prefix: string) => {
        const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
        return line ? line.slice(line.indexOf(':') + 1).trim() || null : null;
    };
    return val('email:') || val('tel:') || (lines[0] ?? null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/adopterDisplay.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/adopterDisplay.ts src/lib/adopterDisplay.test.ts
git commit -m "feat(adopters): namelessSubIdentifier for name-only surfaces"
```

---

### Task 4: i18n keys (es/en/pt)

**Files:**
- Modify: `src/i18n/locales/es.ts`, `src/i18n/locales/en.ts`, `src/i18n/locales/pt.ts` (all inside the `adopter: { … }` object)

**Interfaces:**
- Produces i18n keys: `adopter.nameless`, `adopter.dont_know_name`, `adopter.name_or_contact_required`, `adopter.name_empty_prompt`.

- [ ] **Step 1: Add the keys to `es.ts`** (inside `adopter: {`, e.g. right after `title_new`)

```ts
        nameless: 'Sin nombre',
        dont_know_name: 'No conozco el nombre',
        name_or_contact_required: 'Ingresá un nombre/alias o al menos un dato de contacto.',
        name_empty_prompt: 'Te falta el nombre. Completalo, o marcá "No conozco el nombre" si es un adoptante anónimo.',
```

- [ ] **Step 2: Add the same keys to `en.ts`**

```ts
        nameless: 'No name',
        dont_know_name: "I don't know the name",
        name_or_contact_required: 'Enter a name/alias or at least one contact detail.',
        name_empty_prompt: 'The name is missing. Fill it in, or check "I don\'t know the name" for an anonymous adopter.',
```

- [ ] **Step 3: Add the same keys to `pt.ts`**

```ts
        nameless: 'Sem nome',
        dont_know_name: 'Não sei o nome',
        name_or_contact_required: 'Insira um nome/apelido ou pelo menos um contato.',
        name_empty_prompt: 'Falta o nome. Preencha, ou marque "Não sei o nome" para um adotante anônimo.',
```

- [ ] **Step 4: Verify types/keys resolve**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/es.ts src/i18n/locales/en.ts src/i18n/locales/pt.ts
git commit -m "i18n(adopters): nameless / dont-know-name / min-identifier strings"
```

---

### Task 5: `<AdopterName>` component

**Files:**
- Create: `src/components/AdopterName.tsx`

**Interfaces:**
- Consumes: `isNamelessAdopter`, `adopterDisplayName` (Task 1); `useLanguage` (`t`).
- Produces: React component
  `<AdopterName adopter={{ name?: string | null }} subId?: string | null className?: string title?: boolean />`
  — renders the real name as a `<span className>`; when nameless renders `<span>` styled italic + `var(--text-muted)` with `adopter.nameless`, optionally followed by a muted `· {subId}` when `subId` is provided.

- [ ] **Step 1: Write the component**

```tsx
// src/components/AdopterName.tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import { isNamelessAdopter } from '@/lib/adopterDisplay';

interface AdopterNameProps {
    adopter: { name?: string | null } | null | undefined;
    /** Optional contact sub-identifier (already access-gated by the caller). */
    subId?: string | null;
    className?: string;
    /** Set a `title` attribute (for truncated names). */
    title?: boolean;
}

export function AdopterName({ adopter, subId, className, title }: AdopterNameProps) {
    const { t } = useLanguage();
    if (isNamelessAdopter(adopter)) {
        return (
            <span className={className} title={title ? t('adopter.nameless') : undefined}>
                <span className="italic" style={{ color: 'var(--text-muted)' }}>{t('adopter.nameless')}</span>
                {subId ? <span className="ml-1 font-normal not-italic" style={{ color: 'var(--text-muted)' }}>· {subId}</span> : null}
            </span>
        );
    }
    const name = adopter!.name as string;
    return <span className={className} title={title ? name : undefined}>{name}</span>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AdopterName.tsx
git commit -m "feat(adopters): <AdopterName> component with themed 'Sin nombre' fallback"
```

---

### Task 6: Relax server validation (Zod schemas)

**Files:**
- Modify: `src/app/actions/validation.ts:26` (`saveAdopterSchema.name`) and `:49` (`createAdopterApiSchema.name`), adding a `.superRefine` on each object.
- Test: `src/app/actions/validation.test.ts` (create)

**Interfaces:**
- Consumes: `hasMinimumIdentifier` (Task 2).
- Produces: both schemas accept `name === ''` but reject when name AND contact are both empty (issue path `['name']`, message key `adopter.name_or_contact_required` literal is a UI concern — the schema emits a stable English message).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/actions/validation.test.ts
import { describe, it, expect } from 'vitest';
import { createAdopterApiSchema } from './validation';

const base = { contactEntries: JSON.stringify([{ type: 'email', value: 'a@b.com' }]) };

describe('createAdopterApiSchema — nameless', () => {
    it('accepts an empty name when a contact is present', () => {
        expect(createAdopterApiSchema.safeParse({ name: '', ...base }).success).toBe(true);
    });
    it('rejects when name AND contact are both empty', () => {
        const r = createAdopterApiSchema.safeParse({ name: '', contactEntries: JSON.stringify([]) });
        expect(r.success).toBe(false);
    });
    it('still accepts a normal named record', () => {
        expect(createAdopterApiSchema.safeParse({ name: 'Ana' }).success).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/actions/validation.test.ts`
Expected: FAIL — empty name rejected by `.min(1)`.

- [ ] **Step 3: Edit `validation.ts`**

Add the import near the top:
```ts
import { hasMinimumIdentifier } from '@/domain/adopterIdentity';
```
Change `saveAdopterSchema.name` (line 26) from `name: requiredText,` to:
```ts
    name: z.string().max(5_000).optional().default(''),
```
Change `createAdopterApiSchema.name` (line 49) from `name: z.string().min(1, 'Name is required').max(1_000),` to:
```ts
    name: z.string().max(1_000).optional().default(''),
```
Append `.superRefine` to BOTH object schemas (after the closing `})` of each `z.object({...})`), e.g. for `createAdopterApiSchema`:
```ts
.superRefine((data, ctx) => {
    const contactEntries = typeof data.contactEntries === 'string' ? data.contactEntries : null;
    const contactInfo = typeof data.contactInfo === 'string' ? data.contactInfo : null;
    if (!hasMinimumIdentifier({ name: data.name, contactEntries, contactInfo })) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'A name or at least one contact is required.' });
    }
});
```
(Apply the same `.superRefine` to `saveAdopterSchema` — its `contactInfo` field also exists.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/actions/validation.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/validation.ts src/app/actions/validation.test.ts
git commit -m "feat(adopters): schemas allow empty name, require name-or-contact"
```

---

### Task 7: Relax import validation (`validateMappedRow`)

**Files:**
- Modify: `src/domain/importRow.ts:76-82` (`validateMappedRow`)
- Test: `src/domain/importRow.test.ts` (append)

**Interfaces:**
- Consumes: existing `MappedRow` type (has `name`, `phones[]`, `emails[]`, `socials[]`, `dnis[]`, `combinedContacts[]`, `addresses[]`).
- Produces: `validateMappedRow` no longer errors on empty name alone; it errors ("Falta el nombre y el contacto del adoptante.") only when name AND all contact arrays are empty.

- [ ] **Step 1: Write the failing test (append to `src/domain/importRow.test.ts`)**

```ts
import { validateMappedRow } from './importRow';
const empty = { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] };

describe('validateMappedRow — nameless', () => {
    it('accepts empty name when a phone is present', () => {
        expect(validateMappedRow({ ...empty, phones: ['4796-3445'] })).toEqual([]);
    });
    it('rejects when name AND all contact are empty', () => {
        expect(validateMappedRow({ ...empty })).toContain('Falta el nombre y el contacto del adoptante.');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/importRow.test.ts`
Expected: FAIL — current code errors "Falta el nombre del adoptante." on empty name.

- [ ] **Step 3: Edit `validateMappedRow`** — replace the name check (line 78):

```ts
    const hasContact = [row.phones, row.emails, row.socials, row.dnis, row.addresses, row.combinedContacts]
        .some((a) => a && a.length > 0);
    if (!row.name?.trim() && !hasContact) {
        errors.push('Falta el nombre y el contacto del adoptante.');
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/importRow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/importRow.ts src/domain/importRow.test.ts
git commit -m "feat(import): allow nameless rows with contact; error only when both missing"
```

---

### Task 8: Manual-form friction gate (`AdopterForm`)

**Files:**
- Modify: `src/components/AdopterForm.tsx` (name `<input>` at ~L881-888; the save handler; add local `dontKnowName` state).

**Interfaces:**
- Consumes: `hasMinimumIdentifier` (Task 2), i18n keys (Task 4). Reads the form's `data.name`, `data.contactInfo`, and serialized `contactEntries` (already built at ~L384-389).
- Produces: no HTML `required`; a save-time gate.

- [ ] **Step 1: Remove `required`** from the name input (~L883). Change:
```tsx
    required
```
to (delete the line). Keep `value={data.name}` and the placeholder.

- [ ] **Step 2: Add state + a save guard.** Near the other `useState`s add:
```tsx
    const [dontKnowName, setDontKnowName] = useState(false);
    const [nameHint, setNameHint] = useState(false);
```
In the save handler (the function that persists — where `data.name.trim()` is read before calling save), BEFORE persisting add:
```tsx
        const nameEmpty = !data.name.trim();
        const hasContact = hasMinimumIdentifier({ name: data.name, contactEntries: JSON.stringify(contactEntries), contactInfo: data.contactInfo });
        if (nameEmpty && !hasContact) { setNameHint(true); return; }        // hard: neither name nor contact
        if (nameEmpty && !dontKnowName) { setNameHint(true); return; }        // gentle: ask, or opt in
```
Import at top: `import { hasMinimumIdentifier } from '@/domain/adopterIdentity';`

- [ ] **Step 3: Render the hint + opt-in** directly under the name input, shown when `nameHint`:
```tsx
    {nameHint && (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <p>{t('adopter.name_empty_prompt')}</p>
            {hasMinimumIdentifier({ name: data.name, contactEntries: JSON.stringify(contactEntries), contactInfo: data.contactInfo })
                ? (<label className="inline-flex items-center gap-1.5 mt-1 cursor-pointer">
                     <input type="checkbox" checked={dontKnowName} onChange={(e) => { setDontKnowName(e.target.checked); if (e.target.checked) setNameHint(false); }} />
                     <span>{t('adopter.dont_know_name')}</span>
                   </label>)
                : (<p className="text-rose-600 mt-1">{t('adopter.name_or_contact_required')}</p>)}
        </div>
    )}
```

- [ ] **Step 4: Verify + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS; lint warnings ≤125.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdopterForm.tsx
git commit -m "feat(adopters): manual-create friction gate — 'No conozco el nombre' opt-in"
```

---

### Task 9: Group A surfaces — name-with-context (swap in `<AdopterName>`)

**Files (each: replace the raw name render with `<AdopterName>`):**
- `src/components/AdopterResultCard.tsx:161-168` — the name `<span>` (keep the query-highlight for the non-nameless branch: render `<AdopterName>` only when nameless, else keep the highlight logic).
- `src/app/my-adopters/page.tsx:376` and `:487` — the name `<div>`; also fix the `alt` at `:367,:478` to use `adopterDisplayName(adopter, t('adopter.nameless'))`.
- `src/components/AdminAdopterList.tsx:254` — the name `<div>`.
- `src/components/DuplicateMergeModal.tsx:181` — the ProfileCard name `<p>`.
- `src/components/DuplicatePeek.tsx:200-202` — keep highlight for named; nameless → `<AdopterName>`.
- `src/components/StrongMatchStrip.tsx:57` — the name `<p>`.
- `src/components/AdopterPicker.tsx:127` and `:230` — the name `<div>`s.
- `src/components/PendingDedup.tsx:58-60` — the name inside `<Link>`.

**Interfaces:** Consumes `<AdopterName>` (Task 5), `adopterDisplayName` (Task 1).

- [ ] **Step 1: Apply the transform.** For a plain `{X.name}` render, replace with `<AdopterName adopter={X} className={"<existing classes>"} title />`. For a render that also highlights query tokens (AdopterResultCard, DuplicatePeek), wrap only the empty case:
```tsx
{isNamelessAdopter(res.adopter)
    ? <AdopterName adopter={res.adopter} className="<existing>" />
    : /* existing highlight expression */}
```
For `alt`/`title` string attributes, use `adopterDisplayName(x, t('adopter.nameless'))`.

- [ ] **Step 2: Verify + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AdopterResultCard.tsx src/app/my-adopters/page.tsx src/components/AdminAdopterList.tsx src/components/DuplicateMergeModal.tsx src/components/DuplicatePeek.tsx src/components/StrongMatchStrip.tsx src/components/AdopterPicker.tsx src/components/PendingDedup.tsx
git commit -m "feat(adopters): nameless fallback on name-with-context surfaces (Group A)"
```

---

### Task 10: Group B surfaces — name-only (fallback + fix silent-drop + sub-id)

**Files & exact changes:**
- `src/app/my-adoptions/page.tsx:241,333` — guard is `adoption.adopterId && adoption.adopterName ?`; change to gate on `adoption.adopterId` only, and render `<AdopterName adopter={{ name: adoption.adopterName }} />` as the link text (so a nameless adopter keeps its link).
- `src/app/my-animals/page.tsx:376,390` — same: gate the "Adopted by/In foster with" block on `animal.adopterId` only; render `adopterDisplayName({ name: animal.adopterName }, t('dashboard'... use adopter.nameless))`. Also extend the search filter at `:113` to also match `animal.adopterContact` (the adopter's contact) — add it to the haystack.
- `src/app/admin/data-requests/page.tsx:107,165,227,264` — change `{r.adopterName || r.adopterId}` to `{adopterDisplayName({ name: r.adopterName }, t('adopter.nameless'))}` (keep the id line separately if present; do NOT show the raw UUID as the name).
- `src/app/admin/flags/page.tsx:59,105` — change `{flag.adopterName || 'Unknown'}` to: if `flag.adopterId` present → `adopterDisplayName({ name: flag.adopterName }, t('adopter.nameless'))`; else keep `'Unknown'` (deleted). Distinguishes nameless from deleted.
- `src/app/contract-results/[notificationId]/page.tsx:122` — interpolate `adopterDisplayName({ name: metadata.adopterName }, t('adopter.nameless'))` into the subtitle.
- `src/components/ApplicantDetailPanel.tsx:221` — `<h2>` title → `<AdopterName>` (with `subId` from `namelessSubIdentifier` when the viewer has access — the panel already knows the applicant's contact); L353/L160 phrases → `adopterDisplayName(...)`.
- `src/components/AnimalApplicants.tsx:255` — row name → `<AdopterName>`; L94/L128 share phrases → `adopterDisplayName(...)`.
- `src/components/TransferOwnershipModal.tsx:92-95` — `.replace('{name}', adopterName)` → `.replace('{name}', adopterDisplayName({ name: adopterName }, t('adopter.nameless')))`.
- `src/components/DuplicateMergeModal.tsx:61-63,121-122` — confirm dialog + `<strong>` bullets → use `adopterDisplayName(secondary, t('adopter.nameless'))` / `primary`.
- `src/components/RequestPiiAccessModal.tsx:61` — `.replace('{name}', adopterName)` → `adopterDisplayName`.
- `src/components/DeleteAdopterButton.tsx:21` — `.replace('{name}', adopterName)` → `adopterDisplayName`.
- `src/components/PiiAccessRequestPanel.tsx:62-64` — link text → `<AdopterName>`.
- `src/components/AdopterForm.tsx` read-mode `<h1>` (~L929) — `displayName` when `!isNew` → `adopterDisplayName(initialData, t('adopter.nameless'))`; render the fallback italic/muted; append `namelessSubIdentifier(initialData.contactInfo)` as a sub-line when the viewer has access (the profile already unmasks for privileged viewers).

**Interfaces:** Consumes `<AdopterName>`, `adopterDisplayName`, `namelessSubIdentifier`, i18n `adopter.nameless`.

- [ ] **Step 1: Apply the changes above** file-by-file (string interpolations → `adopterDisplayName`; standalone name elements → `<AdopterName>`; access-gated `subId` only where the surface already has the unmasked contact).

- [ ] **Step 2: Verify + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/my-adoptions/page.tsx src/app/my-animals/page.tsx src/app/admin/data-requests/page.tsx src/app/admin/flags/page.tsx src/app/contract-results/[notificationId]/page.tsx src/components/ApplicantDetailPanel.tsx src/components/AnimalApplicants.tsx src/components/TransferOwnershipModal.tsx src/components/DuplicateMergeModal.tsx src/components/RequestPiiAccessModal.tsx src/components/DeleteAdopterButton.tsx src/components/PiiAccessRequestPanel.tsx src/components/AdopterForm.tsx
git commit -m "feat(adopters): nameless fallback on name-only surfaces + fix silent-drop guards (Group B)"
```

---

### Task 11: Group C alignment (wording consistency)

**Files:**
- `src/components/OrgActivityFeed.tsx:126-127` — the existing italic fallback `adopterFallback` ('un perfil'/'a profile'): change its value to `t('adopter.nameless')` so the label matches everywhere. Keep the italic style.
- `src/components/VisitIntentCard.tsx:177-179` — leave behavior (first-name → generic subject) but ensure the generic subject reads sensibly; no change required unless the copy diverges — verify only.
- `src/components/RecordTypeGuidance.tsx:135` — leave "esta persona"/"this person" (contextually better inside guidance sentences than "Sin nombre") — verify only, no change.

- [ ] **Step 1: Update `OrgActivityFeed` fallback to `t('adopter.nameless')`.** Verify the other two read sensibly (no code change).

- [ ] **Step 2: Verify + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/OrgActivityFeed.tsx
git commit -m "chore(adopters): align org-feed nameless label with adopter.nameless"
```

---

### Task 12: End-to-end tests (Playwright)

**Files:**
- Create: `tests/nameless-adopter.spec.ts`

**Interfaces:** Consumes the running app (authed project). Uses the manual create flow at `/adopter/create` and the search on the home page.

- [ ] **Step 1: Write the e2e spec**

```ts
// tests/nameless-adopter.spec.ts
import { test, expect } from '@playwright/test';

test.describe('nameless adopter', () => {
    test('create flow requires the "no conozco" opt-in, then shows "Sin nombre"', async ({ page }) => {
        await page.goto('/adopter/create');
        // fill a phone (a contact) but leave the name empty
        await page.getByPlaceholder(/Nombre Completo/i).fill('');
        // add a contact — selector depends on the form; use the contact input
        await page.getByRole('textbox', { name: /tel|contacto|phone/i }).first().fill('4796-3445').catch(() => {});
        await page.getByRole('button', { name: /Guardar|Crear|Save/i }).first().click();
        // gentle prompt appears; opt in
        await expect(page.getByText(/No conozco el nombre|don't know the name/i)).toBeVisible();
        await page.getByText(/No conozco el nombre|don't know the name/i).click();
        await page.getByRole('button', { name: /Guardar|Crear|Save/i }).first().click();
        // profile shows the fallback
        await expect(page.getByText(/Sin nombre|No name/i).first()).toBeVisible();
    });

    test('rejects a record with neither name nor contact', async ({ page }) => {
        await page.goto('/adopter/create');
        await page.getByPlaceholder(/Nombre Completo/i).fill('');
        await page.getByRole('button', { name: /Guardar|Crear|Save/i }).first().click();
        await expect(page.getByText(/al menos un dato de contacto|at least one contact/i)).toBeVisible();
    });
});
```

- [ ] **Step 2: Run the e2e (authed project)**

Run: `npx playwright test tests/nameless-adopter.spec.ts --project=authed`
Expected: PASS. (If the contact-input selector doesn't match the real form, adjust it to the actual placeholder/label after inspecting `AdopterForm`.)

- [ ] **Step 3: Commit**

```bash
git add tests/nameless-adopter.spec.ts
git commit -m "test(adopters): e2e for nameless create flow + min-identifier rejection"
```

---

## Self-Review

- **Spec coverage:** min-identifier rule → Tasks 2,6,7,8. Scope (relax rescuer paths, keep `_adopterFactory`) → Tasks 6,7 (factory untouched by design; note it's intentionally excluded). Unified fallback + deleted-vs-nameless → Tasks 1,5,9,10 (admin/flags distinction in Task 10). Friction + "No conozco" → Task 8. Access-gated sub-identifier → Tasks 3,10 (ApplicantDetailPanel, AdopterForm `<h1>`). Surface groups A/B/C → Tasks 9,10,11. i18n → Task 4. my-animals search → Task 10. Testing → Tasks 1-3,6,7 (unit) + 12 (e2e). **No gaps.**
- **Placeholder scan:** each code step has real code; surface-swap tasks enumerate exact files/lines + the transform. No TBD/TODO.
- **Type consistency:** `isNamelessAdopter`/`adopterDisplayName(adopter, fallback)`/`namelessSubIdentifier(contactInfo)`/`hasAnyContact`/`hasMinimumIdentifier`/`<AdopterName adopter subId className title>` used consistently across tasks.

## Deployment (after all tasks)

Bump version (`npm version <patch/minor> --no-git-tag-version`), add a CHANGELOG entry, commit, push to `staging`, verify green + manual check on staging, then PR staging→master (reconcile the squash-fork first: merge master into staging, `--ours` for version files).
