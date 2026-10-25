'use client';

import { useEffect, useState } from 'react';
import { getMatchContext, type MatchContext } from '@/app/actions';
import { reportClientError } from '@/lib/clientErrorReporter';
import { matchBreakdown, type BreakdownRow, type BreakdownStatus } from '@/domain/matchBreakdown';

/**
 * What a possible duplicate shares with the post being imported — and what it
 * doesn't — field by field (Jon, 2026-10-25: "if a possible duplicate is
 * detected, we don't explain why").
 *
 * Builds on the spreadsheet import's "¿por qué?" panel (your data next to what
 * the existing profile has) and PendingDedup's matched-value chips. The
 * existing profile's contact VALUES are never shown — it may be another team's
 * protected profile. A row shows the post's own value (the rescuer has it) and,
 * for the profile, only whether it has that kind of contact. Its name is shown:
 * names are not PII-gated. The profile's side loads on first open.
 */
export default function MatchWhy({ adopterId, matchTypes, profileName, postName, postEntries, t, defaultOpen = false }: {
    adopterId: string;
    matchTypes: string[];
    profileName: string;
    postName: string | undefined;
    postEntries: Array<{ type: string; value: string }>;
    t: (key: string) => string;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const [ctx, setCtx] = useState<MatchContext | 'loading' | 'error' | null>(null);

    useEffect(() => {
        if (!open || ctx !== null) return;
        setCtx('loading');
        getMatchContext(adopterId)
            .then(c => setCtx(c.ok ? c : 'error'))
            .catch(e => {
                // Degraded, not broken: the rows still show what matched — and it
                // is logged, like every problem the rescuer sees.
                void reportClientError({ message: 'import: match details could not load', source: 'MatchWhy', level: 'warn', extra: { adopterId, error: e instanceof Error ? e.message : String(e) } });
                setCtx('error');
            });
    }, [open, ctx, adopterId]);

    const has = ctx && ctx !== 'loading' && ctx !== 'error' ? ctx.has : null;
    const rows = matchBreakdown({ matchTypes, post: { name: postName, entries: postEntries }, profile: { name: profileName, has } });
    const matchedCount = rows.filter(r => r.status === 'match' || r.status === 'partial').length;
    const differentCount = rows.filter(r => r.status === 'different').length;
    // Only the name lines up and the profile has no phone or email to check it
    // against: the commonest false merge, so say so (kept from the "¿Por qué?" panel).
    const nameOnly = has !== null && !has.phone && !has.email
        && rows.every(r => r.field === 'name' || (r.status !== 'match' && r.status !== 'partial'));

    return (
        <div className="mt-2" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 min-h-[44px] text-left text-sm font-semibold text-teal-700 hover:text-teal-800"
            >
                <span className="inline-flex items-center gap-1">
                    <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    {t('import.compare_toggle')}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                    <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">{t('import.compare_count_same')}: {matchedCount}</span>
                    {differentCount > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{t('import.compare_count_diff')}: {differentCount}</span>}
                </span>
            </button>

            {open && (
                <div data-testid="import-match-compare" className="mt-2 rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
                    {rows.map(row => <Row key={row.field} row={row} t={t} />)}
                    {nameOnly && <p className="px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50">{t('import.why_name_only_nothing_to_compare')}</p>}
                    {ctx === 'loading' && <p className="px-3 py-2 text-xs text-stone-500">{t('import.compare_loading')}</p>}
                    {ctx === 'error' && <p className="px-3 py-2 text-xs text-stone-500">{t('import.why_unavailable')}</p>}
                    <p className="px-3 py-2 text-xs text-stone-500">{t('import.compare_privacy')}</p>
                </div>
            )}
        </div>
    );
}

const ICON: Record<BreakdownStatus, { cls: string; path: string }> = {
    match: { cls: 'bg-teal-100 text-teal-800', path: 'M5 13l4 4L19 7' },
    partial: { cls: 'bg-teal-50 text-teal-700', path: 'M5 12h14' },
    different: { cls: 'bg-amber-100 text-amber-800', path: 'M6 9h12M6 15h12M15 5L9 19' },
    only_post: { cls: 'bg-stone-100 text-stone-600', path: 'M12 5v14M5 12h14' },
    only_profile: { cls: 'bg-stone-100 text-stone-500', path: 'M12 12h.01' },
};

function Row({ row, t }: { row: BreakdownRow; t: (key: string) => string }) {
    const icon = ICON[row.status];
    const b = (v?: string) => <b className="text-stone-900 break-words">{v}</b>;
    let detail: React.ReactNode;
    if (row.field === 'name') {
        detail = row.status === 'match' ? <>{t('import.compare_same')} {b(row.post)}</>
            : row.status === 'partial' ? <>{t('import.compare_post')} {b(row.post)} · {t('import.compare_profile')} {b(row.profile)}</>
                : row.status === 'different' ? <>{t('import.compare_post')} {b(row.post)} · {t('import.compare_profile')} {b(row.profile)}</>
                    : <>{t('import.compare_only_post')} {b(row.post)}</>;
    } else {
        detail = row.status === 'match' ? <>{t('import.compare_same')} {b(row.post)}</>
            : row.status === 'partial' ? <>{t('import.compare_partial')} {b(row.post)}</>
                : row.status === 'different' ? <>{t('import.compare_profile_has_other')} <span className="text-stone-500">({t('import.compare_post_has')} {b(row.post)})</span></>
                    : row.status === 'only_post' ? <>{t('import.compare_only_post')} {b(row.post)} <span className="text-stone-500">{t('import.compare_would_add')}</span></>
                        : <span className="text-stone-500">{t('import.compare_only_profile')}</span>;
    }
    return (
        <div className="flex items-start gap-3 px-3 py-2.5" data-field={row.field} data-status={row.status}>
            <span className={`mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${icon.cls}`} aria-hidden="true">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d={icon.path} /></svg>
            </span>
            <div className="min-w-0 text-sm text-stone-700">
                <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {t(`import.field_${row.field}`)} · <span className={row.status === 'different' ? 'text-amber-800' : row.status === 'match' || row.status === 'partial' ? 'text-teal-800' : ''}>{t(`import.compare_status_${row.status}`)}</span>
                </span>
                <span className="block mt-0.5">{detail}</span>
            </div>
        </div>
    );
}
