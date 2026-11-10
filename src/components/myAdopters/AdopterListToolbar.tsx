'use client';

/**
 * Mis adoptantes — the list's controls (Jon 2026-11-10, option E): «Buscar
 * por nombre», «Filtros» (the panel with every filter), «Quitar filtros»
 * while anything is applied, the person's pinned filters as quick buttons,
 * the «Ordenar» menu on a phone (a computer sorts with the column headers),
 * and «Mostrando X de Y adoptantes». Rules: src/domain/adopterListView.ts.
 */

import { FileText, Search, Share2, SlidersHorizontal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { appliedCount, groupOf, SORT_KEYS, type FilterKey, type ListView, type SortKey } from '@/domain/adopterListView';

type T = (key: string) => string;

/** A filter's label, as the panel, the pinned buttons and the pills all write it. */
export function filterLabel(k: FilterKey, t: T): string {
    switch (k) {
        case 'src:form': return t('myAdopters.filter_forms') || 'Por formulario';
        case 'src:post': return t('myAdopters.filter_posts') || 'Desde un post';
        case 'src:imported': return t('myAdopters.filter_imported');
        case 'src:api': return t('myAdopters.filter_api');
        case 'src:contract': return t('myAdopters.filter_contract');
        case 'src:manual': return t('myAdopters.filter_manual');
        case 'rating:none': return t('ratings.none') || 'Sin calificar';
        case 'alert:housemate': return t('myAdopters.filter_housemate');
        default: {
            const n = k.slice('rating:'.length);
            const word = t(`ratings.${['', 'dangerous', 'poor', 'average', 'good', 'excellent'][Number(n)]}`);
            return `${n}★ ${word}`;
        }
    }
}

export function filterIcon(k: FilterKey): ReactNode {
    if (k === 'src:form') return <FileText className="w-4 h-4" strokeWidth={2} aria-hidden="true" />;
    if (k === 'src:post') return <Share2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />;
    return null;
}

/** A sentence with {placeholders} filled by elements («Mostrando {n} de {total} adoptantes» with bold numbers). */
function fillNodes(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
    return template.split(/(\{\w+\})/).map((part, i) => {
        const m = part.match(/^\{(\w+)\}$/);
        return m && m[1] in nodes ? nodes[m[1]] : <span key={i}>{part}</span>;
    });
}

const groupLabel = (k: FilterKey, t: T) => t(`myAdopters.filters_group_${groupOf(k)}`);

/** The old tabs' test ids, kept so links and checks that count «Por formulario» / «Desde un post» still find them. */
const PIN_TEST_ID: Partial<Record<FilterKey, string>> = { 'src:form': 'filter-forms', 'src:post': 'filter-posts' };

export const CHIP = 'inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-bold border transition-colors';
export const CHIP_ON = 'bg-teal-600 text-white border-transparent';
// Not hover:bg-stone-100: hover variants have no [data-theme] remap and flash a white chip in Azul Noche.
export const CHIP_OFF = 'bg-white text-stone-700 border-stone-200 hover:bg-[var(--accent-subtle-bg)]';

export default function AdopterListToolbar({ view, onView, pins, counts, total, shown, onOpenPanel, t }: {
    view: ListView;
    onView: (next: ListView) => void;
    pins: FilterKey[];
    /** How many people each filter holds on its own (the whole list). */
    counts: Record<FilterKey, number>;
    total: number;
    shown: number;
    onOpenPanel: () => void;
    t: T;
}) {
    const toggle = (k: FilterKey) => {
        const selected = new Set(view.selected);
        if (selected.has(k)) selected.delete(k); else selected.add(k);
        onView({ ...view, selected });
    };
    const applied = appliedCount(view);
    const panelCount = view.selected.size;
    // A pinned filter with nobody in it stays out of the way (as the «Desde un post» tab did), unless it's on.
    const pinned = pins.filter(k => counts[k] > 0 || view.selected.has(k));
    const unpinnedOn = [...view.selected].filter(k => !pins.includes(k));

    return (
        <div className="mb-4 space-y-3" data-testid="adopter-list-toolbar">
            <div className="flex flex-wrap items-center gap-2">
                <label className="relative flex-1 min-w-[12rem] md:flex-none md:w-64">
                    <span className="sr-only">{t('myAdopters.search_placeholder')}</span>
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                    <input
                        type="search"
                        value={view.q}
                        onChange={e => onView({ ...view, q: e.target.value.slice(0, 100) })}
                        placeholder={t('myAdopters.search_placeholder')}
                        data-testid="adopter-list-search"
                        className="w-full min-h-[44px] rounded-xl border border-stone-200 bg-white pl-9 pr-3 text-base md:text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-teal-400"
                    />
                </label>
                {/* A phone has no column headers: it sorts here. */}
                <label className="md:hidden flex-1 min-w-[10rem]">
                    <span className="sr-only">{t('myAdopters.sort_label')}</span>
                    <select
                        value={view.sort}
                        onChange={e => onView({ ...view, sort: e.target.value as SortKey })}
                        data-testid="adopter-list-sort"
                        className="w-full min-h-[44px] rounded-xl border border-stone-200 bg-white px-3 text-base text-stone-900"
                    >
                        {SORT_KEYS.map(s => <option key={s} value={s}>{t(`myAdopters.sort_${s}`)}</option>)}
                    </select>
                </label>
                <button type="button" onClick={onOpenPanel} aria-haspopup="dialog" data-testid="adopter-list-filters"
                    className={`${CHIP} ${panelCount ? 'bg-[var(--accent-subtle-bg)] text-teal-800 border-teal-600' : CHIP_OFF}`}>
                    <SlidersHorizontal className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    {t('myAdopters.filters_button')}{panelCount > 0 && <span>· {panelCount}</span>}
                </button>
                {applied > 0 && (
                    <button type="button" onClick={() => onView({ ...view, selected: new Set(), q: '' })} data-testid="adopter-list-clear"
                        className={`${CHIP} ${CHIP_OFF}`}>
                        <X className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                        {t('myAdopters.filters_clear')}
                    </button>
                )}
                {pinned.length > 0 && <span aria-hidden="true" className="hidden md:block w-px h-7 bg-stone-200 mx-1" />}
                {pinned.length > 0 && (
                    <div role="group" aria-label={t('myAdopters.filter_label') || 'Filtrar'} className="flex flex-wrap gap-2 w-full md:w-auto">
                        {pinned.map(k => (
                            <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={view.selected.has(k)}
                                data-testid={PIN_TEST_ID[k] ?? `filter-pin-${k.replace(':', '-')}`}
                                className={`${CHIP} ${view.selected.has(k) ? CHIP_ON : CHIP_OFF}`}>
                                {filterIcon(k)}
                                {filterLabel(k, t)}
                                <span data-testid={PIN_TEST_ID[k] ? `${PIN_TEST_ID[k]}-count` : undefined}
                                    className={`text-xs font-semibold px-1.5 rounded-full ${view.selected.has(k) ? 'bg-white/20' : 'bg-stone-100 text-stone-500'}`}>{counts[k]}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* What's on but not pinned (pinned ones already show lit): each with its own ✕. */}
            {unpinnedOn.length > 0 && (
                <div className="flex flex-wrap items-center gap-2" data-testid="adopter-list-active">
                    {unpinnedOn.map(k => (
                        <span key={k} className="inline-flex items-center gap-1 min-h-[32px] pl-3 pr-1 rounded-full bg-[var(--accent-subtle-bg)] border border-teal-200 text-teal-800 text-xs font-semibold">
                            {groupLabel(k, t)}: {filterLabel(k, t)}
                            <button type="button" onClick={() => toggle(k)} aria-label={`${t('myAdopters.filter_remove')}: ${filterLabel(k, t)}`}
                                className="w-8 h-8 grid place-items-center rounded-full hover:bg-teal-100">
                                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* «Mostrando X de Y» while anything narrows the list; just «Y adoptantes» otherwise. Y = everyone. */}
            <p className="text-sm text-stone-600" aria-live="polite" data-testid="adopter-list-count">
                {fillNodes(t(applied > 0 ? 'myAdopters.showing' : 'myAdopters.total'), {
                    n: <b key="n" className="text-stone-900">{shown}</b>,
                    // The whole list's number: the home card's «N adoptantes» is checked against it.
                    total: <b key="total" data-testid="filter-all-count" className="text-stone-900">{total}</b>,
                })}
            </p>
        </div>
    );
}
