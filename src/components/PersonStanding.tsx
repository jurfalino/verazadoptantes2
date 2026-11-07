'use client';

/**
 * How a person stands, wherever ONE person is summed up in a line: a household
 * member's row, «¿Es este perfil?» and a match card's header. A card's
 * housemate alerts («Conviviente con …», HousemateAlert) come in through
 * `alerts`: after the rating, before the flags — alerts first, as everywhere.
 *
 * - `PersonStanding`: «Menor de edad» first for a minor (an informational
 *   marker only — Jon, 2026-10-28), then the rating (★ + its word: colour is
 *   never the only signal) or «Sin calificación», and the open flags as
 *   neutral chips by name (FlagSummary: never «Inexacto», never counted as
 *   «N alertas» — Jon, 2026-11-01) — the same for everyone.
 * - `PersonActivity`: the person's activity counted as their own «Actividad»
 *   header counts it (ActivityCountsLine), «sin actividad» when none.
 *
 * One renderer, so the same fact never reads two ways («Sin calificación» here,
 * nothing there; «0 adopciones» here, «sin actividad» there).
 */
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { MinorTag } from '@/components/MinorTag';
import { FlagSummary } from '@/components/AlertPill';
import type { OpenFlagKind } from '@/domain/flags';
import type { ReactNode } from 'react';
import { ActivityCountsLine } from '@/components/ActivityCountsLine';
import { activityParts, type ActivityCounts } from '@/domain/activityCounts';

export function PersonStanding({ rating, openFlags, isMinor, minorTestId, flagsTestId = 'person-flags', alerts }: {
    rating: number | null | undefined;
    /** Open flags, one per kind (openFlagKinds — the profile header's rule). */
    openFlags: readonly OpenFlagKind[];
    isMinor: boolean;
    minorTestId?: string;
    flagsTestId?: string;
    /** The card's ALERTS about this person (the housemate chips), drawn before the flags. */
    alerts?: ReactNode;
}) {
    return (
        <>
            {isMinor && <MinorTag testId={minorTestId} />}
            {/* The one rating pill (or «Sin calificación»), as in the profile header (Jon, 2026-10-28). */}
            <RatingBadge rating={rating} />
            {alerts}
            {/* The flags, one neutral chip each by name — never «Inexacto», never «N alertas» (rescuerFlagKinds). */}
            <FlagSummary kinds={openFlags} testId={flagsTestId} />
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
