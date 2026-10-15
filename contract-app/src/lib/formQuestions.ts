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

const HOSTS = FOLLOW_UP_HOSTS as Record<string, readonly string[]>
const ONLY = SPECIES_ONLY_STEPS as Record<string, string>

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

/** The host a follow-up renders under in this config — the first of its hosts that is asked — or null. */
export function followUpHost(id: string, present: ReadonlySet<string>): string | null {
    return HOSTS[id]?.find(h => present.has(h)) ?? null
}

/** The follow-ups shown under `hostId` (configured, and their host answer allows them). */
export function followUpsUnder(hostId: string, configSchema: { id: string }[], answers: Record<string, unknown>): string[] {
    const present = new Set(configSchema.map(s => s.id))
    return Object.keys(FOLLOW_UP_HOSTS)
        .filter(id => present.has(id) && followUpHost(id, present) === hostId && followUpVisible(id, answers))
}

/**
 * Whether `id` is a screen of its own for these answers (species-only and
 * follow-up rules). Follow-ups are screens only when none of their hosts is
 * asked — then allergy and carer stand alone; petsCare / sterilizeHow need a
 * host answer and are not asked at all.
 */
export function isOwnScreen(id: string, present: ReadonlySet<string>, answers: Record<string, unknown>, ctx: FormCtx): boolean {
    const only = ONLY[id]
    if (only) return effectiveSpecies(answers, ctx) === only
    if (HOSTS[id]) return !followUpHost(id, present) && (id === 'allergy' || id === 'carer')
    return true
}

/** Keeps only the new questions' answers that were actually asked. */
export function stripUnaskedNewAnswers(answers: Record<string, unknown>, configSchema: { id: string }[], ctx: FormCtx): Record<string, unknown> {
    const present = new Set(configSchema.map(s => s.id))
    const asked = (id: string): boolean => {
        if (!present.has(id)) return false
        if (HOSTS[id] && followUpHost(id, present)) return followUpVisible(id, answers)
        return isOwnScreen(id, present, answers, ctx)
    }
    const drop = new Set<string>()
    for (const id of NEW_FORM_STEPS) {
        if (!asked(id)) (ANSWER_KEYS[id] ?? [id]).forEach(k => drop.add(k))
    }
    if (answers.gaveAway !== 'yes') drop.add('gaveAwayWhy')
    if (![...drop].some(k => k in answers)) return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) if (!drop.has(k)) out[k] = v
    return out
}
