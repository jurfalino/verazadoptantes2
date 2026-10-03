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

/**
 * adoption_doc_settings.hidden_steps as stored → sanitized step ids. Never
 * throws: malformed JSON, or JSON that isn't an array, yields no steps and
 * `malformed: true` so the caller can log it (a bad row must not break the
 * public form, the settings card or the editor).
 */
export function parseStoredHiddenSteps(raw: string | null | undefined): { steps: string[]; malformed: boolean } {
    if (!raw) return { steps: [], malformed: false };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { steps: [], malformed: true };
    }
    if (!Array.isArray(parsed)) return { steps: [], malformed: true };
    return { steps: sanitizeHiddenSteps(parsed), malformed: false };
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

/**
 * Whether a signed contract version belongs to the animal's owner (spec §1.4):
 * a user version owned by that same (normalized) email, or an org version of
 * an org the owner is a member of. A missing/anonymous owner never owns one.
 * Only an owned version gets its content hash recorded and first_signed_at
 * stamped — a client can't pin or "lock" someone else's version by sending
 * its id.
 */
export function isContractVersionOwnedBy(
    version: { ownerType: string; ownerId: string },
    ownerEmail: string | null | undefined,
    ownerOrgIds: readonly string[],
): boolean {
    const email = ownerEmail ? normalizeEmail(ownerEmail) : '';
    if (!email || email === 'anonymous') return false;
    if (version.ownerType === 'user') return version.ownerId === email;
    if (version.ownerType === 'org') return ownerOrgIds.includes(version.ownerId);
    return false;
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

// Activity-feed action names + row-visibility rule for adoption_docs_* now
// live in ./adoptionDocsActivity — a zero-import leaf module, kept separate
// so a client component can use them without pulling in the zod schemas
// this file builds at module scope. See that file's docstring.
