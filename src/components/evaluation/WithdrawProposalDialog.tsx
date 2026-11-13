'use client';

/**
 * «Quitar de {animal}» (Jon 2026-11-13: «Sumar a un animal» is reversible). Asks first, gender-neutral: the
 * person leaves the animal's candidates and the general form goes back to «por evaluar»; nobody is told and
 * nothing is written on the profile. Refused (`already_acted`) once something happened on the animal's side.
 */
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal, ModalText, ModalActions } from '@/components/ui/Modal';
import { withdrawProposal } from '@/app/actions/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

export function WithdrawProposalDialog({ generalApplicationId, personName, animalName, onClose, onDone }: {
    generalApplicationId: string;
    /** First name, as the rest of the evaluation copy uses it. */
    personName: string;
    animalName: string;
    onClose: () => void;
    /** Removed (or refused because the animal's side moved): the panel re-reads. */
    onDone: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [busy, setBusy] = useState(false);
    const fill = (key: string) => t(key).split('{name}').join(personName).split('{animal}').join(animalName);

    const quit = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await withdrawProposal(generalApplicationId);
            if (res.ok) { onDone(); return; }
            if (res.error === 'already_acted') { toast.info(fill('evaluation.undo_refused')); onDone(); return; }
            toast.error(t('errors.generic'), t('evaluation.action_failed'), res.errorId || resolveErrorId(new Error(`withdrawProposal: ${res.error}`), 'WithdrawProposalDialog'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.action_failed'), resolveErrorId(e, 'WithdrawProposalDialog'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal title={fill('evaluation.undo_confirm_title')} onClose={onClose} busy={busy} testId="withdraw-proposal">
            <ModalText>{fill('evaluation.undo_confirm_body')}</ModalText>
            <ModalActions
                onCancel={onClose}
                busy={busy}
                confirm={{ label: fill('evaluation.undo_confirm_button'), onClick: () => { void quit(); }, tone: 'primary', testId: 'withdraw-proposal-confirm' }}
            />
        </Modal>
    );
}
