'use client';

/**
 * Shared bits of «Pendientes de revisar» (layout D): button styles, the dialog
 * shell, the «Se conserva» badges and how a profile's owner is named.
 *
 * Colours are CSS variables (theme-safe by construction) or classes with a
 * [data-theme] remap in globals.css (bg-white, bg-teal-700, stone-*, teal-*).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import type { PendingDedupPair, PendingDedupSide } from '@/app/actions/duplicates';

export type T = (key: string) => string;
export type KeepSide = PendingDedupPair['defaultKeep'];

export const PRIMARY = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-[14px] font-bold text-white bg-teal-700 hover:bg-teal-600 shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
/** Outlined so it has a shape in both themes (D29): bg-stone-100 vanished in Azul Noche. */
export const SECONDARY = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-[14px] font-bold border border-[var(--text-faint)] text-[var(--text-primary)] bg-transparent hover:bg-[var(--accent-subtle-bg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const ACCENT_SECONDARY = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-[14px] font-bold border border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-subtle-bg)] hover:bg-[var(--accent-badge-bg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const T_PRIMARY = 'text-[var(--text-primary)]';
export const T_MUTED = 'text-[var(--text-muted)]';

export const fill = (template: string, params: Record<string, string>) =>
    Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);

// The row rules (pure, unit-tested) live in the domain layer.
export { otherSide, sideById, movesToOtherList, combineTheirsSide } from '@/domain/pendingRowRules';
export const sideOf = (pair: PendingDedupPair, s: KeepSide): PendingDedupSide => (s === 'new' ? pair.newAdopter : pair.existingAdopter);

/** Who a profile belongs to, by name, for a sentence («la lista de María»). Never an email. */
export function ownerName(side: PendingDedupSide, t: T): string {
    if (side.createdByName) return side.createdByName;
    if (side.createdByAnonymous) return t('myAdopters.pending_d_anonymous') || 'un usuario anónimo';
    return (t('myAdopters.pending_dedup_a_user') || 'Un usuario').toLocaleLowerCase();
}

export function KeptBadge({ t }: { t: T }) {
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-700 text-white">
            <Check className="w-3 h-3" strokeWidth={3} aria-hidden="true" />{t('myAdopters.pending_d_kept') || 'Se conserva'}
        </span>
    );
}

export function AbsorbedBadge({ t }: { t: T }) {
    return (
        <span className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-[var(--border-default)] ${T_MUTED}`}>
            {t('myAdopters.pending_d_absorbed') || 'Se suma al otro'}
        </span>
    );
}

/**
 * The house modal (fixed inset-0, --overlay-bg backdrop, --surface-card panel,
 * max-w-md): Escape and the backdrop close it unless busy; focus lands inside.
 */
export function PendientesDialog({ title, onClose, busy = false, testId, t, children }: {
    title: string;
    t: T;
    onClose: () => void;
    busy?: boolean;
    testId: string;
    children: ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ busy, onClose });
    useEffect(() => { latest.current = { busy, onClose }; });
    useEffect(() => {
        // Once, on open: the text field, else the marked button (Cancel), else
        // the close button — an accidental Enter never confirms anything.
        panelRef.current?.querySelector<HTMLElement>('textarea, [data-autofocus], button')?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !latest.current.busy) latest.current.onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[var(--overlay-bg)]"
            onClick={() => { if (!busy) onClose(); }} role="presentation">
            <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}
                className="w-full max-w-md max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-xl p-6"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 mb-4">
                    <h3 className={`text-[20px] font-bold leading-tight ${T_PRIMARY}`}>{title}</h3>
                    <button type="button" onClick={onClose} disabled={busy} aria-label={t('common.close') || 'Cerrar'}
                        className={`-m-2 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl ${T_MUTED} hover:bg-[var(--accent-subtle-bg)]`}>
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
