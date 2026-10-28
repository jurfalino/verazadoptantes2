'use client';

/**
 * The one dialog shell (audit B8): every confirm and small form dialog —
 * ConfirmDialog, the household dialogs, the profile's delete / «Pedir
 * eliminación», the ⋯ «Reportar» dialog, Pendientes' dialogs and the admin
 * merge confirms — has the same header, close button and footer.
 *
 * - Header: the title at Heading-MD (16px / 700, `--text-primary`) and a «×»
 *   close button with a 44px hit area. No 18px or 20px titles, no coloured ones.
 * - Footer (`ModalActions`): «Cancelar» is the matrix Secondary button (tinted,
 *   with a border that stays visible in Azul Noche — `--surface-muted` on
 *   `--surface-card` is the same colour there, which is why it vanished);
 *   the decision is Primary or Destructive. Every button is the matrix's
 *   (components/ui/Button.tsx): 12px radius, 700, ≥44px. Full-width halves on a
 *   phone, right-aligned from `sm:`.
 * - Behaviour: rendered on <body> (a portal: no ancestor's stacking context can
 *   trap it — tests/one-reality.authed.spec.ts), `role="dialog"` +
 *   `aria-modal`, Escape and a tap on the backdrop close it unless `busy`.
 *   Focus lands on `[data-autofocus]`, else a text field, else «Cancelar»
 *   (`data-modal-cancel`): an accidental Enter never confirms anything.
 *   The portal waits for the client, so the server renders nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/ui/Button';

const WIDTH = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' } as const;

export function Modal({ title, onClose, busy = false, testId, size = 'md', children }: {
    title: ReactNode;
    onClose: () => void;
    busy?: boolean;
    testId?: string;
    size?: keyof typeof WIDTH;
    children: ReactNode;
}) {
    const { t } = useLanguage();
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const panelRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ busy, onClose });
    useEffect(() => { latest.current = { busy, onClose }; });

    useEffect(() => {
        if (!mounted) return;
        const panel = panelRef.current;
        const first = (sel: string) => panel?.querySelector<HTMLElement>(sel);
        (first('[data-autofocus]') ?? first('textarea, input[type="text"], input[type="email"], input[type="search"], input:not([type])') ?? first('[data-modal-cancel]') ?? first('button'))?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !latest.current.busy) latest.current.onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [mounted]);

    if (!mounted) return null;
    const label = typeof title === 'string' ? title : undefined;
    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }} role="presentation"
            onClick={e => { if (e.target === e.currentTarget && !latest.current.busy) onClose(); }}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} data-testid={testId}
                className={`w-full ${WIDTH[size]} max-h-[90svh] overflow-y-auto rounded-2xl border p-6 shadow-xl space-y-4`}
                style={{ background: 'var(--surface-card)', borderColor: 'var(--border-default)' }}>
                <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 text-base font-bold leading-snug [overflow-wrap:anywhere]" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                    <button type="button" onClick={onClose} disabled={busy} aria-label={t('common.close') || 'Cerrar'} data-testid={testId ? `${testId}-close` : undefined}
                        className="-mr-3 -mt-3 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 transition-colors disabled:opacity-40">
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    );
}

/** The dialog's body text, under the title. */
export function ModalText({ children, testId }: { children: ReactNode; testId?: string }) {
    // `overflow-wrap:anywhere`: a long email in the text (the admin approve confirm names each side's owner) wraps inside the panel.
    return <p className="text-sm [overflow-wrap:anywhere]" style={{ color: 'var(--text-secondary)' }} data-testid={testId}>{children}</p>;
}

/**
 * «Cancelar» + the decision (+ an optional safer third choice), as the matrix's
 * buttons. `confirm.tone`: 'destructive' (default — what a confirm exists for)
 * or 'primary'.
 */
export function ModalActions({ onCancel, cancelLabel, cancelTestId, busy = false, confirm, secondary }: {
    onCancel: () => void;
    cancelLabel?: string;
    cancelTestId?: string;
    busy?: boolean;
    confirm: { label: string; onClick: () => void; tone?: 'destructive' | 'primary'; disabled?: boolean; testId?: string };
    secondary?: { label: string; onClick: () => void; testId?: string };
}) {
    const { t } = useLanguage();
    const layout = 'flex-1 sm:flex-none';
    return (
        <div className="flex flex-wrap gap-2 pt-1 sm:justify-end">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} data-modal-cancel="" data-testid={cancelTestId} layoutClassName={layout}>
                {cancelLabel || t('common.cancel')}
            </Button>
            {secondary && (
                <Button type="button" variant="secondary" onClick={secondary.onClick} disabled={busy} data-testid={secondary.testId} layoutClassName={layout}>
                    {secondary.label}
                </Button>
            )}
            <Button type="button" variant={confirm.tone === 'primary' ? 'primary' : 'destructive'} onClick={confirm.onClick} disabled={busy || confirm.disabled}
                loading={busy} data-testid={confirm.testId} layoutClassName={layout}>
                {confirm.label}
            </Button>
        </div>
    );
}
