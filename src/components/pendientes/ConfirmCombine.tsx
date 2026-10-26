'use client';

/**
 * «¿Combinar perfiles?» (D25, D40): shown whenever the viewer's adopter will
 * move to another rescuer's list — keeping the other rescuer's profile, or
 * accepting their request — and for the asked owner's flip, which keeps theirs.
 * It names who the adopter goes to, which profile stays, and that the viewer
 * keeps seeing its details.
 */

import { ArrowUp } from 'lucide-react';
import type { PendingDedupSide } from '@/app/actions/duplicates';
import { KeptBadge, PendientesDialog, PRIMARY, SECONDARY, T_MUTED, T_PRIMARY, fill, ownerName, type T } from './ui';

export type ConfirmMode =
    /** The viewer's adopter goes to `kept`'s owner. */
    | 'moves'
    /** «Conservar el mío»: the requester's profile joins the viewer's. */
    | 'flip';

function ProfileLine({ side, t, formatShortDate }: { side: PendingDedupSide; t: T; formatShortDate: (v: number) => string }) {
    const owner = side.isMine ? (t('myAdopters.pending_d_mine_tag') || 'Tuyo') : fill(t('myAdopters.pending_dedup_created_by') || 'Cargado por {name}', { name: ownerName(side, t) });
    return (
        <div className="min-w-0">
            <p className={`text-[15px] font-bold break-words ${T_PRIMARY}`}>{side.name}</p>
            <p className={`mt-1 text-[12px] ${T_MUTED}`}>
                {owner}{side.createdAt ? ` · ${formatShortDate(side.createdAt)}` : ''}
            </p>
        </div>
    );
}

export default function ConfirmCombine({ mode, entriesOnly = false, kept, absorbed, toName, busy, onConfirm, onCancel, t, formatShortDate }: {
    mode: ConfirmMode;
    /** An immediate keep-theirs by a non-admin: they keep only the details they entered. */
    entriesOnly?: boolean;
    kept: PendingDedupSide;
    absorbed: PendingDedupSide;
    /** 'moves': whose list the adopter goes to. 'flip': the requester. */
    toName: string;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    t: T;
    formatShortDate: (v: number) => string;
}) {
    const title = mode === 'flip'
        ? (t('myAdopters.pending_d_confirm_flip_title') || '¿Conservar el tuyo?')
        : (t('myAdopters.pending_d_confirm_title') || '¿Combinar perfiles?');
    return (
        <PendientesDialog title={title} onClose={onCancel} busy={busy} testId="dedup-confirm-dialog" t={t}>
            <p className={`text-[15px] font-semibold ${T_PRIMARY}`}>
                {mode === 'flip'
                    ? fill(t('myAdopters.pending_d_confirm_flip') || 'El perfil de {name} se suma al tuyo.', { name: toName })
                    : fill(t('myAdopters.pending_d_confirm_moves') || 'Este adoptante pasará a la lista de {name}.', { name: toName })}
            </p>
            <div className="mt-4 space-y-2">
                <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-subtle-bg)] p-3">
                    <div className="mb-2"><KeptBadge t={t} /></div>
                    <ProfileLine side={kept} t={t} formatShortDate={formatShortDate} />
                </div>
                <div className={`flex items-center gap-2 pl-3 text-[12px] font-semibold ${T_MUTED}`}>
                    <ArrowUp className="w-4 h-4" aria-hidden="true" />{t('myAdopters.pending_d_confirm_joins') || 'se le suma'}
                </div>
                <div className="rounded-xl border border-[var(--border-default)] p-3">
                    <ProfileLine side={absorbed} t={t} formatShortDate={formatShortDate} />
                </div>
            </div>
            <p className={`mt-4 text-[14px] ${T_MUTED}`}>
                {mode === 'flip'
                    ? fill(t('myAdopters.pending_d_confirm_flip_access') || 'Se conserva el tuyo. {name} va a seguir viendo sus datos.', { name: toName })
                    : fill(entriesOnly
                        ? (t('myAdopters.pending_d_confirm_kept_entries') || 'Se conserva {profile}. Vas a seguir viendo los datos que cargaste.')
                        : (t('myAdopters.pending_d_confirm_kept') || 'Se conserva {profile}. Vas a seguir viendo sus datos.'), {
                        profile: fill(t('myAdopters.pending_d_confirm_profile_of') || 'el perfil de {name}', { name: ownerName(kept, t) }),
                    })}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2">
                <button type="button" data-autofocus className={SECONDARY} onClick={onCancel} disabled={busy}>
                    {t('common.cancel') || 'Cancelar'}
                </button>
                <button type="button" data-testid="dedup-confirm" className={PRIMARY} onClick={onConfirm} disabled={busy}>
                    {busy ? (t('common.processing') || 'Procesando...') : (t('myAdopters.pending_d_confirm_action') || 'Combinar')}
                </button>
            </div>
        </PendientesDialog>
    );
}
