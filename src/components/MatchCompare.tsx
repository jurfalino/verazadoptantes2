'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getMatchContext, type MatchContext } from '@/app/actions';
import { reportClientError } from '@/lib/clientErrorReporter';
import { matchBreakdown, otherSignals, type BreakdownField, type BreakdownRow } from '@/domain/matchBreakdown';
import { matchTypeLabel } from '@/lib/matchTypeLabels';
import { parseBlobToContactEntries, deserializeContactEntries } from '@/lib/contactEntries';

/**
 * A profile's contact as typed entries, exactly as the screen already shows it
 * to this viewer: the (masked) typed list when present, else the visible text.
 * Never re-parse masked text when the typed list exists — «z•••@x.com» reads as
 * a social handle.
 */
export function entriesAsShown(p: { contactEntries?: string | null; contactInfo?: string | null }): Array<{ type: string; value: string }> {
    return (p.contactEntries ? deserializeContactEntries(p.contactEntries) : parseBlobToContactEntries(p.contactInfo ?? null))
        .map(e => ({ type: e.type, value: e.value }));
}

/** Where the rescuer's side of the comparison came from — names the left block. */
export type MatchSourceKind = 'post' | 'form' | 'contract' | 'typed' | 'sheet' | 'profile' | 'new';
type Target = 'profile' | 'other' | 'existing';
type Mark = 'match' | 'partial' | 'different' | null;

/**
 * «Qué coincide y qué no» on every screen that asks "same person?" (Jon,
 * 2026-10-25): the post import, form and contract results, Pendientes de
 * revisar, the create form, «Reportar duplicado» and the spreadsheet import.
 *
 * Two blocks, never mixed: the rescuer's data (post, form, …) and the existing
 * profile, each listing only its own values. Each value carries a label saying whether it
 * matches — ✓ coincide, ≈ parecido, ≠ distinto (the value itself is not
 * highlighted, Jon 2026-10-25) — and the header names the fields. A value with no counterpart
 * stays plain.
 *
 * Privacy: the existing profile's values appear only where the screen passes
 * `profileEntries` — what it already shows this viewer, masked ones with a
 * lock. Elsewhere that block shows the rescuer's own value for an exact match
 * (the same value, so nothing new) and otherwise only that the profile has one.
 * Its name is shown: names are not PII-gated.
 */
export default function MatchCompare({ adopterId, matchTypes, profileName, source, target = 'profile', t, defaultOpen = false, bare = false, profileEntries, sourceHead, targetHead }: {
    /** The possibly-duplicate profile. */
    adopterId: string;
    matchTypes: string[];
    profileName: string;
    source: { kind: MatchSourceKind; name: string | null | undefined; entries: Array<{ type: string; value: string }> };
    /** What to call the possible duplicate: «Perfil existente» (default), «Otro perfil», «Existente». */
    target?: Target;
    t: (key: string) => string;
    defaultOpen?: boolean;
    /** A page made for the comparison, or a row that already expands: blocks always shown. */
    bare?: boolean;
    /** The other profile's contact as THIS SCREEN ALREADY SHOWS IT to the viewer
     *  (masked values keep their «•»). */
    profileEntries?: Array<{ type: string; value: string }>;
    /** Replace a block's title — e.g. Pendientes puts each profile's name link, source and date there. */
    sourceHead?: ReactNode;
    targetHead?: ReactNode;
}) {
    // One candidate (defaultOpen) or a page made for the comparison (bare): the
    // blocks show directly — no toggle, no summary line repeating their labels.
    // Only a list of several candidates collapses each to a one-line summary (Jon, 2026-10-25).
    const always = bare || defaultOpen;
    const [open, setOpen] = useState(always);
    const [ctx, setCtx] = useState<MatchContext | 'loading' | 'error' | null>(null);

    // Loaded up front, not on open: the closed header names the differences,
    // and those need to know what the profile has.
    useEffect(() => {
        if (ctx !== null) return;
        setCtx('loading');
        getMatchContext(adopterId)
            .then(c => setCtx(c.ok ? c : 'error'))
            .catch(e => {
                // Degraded, not broken: the blocks still show what matched — and it
                // is logged, like every problem the rescuer sees.
                void reportClientError({ message: 'match compare: profile details could not load', source: 'MatchCompare', level: 'warn', extra: { adopterId, sourceKind: source.kind, error: e instanceof Error ? e.message : String(e) } });
                setCtx('error');
            });
    }, [ctx, adopterId, source.kind]);

    const has = ctx && ctx !== 'loading' && ctx !== 'error' ? ctx.has : null;
    const all = matchBreakdown({ matchTypes, source: { name: source.name ?? undefined, entries: source.entries }, profile: { name: profileName, has, entries: profileEntries } });
    // Until we know what the profile has, a contact that didn't match could be
    // "distinto" or only on one side: show only what we know.
    const rows = (has === null && !profileEntries ? all.filter(r => r.field === 'name' || r.status === 'match' || r.status === 'partial') : all)
        .slice().sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field));
    // A flag, a shared source URL, a general text hit: why the pair exists even
    // when no field lines up.
    const others = otherSignals(matchTypes).map(ty => matchTypeLabel(ty, t)).filter(Boolean);
    const fieldName = (f: BreakdownField) => t(`matchCompare.field_${f}`).toLocaleLowerCase();
    const same = rows.filter(r => r.status === 'match' || r.status === 'partial').map(r => fieldName(r.field));
    const diff = rows.filter(r => r.status === 'different').map(r => fieldName(r.field));
    // Only the name lines up and the profile has no phone or email to check it
    // against: the commonest false merge, so say so.
    const nameOnly = has !== null && !has.phone && !has.email
        && rows.every(r => r.field === 'name' || (r.status !== 'match' && r.status !== 'partial'));
    const anyLocked = rows.some(r => targetCell(r, !!profileEntries).locked || !!r.source?.includes('•'));

    const summary = (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs font-semibold">
            {(same.length > 0 || others.length > 0) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                    <MarkIcon mark="match" />{t('matchCompare.count_same')}: {[...same, ...others.map(o => o.toLocaleLowerCase())].join(', ')}
                </span>
            )}
            {diff.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    <MarkIcon mark="different" />{t('matchCompare.count_diff')}: {diff.join(', ')}
                </span>
            )}
        </span>
    );

    return (
        <div className="mt-2" data-testid="match-compare">
            {always ? null : (
                <button
                    type="button"
                    aria-expanded={open}
                    // Inside a selectable card: opening the comparison must not pick the profile.
                    onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
                    onKeyDown={e => e.stopPropagation()}
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 min-h-[44px] text-left text-sm font-semibold text-teal-700 hover:text-teal-800"
                >
                    <span className="inline-flex items-center gap-1">
                        <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        {t('matchCompare.toggle')}
                    </span>
                    {summary}
                </button>
            )}

            {open && (
                <div data-testid="match-compare-rows" className="mt-1 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Block head={sourceHead ?? t(`matchCompare.col_${source.kind}`)} side="source">
                            {rows.map(r => <Cell key={r.field} label={t(`matchCompare.field_${r.field}`)} {...sourceCell(r)} t={t} />)}
                        </Block>
                        <Block head={targetHead ?? t(`matchCompare.col_target_${target}`)} side="target">
                            {rows.map(r => <Cell key={r.field} label={t(`matchCompare.field_${r.field}`)} {...targetCell(r, !!profileEntries)} t={t} />)}
                        </Block>
                    </div>
                    {nameOnly && <p className="rounded-lg px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50">{t('matchCompare.name_only_warning')}</p>}
                    {ctx === 'loading' && <p className="text-xs text-stone-500">{t('matchCompare.loading')}</p>}
                    {ctx === 'error' && <p className="text-xs text-stone-500">{t('matchCompare.unavailable')}</p>}
                    {/* With no summary line, a signal that isn't a field still needs saying. */}
                    {always && others.length > 0 && (
                        <p className="text-sm text-stone-700">
                            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('matchCompare.also')}</span>{' '}
                            {others.join(' · ')}
                        </p>
                    )}
                    {anyLocked && (
                        <p className="text-xs text-stone-500 flex items-center gap-1.5"><LockIcon />{t('matchCompare.privacy_locked')}</p>
                    )}
                </div>
            )}
        </div>
    );
}

const FIELDS: BreakdownField[] = ['name', 'phone', 'email', 'social', 'id', 'address'];

interface CellData { value?: string; mark: Mark; locked?: boolean; empty?: boolean }

/** The rescuer's side: their own value, marked by how it compares. */
function sourceCell(r: BreakdownRow): CellData {
    if (r.status === 'only_profile') return { mark: null, empty: true };
    const mark: Mark = r.status === 'only_source' ? null : r.status;
    return { value: r.source, mark };
}

/** The existing profile's side, never showing more than this screen may. */
function targetCell(r: BreakdownRow, valuesShown: boolean): CellData {
    if (r.status === 'only_source') return { mark: null, empty: true };
    const mark: Mark = r.status === 'only_profile' ? null : r.status;
    if (r.field === 'name') return { value: r.profile, mark };
    if (valuesShown && r.profile) return { value: r.profile, mark, locked: r.profile.includes('•') };
    // Not shown here: an exact match IS the rescuer's own value; anything else
    // only that the profile has one.
    if (r.status === 'match' && r.source) return { value: r.source, mark };
    return { mark, locked: true };
}

function Block({ head, side, children }: { head: ReactNode; side: 'source' | 'target'; children: ReactNode }) {
    return (
        // Themed colours only (globals.css remaps them for dark mode; opacity variants aren't).
        <div className={`min-w-0 rounded-xl border border-stone-200 p-3 ${side === 'source' ? 'bg-stone-50' : 'bg-white'}`}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-500">{head}</div>
            <dl className="space-y-1.5">{children}</dl>
        </div>
    );
}

function Cell({ label, value, mark, locked, empty, t }: CellData & { label: string; t: (key: string) => string }) {
    const shown = empty ? <span className="text-stone-400">—</span>
        : locked ? <span className="inline-flex items-center gap-1 text-stone-500"><LockIcon />{value ?? t('matchCompare.has_one')}</span>
            : value ? <span className="break-words">{value}</span>
                    // Matched on a value outside this side's contact list (a handle in a form comment).
                    : <span className="font-normal italic">{t('matchCompare.elsewhere')}</span>;
    return (
        <div className="min-w-0" data-mark={mark ?? 'none'}>
            <dt className="text-xs text-stone-500">{label}</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-stone-900">
                {shown}
                {mark && !empty && (
                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${mark === 'different' ? 'text-amber-800' : 'text-teal-800'}`}>
                        <MarkIcon mark={mark} />{t(`matchCompare.status_${mark}`)}
                    </span>
                )}
            </dd>
        </div>
    );
}

function MarkIcon({ mark }: { mark: Exclude<Mark, null> }) {
    const d = mark === 'match' ? 'M5 13l4 4L19 7' : mark === 'partial' ? 'M5 9.5c2-2 4-2 7 0s5 2 7 0M5 15c2-2 4-2 7 0s5 2 7 0' : 'M6 9h12M6 15h12M15 5L9 19';
    return <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function LockIcon() {
    return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
    );
}
