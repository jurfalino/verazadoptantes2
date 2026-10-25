'use client';

import { useEffect, useState } from 'react';
import { getMatchContext, type MatchContext } from '@/app/actions';
import { reportClientError } from '@/lib/clientErrorReporter';
import { matchBreakdown, type BreakdownRow, type BreakdownStatus } from '@/domain/matchBreakdown';

/** Where the rescuer's side of the comparison came from — names the left column. */
export type MatchSourceKind = 'post' | 'form' | 'contract' | 'typed' | 'sheet' | 'profile' | 'new';

/**
 * «Qué coincide y qué no»: what a possible duplicate shares with the data the
 * rescuer is deciding about — and what it doesn't — field by field. The same
 * card on every screen that asks "same person?" (Jon, 2026-10-25): the post
 * import, form and contract results, Pendientes de revisar, the create form,
 * «Reportar duplicado» and the spreadsheet import.
 *
 * Privacy: the other profile's contact VALUES are never shown — it may be
 * another team's protected profile. A row shows the rescuer's own value and,
 * for the other profile, only whether it has that kind of contact. Its name is shown: names are not PII-gated. Screens that are
 * already allowed to show more keep doing so next to this card.
 */
export default function MatchCompare({ adopterId, matchTypes, profileName, source, target = 'profile', t, defaultOpen = false, bare = false }: {
    /** The possibly-duplicate profile. */
    adopterId: string;
    matchTypes: string[];
    profileName: string;
    source: { kind: MatchSourceKind; name: string | null | undefined; entries: Array<{ type: string; value: string }> };
    /** How to call the possible duplicate: «el perfil» (default), «el otro
     *  perfil» next to the profile you are on, «el existente» next to a new one. */
    target?: 'profile' | 'other' | 'existing';
    t: (key: string) => string;
    defaultOpen?: boolean;
    /** Already inside an expandable row of its own: rows always shown, no toggle. */
    bare?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen || bare);
    const [ctx, setCtx] = useState<MatchContext | 'loading' | 'error' | null>(null);

    // Loaded up front, not on open: the summary on the closed toggle counts the
    // differences, and those need to know what the profile has.
    useEffect(() => {
        if (ctx !== null) return;
        setCtx('loading');
        getMatchContext(adopterId)
            .then(c => setCtx(c.ok ? c : 'error'))
            .catch(e => {
                // Degraded, not broken: the rows still show what matched — and it
                // is logged, like every problem the rescuer sees.
                void reportClientError({ message: 'match compare: profile details could not load', source: 'MatchCompare', level: 'warn', extra: { adopterId, sourceKind: source.kind, error: e instanceof Error ? e.message : String(e) } });
                setCtx('error');
            });
    }, [ctx, adopterId, source.kind]);

    const has = ctx && ctx !== 'loading' && ctx !== 'error' ? ctx.has : null;
    const rows = matchBreakdown({ matchTypes, source: { name: source.name ?? undefined, entries: source.entries }, profile: { name: profileName, has } });
    const matchedCount = rows.filter(r => r.status === 'match' || r.status === 'partial').length;
    const differentCount = rows.filter(r => r.status === 'different').length;
    // Only the name lines up and the profile has no phone or email to check it
    // against: the commonest false merge, so say so.
    const nameOnly = has !== null && !has.phone && !has.email
        && rows.every(r => r.field === 'name' || (r.status !== 'match' && r.status !== 'partial'));

    return (
        <div className="mt-2" data-testid="match-compare" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            {!bare && <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 min-h-[44px] text-left text-sm font-semibold text-teal-700 hover:text-teal-800"
            >
                <span className="inline-flex items-center gap-1">
                    <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    {t('matchCompare.toggle')}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                    <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">{t('matchCompare.count_same')}: {matchedCount}</span>
                    {has !== null && differentCount > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{t('matchCompare.count_diff')}: {differentCount}</span>}
                </span>
            </button>}

            {open && (
                <div data-testid="match-compare-rows" className="mt-1 rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
                    {rows.map(row => <Row key={row.field} row={row} kind={source.kind} target={target} t={t} />)}
                    {nameOnly && <p className="px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50">{t('matchCompare.name_only_warning')}</p>}
                    {ctx === 'loading' && <p className="px-3 py-2 text-xs text-stone-500">{t('matchCompare.loading')}</p>}
                    {ctx === 'error' && <p className="px-3 py-2 text-xs text-stone-500">{t('matchCompare.unavailable')}</p>}
                    <p className="px-3 py-2 text-xs text-stone-500">{t('matchCompare.privacy')}</p>
                </div>
            )}
        </div>
    );
}

const ICON: Record<BreakdownStatus, { cls: string; path: string }> = {
    match: { cls: 'bg-teal-100 text-teal-800', path: 'M5 13l4 4L19 7' },
    partial: { cls: 'bg-teal-50 text-teal-700', path: 'M5 12h14' },
    different: { cls: 'bg-amber-100 text-amber-800', path: 'M6 9h12M6 15h12M15 5L9 19' },
    only_source: { cls: 'bg-stone-100 text-stone-600', path: 'M12 5v14M5 12h14' },
    only_profile: { cls: 'bg-stone-100 text-stone-500', path: 'M12 12h.01' },
};

function Row({ row, kind, target, t }: { row: BreakdownRow; kind: MatchSourceKind; target: 'profile' | 'other' | 'existing'; t: (key: string) => string }) {
    const icon = ICON[row.status];
    const b = (v?: string) => <b className="text-stone-900 break-words">{v}</b>;
    const src = t(`matchCompare.src_${kind}`);
    const only = t(kind === 'profile' ? 'matchCompare.only_profile_src' : `matchCompare.only_${kind}`);
    const theirs = t(`matchCompare.target_${target}`);
    const statusLabel = row.status === 'only_source' ? only.toLocaleLowerCase()
        : row.status === 'only_profile' ? t(`matchCompare.only_profile_${target}`)
            : t(`matchCompare.status_${row.status}`);
    let detail: React.ReactNode;
    // The engine can match a value the source holds outside its contact list
    // (a handle in a form comment): the status says it, there is no value to repeat.
    if ((row.status === 'match' || row.status === 'partial') && !row.source) detail = null;
    else if (row.status === 'match') detail = <>{t('matchCompare.same')} {b(row.source)}</>;
    else if (row.field === 'name' && (row.status === 'partial' || row.status === 'different')) {
        detail = <>{src}: {b(row.source)} · {theirs} {b(row.profile)}</>;
    } else if (row.status === 'partial') detail = <>{t('matchCompare.partial')} {b(row.source)}</>;
    else if (row.status === 'different') detail = <>{t(`matchCompare.has_other_${target}`)} <span className="text-stone-500">({src.toLocaleLowerCase()}: {b(row.source)})</span></>;
    else if (row.status === 'only_source') detail = <>{b(row.source)} {row.field !== 'name' && <span className="text-stone-500">{t('matchCompare.would_add')}</span>}</>;
    else detail = <span className="text-stone-500">{t(`matchCompare.only_profile_detail_${target}`)}</span>;
    return (
        <div className="flex items-start gap-3 px-3 py-2.5" data-field={row.field} data-status={row.status}>
            <span className={`mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${icon.cls}`} aria-hidden="true">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d={icon.path} /></svg>
            </span>
            <div className="min-w-0 text-sm text-stone-700">
                <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {t(`matchCompare.field_${row.field}`)} · <span className={row.status === 'different' ? 'text-amber-800' : row.status === 'match' || row.status === 'partial' ? 'text-teal-800' : ''}>{statusLabel}</span>
                </span>
                {detail && <span className="block mt-0.5">{detail}</span>}
            </div>
        </div>
    );
}
