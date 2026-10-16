/**
 * Pure form-step / draft / custom-contract helpers for the contract-app SPA.
 * Mirrors the Next app's src/domain/adoptionDocs.ts — the FORM_STEP_IDS and
 * LOCKED_FORM_STEPS literals below must stay byte-identical (same order,
 * same quotes) because src/domain/adoptionDocs.mirror.test.ts extracts them
 * from this file's source text with a regex. NO server/DB imports here; this
 * ships to the browser.
 */
import { CONTRACT_CONTENT } from '../i18n/contractContent'

import { stripGiftAnswers } from './giftFlow'
import { stripPhotos } from './formPhotos'
import { settleOpenAnswers } from './openAnswers'
import { NEW_FORM_STEPS, DEFAULT_OFF_FORM_STEPS, isOwnScreen, followUpHost, followUpVisible, stripUnaskedNewAnswers, type FormCtx } from './formQuestions'

const NEW = new Set<string>(NEW_FORM_STEPS)
const OFF = new Set<string>(DEFAULT_OFF_FORM_STEPS)
const VARIANT_OF: Record<string, string> = { lastAnimal: 'petExperience', movingIfNoPets: 'movingPlans' }

export const FORM_STEP_IDS = [
    'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'carer', 'giftRecipient', 'children', 'allergy',
    'existingPets', 'petsCare', 'housingType', 'rental', 'household', 'hasOutdoor', 'isSafe', 'catOutdoor',
    'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'petExperience', 'lastAnimal', 'gaveAway',
    'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingPlans', 'movingIfNoPets', 'vacationPlan',
    'returnReasons', 'adaptPlan', 'visitConsent', 'identity-name', 'identity-email', 'identity-phone',
    'identity-address', 'social', 'ageRange', 'vetReference', 'motivation', 'geo', 'selfie',
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
 * applied to the schema. `stored` null = custom forms off (or the config
 * didn't load) → today's form: none of the 2026-10 questions, "¿Hay niños?",
 * the old "mascotas previas" / "mudanza" wordings.
 */
export function formStepsToAsk<T extends { id: string }>(schema: T[], stored: readonly string[] | null | undefined): T[] {
    if (stored == null) return schema.filter(s => !NEW.has(s.id) && s.id !== 'household')
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

/** Per-form options in the same stored list (mirror of the app's FORM_OPTION_TOKENS). */
export const FORM_OPTION_TOKENS = [
    'phone-optional',
    'on:catOutdoor', 'on:dogWalks', 'on:dogTied', 'on:social', 'on:vetReference', 'on:motivation',
    'way:petExperience:old', 'way:movingPlans:old',
    'on:photos', 'photos-required',
    'way:carer:open',
    'way:petsCare:open',
    'way:rental:open',
    'way:isSafe:open',
    'way:catOutdoor:open',
    'way:sleepPlace:open',
    'way:hoursAlone:open',
    'way:dogWalks:open',
    'way:dogTied:open',
    'way:petExperience:open',
    'way:gaveAway:open',
    'way:sterilizeHow:open',
    'way:movingPlans:open',
    'way:vacationPlan:open',
    'way:returnReasons:open',
    'way:adaptPlan:open',
] as const

/** The phone is required unless the rescuer turned it off — also when the config couldn't load (null). */
export function isPhoneRequired(stored: readonly string[] | null | undefined): boolean {
    return !(stored ?? []).includes('phone-optional')
}

/** Release 3: this step is asked as free text (`way:<row>:open`) — never with no config. A variant follows its row. */
export function isAskedOpen(stepId: string, stored: readonly string[] | null | undefined): boolean {
    return (stored ?? []).includes(`way:${VARIANT_OF[stepId] ?? stepId}:open`)
}

/** Release 2: photos of the protection — never with no config (custom forms off). */
export function photosOn(stored: readonly string[] | null | undefined): boolean {
    return (stored ?? []).includes('on:photos')
}

export function photosRequired(stored: readonly string[] | null | undefined): boolean {
    return photosOn(stored) && (stored ?? []).includes('photos-required')
}

/** The schema with the phone field's `required` set from the stored list (spec Part 3). */
export function withPhoneRequirement<T extends { id: string; fields?: Array<{ name: string; required?: boolean }> }>(
    schema: T[], stored: readonly string[] | null | undefined,
): T[] {
    const required = isPhoneRequired(stored)
    return schema.map(s => s.id === 'identity-phone' && s.fields
        ? { ...s, fields: s.fields.map(f => (f.name === 'phone' ? { ...f, required } : f)) }
        : s)
}

/** Steps that exist only because of an earlier answer (mirror of the app's DERIVED_FORM_STEPS). */
export const DERIVED_FORM_STEPS = ['giftRecipient'] as const
const DERIVED = new Set<string>(DERIVED_FORM_STEPS)

/**
 * The screens for these answers: "¿Para quién es?" only after "Es un regalo";
 * species-only questions only for that species; follow-ups render inside their
 * host's screen (FollowUps) and are screens only when no host is asked.
 */
export function stepsForAnswers<T extends { id: string }>(schema: T[], answers: Record<string, unknown>, ctx: FormCtx = {}): T[] {
    const present = new Set(schema.map(s => s.id))
    return schema.filter(s => (s.id === 'giftRecipient' ? answers.intent === 'gift' : isOwnScreen(s.id, present, answers, ctx)))
}

/**
 * Where "Continuar" from `step` goes, read from the answers being saved — the
 * schema on screen before the tap may not have the step the tap adds
 * ("Es un regalo" → "¿Para quién es?") or may still have the one it removes.
 */
export function stepAfter<T extends { id: string }>(configSchema: T[], step: number, nextAnswers: Record<string, unknown>, ctx: FormCtx = {}): { id: string } | 'submit' {
    const next = stepsForAnswers(configSchema, nextAnswers, ctx)[step + 1]
    return next ? { id: next.id } : 'submit'
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
/** The questions the applicant saw: their screens, plus the follow-ups shown under a host. */
function shownStepIds(configSchema: { id: string }[], answers: Record<string, unknown>, ctx: FormCtx): string[] {
    const present = new Set(configSchema.map(s => s.id))
    const screens = new Set(stepsForAnswers(configSchema, answers, ctx).map(s => s.id))
    return configSchema.map(s => s.id).filter(id => screens.has(id) || (!!followUpHost(id, present) && followUpVisible(id, answers)))
}

export function buildSubmitBody(
    finalAnswers: Record<string, unknown>,
    hiddenSteps: readonly string[] | null,
    animalId: string | null | undefined,
    configSchema: readonly { id: string }[],
    ctx: FormCtx = {},
): Record<string, unknown> {
    // A "Para mí" form never carries a recipient or a "No sé" from a gift draft;
    // a new question carries an answer only if it was really asked (spec 2026-10-14).
    const cleaned = settleOpenAnswers(stripPhotos(
        stripUnaskedNewAnswers(stripGiftAnswers(stripHiddenAnswers(finalAnswers, hiddenSteps ?? [])), [...configSchema], ctx),
        hiddenSteps, [...configSchema],
    ), hiddenSteps, [...configSchema])
    return {
        ...cleaned,
        ...(animalId ? { animalId } : {}),
        shownSteps: shownStepIds([...configSchema], cleaned, ctx),
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
