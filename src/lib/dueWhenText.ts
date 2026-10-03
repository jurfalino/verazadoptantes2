import { dueWhen } from '@/domain/dueWhen';
import { interpolate } from '@/lib/interpolate';

type T = (key: string) => string;

/**
 * The ONE place that turns a follow-up due date into words. Used by the
 * /my-animals card and the profile's «Para hacer ahora» banner.
 * Client-safe (no server imports).
 */
export function dueWhenText(
    t: T,
    dueDateMs: number,
    nowMs: number,
    formatDate: (ms: number) => string = () => '',
): string {
    const due = dueWhen(dueDateMs, nowMs);
    if (due.kind === 'overdue') {
        return due.days === 1
            ? (t('followups.overdue_day_one') || 'venció hace 1 día')
            : interpolate(t('followups.overdue_days') || 'venció hace {days} días', { days: due.days });
    }
    if (due.kind === 'future') return `${t('followups.vence_el') || 'vence el'} ${formatDate(dueDateMs)}`.trim();
    return t('followups.due_today') || 'vence hoy';
}
