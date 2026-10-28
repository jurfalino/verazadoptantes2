'use client';

/**
 * Shared bits of «Pendientes de revisar» (layout D): button styles, the dialog
 * shell, the «Se conserva» badges and how a profile's owner is named.
 *
 * Colours are CSS variables (theme-safe by construction) or classes with a
 * [data-theme] remap in globals.css (bg-white, bg-teal-700, stone-*, teal-*).
 */

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
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

/** Pendientes' dialogs — the shared `Modal` (focus lands on [data-autofocus] / the text field / «Cancelar»). */
export function PendientesDialog({ title, onClose, busy = false, testId, children }: {
    title: string;
    t: T;
    onClose: () => void;
    busy?: boolean;
    testId: string;
    children: ReactNode;
}) {
    // The shared dialog shell (audit B8): 16px title, ×, focus, Escape, backdrop, portal.
    return (
        <Modal title={title} onClose={onClose} busy={busy} testId={testId}>
            <div>{children}</div>
        </Modal>
    );
}
