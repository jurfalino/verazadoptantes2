'use client';

import { useLanguage } from '@/context/LanguageContext';
import { Modal, ModalActions, ModalText } from '@/components/ui/Modal';

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
 * The shell, header, × and buttons are the shared `Modal` / `ModalActions`
 * (audit B8): on <body> (a portal — an ancestor's stacking context once
 * trapped the «No convive» confirm, tests/one-reality.authed.spec.ts), focus
 * on **Cancel** (an accidental Enter does nothing), Escape and the backdrop
 * close it unless busy, and nothing renders on the server.
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
    if (!open) return null;
    return (
        <Modal title={title} onClose={onCancel} busy={busy} testId={testId} size="sm">
            {message && <ModalText>{message}</ModalText>}
            <ModalActions
                onCancel={onCancel}
                cancelTestId={testId ? `${testId}-cancel` : undefined}
                busy={busy}
                secondary={secondary}
                confirm={{ label: confirmLabel || t('common.delete'), onClick: onConfirm, tone: destructive ? 'destructive' : 'primary', testId: testId ? `${testId}-confirm` : undefined }}
            />
        </Modal>
    );
}
