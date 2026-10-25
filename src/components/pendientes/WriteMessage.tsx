'use client';

/**
 * «Escribirle a María» (D28): a short note to the other side of a merge
 * request. She and her team get it in the bell and by email (it goes to the
 * whole owner team), and replying to the email reaches the sender — so the
 * box says she AND her team will see the sender's email. The sender never
 * sees theirs.
 */

import { useState } from 'react';
import { Info, Mail } from 'lucide-react';
import { PendientesDialog, PRIMARY, SECONDARY, T_MUTED, T_PRIMARY, fill, type T } from './ui';

/** sendPairMessage's limit. */
const MAX_LENGTH = 1000;

export default function WriteMessage({ toName, aboutName, busy, onSend, onCancel, t }: {
    toName: string;
    /** The adopter the pair is about. */
    aboutName: string;
    busy: boolean;
    onSend: (text: string) => void;
    onCancel: () => void;
    t: T;
}) {
    const [text, setText] = useState('');
    const ready = text.trim().length > 0 && !busy;
    return (
        <PendientesDialog title={fill(t('myAdopters.pending_d_write_title') || 'Escribirle a {name}', { name: toName })} onClose={onCancel} busy={busy} testId="dedup-write-dialog" t={t}>
            <p className={`text-[14px] ${T_MUTED}`}>
                {fill(t('myAdopters.pending_d_write_about') || 'Sobre {name}', { name: aboutName })}
            </p>
            <label htmlFor="dedup-write-text" className={`block mt-4 mb-2 text-[12px] font-semibold uppercase tracking-wider ${T_MUTED}`}>
                {t('myAdopters.pending_d_write_label') || 'Mensaje'}
            </label>
            {/* 16px: iOS Safari zooms into anything smaller on focus. */}
            <textarea id="dedup-write-text" data-testid="dedup-write-text" rows={4} maxLength={MAX_LENGTH} value={text}
                onChange={e => setText(e.target.value)}
                className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-base)] p-3 text-[16px] ${T_PRIMARY} focus:outline-none focus:border-[var(--accent)]`} />
            <div className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2 bg-[var(--status-info-bg)] border border-[var(--status-info-border)] text-[var(--status-info-text)]">
                <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-[13px] font-semibold">
                    {fill(t('myAdopters.pending_d_write_warning') || '{name} y su equipo verán tu email para responderte.', { name: toName })}
                </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
                <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy}>{t('common.cancel') || 'Cancelar'}</button>
                <button type="button" data-testid="dedup-write-send" className={PRIMARY} onClick={() => onSend(text.trim())} disabled={!ready}>
                    <Mail className="w-4 h-4" aria-hidden="true" />
                    {busy ? (t('common.processing') || 'Procesando...') : (t('myAdopters.pending_d_write_send') || 'Enviar')}
                </button>
            </div>
        </PendientesDialog>
    );
}
