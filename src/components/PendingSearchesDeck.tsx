'use client';

/**
 * "Quedó pendiente" — the searches this rescuer made that never became a
 * record, asked about on their next visit (ENABLE_PENDING_SEARCHES).
 *
 * Why it exists: a third of the searches that find someone never open a
 * profile, so the question on the profile page cannot reach those people.
 *
 * **This deck never writes an activity record.** v2.56.82 did, onto an adopter
 * inherited from a broader search in the same group, without showing who it
 * was — a record whose subject nobody had confirmed. A reason tapped here now
 * only carries the rescuer to the place where the person is on screen: their
 * profile when the search identified them beyond doubt, the search itself when
 * it did not. The save happens there, deliberately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPendingAsks, resolvePendingAsk } from '@/app/actions';
import { isIdentified, type PendingAsk } from '@/domain/pendingSearches';
import { RECORD_TYPES } from '@/domain/constants';
import { useLanguage } from '@/context/LanguageContext';
import { useRelativeTime } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { zarazTrack } from '@/lib/zaraz';

type Answer = typeof RECORD_TYPES.REQUEST | typeof RECORD_TYPES.ADOPTION;

export default function PendingSearchesDeck() {
    const { t, locale } = useLanguage();
    const router = useRouter();
    const toast = useShowToast();
    const relative = useRelativeTime();
    const trackRef = useRef<HTMLDivElement>(null);

    const [asks, setAsks] = useState<PendingAsk[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [active, setActive] = useState(0);

    useEffect(() => {
        let alive = true;
        getPendingAsks()
            .then((rows) => { if (alive) setAsks(rows); })
            // An empty deck is the right failure mode for a homepage card: the
            // action already logged whatever went wrong server-side.
            .catch(() => { if (alive) setAsks([]); });
        return () => { alive = false; };
    }, []);

    const onScroll = useCallback(() => {
        const el = trackRef.current;
        const card = el?.firstElementChild as HTMLElement | null;
        if (!el || !card) return;
        setActive(Math.min(asks.length - 1, Math.round(el.scrollLeft / (card.offsetWidth + 8))));
    }, [asks.length]);

    /** Take the rescuer to the person, with the reason already chosen. */
    const openProfile = (ask: PendingAsk, recordType: Answer) => {
        zarazTrack('pending_ask_opened_profile', { record_type: recordType });
        router.push(`/adopter/${ask.adopterId}?newAdoption=${recordType}`);
    };

    /** Nobody was identified, so run the search again and let them choose. */
    const searchAgain = (ask: PendingAsk) => {
        zarazTrack('pending_ask_searched_again', {});
        router.push(`/?q=${encodeURIComponent(ask.query)}`);
    };

    const dismiss = async (ask: PendingAsk) => {
        setBusyId(ask.id);
        zarazTrack('pending_ask_dismissed', {});
        try {
            await resolvePendingAsk(ask.memberIds, 'dismissed');
            setAsks((prev) => prev.filter((a) => a.id !== ask.id));
            setActive(0);
            trackRef.current?.scrollTo({ left: 0 });
        } catch (e) {
            if (!handledAsStale(e)) {
                toast.error(
                    t('pendingSearches.save_failed'),
                    userFacingMessage(e, t('pendingSearches.save_failed')),
                    resolveErrorId(e, 'PendingSearchesDeck.dismiss'),
                );
            }
        } finally {
            setBusyId(null);
        }
    };

    if (asks.length === 0) return null;

    const chipStyle = {
        background: 'var(--surface-card)',
        color: 'var(--accent)',
        border: '1px solid var(--accent)',
    } as const;
    const quietStyle = {
        background: 'transparent',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-default)',
    } as const;

    return (
        <section
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-accent)' }}
            aria-label={t('pendingSearches.title')}
            data-testid="pending-searches-deck"
        >
            <div className="flex items-baseline gap-2">
                <h2 className="text-base font-bold flex-1 min-w-0" style={{ color: 'var(--accent)' }}>
                    {t('pendingSearches.title')}
                </h2>
                {asks.length > 1 && (
                    <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>
                        {active + 1} / {asks.length}
                    </span>
                )}
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('pendingSearches.subtitle')}</p>

            <div
                ref={trackRef}
                onScroll={onScroll}
                className="pending-deck flex gap-2 overflow-x-auto"
                style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
            >
                {asks.map((ask) => {
                    const when = relative(ask.createdAt * 1000, locale === 'en' ? 'en' : 'es') || '';
                    const counted = ask.searchCount > 1
                        ? t('pendingSearches.searched_times')
                            .replace('{count}', String(ask.searchCount))
                            .replace('{when}', when)
                        : t('pendingSearches.searched_once_short').replace('{when}', when);
                    const known = isIdentified(ask) && !!ask.adopterName;
                    const busy = busyId === ask.id;

                    return (
                        <article
                            key={ask.id}
                            className="shrink-0 w-[88%] sm:w-[48%] rounded-xl p-4 flex flex-col gap-3"
                            style={{ background: 'var(--accent-subtle-bg)', border: '1px solid var(--border-accent)', scrollSnapAlign: 'start' }}
                            data-testid={known ? 'pending-ask-known' : 'pending-ask-unknown'}
                        >
                            <div className="min-w-0">
                                {/* The words they typed — the one thing that is always true. */}
                                <p className="text-base font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                                    {ask.query}
                                </p>
                                <p className="text-xs line-clamp-2" style={{ color: 'var(--text-faint)' }}>{counted}</p>
                                {known && (
                                    <p className="text-xs font-semibold line-clamp-1 mt-1" style={{ color: 'var(--accent)' }}>
                                        {t('pendingSearches.matches').replace('{name}', ask.adopterName as string)}
                                    </p>
                                )}
                            </div>

                            <div className="flex flex-col gap-2">
                                {known ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => openProfile(ask, RECORD_TYPES.REQUEST)}
                                            data-testid="pending-ask-request"
                                            className="px-4 py-2 rounded-xl text-sm font-bold text-left transition-all duration-200"
                                            style={chipStyle}
                                        >
                                            {t('pendingSearches.option_request')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openProfile(ask, RECORD_TYPES.ADOPTION)}
                                            className="px-4 py-2 rounded-xl text-sm font-bold text-left transition-all duration-200"
                                            style={chipStyle}
                                        >
                                            {t('pendingSearches.option_adoption')}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => searchAgain(ask)}
                                        data-testid="pending-ask-search-again"
                                        className="px-4 py-2 rounded-xl text-sm font-bold text-left transition-all duration-200"
                                        style={chipStyle}
                                    >
                                        {t('pendingSearches.option_search_again')}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void dismiss(ask)}
                                    data-testid="pending-ask-dismiss"
                                    className="px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-40"
                                    style={quietStyle}
                                >
                                    {t('pendingSearches.option_nothing')}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>

            {asks.length > 1 && (
                <div className="flex justify-center gap-2" aria-hidden="true">
                    {asks.map((ask, i) => (
                        <span
                            key={ask.id}
                            className="w-2 h-2 rounded-full transition-all duration-200"
                            style={{ background: i === active ? 'var(--accent)' : 'var(--border-default)' }}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
