'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { requestPiiAccess } from '@/app/actions/piiAccess';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { Modal, ModalActions, ModalText } from '@/components/ui/Modal';

interface RequestPiiAccessModalProps {
    adopterId: string;
    adopterName: string;
    open: boolean;
    onClose: () => void;
    /** Called after a request is successfully filed (or the viewer already has access). */
    onRequested: () => void;
}

/**
 * Standalone "request contact access" modal — the explicit request path for a
 * viewer whose contact view is masked. Optional free-text justification.
 */
export default function RequestPiiAccessModal({
    adopterId, adopterName, open, onClose, onRequested,
}: RequestPiiAccessModalProps) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [justification, setJustification] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!open) return null;

    async function submit() {
        setSubmitting(true);
        try {
            const res = await requestPiiAccess(adopterId, { justification: justification.trim() || null });
            if (res.ok && (res.status === 'created' || res.status === 'duplicate')) {
                toast.success('✓', t('adopter.pii_request_sent'));
                onRequested();
                onClose();
            } else if (res.status === 'has_access') {
                onRequested();
                onClose();
            } else if (res.status === 'cooldown') {
                toast.error(t('errors.generic'), t('adopter.pii_request_cooldown_short'));
            } else {
                toast.error(t('errors.generic'), res.error || t('adopter.pii_request_error'));
            }
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.pii_request_error'), resolveErrorId(e, 'RequestPiiAccessModal'));
        } finally {
            setSubmitting(false);
        }
    }

    // The shared dialog shell (ui/Modal): on <body>, above any other dialog it opens from (the
    // homepage's «¿Es la misma persona?» panel), and only the topmost answers Escape and Tab.
    return (
        <Modal title={t('adopter.pii_modal_title')} onClose={onClose} busy={submitting} testId="pii-request-dialog">
            <ModalText>
                {t('adopter.pii_modal_body').replace('{name}', adopterDisplayName({ name: adopterName }, t('adopter.nameless')))}
            </ModalText>
            <div className="space-y-1.5">
                <label htmlFor="pii-justification" className="text-sm font-medium block" style={{ color: 'var(--text-primary)' }}>
                    {t('adopter.pii_modal_justification_label')}
                </label>
                <textarea
                    id="pii-justification"
                    rows={3}
                    value={justification}
                    onChange={e => setJustification(e.target.value)}
                    maxLength={1000}
                    placeholder={t('adopter.pii_modal_justification_ph')}
                    className="w-full rounded-xl border border-teal-200 bg-white text-teal-900 text-sm p-3 outline-none focus:border-teal-500 resize-y"
                />
            </div>
            <ModalActions
                onCancel={onClose}
                cancelLabel={t('adopter.pii_modal_cancel')}
                busy={submitting}
                confirm={{ label: t('adopter.pii_modal_submit'), onClick: submit, tone: 'primary', disabled: !justification.trim() }}
            />
        </Modal>
    );
}
