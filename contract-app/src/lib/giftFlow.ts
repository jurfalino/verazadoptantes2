/**
 * Gift flow (spec Part 2 §8): after "Es un regalo" + "¿Para quién es?", the
 * home questions talk about the recipient ("¿Dónde vive Laura?") and offer
 * "No sé" where the giver may not know. Pure — the form applies it per step.
 */
// Not vacationPlan: it already offers "No lo sé aún" (Jon, 2026-10-13).
// The 2026-10-14 home questions about the recipient's home and past animals too (spec §4.3);
// allergy and moving-if-no-pets already offer their own "No sé".
export const GIFT_UNKNOWN_STEPS = ['children', 'hasOutdoor', 'isSafe', 'petExperience', 'willingToSterilize', 'movingPlans',
    'rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'lastAnimal', 'gaveAway'] as const
const UNKNOWN_STEPS = new Set<string>(GIFT_UNKNOWN_STEPS)

const TITLE: Record<string, string> = {
    children: 'form.q_children_title_gift',
    existingPets: 'form.q_existing_pets_title_gift',
    housingType: 'form.q_housing_title_gift',
    hasOutdoor: 'form.q_outdoor_title_gift',
    petExperience: 'form.q_pet_experience_title_gift',
    willingToSterilize: 'form.q_sterilize_title_gift',
    movingPlans: 'form.q_moving_title_gift',
    vacationPlan: 'form.q_vacation_title_gift',
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
}

/** The gift title key for a step, or null when its wording doesn't change (the household step words itself). */
export function giftTitleKey(stepId: string): string | null {
    return TITLE[stepId] ?? null
}

/** A gift with a named recipient — before the name is given, wording stays neutral. */
export function isGift(answers: Record<string, unknown>): boolean {
    const r = answers.giftRecipient as { firstName?: unknown } | undefined
    return answers.intent === 'gift' && typeof r?.firstName === 'string' && !!r.firstName.trim()
}

export function recipientFirstName(answers: Record<string, unknown>): string {
    return String((answers.giftRecipient as { firstName?: string } | undefined)?.firstName ?? '').trim()
}

/** The step as a gift form asks it; the same object when nothing changes. */
export function adaptStepForGift<S extends { id: string; title: string; options?: Array<{ value: string; label: string; icon?: string }> }>(
    step: S, answers: Record<string, unknown>, t: (k: string) => string,
): S {
    if (!isGift(answers)) return step
    const key = giftTitleKey(step.id)
    const withUnknown = (GIFT_UNKNOWN_STEPS as readonly string[]).includes(step.id) && Array.isArray(step.options)
    if (!key && !withUnknown) return step
    return {
        ...step,
        ...(key ? { title: t(key).replace('{n}', recipientFirstName(answers)) } : {}),
        ...(withUnknown ? { options: [...step.options!, { value: 'unknown', label: t('form.opt_unknown'), icon: 'maybe' }] } : {}),
    }
}

/** A "No sé" — only on the questions that offer it; "unknown" typed in a text field is an answer. */
const isUnknownAnswer = (k: string, v: unknown) => v === 'unknown' && UNKNOWN_STEPS.has(k)

/** A "Para mí" form never carries the recipient or a "No sé" left over from a gift draft. */
export function stripGiftAnswers(answers: Record<string, unknown>): Record<string, unknown> {
    if (answers.intent === 'gift') return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) {
        if (k === 'giftRecipient' || isUnknownAnswer(k, v)) continue
        out[k] = v
    }
    return out
}

/**
 * The answers as the form should hold them right now. Not a gift → every
 * "No sé" goes at once, so those questions read as unanswered and get asked
 * again (the recipient stays, in case they switch back). "Intención" not asked
 * (the rescuer hid it after a gift draft was saved) → not a gift at all.
 * Returns the same object when nothing changes.
 */
export function settleGiftAnswers(answers: Record<string, unknown>, intentAsked: boolean): Record<string, unknown> {
    const dropIntent = !intentAsked && ('intent' in answers || 'giftRecipient' in answers)
    if (!dropIntent && answers.intent === 'gift') return answers
    const stale = Object.entries(answers).some(([k, v]) => isUnknownAnswer(k, v))
    if (!dropIntent && !stale) return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) {
        if (isUnknownAnswer(k, v)) continue
        if (dropIntent && (k === 'intent' || k === 'giftRecipient')) continue
        out[k] = v
    }
    return out
}

/** The applicant's phone rule (PetShieldForm VALIDATORS['phone-ar']); the server keeps only phones that pass it. */
const PHONE = /^[\d+\s()-]{7,}$/

/** What stops "¿Para quién es?" from being answered — null when it can go on. */
export function giftRecipientProblem(r: { relationship?: string; firstName?: string; phone?: string }): 'missing' | 'phone' | null {
    if (!r.relationship || !r.firstName?.trim()) return 'missing'
    const phone = r.phone?.trim()
    if (phone && !PHONE.test(phone)) return 'phone'
    return null
}
