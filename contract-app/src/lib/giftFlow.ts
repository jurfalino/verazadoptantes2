/**
 * Gift flow (spec Part 2 §8): after "Es un regalo" + "¿Para quién es?", the
 * home questions talk about the recipient ("¿Dónde vive Laura?") and offer
 * "No sé" where the giver may not know. Pure — the form applies it per step.
 */
export const GIFT_UNKNOWN_STEPS = ['children', 'hasOutdoor', 'isSafe', 'petExperience', 'willingToSterilize', 'movingPlans', 'vacationPlan'] as const

const TITLE: Record<string, string> = {
    children: 'form.q_children_title_gift',
    existingPets: 'form.q_existing_pets_title_gift',
    housingType: 'form.q_housing_title_gift',
    hasOutdoor: 'form.q_outdoor_title_gift',
    petExperience: 'form.q_pet_experience_title_gift',
    willingToSterilize: 'form.q_sterilize_title_gift',
    movingPlans: 'form.q_moving_title_gift',
    vacationPlan: 'form.q_vacation_title_gift',
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

/** A "Para mí" form never carries the recipient or a "No sé" left over from a gift draft. */
export function stripGiftAnswers(answers: Record<string, unknown>): Record<string, unknown> {
    if (answers.intent === 'gift') return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) {
        if (k === 'giftRecipient' || v === 'unknown') continue
        out[k] = v
    }
    return out
}
