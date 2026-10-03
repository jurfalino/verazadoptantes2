/**
 * The adoption-form "semáforo": a traffic-light read on the answers a
 * rescuer most needs to notice. Decided with Jon (2026-10-03):
 *
 *   intent    gift → risk (red)       self → ok (green)
 *   isSafe    no   → risk (red)       yes  → ok   "na" (no outdoor space) → none
 *   children  any  → caution (amber)  none → ok
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
        default:
            return null;
    }
}
