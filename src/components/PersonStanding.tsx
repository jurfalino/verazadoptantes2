'use client';

/**
 * How a person stands, wherever ONE person is summed up in a line: a household
 * member's row, «¿Es este perfil?», and the household line of a search result /
 * form, contract or Pendientes match card (CardHouseholdLine).
 *
 * - `PersonStanding`: «Menor de edad» for a minor (who carries no rating or
 *   alerts), else the rating (★ + its word: colour is never the only signal)
 *   or «Sin calificación», and «N alertas» when there are any.
 * - `PersonActivity`: the person's activity counted as their own «Actividad»
 *   header counts it (ActivityCountsLine), «sin actividad» when none — and
 *   nothing for a minor with none (their records go on the adults).
 *
 * One renderer, so the same fact never reads two ways («Sin calificación» here,
 * nothing there; «0 adopciones» here, «sin actividad» there).
 */
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { AlertPill } from '@/components/AlertPill';
import { ActivityCountsLine } from '@/components/ActivityCountsLine';
import { activityParts, type ActivityCounts } from '@/domain/activityCounts';

export function PersonStanding({ rating, openAlerts, isMinor, minorTestId, alertsTestId = 'person-alerts' }: {
    rating: number | null | undefined;
    openAlerts: number;
    isMinor: boolean;
    minorTestId?: string;
    alertsTestId?: string;
}) {
    const { t } = useLanguage();
    if (isMinor) return <MinorTag testId={minorTestId} />;
    return (
        <>
            {rating != null && rating >= 1
                ? <RatingBadge rating={rating} variant="inline" size="sm" label="short" />
                : <span className="text-xs text-stone-500 whitespace-nowrap" data-testid="person-unrated">{t('adopter.hh_link_unrated')}</span>}
            {openAlerts > 0 && (
                // The profile header's flag pill (AlertPill), with the count (audit B2).
                <AlertPill kind="count" testId={alertsTestId}>
                    {openAlerts === 1 ? t('adopter.hh_link_alerts_one') : t('adopter.hh_link_alerts_many').replace('{n}', String(openAlerts))}
                </AlertPill>
            )}
        </>
    );
}

export function PersonActivity({ activity, isMinor, testId = 'person-activity' }: { activity: ActivityCounts; isMinor: boolean; testId?: string }) {
    const { t } = useLanguage();
    if (activityParts(activity).length > 0) {
        return (
            <span className="inline-flex flex-wrap items-baseline gap-x-1 text-xs text-stone-600" data-testid={testId}>
                <ActivityCountsLine counts={activity} separated />
            </span>
        );
    }
    if (isMinor) return null;
    return <span className="text-xs text-stone-500" data-testid={testId}>{t('adopter.hh_no_activity')}</span>;
}
