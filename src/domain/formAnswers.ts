/**
 * Form-answer sections and the «what needs a look» summary — pure domain.
 * FormAnswersPanel renders from FORM_ANSWER_SECTIONS + answerShown, so the
 * summary counts exactly the rows the panel shows.
 */
import { answerSignal, personSignal, type AnswerSignal } from './answerSignals';

export const FORM_ANSWER_SECTIONS: ReadonlyArray<{ id: string; titleKey: string; fields: readonly string[] }> = [
    { id: 'identity', titleKey: 'petshield.sections.identity', fields: ['ageRange', 'carer', 'lastAnimal', 'petExperience', 'gaveAway', 'gaveAwayWhy', 'instagram', 'facebook', 'vetReference', 'motivation', 'howHeard'] },
    { id: 'household', titleKey: 'petshield.sections.household', fields: ['children', 'allergy', 'existingPets', 'petsCare', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied'] },
    { id: 'preferences', titleKey: 'petshield.sections.preferences', fields: ['species', 'speciesOther', 'lifeStage', 'intent'] },
    { id: 'commitments', titleKey: 'petshield.sections.commitments', fields: ['specialNeeds', 'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingIfNoPets', 'movingPlans', 'vacationPlan', 'returnReasons', 'adaptPlan', 'visitConsent'] },
    { id: 'context', titleKey: 'petshield.sections.context', fields: ['geo', 'legal'] },
];

/** True when FormAnswersPanel renders a row for this answer. */
export function answerShown(field: string, raw: unknown): boolean {
    if (raw === undefined || raw === null || raw === '') return false;
    if (typeof raw === 'object' && typeof (raw as { open?: unknown }).open === 'string') return (raw as { open: string }).open !== '';
    if (field === 'existingPets') {
        if (typeof raw !== 'object') return false;
        return Object.values(raw as Record<string, unknown>).some((v) => typeof v === 'number' && v > 0);
    }
    return true;
}

/** `field` 'household' = the people list. */
export type FlaggedAnswer = { field: string; signal: 'risk' | 'caution' };

export function summarizeAnswers(answers: Record<string, unknown>): { flagged: FlaggedAnswer[]; restCount: number } {
    const people = Array.isArray(answers.householdPeople) ? (answers.householdPeople as Array<{ age: number }>) : null;
    const red: FlaggedAnswer[] = [];
    const amber: FlaggedAnswer[] = [];
    let shown = 0;
    for (const section of FORM_ANSWER_SECTIONS) {
        for (const field of section.fields) {
            const raw = answers[field];
            if (!answerShown(field, raw)) continue;
            shown++;
            let signal: AnswerSignal | null;
            let name = field;
            if (field === 'children' && people) {
                name = 'household';
                const signals = people.map((p) => personSignal(p.age));
                signal = signals.includes('risk') ? 'risk' : signals.includes('caution') ? 'caution' : null;
            } else {
                signal = answerSignal(field, raw);
            }
            if (signal === 'risk') red.push({ field: name, signal });
            else if (signal === 'caution') amber.push({ field: name, signal });
        }
    }
    const flagged = [...red, ...amber];
    return { flagged, restCount: shown - flagged.length };
}
