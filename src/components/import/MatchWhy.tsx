'use client';

import { useState } from 'react';
import { getMatchContext, type MatchContext } from '@/app/actions';
import { reportClientError } from '@/lib/clientErrorReporter';

const NAME_SIGNALS = new Set(['name_full', 'name_word', 'name_phonetic', 'name_word_fuzzy', 'like_fallback_name']);

/**
 * "¿Por qué?" under a possible duplicate in the post-import wizard — the same
 * explanation the spreadsheet import gives (audit 2026-10-21, D6): what the
 * existing profile HAS (presence only, never the values — it may be protected or
 * another team's), and a warning when only the name matched and there is
 * nothing on the other side to compare. Loaded on first open.
 */
export default function MatchWhy({ adopterId, matchTypes, t }: {
    adopterId: string;
    matchTypes: string[];
    t: (key: string) => string;
}) {
    const [open, setOpen] = useState(false);
    const [ctx, setCtx] = useState<MatchContext | 'loading' | 'error' | null>(null);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && ctx === null) {
            setCtx('loading');
            getMatchContext(adopterId)
                .then(c => setCtx(c.ok ? c : 'error'))
                .catch(e => {
                    // Degraded, not broken: the panel says it could not load — and it
                    // is logged, like every problem the rescuer sees (Jon, 2026-10-22).
                    void reportClientError({ message: 'import: match details could not load', source: 'MatchWhy', level: 'warn', extra: { adopterId, error: e instanceof Error ? e.message : String(e) } });
                    setCtx('error');
                });
        }
    };

    const nameOnly = matchTypes.length > 0 && matchTypes.every(m => NAME_SIGNALS.has(m));
    const presence: Array<[keyof MatchContext['has'], string]> = [
        ['phone', t('import.presence_phone')],
        ['email', t('import.presence_email')],
        ['id', t('import.presence_id')],
        ['social', t('import.presence_social')],
        ['address', t('import.presence_address')],
    ];

    return (
        <div className="mt-1">
            <span
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={e => { e.stopPropagation(); toggle(); }}
                onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    toggle();
                }}
                className="inline-flex items-center min-h-[44px] -my-2 text-xs font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2 cursor-pointer"
            >
                {t('import.why_toggle')}
            </span>
            {open && (
                <div className="mt-1 rounded-lg bg-stone-50 border border-stone-200 p-2.5 text-xs text-stone-700 space-y-1.5" onClick={e => e.stopPropagation()}>
                    {ctx === 'loading' && <p className="text-stone-500">…</p>}
                    {ctx === 'error' && <p className="text-stone-500">{t('import.why_unavailable')}</p>}
                    {ctx && ctx !== 'loading' && ctx !== 'error' && (
                        <>
                            <p className="font-medium">{t('import.why_existing_has')}</p>
                            <div className="flex flex-wrap gap-1">
                                {presence.map(([k, label]) => (
                                    <span key={k} className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${ctx.has[k] ? 'bg-teal-50 text-teal-800' : 'bg-stone-100 text-stone-500'}`}>
                                        {ctx.has[k] ? '✓' : '·'} {label}
                                    </span>
                                ))}
                            </div>
                            {nameOnly && !ctx.has.phone && !ctx.has.email && (
                                <p className="text-amber-800">{t('import.why_name_only_nothing_to_compare')}</p>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
