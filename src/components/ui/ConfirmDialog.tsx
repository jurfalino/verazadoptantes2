'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
    /**
     * Optional third choice, for destructive acts that have a safer variant —
     * e.g. "delete the record but keep the animal". Rendered as a neutral
     * button beside Confirm so the destructive path is never the only way
     * forward. Omit it and the dialog is the usual Cancel / Confirm pair.
     */
    secondary?: { label: string; onClick: () => void };
    onConfirm: () => void;
    onCancel: () => void;
    /** `data-testid` of the dialog; its buttons get `${testId}-confirm` / `${testId}-cancel`. */
    testId?: string;
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
 *
 * Rendered on `<body>` (a portal), never in place: an ancestor that makes a
 * stacking context (the profile form's read-only `opacity-90` grid, a
 * transform) traps even a `fixed z-50` panel under later siblings — the «No
 * convive» confirm could not be clicked (tests/one-reality.authed.spec.ts).
 * The portal waits for the client (`mounted`), so server rendering and the
 * first hydration pass render nothing.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    destructive = true,
    busy = false,
    secondary,
    onConfirm,
    onCancel,
    testId,
}: Props) {
    const { t } = useLanguage();
    const cancelRef = useRef<HTMLButtonElement>(null);
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!open || !mounted) return;
        cancelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, mounted, busy, onCancel]);

    if (!open || !mounted) return null;

    return createPortal(
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
                data-testid={testId}
            >
                <div className="space-y-1.5">
                    <h3 className="text-base font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                        {title}
                    </h3>
                    {message && (
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
                    )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end pt-1">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        data-testid={testId ? `${testId}-cancel` : undefined}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
                    >
                        {t('common.cancel')}
                    </button>
                    {secondary && (
                        <button
                            type="button"
                            onClick={secondary.onClick}
                            disabled={busy}
                            className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                        >
                            {secondary.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        data-testid={testId ? `${testId}-confirm` : undefined}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
                            }`}
                    >
                        {confirmLabel || t('common.delete')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
