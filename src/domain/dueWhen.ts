/**
 * One wording rule for "when is this follow-up due", shared by the
 * /my-animals card and the animal profile's «Para hacer ahora» banner so the
 * two surfaces can never disagree. Pure: timestamps in, a tag out.
 *
 * Less than 24h past due still reads as "today" (the due moment is
 * placementStart + N days, so the same calendar day for the rescuer).
 */
export type DueWhen =
    | { kind: 'today' }
    | { kind: 'overdue'; days: number }
    | { kind: 'future' };

export function dueWhen(dueDateMs: number, nowMs: number): DueWhen {
    if (dueDateMs > nowMs) return { kind: 'future' };
    const days = Math.floor((nowMs - dueDateMs) / 86400000);
    return days === 0 ? { kind: 'today' } : { kind: 'overdue', days };
}
