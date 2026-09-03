'use client';

import { useEffect, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    open: boolean;
    title: string;
    /** Optional second line — e.g. what else gets removed along with this. */
    message?: string;
    /** Defaults to common.delete. */
    confirmLabel?: string;
    /** Red confirm button. Default true, since this exists for destructive acts. */
    destructive?: boolean;
    /** Disables both buttons while the action is in flight. */
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmation dialog for destructive actions.
 *
 * Exists because `confirm()` cannot be labelled or themed: it renders OK/Cancel
 * in browser chrome, ignores the `[data-theme]` palette entirely, and prefixes
 * the message with "buenadoptante.org dice:". A labelled destructive button
 * ("Eliminar") is also better error prevention than a generic OK, because
 * people read the button rather than the prose above it.
 *
 * Shell markup follows the house modal pattern (see `VisibilityBadgeModal`):
 * `fixed inset-0 z-50`, `--overlay-bg` backdrop, `--surface-card` panel,
 * backdrop click closes, `role="dialog"` + `aria-modal`.
 *
 * Focus lands on **Cancel**, not Confirm: an accidental Enter or Space on a
 * destructive dialog should do nothing.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    destructive = true,
    busy = false,
    onConfirm,
    onCancel,
}: Props) {
    const { t } = useLanguage();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        cancelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, busy, onCancel]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'var(--overlay-bg)' }}
            onClick={() => { if (!busy) onCancel(); }}
            role="presentation"
        >
            <div
                className="rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4"
                style={{ background: 'var(--surface-card)' }}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="space-y-1.5">
                    <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                        {title}
                    </h3>
                    {message && (
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
                    )}
                </div>
                <div className="flex gap-2 justify-end pt-1">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
                            }`}
                    >
                        {confirmLabel || t('common.delete')}
                    </button>
                </div>
            </div>
        </div>
    );
}
