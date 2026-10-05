/**
 * Pure rules for the "¿Quiénes viven en la casa?" step (spec 2026-10-04 §1).
 * The server re-validates everything (src/domain/householdPeople.ts); these
 * only decide what the form lets the applicant do.
 */
export type DraftPerson = { relationship: string | null; age: number | null; firstName?: string; lastName?: string }

export function isPersonComplete(p: DraftPerson): boolean {
    return !!p.relationship && typeof p.age === 'number' && Number.isInteger(p.age) && p.age >= 0 && p.age <= 120
}

/** "…en la casa?" / "…en el departamento?" from the housing answer; neutral otherwise. */
export function householdStepTitleKey(housingType: unknown): string {
    return housingType === 'house' ? 'form.q_household_title_house'
        : housingType === 'apartment' ? 'form.q_household_title_apartment'
            : 'form.q_household_title_home'
}

/** Continue needs "Vivo solo/a" or at least one complete person, and no card left half-filled. */
export function canLeaveHouseholdStep(s: { livesAlone: boolean; people: DraftPerson[]; editing: DraftPerson | null }): boolean {
    if (s.editing) return false
    return s.livesAlone || (s.people.length > 0 && s.people.every(isPersonComplete))
}
