'use client';

/**
 * How a person stands, wherever ONE person is summed up in a line: a household
 * member's row, «¿Es este perfil?», and the household line of a search result /
 * form, contract or Pendientes match card (CardHouseholdLine).
 *
 * - `PersonStanding`: «Menor de edad» first for a minor (an informational
 *   marker only — Jon, 2026-10-28), then the rating (★ + its word: colour is
 *   never the only signal) or «Sin calificación», and the open alerts
 *   (AlertSummary) when there are any — the same for everyone.
 * - `PersonActivity`: the person's activity counted as their own «Actividad»
 *   header counts it (ActivityCountsLine), «sin actividad» when none.
 *
 * One renderer, so the same fact never reads two ways («Sin calificación» here,
 * nothing there; «0 adopciones» here, «sin actividad» there).
 */
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { AlertSummary } from '@/components/AlertPill';
import type { OpenAlertKind } from '@/domain/flags';
import { ActivityCountsLine } from '@/components/ActivityCountsLine';
import { activityParts, type ActivityCounts } from '@/domain/activityCounts';

export function PersonStanding({ rating, openAlerts, isMinor, minorTestId, alertsTestId = 'person-alerts' }: {
    rating: number | null | undefined;
    /** Open alerts, one per kind (openAlertKinds — the profile header's rule). */
    openAlerts: readonly OpenAlertKind[];
    isMinor: boolean;
    minorTestId?: string;
    alertsTestId?: string;
}) {
    return (
        <>
            {isMinor && <MinorTag testId={minorTestId} />}
            {/* The one rating pill (or «Sin calificación»), as in the profile header (Jon, 2026-10-28). */}
            <RatingBadge rating={rating} />
            {/* The profile header's flag pill: one kind as itself, two as «2 alertas» (audit B2, fix round 2 item 9). */}
            <AlertSummary kinds={openAlerts} testId={alertsTestId} />
        </>
    );
}

export function PersonActivity({ activity, testId = 'person-activity' }: { activity: ActivityCounts; testId?: string }) {
    const { t } = useLanguage();
    if (activityParts(activity).length > 0) {
        return (
            // «·» between counts, never at the start of a wrapped line (SEPARATED_PIECE, audit B10).
            <span className="inline-block min-w-0 max-w-full overflow-hidden text-xs text-stone-600" data-testid={testId}>
                <span className="-ml-3 flex flex-wrap items-baseline"><ActivityCountsLine counts={activity} separated /></span>
            </span>
        );
    }
    return <span className="text-xs text-stone-500" data-testid={testId}>{t('adopter.hh_no_activity')}</span>;
}
