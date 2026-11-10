'use client';

/**
 * «No avanzar» (spec 2026-11-10, decision E1): a regular observation on the
 * applicant's profile — neither good nor bad — that REQUIRES a rating and a
 * reason. The first line is pre-filled and editable; the rating is the app's
 * own StarRating (large, label beside, never cleared once set); «Guardar»
 * stays disabled, naming what is missing, until both are filled.
 */
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal, ModalActions, ModalText } from '@/components/ui/Modal';
import { StarRating } from '@/components/StarRating';
import { declineApplication } from '@/app/actions/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { firstName } from '@/lib/householdCopy';
import { DECLINE_REASON_MAX, DECLINE_TEXT_MAX } from '@/domain/constants';

export type DeclineMissing = 'missing_both' | 'missing_rating' | 'missing_reason';

/** What still has to be filled before «Guardar» (the copy key under `evaluation.`), or null when ready. */
export function declineMissing(rating: number, reason: string): DeclineMissing | null {
    const noRating = !(rating > 0);
    const noReason = !reason.trim();
    return noRating && noReason ? 'missing_both' : noRating ? 'missing_rating' : noReason ? 'missing_reason' : null;
}

const FIELD = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

/** The fields, controlled. */
export function DeclineForm({ text, rating, reason, busy, onText, onRating, onReason }: {
    text: string; rating: number; reason: string; busy: boolean;
    onText: (v: string) => void; onRating: (v: number) => void; onReason: (v: string) => void;
}) {
    const { t } = useLanguage();
    const missing = declineMissing(rating, reason);
    return (
        <div className="space-y-4">
            <label className="block space-y-1">
                <span className="block text-xs font-semibold text-stone-600">{t('evaluation.decline_text_label')}</span>
                <textarea
                    data-testid="decline-text" value={text} maxLength={DECLINE_TEXT_MAX} rows={2} disabled={busy}
                    onChange={e => onText(e.target.value)} className={FIELD}
                />
            </label>
            <div className="space-y-1">
                <span className="block text-xs font-semibold text-stone-600">{t('evaluation.decline_rating')}</span>
                {/* Required and not clearable: re-tapping the current star would clear it — ignored. */}
                <StarRating value={rating} size="lg" showLabel clearable={false} onChange={v => { if (v > 0 && !busy) onRating(v); }} />
                {rating === 1 && <p className="text-xs text-rose-700">{t('import.rating_one_bans')}</p>}
            </div>
            <label className="block space-y-1">
                <span className="block text-xs font-semibold text-stone-600">{t('evaluation.decline_reason')}</span>
                <textarea
                    data-testid="decline-reason" value={reason} maxLength={DECLINE_REASON_MAX} rows={3} disabled={busy}
                    onChange={e => onReason(e.target.value)} className={FIELD}
                />
            </label>
            {missing && <p className="text-xs font-semibold text-amber-700" data-testid="decline-missing">{t(`evaluation.${missing}`)}</p>}
        </div>
    );
}

export function DeclineApplicationDialog({ applicationId, personName, animalName, onClose, onDone }: {
    applicationId: string;
    personName: string;
    /** null: a general application. */
    animalName: string | null;
    onClose: () => void;
    /** The outcome is recorded (or already was): the panel re-reads and moves on. */
    onDone: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const name = firstName(personName) || personName;
    const prefill = animalName
        ? t('evaluation.decline_prefill_animal').replace('{animal}', animalName)
        : t('evaluation.decline_prefill');
    const [text, setText] = useState(prefill);
    const [rating, setRating] = useState(0);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const ready = declineMissing(rating, reason) === null;

    const save = async () => {
        if (!ready || busy) return;
        setBusy(true);
        try {
            // An emptied first line saves as the pre-filled one (the observation always says what it is).
            const res = await declineApplication(applicationId, { text: text.trim() || prefill, rating, reason });
            // `already_decided`: the outcome is already recorded (a double tap, another tab) — same as done.
            if (res.ok || res.error === 'already_decided') {
                onDone();
                return;
            }
            toast.error(t('errors.generic'), t('evaluation.decline_failed'),
                res.errorId ?? resolveErrorId(new Error(`declineApplication: ${res.error}`), 'DeclineApplicationDialog'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.decline_failed'), resolveErrorId(e, 'DeclineApplicationDialog'));
        } finally {
            setBusy(false);
        }
    };

    const title = animalName
        ? t('evaluation.decline_title_animal').replace('{name}', name).replace('{animal}', animalName)
        : t('evaluation.decline_title').replace('{name}', name);

    return (
        <Modal title={title} onClose={onClose} busy={busy} testId="decline-dialog">
            <ModalText>{t('evaluation.decline_note').replace('{name}', name)}</ModalText>
            <DeclineForm text={text} rating={rating} reason={reason} busy={busy} onText={setText} onRating={setRating} onReason={setReason} />
            <ModalActions
                onCancel={onClose}
                busy={busy}
                confirm={{ label: t('evaluation.decline_save'), onClick: save, tone: 'primary', disabled: !ready, testId: 'decline-save' }}
            />
        </Modal>
    );
}
