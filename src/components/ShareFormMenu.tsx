'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useContractBase } from '@/hooks/useContractBase';
import { zarazTrack } from '@/lib/zaraz';

const getQrImageSrc = (url: string) => `/api/qr?data=${encodeURIComponent(url)}`;

interface ShareFormMenuProps {
    userId: string;
    /**
     * When provided, the share URL becomes /form?u=...&animal=ID and all
     * labels switch to per-animal phrasing ("formulario para {name}").
     * Used by the /my-animals card actions so rescuers can hand a
     * prospective adopter a link pre-targeted to a specific animal.
     */
    animalId?: string;
    animalName?: string;
    /**
     * Tighter button styling for use inside card action rows where the
     * full-width "Compartir formulario de adopción" label is too long.
     */
    compact?: boolean;
}

export default function ShareFormMenu({ userId, animalId, animalName, compact = false }: ShareFormMenuProps) {
    const { t } = useLanguage();
    const contractBase = useContractBase();
    const [isOpen, setIsOpen] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);

    const perAnimal = !!animalId;
    const baseUrl = contractBase ? `${contractBase}/form?u=${encodeURIComponent(userId)}` : '';
    const fullUrl = baseUrl && animalId ? `${baseUrl}&animal=${encodeURIComponent(animalId)}` : baseUrl;
    const ready = fullUrl !== '';
    const shareText = perAnimal
        ? `${t('dashboard.share_form_for_animal_share_text') || 'Formulario de adopción para'} ${animalName || 'este animal'}`
        : 'Formulario de adopción responsable — PetShield';

    const handleCopyLink = async () => {
        if (!ready) return;
        try {
            await navigator.clipboard.writeText(fullUrl);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = fullUrl;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        setCopied(true);
        zarazTrack('contract_shared', { channel: 'clipboard' });
        setTimeout(() => setCopied(false), 2000);
    };

    const handleWhatsApp = () => {
        if (!ready) return;
        window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${fullUrl}`)}`, '_blank');
        zarazTrack('contract_shared', { channel: 'whatsapp' });
        setIsOpen(false);
    };

    const handleEmail = () => {
        if (!ready) return;
        window.open(`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n\n${fullUrl}`)}`, '_blank');
        zarazTrack('contract_shared', { channel: 'email' });
        setIsOpen(false);
    };

    const handleNativeShare = async () => {
        if (!ready) return;
        if (navigator.share) {
            try {
                await navigator.share({ title: shareText, url: fullUrl });
                zarazTrack('contract_shared', { channel: 'native' });
            } catch { /* User cancelled */ }
        }
        setIsOpen(false);
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setShowQr(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
                className={`inline-flex items-center gap-2 ${compact ? 'px-3 py-2 text-[12px]' : 'px-4 py-2.5 text-[13px]'} font-semibold text-teal-700 bg-teal-50 rounded-xl hover:bg-teal-100 transition-colors border border-teal-200`}
                aria-label={perAnimal
                    ? `${t('dashboard.share_form_for_animal_short') || 'Compartir formulario'}${animalName ? ` — ${animalName}` : ''}`
                    : (t('dashboard.share_form') || 'Share application form')}
            >
                <svg className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                {perAnimal
                    ? (compact ? (t('dashboard.share_form_for_animal_short') || 'Formulario') : (t('dashboard.share_form_for_animal') || 'Compartir formulario'))
                    : (t('dashboard.share_form') || 'Share application form')}
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => { setIsOpen(false); setShowQr(false); }}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="p-5 pb-3 border-b border-stone-100">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-lg">📋</div>
                                    <div>
                                        <h3 className="font-semibold text-stone-900 text-sm">
                                            {showQr
                                                ? (t('common.qr_code') || 'QR code')
                                                : perAnimal
                                                    ? (t('dashboard.share_form_for_animal_modal_title') || 'Compartir formulario')
                                                    : (t('dashboard.share_form_modal_title') || 'Share application form')}
                                        </h3>
                                        <p className="text-xs text-stone-500 mt-0.5 truncate max-w-[220px]">
                                            {showQr
                                                ? (t('dashboard.share_form_qr_hint') || 'Have the applicant scan to open the form')
                                                : perAnimal
                                                    ? (animalName || t('dashboard.share_form_for_animal_modal_hint') || 'Aspirantes completarán este formulario para postularse a este animal.')
                                                    : (t('dashboard.share_form_modal_hint') || 'Applicants fill this form; you\'ll receive their responses.')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => showQr ? setShowQr(false) : setIsOpen(false)}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        {showQr ? (
                            <div className="p-5 flex flex-col items-center">
                                <p className="text-xs text-stone-500 mb-3 text-center">{t('share.form_qr_hint')}</p>
                                <img src={getQrImageSrc(fullUrl)} alt="QR del enlace" className="rounded-xl border border-stone-200 bg-white" width={220} height={220} />
                                <p className="text-xs text-stone-400 mt-3 truncate max-w-full px-2">{fullUrl}</p>
                            </div>
                        ) : (
                        <>
                        {/* Share Options */}
                        <div className="p-3 space-y-1">
                            <a
                                href={fullUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setIsOpen(false)}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0 text-indigo-700">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">{t('share.open_in_new_tab')}</p>
                                    <p className="text-xs text-stone-500">{t('share.form_preview_hint')}</p>
                                </div>
                            </a>

                            <button
                                onClick={handleCopyLink}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-lg flex-shrink-0">
                                    {copied ? '✅' : '🔗'}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">{copied ? '¡Copiado!' : 'Copiar enlace'}</p>
                                    <p className="text-xs text-stone-500 truncate max-w-[220px]">{fullUrl}</p>
                                </div>
                            </button>

                            <button
                                onClick={handleWhatsApp}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-green-50 active:bg-green-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-lg flex-shrink-0">💬</div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">WhatsApp</p>
                                    <p className="text-xs text-stone-500">{t('share.via_message')}</p>
                                </div>
                            </button>

                            <button
                                onClick={handleEmail}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-blue-50 active:bg-blue-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-lg flex-shrink-0">📧</div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">Email</p>
                                    <p className="text-xs text-stone-500">{t('share.via_email')}</p>
                                </div>
                            </button>

                            <button
                                onClick={() => setShowQr(true)}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                            >
                                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-stone-900">{t('common.qr_code')}</p>
                                    <p className="text-xs text-stone-500">{t('share.qr_show')}</p>
                                </div>
                            </button>

                            {typeof navigator !== 'undefined' && 'share' in navigator && (
                                <button
                                    onClick={handleNativeShare}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-purple-50 active:bg-purple-100 transition-colors"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-lg flex-shrink-0">📤</div>
                                    <div>
                                        <p className="text-sm font-semibold text-stone-900">Más opciones...</p>
                                        <p className="text-xs text-stone-500">{t('share.more_options')}</p>
                                    </div>
                                </button>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-5 pb-4 pt-1">
                            <p className="text-xs text-stone-500 text-center">
                                {perAnimal
                                    ? (t('dashboard.share_form_for_animal_footer_hint') || 'El postulante completará el formulario para adoptar a este animal.')
                                    : t('share.form_footer_hint')}
                            </p>
                        </div>
                        </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
