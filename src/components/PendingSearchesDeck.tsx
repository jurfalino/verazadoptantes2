'use client';

/**
 * "Quedó pendiente" — the searches this rescuer made that never became a
 * record, asked about on their next visit (ENABLE_PENDING_SEARCHES).
 *
 * Why it exists: a third of the searches that find someone never open a
 * profile, so the question on the profile page cannot reach those people.
 * Searches that refine one another are one ask (`groupPendingSearches`), and
 * the asks are swiped rather than stacked, so ten pending people cost one
 * screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPendingAsks, resolvePendingAsk, saveAdoption } from '@/app/actions';
import type { PendingAsk } from '@/domain/pendingSearches';
import { RECORD_TYPES } from '@/domain/constants';
import { useLanguage } from '@/context/LanguageContext';
import { useRelativeTime } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { userFacingMessage, handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { appendCreatePrefill } from '@/lib/createPrefill';
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

    const drop = useCallback((id: string) => {
        setAsks((prev) => prev.filter((a) => a.id !== id));
        setActive(0);
        trackRef.current?.scrollTo({ left: 0 });
    }, []);

    const onScroll = () => {
        const el = trackRef.current;
        const card = el?.firstElementChild as HTMLElement | null;
        if (!el || !card) return;
        setActive(Math.min(asks.length - 1, Math.round(el.scrollLeft / (card.offsetWidth + 8))));
    };

    const answer = async (ask: PendingAsk, recordType: Answer) => {
        setBusyId(ask.id);
        zarazTrack('pending_ask_answered', { record_type: recordType, known_adopter: !!ask.adopterId });
        try {
            if (!ask.adopterId) {
                // Nobody matched this search, so the person has to be created
                // first. The create form carries the query and the answer.
                const params = new URLSearchParams();
                appendCreatePrefill(params, ask.query);
                params.set('continueToAdoption', 'true');
                params.set('newAdoption', recordType);
                await resolvePendingAsk(ask.memberIds, 'recorded');
                router.push(`/adopter/create?${params.toString()}`);
                return;
            }

            await saveAdoption({ adopterId: ask.adopterId, recordType, date: new Date() } as never);
            await resolvePendingAsk(ask.memberIds, 'recorded');
            drop(ask.id);
            toast.success(t('pendingSearches.saved'));
        } catch (e) {
            if (!handledAsStale(e)) {
                toast.error(
                    t('pendingSearches.save_failed'),
                    userFacingMessage(e, t('pendingSearches.save_failed')),
                    resolveErrorId(e, 'PendingSearchesDeck.answer'),
                );
            }
        } finally {
            setBusyId(null);
        }
    };

    const dismiss = async (ask: PendingAsk) => {
        setBusyId(ask.id);
        zarazTrack('pending_ask_dismissed', {});
        try {
            await resolvePendingAsk(ask.memberIds, 'dismissed');
            drop(ask.id);
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
                    const when = relative(ask.createdAt * 1000, locale === 'en' ? 'en' : 'es');
                    const subtitle = ask.searchCount > 1
                        ? t('pendingSearches.searched_times')
                            .replace('{count}', String(ask.searchCount))
                            .replace('{when}', when || '')
                        : t('pendingSearches.searched_once')
                            .replace('{query}', ask.query)
                            .replace('{when}', when || '');
                    const busy = busyId === ask.id;

                    return (
                        <article
                            key={ask.id}
                            className="shrink-0 w-[88%] sm:w-[48%] rounded-xl p-4 flex flex-col gap-3"
                            style={{ background: 'var(--accent-subtle-bg)', border: '1px solid var(--border-accent)', scrollSnapAlign: 'start' }}
                        >
                            <div className="min-w-0">
                                <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                    {ask.adopterName || ask.query}
                                </p>
                                {/* Two lines: a long query would otherwise eat the "when" that
                                    tells the rescuer which visit this was. */}
                                <p className="text-xs line-clamp-2" style={{ color: 'var(--text-faint)' }}>{subtitle}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void answer(ask, RECORD_TYPES.REQUEST)}
                                    data-testid="pending-ask-request"
                                    className="px-4 py-2 rounded-xl text-sm font-bold text-left transition-all duration-200 disabled:opacity-40"
                                    style={chipStyle}
                                >
                                    {t('pendingSearches.option_request')}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void answer(ask, RECORD_TYPES.ADOPTION)}
                                    className="px-4 py-2 rounded-xl text-sm font-bold text-left transition-all duration-200 disabled:opacity-40"
                                    style={chipStyle}
                                >
                                    {t('pendingSearches.option_adoption')}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void dismiss(ask)}
                                    data-testid="pending-ask-dismiss"
                                    className="px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-40"
                                    style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
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
