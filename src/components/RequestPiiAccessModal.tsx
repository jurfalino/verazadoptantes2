'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { requestPiiAccess } from '@/app/actions/piiAccess';
import { adopterDisplayName } from '@/lib/adopterDisplay';

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
        } catch {
            toast.error(t('errors.generic'), t('adopter.pii_request_error'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }}>
            <div className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4" style={{ background: 'var(--surface-card)' }}>
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('adopter.pii_modal_title')}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {t('adopter.pii_modal_body').replace('{name}', adopterDisplayName({ name: adopterName }, t('adopter.nameless')))}
                </p>
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
                <div className="flex gap-3 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                        style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                    >
                        {t('adopter.pii_modal_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting || !justification.trim()}
                        className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? '...' : t('adopter.pii_modal_submit')}
                    </button>
                </div>
            </div>
        </div>
    );
}
