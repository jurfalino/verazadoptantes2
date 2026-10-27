'use client';

/**
 * «1 adopción · 2 pedidos · 1 tránsito» — a person's activity by record type,
 * with the «Actividad» header's colours and singular/plural words. The one
 * renderer for the profile's own «Actividad» header (AdoptionHistory) and for
 * each person in «Familiares / Convivientes»; the counting rule is
 * src/domain/activityCounts.ts. Each count carries `data-activity="<type>"`
 * so tests read it without depending on the language.
 */
import { Fragment } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { activityParts, type ActivityCounts, type ActivityKind } from '@/domain/activityCounts';

const WORDS: Record<ActivityKind, { one: string; many: string; color: string }> = {
    adoption: { one: 'stats.adoption_one', many: 'stats.adoptions', color: 'text-teal-700' },
    adoption_request: { one: 'stats.request_one', many: 'stats.requests', color: 'text-sky-700' },
    observation: { one: 'stats.observation_one', many: 'stats.observations', color: 'text-amber-700' },
    follow_up: { one: 'stats.follow_up_one', many: 'stats.follow_ups', color: 'text-violet-700' },
    returned_pet: { one: 'stats.return_one', many: 'stats.returns', color: 'text-rose-700' },
    foster: { one: 'stats.foster_one', many: 'stats.fosters', color: 'text-indigo-700' },
};

/** The counts as inline items (no wrapper): the caller's flex row spaces them. `separated` puts «·» between them. */
export function ActivityCountsLine({ counts, separated = false }: { counts: ActivityCounts; separated?: boolean }) {
    const { t } = useLanguage();
    return (
        <>
            {activityParts(counts).map(({ kind, n }, i) => (
                <Fragment key={kind}>
                    {separated && i > 0 && <span className="text-stone-400" aria-hidden="true">·</span>}
                    <span className="whitespace-nowrap" data-activity={kind} data-count={n}>
                        <strong className={WORDS[kind].color}>{n}</strong> {t(n === 1 ? WORDS[kind].one : WORDS[kind].many)}
                    </span>
                </Fragment>
            ))}
        </>
    );
}
