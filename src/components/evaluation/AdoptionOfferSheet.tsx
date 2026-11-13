'use client';

/**
 * The offer to tell the other candidates (spec 2026-11-10, decision 4 / Q4):
 * once an adoption closed the others, a sheet lists them with «WhatsApp» /
 * «Email» per person — whatever contact they left on the form — and Jon's
 * message (`evaluation.offer_message`), editable. Each button opens the
 * rescuer's own app with the message for that person (`{name}` filled per
 * person), as the contract share does. Nothing records whether it was sent:
 * «Listo» and «Ahora no» both end the offer (markOfferDone), and the row
 * leaves the home. Closing with × keeps it for later (the home row stays).
 *
 * Opened right after a save that closed applications (useAdoptionOfferAfterSave,
 * in the wizard and the record edit) and from the home's offer row.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal, ModalActions } from '@/components/ui/Modal';
import { buttonClasses } from '@/components/ui/Button';
import { getAdoptionOffer, markOfferDone } from '@/app/actions/applications';
import type { OfferCandidate } from '@/app/actions/_applications';
import { phoneAppUrl } from '@/lib/contactEntries';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

/** Jon's text with the animal filled once; `{name}` stays, filled per person at link time. */
export function offerMessage(t: (k: string) => string, animalName: string): string {
    return t('evaluation.offer_message').replace(/\{animal\}/g, animalName);
}

/** The person's links: WhatsApp only with a phone, Email only with an email. */
export function offerLinks(c: Pick<OfferCandidate, 'firstName' | 'phone' | 'email'>, message: string, animalName: string): { whatsapp: string | null; email: string | null } {
    const text = message.replace(/\{name\}/g, c.firstName).replace(/\{animal\}/g, animalName);
    const wa = c.phone ? phoneAppUrl('whatsapp', c.phone) : null;
    const email = c.email?.trim();
    return {
        whatsapp: wa ? `${wa}?text=${encodeURIComponent(text)}` : null,
        // The address is the applicant's own typing: encoded, so a «?» or «&» in it can't add fields.
        email: email ? `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(animalName)}&body=${encodeURIComponent(text)}` : null,
    };
}

const FIELD = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

/** The message, one row per person with their buttons, «Ahora no» / «Listo». */
export function OfferSheetBody({ animalName, message, onMessage, candidates, busy, onNotNow, onDone }: {
    animalName: string;
    message: string;
    onMessage: (v: string) => void;
    candidates: readonly OfferCandidate[];
    busy: boolean;
    onNotNow: () => void;
    onDone: () => void;
}) {
    const { t } = useLanguage();
    const link = buttonClasses({ variant: 'secondary', size: 'compact' });
    return (
        <div className="space-y-4">
            <label className="block space-y-1">
                <span className="block text-xs font-semibold text-stone-600">{t('evaluation.offer_message_label')}</span>
                <textarea data-testid="offer-message" value={message} rows={5} disabled={busy}
                    onChange={e => onMessage(e.target.value)} className={FIELD} />
            </label>
            <ul className="divide-y divide-stone-200">
                {candidates.map((c) => {
                    const links = offerLinks(c, message, animalName);
                    return (
                        <li key={c.applicationId} className="flex flex-wrap items-center gap-2 py-2" data-testid="offer-candidate">
                            <span className="flex-1 min-w-0 text-sm font-semibold text-stone-900 [overflow-wrap:anywhere]">{c.firstName}</span>
                            {links.whatsapp && (
                                <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" data-testid={`offer-wa-${c.applicationId}`} className={link}>
                                    <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                    WhatsApp
                                </a>
                            )}
                            {links.email && (
                                <a href={links.email} data-testid={`offer-email-${c.applicationId}`} className={link}>
                                    <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                                    Email
                                </a>
                            )}
                        </li>
                    );
                })}
            </ul>
            <ModalActions
                onCancel={onNotNow}
                cancelLabel={t('evaluation.offer_not_now')}
                cancelTestId="offer-not-now"
                busy={busy}
                confirm={{ label: t('evaluation.offer_done'), onClick: onDone, tone: 'primary', testId: 'offer-done' }}
            />
        </div>
    );
}

type Load = { state: 'loading' } | { state: 'ok'; animalName: string; candidates: OfferCandidate[] } | { state: 'failed'; errorId: string | null };

export function AdoptionOfferSheet({ animalId, onClose, onDone }: {
    animalId: string;
    /** The sheet closes (after «Listo» / «Ahora no», or ×). */
    onClose: () => void;
    /** The offer is done (or there was nobody left to tell): whatever shows its row re-reads. */
    onDone?: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let current = true;
        getAdoptionOffer(animalId)
            .then((res) => {
                if (!current) return;
                if (!res.ok) {
                    setLoad({ state: 'failed', errorId: res.errorId ?? resolveErrorId(new Error(`getAdoptionOffer: ${res.error}`), 'AdoptionOfferSheet') });
                    return;
                }
                const animalName = res.animalName?.trim() || t('homeModules.unnamed_animal');
                setMessage(offerMessage(t, animalName));
                setLoad({ state: 'ok', animalName, candidates: res.candidates });
            })
            .catch((e) => {
                if (!current) return;
                setLoad({ state: 'failed', errorId: handledAsStale(e) ? null : resolveErrorId(e, 'AdoptionOfferSheet') });
            });
        return () => { current = false; };
        // `t` changes identity with the locale only; the offer is read once per animal.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animalId]);

    // Nobody left to tell (done from another tab, or the save closed no one with a profile): nothing to show.
    const nobody = load.state === 'ok' && load.candidates.length === 0;
    useEffect(() => {
        if (!nobody) return;
        onDone?.();
        onClose();
    }, [nobody, onDone, onClose]);

    const finish = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await markOfferDone(animalId);
            if (res.ok) {
                onDone?.();
                onClose();
                return;
            }
            toast.error(t('errors.generic'), t('evaluation.action_failed'),
                res.errorId ?? resolveErrorId(new Error(`markOfferDone: ${res.error}`), 'AdoptionOfferSheet'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.action_failed'), resolveErrorId(e, 'AdoptionOfferSheet'));
        } finally {
            setBusy(false);
        }
    };

    if (nobody) return null;
    return (
        <Modal title={t('evaluation.offer_title')} onClose={onClose} busy={busy} testId="offer-sheet">
            {load.state === 'loading' && <p className="text-sm text-stone-500" aria-busy="true">{t('common.loading')}</p>}
            {load.state === 'failed' && (
                <p className="text-sm text-stone-600" data-testid="offer-failed">
                    {t('evaluation.offer_failed')}
                    {load.errorId && <span className="text-xs text-stone-500"> ({t('homeModules.error_code')}: {load.errorId})</span>}
                </p>
            )}
            {load.state === 'ok' && (
                <OfferSheetBody animalName={load.animalName} message={message} onMessage={setMessage} candidates={load.candidates}
                    busy={busy} onNotNow={finish} onDone={finish} />
            )}
        </Modal>
    );
}

type SaveResult = { closedApplications?: { animalId: string; count: number } } | null | undefined;

/** The animal whose other candidates this save closed (the sheet to show), or null: the form closes as before. */
export function offerAnimalOf(result: SaveResult): string | null {
    const closed = result?.closedApplications;
    return closed && closed.count > 0 ? closed.animalId : null;
}

/**
 * After a save: `offerAfterSave(result, then)` returns true when the save closed
 * other candidates — the offer sheet shows, and `then` (the form's own reset /
 * close / refresh) runs when it closes; false otherwise, and the caller goes on
 * exactly as before (`then` is not called). `then` must report its own errors
 * (it runs outside the save's try). Render `offerSheet` inside the form, and
 * pause the form's own Escape while `offerOpen`.
 */
export function useAdoptionOfferAfterSave(): {
    offerSheet: ReactNode;
    offerOpen: boolean;
    offerAfterSave: (result: SaveResult, then: () => void) => boolean;
} {
    const [pending, setPending] = useState<{ animalId: string; then: () => void } | null>(null);
    const offerAfterSave = (result: SaveResult, then: () => void) => {
        const animalId = offerAnimalOf(result);
        if (!animalId) return false;
        setPending({ animalId, then });
        return true;
    };
    const offerSheet = pending ? (
        <AdoptionOfferSheet key={pending.animalId} animalId={pending.animalId}
            onClose={() => { const next = pending.then; setPending(null); next(); }} />
    ) : null;
    return { offerSheet, offerOpen: pending !== null, offerAfterSave };
}
