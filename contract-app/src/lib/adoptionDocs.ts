/**
 * Pure form-step / draft / custom-contract helpers for the contract-app SPA.
 * Mirrors the Next app's src/domain/adoptionDocs.ts — the FORM_STEP_IDS and
 * LOCKED_FORM_STEPS literals below must stay byte-identical (same order,
 * same quotes) because src/domain/adoptionDocs.mirror.test.ts extracts them
 * from this file's source text with a regex. NO server/DB imports here; this
 * ships to the browser.
 */
import { CONTRACT_CONTENT } from '../i18n/contractContent'

export const FORM_STEP_IDS = [
    'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'children', 'existingPets',
    'housingType', 'household', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience', 'willingToSterilize',
    'vetCommitment', 'movingPlans', 'vacationPlan', 'identity-name', 'identity-email',
    'identity-phone', 'identity-address', 'ageRange', 'geo', 'selfie',
] as const

/** Terms consent + identity feed the adopter record and dedup — never hideable. */
export const LOCKED_FORM_STEPS = ['legal', 'identity-name', 'identity-email', 'identity-phone', 'identity-address'] as const

const LOCKED = new Set<string>(LOCKED_FORM_STEPS)

/** Removes ids in `hiddenSteps` unless they're locked. Null/empty returns the same array reference. */
export function applyHiddenSteps<T extends { id: string }>(schema: T[], hiddenSteps: readonly string[] | null | undefined): T[] {
    if (!hiddenSteps || hiddenSteps.length === 0) return schema
    const hidden = new Set(hiddenSteps)
    return schema.filter(s => !hidden.has(s.id) || LOCKED.has(s.id))
}

/**
 * Steps the public form asks under the stored list — the app's isStepAsked,
 * applied to the schema. "¿Hay niños?" vs the people list: the 'household'
 * token means people; 'children' hides the household question either way.
 * Default (no config) asks "¿Hay niños?" and never the people list.
 */
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

/** Mirrors src/domain/householdPeople.ts (mirror test). */
export const FORM_RELATIONSHIPS = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate'] as const

/** The legacy "¿Hay niños?" answer, derived from the people list (the server recomputes it). */
export function childrenAnswer(people: ReadonlyArray<{ age: number }>): 'none' | '1' | '2' | '3+' {
    const n = people.filter(p => p.age < 18).length
    return n === 0 ? 'none' : n === 1 ? '1' : n === 2 ? '2' : '3+'
}

export const LEGACY_DRAFT_KEY = 'petshield_draft'

/** Scopes a draft per rescuer (userId) and animal (animalId), so unrelated forms never collide. */
export function draftKey(userId: string | null, animalId: string | null | undefined): string {
    return `${LEGACY_DRAFT_KEY}:${userId ?? '-'}:${animalId ?? '-'}`
}

export type Draft = { answers: Record<string, unknown>; stepId?: string; step?: number }

export type ResolvedDraft = { draft: Draft; migrated: boolean }

/**
 * Decides which draft to hydrate from, given the two raw `localStorage`
 * strings (as `getItem` returns them — `null` when absent). The scoped key
 * always wins over the legacy one. `migrated: true` tells the caller a
 * legacy draft was found and must now be written under the scoped key (and
 * the legacy key cleared) — this function is pure and performs no storage
 * side effects itself. Throws on malformed JSON, matching `JSON.parse`
 * (callers already wrap draft hydration in try/catch).
 */
export function resolveDraft(scopedRaw: string | null, legacyRaw: string | null): ResolvedDraft | null {
    if (scopedRaw) return { draft: JSON.parse(scopedRaw) as Draft, migrated: false }
    if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as { answers?: Record<string, unknown>; step?: number }
        return { draft: { answers: legacy.answers ?? {} }, migrated: true }
    }
    return null
}

/**
 * Restores where a draft should resume in `schema`:
 * - `draft.stepId` present in `schema` → its index there.
 * - `draft.stepId` present in `baseOrder` (the full FORM_STEP_IDS) but hidden
 *   from `schema` → the first schema step at or after it in `baseOrder`,
 *   clamped to the last index.
 * - Legacy numeric-only draft, or an unrecognized stepId → 0 (answers are
 *   kept; the adopter walks forward with answered steps pre-filled).
 */
export function restoreStepIndex(schema: { id: string }[], draft: Draft, baseOrder: readonly string[]): number {
    if (schema.length === 0) return 0
    if (draft.stepId) {
        const direct = schema.findIndex(s => s.id === draft.stepId)
        if (direct !== -1) return direct
        const pos = baseOrder.indexOf(draft.stepId)
        if (pos !== -1) {
            const idx = schema.findIndex(s => {
                const p = baseOrder.indexOf(s.id)
                return p !== -1 && p >= pos
            })
            if (idx !== -1) return idx
            return schema.length - 1
        }
    }
    return 0
}

/**
 * Removes answer keys belonging to hidden steps. `identity-*` ids are
 * locked (never hidden), so no companion-key handling is needed for them.
 * `species` also removes `speciesOther`; `geo` also removes `latitude` and
 * `longitude`.
 */
export function stripHiddenAnswers(answers: Record<string, unknown>, hiddenSteps: readonly string[]): Record<string, unknown> {
    const hidden = new Set(hiddenSteps)
    const drop = new Set<string>()
    // 'household' is a choice, not a hide. With the people list chosen the
    // step also writes a derived `children`, which must survive.
    const people = hidden.has('household')
    const rowHidden = hidden.has('children')
    if (rowHidden) drop.add('children')
    if (rowHidden || !people) { drop.add('householdPeople'); drop.add('livesAlone') }
    for (const id of hidden) {
        if (id === 'household' || id === 'children') continue
        if (LOCKED.has(id)) continue
        drop.add(id)
        if (id === 'species') drop.add('speciesOther')
        if (id === 'geo') { drop.add('latitude'); drop.add('longitude') }
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) {
        if (!drop.has(k)) out[k] = v
    }
    return out
}

/**
 * Builds the POST /submit request body: strips answers belonging to hidden
 * steps (in case a stale draft carried them), attaches `animalId` only when
 * present (unchanged shape on the no-customization path — no `animalId: null`
 * ever sent), and always lists the step ids the adopter actually saw.
 */
export function buildSubmitBody(
    finalAnswers: Record<string, unknown>,
    hiddenSteps: readonly string[] | null,
    animalId: string | null | undefined,
    schema: readonly { id: string }[],
): Record<string, unknown> {
    const cleaned = stripHiddenAnswers(finalAnswers, hiddenSteps ?? [])
    return {
        ...cleaned,
        ...(animalId ? { animalId } : {}),
        shownSteps: schema.map(s => s.id),
    }
}

// ── Rich text (structurally identical to the Next app's) ─────────────
export type Mark = 'bold' | 'italic' | 'underline'
export type Inline = { text: string; marks?: Mark[] }
export type Block = { type: 'paragraph'; content: Inline[] } | { type: 'bulletList'; items: Inline[][] }
export type RichDoc = { type: 'doc'; content: Block[] }
export type SectionKey = '2' | '3' | '4'
const SECTION_KEYS: readonly SectionKey[] = ['2', '3', '4']

export type CustomContract = { versionId: string; sections: Partial<Record<SectionKey, RichDoc>> }

const MARKS: readonly Mark[] = ['bold', 'italic', 'underline']

function isPlainObject(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object' && !Array.isArray(x)
}

function isInline(x: unknown): x is Inline {
    if (!isPlainObject(x) || typeof x.text !== 'string') return false
    if (x.marks === undefined) return true
    return Array.isArray(x.marks) && x.marks.every(m => MARKS.includes(m as Mark))
}

function isInlineList(x: unknown): x is Inline[] {
    return Array.isArray(x) && x.every(isInline)
}

/** Exactly a paragraph or a bulletList — any other block type is invalid. */
function isBlock(x: unknown): x is Block {
    if (!isPlainObject(x)) return false
    if (x.type === 'paragraph') return isInlineList(x.content)
    if (x.type === 'bulletList') return Array.isArray(x.items) && x.items.every(isInlineList)
    return false
}

function isRichDoc(x: unknown): x is RichDoc {
    if (!isPlainObject(x)) return false
    return x.type === 'doc' && Array.isArray(x.content) && x.content.every(isBlock)
}

/**
 * `versionId` is a non-empty string; `sections` is an object whose keys are
 * a subset of 2, 3 and 4, each value a RichDoc validated all the way down:
 * blocks are exactly paragraph {content: Inline[]} or bulletList
 * {items: Inline[][]}, and each Inline is {text: string, marks?: subset of
 * bold|italic|underline}. Anything else — an unknown block type included —
 * makes the whole contract invalid, and the caller falls back to standard.
 */
export function isValidCustomContract(x: unknown): x is CustomContract {
    if (!isPlainObject(x)) return false
    if (typeof x.versionId !== 'string' || x.versionId.length === 0) return false
    if (!isPlainObject(x.sections)) return false
    const sections = x.sections
    for (const key of Object.keys(sections)) {
        if (!SECTION_KEYS.includes(key as SectionKey)) return false
        if (!isRichDoc(sections[key])) return false
    }
    return true
}

/**
 * Picks the custom RichDoc for contract section index `si` (0-based against
 * `CONTRACT_CONTENT[locale].sections`), where indices 0, 1, 2 map to section
 * keys '2', '3', '4'. Index 3 (section 5) is never customizable, and a
 * missing key (section not edited by the rescuer) falls back to `undefined`
 * so the caller renders the standard text.
 */
export function customSectionFor(custom: CustomContract | null | undefined, si: number): RichDoc | undefined {
    if (!custom || si >= 3 || si < 0) return undefined
    return custom.sections[String(si + 2) as SectionKey]
}

/**
 * PDF footer code. Standard: 'v:std-<STANDARD_CONTRACT_VERSION>'. Custom:
 * 'v:<first 8 of versionId> · std-<STANDARD_CONTRACT_VERSION>' — section 5
 * (and 2–4 left unedited) is still the standard text, so both codes identify
 * what was signed.
 */
export function contractVersionLabel(custom: CustomContract | null): string {
    if (custom) return `v:${custom.versionId.slice(0, 8)} · std-${STANDARD_CONTRACT_VERSION}`
    return `v:std-${STANDARD_CONTRACT_VERSION}`
}

/** 32-bit FNV-1a over UTF-16 code units, rendered as 8 lowercase hex chars. */
export function fnv1a(s: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
}

const LOCALES = ['es', 'en', 'pt'] as const
export const STANDARD_CONTRACT_VERSION: string = fnv1a(JSON.stringify(LOCALES.map(l => CONTRACT_CONTENT[l].sections)))
