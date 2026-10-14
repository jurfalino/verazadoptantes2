/**
 * The adoption-form "semáforo": a traffic-light read on the answers a
 * rescuer most needs to notice. Decided with Jon (2026-10-03):
 *
 *   intent    gift → risk (red)       self → ok (green)
 *   isSafe    no   → risk (red)       yes  → ok   "na" (no outdoor space) → none
 *   children  any  → caution (amber)  none → ok
 *
 * Spec 2026-10-14 §5 adds the new questions — red / amber only, no green:
 *   movingIfNoPets return → red, family → amber · gaveAway yes → red ·
 *   lastAnimal lost / street / gave → red · returnReasons any reason → amber ·
 *   willingToSterilize no → red · catOutdoor & dogTied yes → red, sometimes → amber ·
 *   sleepPlace outside → amber · rental rentNotAllowed / rentUnsure → amber ·
 *   visitConsent no → red · adaptPlan return → red · carer minor → amber ·
 *   allergy yes → amber.
 *
 * Red marks a likely dealbreaker, amber something to talk through with the
 * applicant. Every other question, and any unanswered or unknown value,
 * gets no signal — a dot must only ever mean one of these readings.
 */

export type AnswerSignal = 'ok' | 'caution' | 'risk';

export function answerSignal(field: string, raw: unknown): AnswerSignal | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const v = String(raw);
    switch (field) {
        case 'intent':
            return v === 'gift' ? 'risk' : v === 'self' ? 'ok' : null;
        case 'isSafe':
            return v === 'no' ? 'risk' : v === 'yes' ? 'ok' : null;
        case 'children':
            return v === 'none' ? 'ok' : ['1', '2', '3+'].includes(v) ? 'caution' : null;
        case 'movingIfNoPets': return v === 'return' ? 'risk' : v === 'family' ? 'caution' : null;
        case 'gaveAway': return v === 'yes' ? 'risk' : null;
        case 'lastAnimal': return ['lost', 'street', 'gave'].includes(v) ? 'risk' : null;
        case 'returnReasons': return ['allergy', 'baby', 'behaviour', 'other'].includes(v) ? 'caution' : null;
        case 'willingToSterilize': return v === 'no' ? 'risk' : null;
        case 'catOutdoor':
        case 'dogTied': return v === 'yes' ? 'risk' : v === 'sometimes' ? 'caution' : null;
        case 'sleepPlace': return v === 'outside' ? 'caution' : null;
        case 'rental': return v === 'rentNotAllowed' || v === 'rentUnsure' ? 'caution' : null;
        case 'visitConsent': return v === 'no' ? 'risk' : null;
        case 'adaptPlan': return v === 'return' ? 'risk' : null;
        case 'carer': return v === 'minor' ? 'caution' : null;
        case 'allergy': return v === 'yes' ? 'caution' : null;
        default:
            return null;
    }
}

/** One person in "¿Quiénes viven en la casa?" (Jon, 2026-10-04): under 5 red, 5–17 amber, adults green. */
export function personSignal(age: number): AnswerSignal {
    return age < 5 ? 'risk' : age < 18 ? 'caution' : 'ok';
}
