'use client';

/**
 * v2.56.123 — handing the animal's veterinary record to the family.
 *
 * The rescuer's half of /salud/:id. Three things it deliberately does:
 *
 *  1. Says what the family will receive, BEFORE sending. The rescuer is about
 *     to publish a link out of an app whose whole subject is other people's
 *     records, so "nada sobre su adopción ni sobre el tránsito anterior" is
 *     not reassurance copy — it is the one fact they need to send it freely.
 *  2. Lets them edit the message. The prefilled text is a starting point, not
 *     a template they are stuck with.
 *  3. Keeps contacting and copying separate. WhatsApp is the one-tap path when
 *     a phone is on file (~80% of placed animals in production); everyone else
 *     gets the link to paste wherever they already talk to that family.
 *
 * Telegram cannot prefill a message to a person, so that branch copies the
 * text and opens the chat — the same convention the due-follow-up row uses.
 */

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { useContractBase } from '@/hooks/useContractBase';
import { reportClientError } from '@/lib/clientErrorReporter';
import { interpolate } from '@/lib/interpolate';
import { buildWaMeUrl, buildTelegramUrl } from '@/lib/whatsapp';

export default function ShareHealthRecordModal({
    open, onClose, animalId, token, animalName, vetEventCount, familyName, contact,
}: {
    open: boolean;
    onClose: () => void;
    /** For error reporting only — the shared address is `token`. */
    animalId: string;
    token: string;
    animalName: string;
    vetEventCount: number;
    familyName: string | null;
    contact: { channel: 'whatsapp' | 'telegram'; phone: string } | null;
}) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const contractBase = useContractBase();
    const [message, setMessage] = useState('');
    const [copied, setCopied] = useState(false);
    /** Seeded exactly once per opening. Keying the effect on an empty `message`
     *  instead would refill the box the moment the rescuer cleared it to write
     *  their own. */
    const seeded = useRef(false);

    const url = contractBase ? `${contractBase}/salud/${token}?lang=${locale}` : '';

    useEffect(() => {
        if (!open) { seeded.current = false; return; }
        if (seeded.current || !url) return;
        seeded.current = true;
        setMessage(interpolate(
            t('healthRecord.message') || 'Hola{saludo}. Te paso el historial de salud de {animal}, con todo lo que le hicimos: {link}',
            { saludo: familyName ? ` ${familyName}` : '', animal: animalName, link: url },
        ));
    }, [open, url, t, familyName, animalName]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const handleCopy = async () => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success(t('myAnimals.showcase_copied') || 'Link copiado', '');
        } catch (e) {
            const errorId = await reportClientError({
                message: e instanceof Error ? e.message : String(e),
                source: 'ShareHealthRecordModal.copy',
                extra: { animalId },
            });
            toast.error(t('errors.generic') || 'Error', t('myAnimals.showcase_copy_failed') || 'No se pudo copiar.', errorId);
        }
    };

    const contactUrl = contact
        ? (contact.channel === 'telegram' ? buildTelegramUrl(contact.phone) : buildWaMeUrl(contact.phone, message))
        : null;

    const onContactClick = () => {
        // t.me carries no text, so the message goes to the clipboard and the
        // rescuer pastes it into the chat that is about to open.
        if (contact?.channel === 'telegram') {
            navigator.clipboard?.writeText(message).catch(() => { /* blocked: the chat still opens */ });
        }
    };

    const pill = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-bold transition-colors';

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4 max-h-[90vh] overflow-y-auto flex flex-col gap-3"
                role="dialog"
                aria-modal="true"
                aria-label={t('healthRecord.title') || 'Historial médico'}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-base font-bold text-stone-900">
                    {familyName
                        ? interpolate(t('healthRecord.send_to') || 'Mandarle el historial a {name}', { name: familyName })
                        : (t('healthRecord.title') || 'Historial médico')}
                </h3>

                {/* what leaves the app */}
                <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-stone-600">
                        {t('healthRecord.will_receive') || 'Va a recibir'}
                    </p>
                    <p className="mt-1.5 text-[13px] text-stone-700 leading-relaxed" data-testid="health-share-contents">
                        {interpolate(
                            (vetEventCount === 1
                                ? t('healthRecord.contents_one')
                                : t('healthRecord.contents_many'))
                            || 'Los datos de {animal} y las {n} entradas veterinarias que cargaste, con sus fotos. Nada sobre su adopción ni sobre el tránsito anterior.',
                            { animal: animalName, n: vetEventCount },
                        )}
                    </p>
                </div>

                <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-stone-600">
                        {t('healthRecord.message_label') || 'Mensaje'}
                    </span>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={4}
                        className="w-full rounded-xl border border-stone-300 p-3 text-[13px] text-stone-900 leading-relaxed resize-none focus:outline-none focus:border-teal-500"
                        data-testid="health-share-message"
                    />
                </label>

                {contactUrl ? (
                    <>
                        <a
                            href={contactUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={onContactClick}
                            className={`${pill} w-full text-white bg-teal-600 hover:bg-teal-700`}
                            data-testid="health-share-send"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z" /></svg>
                            {contact?.channel === 'telegram'
                                ? (t('healthRecord.send_telegram') || 'Enviar por Telegram')
                                : (t('healthRecord.send_whatsapp') || 'Enviar por WhatsApp')}
                        </a>
                        <p className="-mt-1 text-[11px] text-stone-600 text-center">
                            {interpolate(t('healthRecord.send_to_phone') || 'al {phone}, el teléfono que ya está en su ficha', { phone: contact!.phone })}
                        </p>
                    </>
                ) : (
                    <p className="text-[12px] text-stone-600 leading-relaxed" data-testid="health-share-nophone">
                        {t('healthRecord.no_phone') || 'No hay un teléfono en su ficha, así que copiá el link y mandáselo por donde ya hablen.'}
                    </p>
                )}

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!url}
                        className={`${pill} flex-1 text-stone-900 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-40`}
                        data-testid="health-share-copy"
                    >
                        {copied ? (t('myAnimals.showcase_copied') || 'Copiado') : (t('myAnimals.showcase_copy') || 'Copiar link')}
                    </button>
                    {url && (
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${pill} flex-1 text-stone-900 bg-white border border-stone-300 hover:bg-stone-50`}
                            data-testid="health-share-preview"
                        >
                            {t('healthRecord.preview') || 'Ver la página'}
                        </a>
                    )}
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed" data-testid="health-share-expires">
                    {t('healthRecord.expires_note') || 'El link deja de funcionar si registrás una devolución.'}
                </p>

                <button
                    type="button"
                    onClick={onClose}
                    className="w-full px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                >
                    {t('common.close') || 'Cerrar'}
                </button>
            </div>
        </div>
    );
}
