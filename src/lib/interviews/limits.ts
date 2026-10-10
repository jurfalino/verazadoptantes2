/**
 * Field limits of an interview draft. The server schema (validation.ts) and
 * the inputs share them: an input that accepts more than the schema makes the
 * whole draft unsaveable.
 */
export const INTERVIEW_LIMITS = {
    answerText: 4000,
    contactValue: 300,
    householdName: 120,
    customQuestion: 500,
    prepName: 200,
    prepRow: 300,
    prepAddress: 500,
    summary: 2000,
    numberMin: 0,
    numberMax: 1000,
} as const;

/**
 * A number input's raw text as an answer value: null when cleared, undefined
 * when it is not a number (ignore the keystroke), otherwise clamped to range.
 */
export function parseInterviewNumber(raw: string): number | null | undefined {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(INTERVIEW_LIMITS.numberMax, Math.max(INTERVIEW_LIMITS.numberMin, n));
}
