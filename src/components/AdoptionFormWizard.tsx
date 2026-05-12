'use client';

import { useState, useEffect, useRef } from 'react';
import { saveAdoption } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { getRecordTypeColors, getRecordTypeIcon } from '@/lib/recordTypeColors';
import RecordTypeGuidance from '@/components/RecordTypeGuidance';
import { StarRating } from '@/components/StarRating';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { MediaLightbox } from '@/components/ui/MediaLightbox';
import type { MediaItem } from '@/components/ui/MediaLightbox';
import { formatShortDate } from '@/lib/dates';
import DatePicker from '@/components/ui/DatePicker';
import { extractVideoThumbnail } from '@/lib/videoThumbnail';
import { zarazTrack } from '@/lib/zaraz';

// Helpers
function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

function extractAddressFromContact(contactText: string): string {
    if (!contactText) return '';
    const lines = contactText.split('\n');
    const kw = /^(address|direcci[oó]n|domicilio|calle|av\.|avenida|blvd|colonia|c\.p\.|cp|barrio)\s*:?/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (kw.test(trimmed)) return trimmed.replace(/^(direcci[oó]n\s*\/\s*address|address|direcci[oó]n|domicilio)\s*:?\s*/i, '');
    }
    return '';
}

const RECORD_TYPES = [
    { value: 'adoption', icon: '🏠', labelKey: 'adoption.type_adoption', fallback: 'Adoption' },
    { value: 'adoption_request', icon: '📝', labelKey: 'adoption.type_request', fallback: 'Request' },
    { value: 'foster', icon: '🤝', labelKey: 'adoption.type_foster', fallback: 'Foster' },
    { value: 'observation', icon: '👁️', labelKey: 'adoption.type_observation', fallback: 'Note' },
    { value: 'follow_up', icon: '📞', labelKey: 'adoption.type_followup', fallback: 'Follow-up' },
    { value: 'returned_pet', icon: '↩️', labelKey: 'adoption.type_returned', fallback: 'Returned' },
] as const;

export default function AdoptionFormWizard({ adopterId, adopterName = '', avgRating = null, tooManyAdoptions = null, tooManyRequests = null, availableAnimals = [], adopterAdoptions = [], currentUser, adopterAddress = '', initialRecordType, autoOpen = false, onClose }: {
    adopterId: string;
    /** Display name of the adopter — used in step-1 guidance copy. */
    adopterName?: string;
    /** Average rating from prior records (1-5). Drives rating-bucket guidance copy. null when unrated. */
    avgRating?: number | null;
    /** Density flag: too many completed adoptions in a recent window (or null when below threshold). */
    tooManyAdoptions?: { count: number; actualSpanDays?: number; periodDays: number } | null;
    /** Density flag: too many open adoption_requests in a recent window (or null when below threshold). */
    tooManyRequests?: { count: number; actualSpanDays?: number; periodDays: number } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availableAnimals?: any[];
    /**
     * All existing adoption-table rows for this adopter. Used as the picker
     * source when the user is logging a follow_up / returned_pet — those flows
     * reference an animal *already* adopted by this person, not the rescuer's
     * unlinked inventory (`availableAnimals`).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adopterAdoptions?: any[];
    currentUser?: string;
    adopterAddress?: string;
    /**
     * Pre-select the record type when the wizard mounts. Skips the user
     * having to tap the chip in step 1 (used by VisitIntentCard which already
     * captured the user's intent). Step 1 still renders so adoption /
     * adoption_request flows can pick an animal — observation flows just
     * click "next".
     */
    initialRecordType?: 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' | 'foster';
    /** Open the wizard immediately on mount (paired with initialRecordType). */
    autoOpen?: boolean;
    /** Called when the wizard closes (cancel or save). */
    onClose?: () => void;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    const newAdoptionParam = searchParams.get('newAdoption');
    const continueToAdoption = searchParams.get('continueToAdoption') === 'true';
    const shouldOpenFromWizard = !!newAdoptionParam || continueToAdoption;
    const prefillAnimalName = searchParams.get('animalName') || '';
    const prefillSpecies = searchParams.get('species') || 'cat';
    const prefillRecordType = initialRecordType
        || (newAdoptionParam === 'observation' ? 'observation' : 'adoption');
    const prefillRating = searchParams.get('rating');
    const prefillDetails = searchParams.get('details') || '';
    const prefillDate = searchParams.get('date') || '';

    const [isOpen, setIsOpen] = useState(shouldOpenFromWizard || autoOpen);
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [direction, setDirection] = useState<'forward' | 'back'>('forward');
    const [pendingImages, setPendingImages] = useState<Array<{ data: string; file?: File; isVideo: boolean; thumbnail?: string }>>([]);
    const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
    const [unknownAnimal, setUnknownAnimal] = useState(false);
    const [customSpecies, setCustomSpecies] = useState(false);
    const [mode, setMode] = useState<'existing' | 'new'>(shouldOpenFromWizard ? 'new' : 'existing');

    const [formData, setFormData] = useState({
        animalName: prefillAnimalName,
        details: prefillDetails,
        status: 'completed',
        rating: prefillRating ? Number(prefillRating) : 5,
        comments: '',
        species: prefillSpecies,
        adopterId: adopterId,
        recordType: prefillRecordType,
        date: prefillDate,
        // Companion date used only for the dual-record follow_up/returned_pet
        // flow — when the user is logging an event for a brand-new animal that
        // wasn't previously in the system, we ask for both the original
        // adoption date and the event date so two records can be created.
        adoptionDate: '',
        deliveredToHome: false,
        verifiedAddress: '',
        identityVerified: false,
        animalId: '',
    });

    const stepContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!formData.date) setFormData(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Focus management and scrolling
    useEffect(() => {
        if (isOpen && stepContainerRef.current) {
            // Scroll if opened via URL param or programmatically (VisitIntentCard)
            if ((shouldOpenFromWizard || autoOpen) && step === 1) {
                setTimeout(() => stepContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
            // Move focus to container on step change for screen readers
            setTimeout(() => {
                stepContainerRef.current?.focus();
            }, 50);
        }
    }, [isOpen, step, shouldOpenFromWizard, autoOpen]);

    const resetForm = () => {
        setFormData({ animalId: '', animalName: '', details: '', status: 'completed', rating: 5, comments: '', species: 'cat', adopterId, recordType: 'adoption', date: new Date().toISOString().split('T')[0], adoptionDate: '', deliveredToHome: false, verifiedAddress: '', identityVerified: false });
        setPendingImages([]);
        setUnknownAnimal(false);
        setCustomSpecies(false);
        setMode('existing');
        setStep(1);
    };

    const safeAvailableAnimals = Array.isArray(availableAnimals) ? availableAnimals : [];
    const safeAdopterAdoptions = Array.isArray(adopterAdoptions) ? adopterAdoptions : [];
    const isObservation = formData.recordType === 'observation';
    const isFollowUpOrReturn = formData.recordType === 'follow_up' || formData.recordType === 'returned_pet';
    // Adoption-request flows only collect species — there's no specific animal yet
    // ("person asks for any cat"), so hiding name + mode-switcher removes friction
    // with no information loss. animalName is saved as null on submit.
    const isRequest = formData.recordType === 'adoption_request';

    // For follow_up / returned_pet, the picker should source from animals this
    // adopter has actually adopted — not the rescuer's unlinked inventory.
    const previousAdoptionsForAdopter = isFollowUpOrReturn
        ? safeAdopterAdoptions.filter(a => a && a.recordType === 'adoption' && a.animalName)
        : [];
    const effectiveAnimalsList = isFollowUpOrReturn ? previousAdoptionsForAdopter : safeAvailableAnimals;
    const showModeSwitcher = !shouldOpenFromWizard && effectiveAnimalsList.length > 0 && !isObservation && !isRequest;
    const effectiveMode = showModeSwitcher ? mode : 'new';

    // Dual-record flow: user is logging a follow_up/returned_pet for an animal
    // that wasn't previously in the system — we'll create the parent adoption
    // and the event record together, so we need two dates.
    const showDualDate = isFollowUpOrReturn && effectiveMode === 'new';

    // Clear stale animal data when user switches to observation type so the saved record
    // doesn't carry over animalName/species from a previously-selected adoption type.
    useEffect(() => {
        if (isObservation && (formData.animalId || formData.animalName || formData.species)) {
            setFormData(d => ({ ...d, animalId: '', animalName: '', species: '' }));
            setUnknownAnimal(false);
            setCustomSpecies(false);
        }
    }, [isObservation, formData.animalId, formData.animalName, formData.species]);

    const handleSelectExisting = (animalId: string) => {
        if (!animalId) return;
        const animal = effectiveAnimalsList.find(a => a.id === animalId);
        if (animal) setFormData(prev => ({ ...prev, animalId: animal.id, animalName: animal.animalName, species: animal.species }));
    };

    const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('ctx')); return; }
                const max = 1200;
                let w = img.width, h = img.height;
                if (w > h) { if (w > max) { h = h * max / w; w = max; } } else { if (h > max) { w = w * max / h; h = max; } }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = () => reject(new Error('img load'));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('read'));
        reader.readAsDataURL(file);
    });

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const isVideoFile = file.type.startsWith('video/');
        if (!file.type.startsWith('image/') && !isVideoFile) { toast.error(t('errors.generic'), t('errors.upload_invalid_file')); return; }
        if (isVideoFile && file.size > 50 * 1024 * 1024) { toast.warning(t('adopter.video_too_large'), t('adopter.video_too_large_desc')); return; }
        e.target.value = '';
        setUploading(true);
        
        // Yield to the main thread so the 'Uploading...' state can render before synchronous canvas operations
        await new Promise(r => setTimeout(r, 50));
        
        try {
            if (isVideoFile) {
                let thumbnail: string | undefined;
                try { thumbnail = await extractVideoThumbnail(file); } catch { /* ignore */ }
                setPendingImages(prev => [...prev, { data: '', file, isVideo: true, thumbnail }]);
            } else {
                const base64 = await compressImage(file);
                setPendingImages(prev => [...prev, { data: base64, isVideo: false }]);
            }
        } catch (error) {
            toast.error(t('toast.upload_failed_title'), t('errors.upload_process_failed'), extractErrorId(error));
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async () => {
        const isAuthenticated = (currentUser && currentUser !== '') || !!session?.user;
        if (!isAuthenticated) { openLogin(); return; }

        // Dual-date validation: both required when logging a brand-new follow-up/return.
        if (showDualDate && !formData.adoptionDate) {
            toast.warning(t('common.error'), t('adoption.fill_required'));
            return;
        }

        setLoading(true);
        try {
            const parseLocalDate = (s: string) => {
                const [y, m, d] = s.split('-').map(Number);
                return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
            };
            const localDate = parseLocalDate(formData.date);

            // For follow_up / returned_pet, animalId on the form refers to a
            // *previous adoption record* — we copy its name/species but must
            // create a NEW row for the event (never UPDATE the parent adoption).
            const idForSubmit = isFollowUpOrReturn ? undefined : (formData.animalId || undefined);

            // Dual-record path: create the parent adoption first, then the event.
            if (showDualDate) {
                const adoptionLocalDate = parseLocalDate(formData.adoptionDate);
                 
                await saveAdoption({
                    animalName: formData.animalName,
                    species: formData.species,
                    details: '',
                    status: 'completed',
                    rating: Number(formData.rating),
                    adopterId,
                    recordType: 'adoption',
                    date: adoptionLocalDate,
                    onBehalfOf: null,
                    deliveredToHome: 0,
                    verifiedAddress: null,
                    identityVerified: 0,
                } as any);
            }

            const submitData = {
                ...formData,
                id: idForSubmit,
                rating: Number(formData.rating),
                date: localDate,
                // Adoption requests don't reference a specific animal — drop the
                // name even if some leftover state held one. Species stays.
                animalName: isRequest ? null : formData.animalName,
                onBehalfOf: null,
                deliveredToHome: formData.deliveredToHome ? 1 : 0,
                verifiedAddress: formData.verifiedAddress || null,
                identityVerified: formData.identityVerified ? 1 : 0
            };
            // `adoptionDate` is wizard-only state, not a column.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (submitData as any).adoptionDate;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await saveAdoption(submitData as any);

            if (pendingImages.length > 0 && result?.id) {
                const uploadPromises = pendingImages.map(async (pending) => {
                    if (pending.isVideo && pending.file) {
                        const fd = new FormData();
                        fd.append('file', pending.file); fd.append('adopterId', adopterId); fd.append('adoptionId', result.id); fd.append('caption', `Video for ${formData.animalName}`); fd.append('mediaType', 'video');
                        if (pending.thumbnail) fd.append('thumbnail', dataUrlToBlob(pending.thumbnail), 'thumb.jpg');
                        return fetch('/api/upload-media', { method: 'POST', body: fd });
                    } else {
                        const { saveImage } = await import('@/app/actions');
                        return saveImage(adopterId, pending.data, `Photo for ${formData.animalName}`, result.id, 'image');
                    }
                });
                await Promise.all(uploadPromises);
            }
            
            zarazTrack('adoption_created', { species: formData.species, recordType: formData.recordType, rating: Number(formData.rating), hasMedia: pendingImages.length > 0 ? 1 : 0 });
            
            resetForm();
            setIsOpen(false);
            onClose?.();
            await new Promise(r => setTimeout(r, 100));
            router.refresh();
        } catch (err) {
            toast.error(t('errors.generic'), t('errors.save_failed_generic'), extractErrorId(err));
        } finally {
            setLoading(false);
        }
    };

    const goNext = () => { setDirection('forward'); setStep(s => Math.min(3, s + 1)); };
    const goBack = () => { setDirection('back'); setStep(s => Math.max(1, s - 1)); };

    const checkStep1Valid = () => {
        // Observations are about the adopter, not an animal — no animal selection required.
        if (isObservation) return true;
        // Adoption requests only collect species — no specific animal yet.
        if (isRequest) {
            if (!formData.species.trim()) {
                toast.warning(t('common.error'), t('adoption.fill_required'));
                return false;
            }
            return true;
        }

        const isValid = effectiveMode === 'existing'
            ? !!formData.animalId
            : (unknownAnimal || !!formData.animalName.trim()) && !!formData.species.trim();

        if (!isValid) {
            toast.warning(t('common.error'), t('adoption.fill_required'));
            return false;
        }
        return true;
    };

    const handleNextStep1 = () => {
        if (checkStep1Valid()) goNext();
    };

    // Closed state renders nothing (v2.14.8). The wizard mounts so URL-driven
    // autoOpen flows still work, and parents (VisitIntentCard) drive opens by
    // unmounting/remounting with `autoOpen` set.
    if (!isOpen) return null;

    const stepLabels = [
        t('wizard.step_what'),
        t('wizard.step_details'),
        t('wizard.step_evidence'),
    ];

    return (
        <>
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
            <div id="wizard-container" ref={stepContainerRef} tabIndex={-1} className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-white rounded-xl border-2 border-teal-400/50 shadow-lg relative ring-4 ring-teal-50/50 mb-4 outline-none overflow-hidden">
                
                {/* Step Indicator */}
                <div className="px-5 pt-5 pb-3">
                    <div className="flex items-center justify-between gap-2 relative">
                        {stepLabels.map((label, i) => {
                            const n = i + 1;
                            const done = step > n;
                            const active = step === n;
                            return (
                                <div key={n} className="flex-1 flex flex-col items-center gap-1 z-10">
                                    <button
                                        type="button"
                                        disabled={n > step}
                                        onClick={() => {
                                            if (n < step) { setDirection('back'); setStep(n); }
                                            if (n === 2 && step === 1) { handleNextStep1(); }
                                        }}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${done ? 'bg-teal-500 text-white ring-2 ring-teal-200' : active ? 'bg-teal-700 text-white ring-4 ring-teal-200 scale-110' : 'bg-stone-100 text-stone-400'}`}
                                    >
                                        {done ? '✓' : n}
                                    </button>
                                    <span className={`text-xs font-medium hidden sm:block ${active ? 'text-teal-700' : done ? 'text-teal-500' : 'text-stone-400'}`}>{label}</span>
                                </div>
                            );
                        })}
                        {/* Connecting lines */}
                        <div className="absolute top-[13px] left-[16.6%] right-[16.6%] h-0.5 bg-stone-200 z-0 hidden sm:block" />
                        <div className={`absolute top-[13px] left-[16.6%] h-0.5 bg-teal-400 z-0 transition-all duration-300 hidden sm:block`} style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }} />
                    </div>
                </div>

                {/* Step Content */}
                <div className={`px-5 pb-3 transition-all duration-300 ${direction === 'forward' ? 'animate-in slide-in-from-right-4' : 'animate-in slide-in-from-left-4'}`} key={step}>
                    
                    {/* ===== STEP 1: What happened? ===== */}
                    {step === 1 && (
                        <div className="space-y-4">
                            {/* When the wizard is opened with a known intent (from VisitIntentCard) we
                                replace the picker with explanatory copy that varies by record type
                                and (for adoption/request) the adopter's rating bucket. Manual-open
                                paths (no `initialRecordType`) keep the full chip grid below. */}
                            {initialRecordType ? (
                                <RecordTypeGuidance
                                    recordType={formData.recordType as 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet'}
                                    adopterName={adopterName}
                                    avgRating={avgRating}
                                    tooManyAdoptions={tooManyAdoptions}
                                    tooManyRequests={tooManyRequests}
                                />
                            ) : (
                                <div>
                                    <label className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider">{t('adoption.record_type')}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {RECORD_TYPES.map(type => {
                                            const colors = getRecordTypeColors(type.value);
                                            const sel = formData.recordType === type.value;
                                            return (
                                                <button key={type.value} type="button" onClick={() => setFormData(d => ({ ...d, recordType: type.value }))}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${sel ? `${colors.bg} ${colors.border} ${colors.text} shadow-sm` : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                                                    <span>{type.icon}</span><span>{t(type.labelKey as any)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {showModeSwitcher && (
                                <div className="flex gap-2 p-1 bg-teal-50 rounded-lg">
                                    <button type="button" onClick={() => setMode('existing')} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${effectiveMode === 'existing' ? 'bg-white text-teal-700 shadow-sm' : 'text-teal-600 hover:text-teal-800'}`}>
                                        {t('adoption.select_existing')} ({effectiveAnimalsList.length})
                                    </button>
                                    <button type="button" onClick={() => { setMode('new'); setFormData(d => ({ ...d, animalId: '', animalName: '', species: 'cat' })); }} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${effectiveMode === 'new' ? 'bg-white text-teal-700 shadow-sm' : 'text-teal-600 hover:text-teal-800'}`}>
                                        {t('adoption.create_new')}
                                    </button>
                                </div>
                            )}

                            {isObservation && (
                                <div className="text-sm text-stone-600 italic bg-teal-50/50 border border-teal-100 rounded-lg p-3">
                                    👁️ {t('wizard.observation_no_animal_hint')}
                                </div>
                            )}

                            {!isObservation && !isRequest && effectiveMode === 'existing' && (
                                <div>
                                    <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">
                                        {isFollowUpOrReturn ? t('adoption.previous_adoption_picker_label') : t('adoption.select_animal')}
                                    </label>
                                    <select className="w-full h-10 pl-4 pr-10 rounded-lg border border-teal-200 bg-teal-50 text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-base md:text-sm" onChange={(e) => handleSelectExisting(e.target.value)} value={formData.animalId || ''}>
                                        <option value="">{t('adoption.choose_animal')}</option>
                                        {effectiveAnimalsList.map(a => {
                                            const dateLabel = isFollowUpOrReturn && a.date ? ` — ${formatShortDate(a.date)}` : '';
                                            return (
                                                <option key={a.id} value={a.id}>{a.animalName} ({a.species}){dateLabel}</option>
                                            );
                                        })}
                                    </select>
                                </div>
                            )}

                            {!isObservation && effectiveMode === 'new' && (
                                <div className={`grid gap-4 ${isRequest ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                                    {!isRequest && (
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="block text-xs font-semibold text-teal-800 uppercase tracking-wider">{t('adoption.animal_name')}</label>
                                                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                                    <span className="text-stone-500">{t('common.unknown')}</span>
                                                    <button type="button" onClick={() => { setUnknownAnimal(!unknownAnimal); if (!unknownAnimal) setFormData(d => ({ ...d, animalName: '' })); }} className={`relative w-9 h-5 rounded-full transition-colors ${unknownAnimal ? 'bg-amber-500' : 'bg-stone-200'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${unknownAnimal ? 'translate-x-4' : 'translate-x-0'}`} />
                                                    </button>
                                                </label>
                                            </div>
                                            <input required={!unknownAnimal} disabled={unknownAnimal} className={`w-full h-10 px-4 rounded-lg border border-teal-200 text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm ${unknownAnimal ? 'bg-stone-100 text-stone-500 cursor-not-allowed' : 'bg-white'}`} value={unknownAnimal ? '' : formData.animalName} onChange={e => setFormData(d => ({ ...d, animalName: e.target.value }))} placeholder={unknownAnimal ? (t('adoption.unknown_animal')) : t('adoption.animal_placeholder')} />
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.species')}</label>
                                        {customSpecies ? (
                                            <div className="flex gap-2">
                                                <input required autoFocus className="flex-1 h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-base md:text-sm" value={formData.species} onChange={e => setFormData(d => ({ ...d, species: e.target.value }))} placeholder={t('adoption.species_other_placeholder')} />
                                                <button type="button" onClick={() => { setCustomSpecies(false); setFormData(d => ({ ...d, species: 'cat' })); }} className="px-3 h-10 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-xs font-medium hover:bg-teal-100 transition-colors whitespace-nowrap" title={t('adoption.species_select_preset')}>↩ {t('adoption.species_presets')}</button>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <select required className="w-full h-10 pl-4 pr-10 rounded-lg border border-teal-200 bg-white text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-base md:text-sm" value={formData.species.toLowerCase() || 'cat'} onChange={e => { if (e.target.value === '_other') { setCustomSpecies(true); setFormData(d => ({ ...d, species: '' })); } else { setFormData(d => ({ ...d, species: e.target.value })); } }}>
                                                    <option value="cat">{t('species.cat')} 🐱</option>
                                                    <option value="dog">{t('species.dog')} 🐶</option>
                                                    <option value="bird">{t('species.bird')} 🐦</option>
                                                    <option value="_other">{t('species.other')}</option>
                                                </select>
                                                <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-teal-700">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center pt-4 border-t border-teal-100/50">
                                <button type="button" onClick={() => { setIsOpen(false); onClose?.(); }} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">{t('common.cancel')}</button>
                                <button type="button" onClick={handleNextStep1} className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 transition-all">{t('wizard.next')} →</button>
                            </div>
                        </div>
                    )}

                    {/* ===== STEP 2: Details ===== */}
                    {step === 2 && (
                        <div className="space-y-4">
                            {showDualDate && (
                                <div className="text-xs text-teal-800 bg-teal-50/70 border border-teal-100 rounded-lg p-2.5">
                                    {t('adoption.dual_date_hint')}
                                </div>
                            )}

                            {showDualDate && (
                                <div>
                                    <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.adoption_date')}</label>
                                    <DatePicker value={formData.adoptionDate} onChange={date => setFormData(d => ({ ...d, adoptionDate: date }))} maxDate={new Date().toISOString().split('T')[0]} dayOptional />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">
                                    {formData.recordType === 'follow_up'
                                        ? t('adoption.followup_event_date')
                                        : formData.recordType === 'returned_pet'
                                            ? t('adoption.return_event_date')
                                            : t('adoption.date')}
                                </label>
                                <DatePicker value={formData.date} onChange={date => setFormData(d => ({ ...d, date }))} maxDate={new Date().toISOString().split('T')[0]} dayOptional />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.rating')}</label>
                                <StarRating value={formData.rating} onChange={(r) => setFormData(d => ({ ...d, rating: r }))} size="lg" showLabel={true} />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.notes')}</label>
                                <textarea className="w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-none text-base md:text-sm" rows={3} value={formData.details} onChange={e => setFormData(d => ({ ...d, details: e.target.value }))} placeholder={t('adoption.notes_placeholder')} />
                            </div>

                            {/* Conditional Delivery / Verification Toggles */}
                            {formData.recordType === 'adoption' && (
                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">🚗</span>
                                            <label className="text-sm font-medium text-blue-800">{t('adoption.delivered_to_home')}</label>
                                        </div>
                                        <button type="button" onClick={() => { const nd = !formData.deliveredToHome; setFormData(d => ({ ...d, deliveredToHome: nd, verifiedAddress: nd ? (d.verifiedAddress || extractAddressFromContact(adopterAddress)) : '' })); }} className={`relative w-12 h-6 rounded-full transition-colors ${formData.deliveredToHome ? 'bg-blue-500' : 'bg-stone-200'}`}>
                                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.deliveredToHome ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                    {formData.deliveredToHome && (
                                        <div className="mt-4 pt-4 border-t border-blue-100">
                                            <label className="block text-xs font-semibold text-blue-800 mb-1.5 uppercase tracking-wider flex items-center gap-1"><span>📍</span> {t('adoption.verify_address')}</label>
                                            <textarea className="w-full p-3 rounded-lg border border-blue-200 bg-white text-blue-950 placeholder-blue-800/40 font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none resize-none text-base md:text-sm" rows={2} value={formData.verifiedAddress} onChange={e => setFormData(d => ({ ...d, verifiedAddress: e.target.value }))} placeholder={t('adoption.address_placeholder')} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {(formData.recordType === 'adoption' || formData.recordType === 'follow_up') && (
                                <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">🪪</span>
                                            <label className="text-sm font-medium text-teal-800">{t('adoption.identity_verified')}</label>
                                        </div>
                                        <button type="button" onClick={() => setFormData(d => ({ ...d, identityVerified: !d.identityVerified }))} className={`relative w-12 h-6 rounded-full transition-colors ${formData.identityVerified ? 'bg-teal-500' : 'bg-stone-200'}`}>
                                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.identityVerified ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center pt-4 border-t border-teal-100/50">
                                <button type="button" onClick={goBack} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">← {t('wizard.back')}</button>
                                <button type="button" onClick={goNext} className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 transition-all">{t('wizard.next')} →</button>
                            </div>
                        </div>
                    )}

                    {/* ===== STEP 3: Evidence & Save ===== */}
                    {step === 3 && (
                        <div className="space-y-4">
                            {/* Summary Card Preview */}
                            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
                                <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Resumen</h4>
                                <div className="flex gap-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${getRecordTypeColors(formData.recordType).iconBg}`}>
                                        {getRecordTypeIcon(formData.recordType)}
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-stone-800">
                                            {formData.animalName || (unknownAnimal ? 'Unknown' : formData.species)}
                                            <span className="mx-2 text-stone-300">|</span>
                                            {formatShortDate(new Date(formData.date))}
                                        </p>
                                        <div className="mt-1 flex items-center gap-2">
                                            <StarRating value={formData.rating} size="sm" />
                                            {formData.deliveredToHome && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">🚗 Delivered</span>}
                                            {formData.identityVerified && <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">🪪 ID</span>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 bg-teal-50 rounded-lg border border-teal-100/50">
                                <label className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    {t('adopter.upload_media')}
                                </label>

                                {pendingImages.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {pendingImages.map((pending, idx) => (
                                            <div key={idx} className="relative group">
                                                {pending.isVideo ? (
                                                    <div className="w-20 h-20 rounded-lg border border-amber-300 ring-2 ring-amber-200 overflow-hidden relative">
                                                        {pending.thumbnail ? <img src={pending.thumbnail} alt={t('common.video_thumbnail_alt')} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-800" />}
                                                    </div>
                                                ) : (
                                                    <img src={pending.data} alt={`Pending photo ${idx + 1}`} className="w-20 h-20 object-cover rounded-lg border border-amber-300 ring-2 ring-amber-200" />
                                                )}
                                                <button type="button" onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-semibold md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center shadow">×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center gap-3">
                                    <label className={`px-4 py-2 bg-white border border-teal-200 text-teal-700 rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {uploading ? t('adopter.uploading') : t('common.add_media')}
                                        <input type="file" accept="image/*,video/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                                    </label>
                                    <span className="text-xs text-teal-700">{pendingImages.length} {t('common.files_attached')}</span>
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-4 border-t border-teal-100/50">
                                <button type="button" onClick={goBack} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">← {t('wizard.back')}</button>
                                <button type="button" disabled={loading} onClick={handleSubmit} className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all flex items-center gap-2">
                                    {loading ? t('adoption.saving') : (
                                        <>💾 {t('wizard.save_record')}</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
