'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useContractBase } from '@/hooks/useContractBase';
import { zarazTrack } from '@/lib/zaraz';
import { getShareFormAnimals } from '@/app/actions/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import ShareAnimalPicker, { ShareAnimalThumb } from '@/components/share/ShareAnimalPicker';
import type { ShareAnimal } from '@/domain/shareFormAnimals';

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
    /**
     * Draws the button that opens the window instead of the default one
     * (the home's «Compartir formulario» row). Gets the opener.
     */
    renderTrigger?: (open: () => void) => ReactNode;
}

/**
 * The last list read per rescuer, so the window opens with «¿Para qué animal?»
 * already in place (no jump) while it is read again in the background.
 */
const lastAnimals = new Map<string, ShareAnimal[]>();

/** «¿Para qué animal?» — the team's animals, read when the window opens. */
type AnimalsLoad = { state: 'idle' | 'loading' } | { state: 'ok'; animals: ShareAnimal[] } | { state: 'failed'; errorId: string | null };

export default function ShareFormMenu({ userId, animalId, animalName, compact = false, renderTrigger }: ShareFormMenuProps) {
    const { t, locale } = useLanguage();
    const contractBase = useContractBase();
    const [isOpen, setIsOpen] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);
    // «¿Para qué animal?» — only when the window was not opened for one animal.
    const canPick = !animalId;
    const [animalsLoad, setAnimalsLoad] = useState<AnimalsLoad>({ state: 'idle' });
    const [picked, setPicked] = useState<ShareAnimal | null>(null);
    const [picking, setPicking] = useState(false);

    const linkAnimalId = animalId ?? picked?.id ?? null;
    const linkAnimalName = animalId ? animalName : (picked?.name?.trim() || t('homeModules.unnamed_animal'));
    const perAnimal = !!linkAnimalId;
    const baseUrl = contractBase ? `${contractBase}/form?u=${encodeURIComponent(userId)}` : '';
    // ?lang= renders the contract-app form in the sharer's language (defaults to es).
    const fullUrl = baseUrl
        ? `${baseUrl}${linkAnimalId ? `&animal=${encodeURIComponent(linkAnimalId)}` : ''}&lang=${locale}`
        : '';
    const ready = fullUrl !== '';
    const shareText = perAnimal
        ? `${t('dashboard.share_form_for_animal_share_text') || 'Formulario de adopción para'} ${linkAnimalName || 'este animal'}`
        : t('share.form_share_text');

    // Read the team's animals each time the window opens (one may have been added meanwhile).
    useEffect(() => {
        if (!isOpen || !canPick) return;
        let current = true;
        const known = lastAnimals.get(userId);
        setAnimalsLoad(known ? { state: 'ok', animals: known } : { state: 'loading' });
        getShareFormAnimals()
            .then((res) => {
                if (!current) return;
                if (res.ok) {
                    lastAnimals.set(userId, res.animals);
                    setAnimalsLoad({ state: 'ok', animals: res.animals });
                    // A picked animal no longer there (adopted meanwhile) is dropped.
                    setPicked(p => (p && !res.animals.some(a => a.id === p.id) ? null : p));
                    return;
                }
                setAnimalsLoad({ state: 'failed', errorId: res.errorId ?? resolveErrorId(new Error(`getShareFormAnimals: ${res.error}`), 'ShareFormMenu') });
            })
            .catch((e: unknown) => {
                if (!current) return;
                setAnimalsLoad({ state: 'failed', errorId: handledAsStale(e) ? null : resolveErrorId(e, 'ShareFormMenu') });
            });
        return () => { current = false; };
    }, [isOpen, canPick, userId]);

    const open = () => { setPicked(null); setPicking(false); setShowQr(false); setIsOpen(true); };
    const close = () => { setIsOpen(false); setShowQr(false); setPicking(false); };
    const pickableAnimals = animalsLoad.state === 'ok' ? animalsLoad.animals : [];

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
        zarazTrack('form_shared', { channel: 'clipboard' });
        setTimeout(() => setCopied(false), 2000);
    };

    const handleWhatsApp = () => {
        if (!ready) return;
        window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${fullUrl}`)}`, '_blank');
        zarazTrack('form_shared', { channel: 'whatsapp' });
        close();
    };

    const handleEmail = () => {
        if (!ready) return;
        window.open(`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n\n${fullUrl}`)}`, '_blank');
        zarazTrack('form_shared', { channel: 'email' });
        close();
    };

    const handleNativeShare = async () => {
        if (!ready) return;
        if (navigator.share) {
            try {
                await navigator.share({ title: shareText, url: fullUrl });
                zarazTrack('form_shared', { channel: 'native' });
            } catch { /* User cancelled */ }
        }
        close();
    };

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (picking) { setPicking(false); return; }
                close();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, picking]);

    return (
        <>
            {renderTrigger ? renderTrigger(open) : (
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); open(); }}
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
            )}

            {isOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={close}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {picking ? (
                            <ShareAnimalPicker
                                animals={pickableAnimals}
                                pickedId={picked?.id ?? null}
                                onPick={(a) => { setPicked(a); setPicking(false); setCopied(false); }}
                                onBack={() => setPicking(false)}
                            />
                        ) : (
                        <>
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
                                                    ? (linkAnimalName || t('dashboard.share_form_for_animal_modal_hint') || 'Aspirantes completarán este formulario para postularse a este animal.')
                                                    : (t('dashboard.share_form_modal_hint') || 'Applicants fill this form; you\'ll receive their responses.')}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => showQr ? setShowQr(false) : close()}
                                    aria-label={t('common.close')}
                                    className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        {showQr ? (
                            <div className="p-5 flex flex-col items-center">
                                <p className="text-xs text-stone-500 mb-3 text-center">{t('share.form_qr_hint')}</p>
                                <img src={getQrImageSrc(fullUrl)} alt={t('share.qr_alt')} className="rounded-xl border border-stone-200 bg-white" width={220} height={220} />
                                <p className="text-xs text-stone-400 mt-3 truncate max-w-full px-2">{fullUrl}</p>
                            </div>
                        ) : (
                        <>
                        {/* «¿Para qué animal?» — the window opened without an animal, and the team has some. */}
                        {/* First open: the line's place is held while the animals are read, so the options below don't jump. */}
                        {canPick && animalsLoad.state === 'loading' && (
                            <div className="px-3 pt-3" aria-busy="true" data-testid="share-form-pick-animal-loading">
                                <div className="w-full flex items-center gap-3 px-4 py-3 min-h-11 rounded-xl bg-stone-50 border border-stone-200">
                                    <span className="w-10 h-10 shrink-0 rounded-lg bg-stone-200 animate-pulse" />
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-xs font-semibold text-stone-500">{t('share.pick_label')}</span>
                                        <span className="block h-4 w-32 mt-1 rounded bg-stone-200 animate-pulse" />
                                    </span>
                                </div>
                            </div>
                        )}
                        {canPick && animalsLoad.state === 'ok' && pickableAnimals.length > 0 && (
                            <div className="px-3 pt-3">
                                <button type="button" onClick={() => setPicking(true)} data-testid="share-form-pick-animal"
                                    className="w-full flex items-center gap-3 px-4 py-3 min-h-11 rounded-xl text-left bg-stone-50 border border-stone-200 hover:border-stone-300 transition-colors">
                                    <ShareAnimalThumb animal={picked} />
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-xs font-semibold text-stone-500">{t('share.pick_label')}</span>
                                        <span className="block text-sm font-semibold text-stone-900 truncate">{picked ? linkAnimalName : t('share.pick_none')}</span>
                                    </span>
                                    <span className="text-xs font-semibold text-teal-700 shrink-0">{t('share.pick_change')}</span>
                                </button>
                            </div>
                        )}
                        {canPick && animalsLoad.state === 'failed' && animalsLoad.errorId && (
                            <p className="px-5 pt-3 text-xs text-stone-500" data-testid="share-form-animals-failed">
                                {t('share.pick_load_failed')} <span className="text-stone-400">({t('homeModules.error_code')}: {animalsLoad.errorId})</span>
                            </p>
                        )}
                        {/* Share Options */}
                        <div className="p-3 space-y-1">
                            <a
                                href={fullUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={close}
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
                                    <p className="text-sm font-semibold text-stone-900">{copied ? t('share.copied') : t('share.copy_link')}</p>
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
                                        <p className="text-sm font-semibold text-stone-900">{t('share.more_title')}</p>
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
                        </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
