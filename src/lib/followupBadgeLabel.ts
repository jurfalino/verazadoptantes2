import { interpolate } from '@/lib/interpolate';
import { dueWhenText } from '@/lib/dueWhenText';

type T = (key: string) => string;

/**
 * The amber «pendiente» row's words: the most overdue control, when it was
 * due, and «+N» for the animal's others — «Control del primer mes · venció
 * hace 3 días +2». The /my-animals card and the homepage animals card both
 * render it, so a follow-up reads the same everywhere. Client-safe.
 */
export function followupBadgeLabel(
    t: T,
    dueFollowups: number,
    dueTop: { copyKey: string; offsetDays?: number; dueDate: number } | null | undefined,
    nowMs: number,
): string {
    // Name the action instead of only counting it: "1 pendiente" made the
    // rescuer open the animal just to find out what.
    if (!dueTop) {
        return `${dueFollowups} ${dueFollowups === 1
            ? (t('followups.pending_one') || 'pendiente')
            : (t('followups.pending_many') || 'pendientes')}`;
    }
    const label = (dueTop.copyKey === 'checkin_custom' || dueTop.copyKey === 'foster_checkin')
        ? interpolate(t(`followups.${dueTop.copyKey}`) || '{days}', { days: dueTop.offsetDays ?? '' })
        : (t(`followups.${dueTop.copyKey}`) || dueTop.copyKey);
    const extra = dueFollowups - 1;
    return `${label} · ${dueWhenText(t, dueTop.dueDate, nowMs)}${extra > 0 ? ` +${extra}` : ''}`;
}
