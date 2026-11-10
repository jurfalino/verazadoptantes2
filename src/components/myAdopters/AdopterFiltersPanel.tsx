'use client';

/**
 * Mis adoptantes «Filtros» (Jon 2026-11-10, option E): every filter in one
 * place — Procedencia, Calificación, Alertas — each with a pin that puts it on
 * the main screen as a quick button (up to PIN_MAX; the rest lock with the
 * reason). Changes apply as they're ticked; «Ver N» just closes.
 */

import { Pin, PinOff } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FILTER_KEYS, groupOf, PIN_MAX, type FilterGroup, type FilterKey, type ListView } from '@/domain/adopterListView';
import { interpolate } from '@/lib/interpolate';
import { filterIcon, filterLabel } from './AdopterListToolbar';

type T = (key: string) => string;

const GROUPS: FilterGroup[] = ['src', 'rating', 'alert'];

export default function AdopterFiltersPanel({ view, onView, pins, onPin, counts, shown, onClose, t }: {
    view: ListView;
    onView: (next: ListView) => void;
    pins: FilterKey[];
    onPin: (k: FilterKey) => void;
    counts: Record<FilterKey, number>;
    shown: number;
    onClose: () => void;
    t: T;
}) {
    const full = pins.length >= PIN_MAX;
    const toggle = (k: FilterKey) => {
        const selected = new Set(view.selected);
        if (selected.has(k)) selected.delete(k); else selected.add(k);
        onView({ ...view, selected });
    };

    return (
        <Modal title={t('myAdopters.filters_title')} onClose={onClose} testId="adopter-filters-panel" size="sm">
            <p className="text-[13px] text-stone-500 -mt-2">
                {interpolate(t('myAdopters.filters_pin_hint'), { max: PIN_MAX, n: pins.length })}
            </p>
            {GROUPS.map(g => (
                <fieldset key={g}>
                    <legend className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1">{t(`myAdopters.filters_group_${g}`)}</legend>
                    {FILTER_KEYS.filter(k => groupOf(k) === g).map(k => {
                        const pinned = pins.includes(k);
                        const locked = !pinned && full;
                        const pinLabel = pinned ? t('myAdopters.pin_remove') : locked ? interpolate(t('myAdopters.pin_full'), { max: PIN_MAX }) : t('myAdopters.pin_add');
                        return (
                            <div key={k} className="flex items-center gap-1">
                                <label className="flex flex-1 min-w-0 items-center gap-3 min-h-[44px] cursor-pointer">
                                    <input type="checkbox" checked={view.selected.has(k)} onChange={() => toggle(k)}
                                        data-testid={`filter-check-${k.replace(':', '-')}`} className="w-[18px] h-[18px] accent-teal-600 shrink-0" />
                                    <span className="flex items-center gap-1.5 min-w-0 text-sm text-stone-900">{filterIcon(k)}<span className="truncate">{filterLabel(k, t)}</span></span>
                                    <span className="ml-auto text-xs text-stone-400 tabular-nums">{counts[k]}</span>
                                </label>
                                {/* Locked stays focusable (aria-disabled, not disabled), so keyboard and screen-reader users hear why. */}
                                <button type="button" onClick={() => !locked && onPin(k)} aria-disabled={locked || undefined}
                                    aria-pressed={pinned} aria-label={`${pinLabel}: ${filterLabel(k, t)}`} title={pinLabel}
                                    data-testid={`filter-pin-toggle-${k.replace(':', '-')}`}
                                    className={`w-11 h-11 shrink-0 grid place-items-center rounded-lg transition-colors ${pinned ? 'text-teal-700' : locked ? 'text-stone-300 cursor-not-allowed' : 'text-stone-400 hover:text-teal-700'}`}>
                                    {pinned ? <Pin className="w-4 h-4 fill-current" aria-hidden="true" /> : locked ? <PinOff className="w-4 h-4" aria-hidden="true" /> : <Pin className="w-4 h-4" aria-hidden="true" />}
                                </button>
                            </div>
                        );
                    })}
                </fieldset>
            ))}
            <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" size="compact" layoutClassName="flex-1"
                    onClick={() => onView({ ...view, selected: new Set(), q: '' })} disabled={view.selected.size === 0 && !view.q.trim()} data-testid="adopter-filters-clear">
                    {t('myAdopters.filters_clear')}
                </Button>
                <Button type="button" variant="primary" size="compact" layoutClassName="flex-1" onClick={onClose} data-testid="adopter-filters-done">
                    {interpolate(t('myAdopters.filters_show'), { n: shown })}
                </Button>
            </div>
        </Modal>
    );
}
