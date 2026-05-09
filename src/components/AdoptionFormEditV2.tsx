'use client';

import { useState, useEffect } from 'react';
import { saveAdoption, getAdoptionImages, deleteImage } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { getRecordTypeColors } from '@/lib/recordTypeColors';
import { StarRating } from '@/components/StarRating';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { MediaLightbox, isVideo as isVideoItem } from '@/components/ui/MediaLightbox';
import type { MediaItem } from '@/components/ui/MediaLightbox';
import { formatShortDate } from '@/lib/dates';
import { formatAge } from '@/lib/ageUtils';
import DatePicker from '@/components/ui/DatePicker';
import { extractVideoThumbnail } from '@/lib/videoThumbnail';
import { zarazTrack } from '@/lib/zaraz';

/** Convert a data URL to a Blob for FormData upload */
function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/** Proxy R2 URLs through the same-origin proxy to avoid CORS/accessibility issues */
function proxyR2Url(url: string): string {
    if (!url) return '';
    if (url.includes('r2.dev')) return `/api/proxy-image?url=${encodeURIComponent(url)}`;
    return url;
}

// Extract address-like lines from freeform contact text
function extractAddressFromContact(contactText: string): string {
    if (!contactText) return '';
    const lines = contactText.split('\n');
    const addressKeywords = /^(address|direcci[oó]n|domicilio|calle|av\.|avenida|blvd|colonia|c\.p\.|cp|barrio)\s*:?/i;
    const addressPatterns = /\b(\d+\s+[A-Z][a-z].*(?:st|ave|blvd|dr|rd|ln|ct|way|street|avenue|drive|road))|(?:c\.p\.?|cp)\s*\d{4,5}/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (addressKeywords.test(trimmed)) {
            return trimmed.replace(/^(direcci[oó]n\s*\/\s*address|address|direcci[oó]n|domicilio)\s*:?\s*/i, '');
        }
        if (addressPatterns.test(trimmed) && !trimmed.match(/^(phones?|emails?|socials?)\s*:/i)) {
            return trimmed;
        }
    }
    return '';
}

export default function AdoptionFormEditV2({ adopterId, initialData, onCancel, onSuccess, onDelete, availableAnimals = [], adopterAdoptions = [], currentUser, adopterAddress = '' }: { adopterId: string, /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ initialData?: any, onCancel?: () => void, onSuccess?: () => void, onDelete?: () => void, /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ availableAnimals?: any[], /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ adopterAdoptions?: any[], currentUser?: string, adopterAddress?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t, locale } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    // Check if we should auto-open the form with prefilled animal data (from new adopter flow)
    const newAdoptionParam = searchParams.get('newAdoption');
    const continueToAdoption = searchParams.get('continueToAdoption') === 'true';
    const shouldOpenFromWizard = !!newAdoptionParam || continueToAdoption;
    const prefillAnimalName = searchParams.get('animalName') || '';
    const prefillSpecies = searchParams.get('species') || 'cat';
    // Support newAdoption=observation to preselect observation type
    const prefillRecordType = newAdoptionParam === 'observation' ? 'observation' : (initialData?.recordType || 'adoption');
    // Read rating and details from URL (from observation wizard)
    const prefillRating = searchParams.get('rating');
    const prefillDetails = searchParams.get('details') || '';
    const prefillDate = searchParams.get('date') || '';

    const [isOpen, setIsOpen] = useState(!!initialData || shouldOpenFromWizard);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [adoptionImages, setAdoptionImages] = useState<any[]>([]);
    const [pendingImages, setPendingImages] = useState<Array<{ data: string; file?: File; isVideo: boolean; thumbnail?: string }>>([]);
    const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
    const [unknownAnimal, setUnknownAnimal] = useState(!initialData?.animalName && initialData?.id ? true : false);
    const [customSpecies, setCustomSpecies] = useState(() => {
        // Check if initial species is not a preset
        const presets = ['cat', 'dog', 'bird', ''];
        const speciesValue = initialData?.species || prefillSpecies;
        return speciesValue && !presets.includes(speciesValue.toLowerCase());
    });

    // New Feature State: "existing" or "new"
    // If wizard prefilled animal data, default to 'new' — the choice was already made
    const [mode, setMode] = useState<'existing' | 'new'>(shouldOpenFromWizard ? 'new' : 'existing');

    const [formData, setFormData] = useState({
        id: initialData?.id,
        animalName: initialData?.animalName || prefillAnimalName,
        details: initialData?.details || prefillDetails,
        status: initialData?.status || 'completed',
        rating: initialData?.rating || (prefillRating ? Number(prefillRating) : 5),
        comments: initialData?.comments || '',
        species: initialData?.species || prefillSpecies,
        adopterId: initialData?.adopterId || adopterId,
        recordType: prefillRecordType,
        date: initialData?.date ? new Date(initialData.date).toISOString().split('T')[0] : (prefillDate || ''),

        deliveredToHome: initialData?.deliveredToHome || false,
        verifiedAddress: initialData?.verifiedAddress || '',
        identityVerified: initialData?.identityVerified || false
    });

    // Set default date on client to avoid SSR hydration mismatch
    useEffect(() => {
        if (!formData.date) {
            setFormData(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update form data when initialData changes
    if (initialData && formData.id !== initialData.id) {
        setFormData({
            id: initialData.id,
            animalName: initialData.animalName || '',
            details: initialData.details || '',
            status: initialData.status || 'completed',
            rating: initialData.rating || 5,
            comments: initialData.comments || '',
            species: initialData.species || '',
            adopterId: initialData.adopterId || adopterId,
            recordType: initialData.recordType || 'adoption',
            date: initialData.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            deliveredToHome: initialData.deliveredToHome || false,
            verifiedAddress: initialData.verifiedAddress || '',
            identityVerified: initialData.identityVerified || false
        });
        setIsOpen(true);
        setMode('new');
    }

    // Fetch images linked to this adoption
    useEffect(() => {
        if (formData.id) {
            getAdoptionImages(formData.id).then(setAdoptionImages);
        } else {
            setAdoptionImages([]);
        }
    }, [formData.id]);

    // Auto-scroll to adoption form when coming from new adopter flow or observation flow
    useEffect(() => {
        if (shouldOpenFromWizard) {
            // Small delay to ensure the form is rendered
            setTimeout(() => {
                const formElement = document.getElementById('adoption-form-section');
                if (formElement) {
                    formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    }, [shouldOpenFromWizard]);

    // Clear animal fields when user switches to observation type so saved record
    // doesn't carry over animalName/species from a previously-selected adoption type.
    useEffect(() => {
        if (formData.recordType === 'observation' && (formData.animalName || formData.species)) {
            setFormData(prev => ({ ...prev, animalName: '', species: '' }));
            setUnknownAnimal(false);
            setCustomSpecies(false);
        }
    }, [formData.recordType, formData.animalName, formData.species]);

    const handleSelectExisting = (animalId: string) => {
        if (!animalId) return;
        const animal = effectiveAnimalsList.find(a => a.id === animalId);
        if (animal) {
            setFormData({
                ...formData,
                // For follow_up / returned_pet, the picked row is a *prior
                // adoption* — never overwrite that row; keep this record's id.
                id: isFollowUpOrReturn ? formData.id : animal.id,
                animalName: animal.animalName,
                species: animal.species,
                details: isFollowUpOrReturn ? formData.details : (animal.details || ''),
                status: isFollowUpOrReturn ? formData.status : 'completed',
                rating: isFollowUpOrReturn ? formData.rating : 5,
                adopterId: adopterId
            });
        }
    }

    // Helper to compress image
    const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { reject(new Error('Canvas context failed')); return; }
                    const maxSize = 1200;
                    let width = img.width;
                    let height = img.height;
                    if (width > height) { if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; } }
                    else { if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; } }
                    canvas.width = width; canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isVideoFile = file.type.startsWith('video/');

        // Validate file type
        if (!file.type.startsWith('image/') && !isVideoFile) {
            toast.error(t('toast.invalid_file_title'), t('errors.upload_invalid_file'));
            return;
        }

        // Video size limit: 50MB
        if (isVideoFile && file.size > 50 * 1024 * 1024) {
            toast.warning(t('toast.video_too_large_title'), t('errors.upload_video_too_large'));
            return;
        }

        // Reset file input so same file can be re-selected
        e.target.value = '';

        setUploading(true);
        try {
            if (isVideoFile) {
                // Generate thumbnail
                let thumbnail: string | undefined;
                try {
                    thumbnail = await extractVideoThumbnail(file);
                    console.log(`[AdoptionForm] Thumbnail generated: ${thumbnail ? `${thumbnail.length} chars` : 'none'}`);
                } catch (e) {
                    console.warn('Thumbnail extraction failed:', (e as Error).message);
                }

                if (formData.id) {
                    // Record already saved — upload video via FormData
                    const fd = new FormData();
                    fd.append('file', file);
                    fd.append('adopterId', adopterId);
                    fd.append('adoptionId', formData.id);
                    fd.append('caption', `Video for ${formData.animalName}`);
                    fd.append('mediaType', 'video');
                    if (thumbnail) {
                        fd.append('thumbnail', dataUrlToBlob(thumbnail), 'thumb.jpg');
                        console.log(`[AdoptionForm] Appended thumbnail as File blob`);
                    }
                    const res = await fetch('/api/upload-media', { method: 'POST', body: fd });
                    const result = await res.json() as { error?: string };
                    if (!res.ok) throw new Error(result.error || 'Upload failed');
                    const updatedImages = await getAdoptionImages(formData.id);
                    setAdoptionImages(updatedImages);
                } else {
                    // Record not yet saved — queue the File object
                    setPendingImages(prev => [...prev, { data: '', file, isVideo: true, thumbnail }]);
                }
            } else {
                const base64 = await compressImage(file);
                if (formData.id) {
                    const { saveImage } = await import('@/app/actions');
                    await saveImage(adopterId, base64, `Photo for ${formData.animalName}`, formData.id, 'image');
                    const updatedImages = await getAdoptionImages(formData.id);
                    setAdoptionImages(updatedImages);
                } else {
                    setPendingImages(prev => [...prev, { data: base64, isVideo: false }]);
                }
            }
        } catch (error) {
            console.error('Upload error:', error instanceof Error ? error.message : error);
            toast.error(t('toast.upload_failed_title'), t('errors.upload_failed'), extractErrorId(error));
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const isAuthenticated = (currentUser && currentUser !== '') || !!session?.user;
        if (!isAuthenticated) { openLogin(); return; }

        setLoading(true);
        try {
            // Parse date as local noon to avoid timezone issues (UTC midnight can shift to previous day)
            const dateParts = formData.date.split('-').map(Number);
            const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2] || 1, 12, 0, 0);

            const result = await saveAdoption({
                ...formData,
                adopterId: adopterId,
                rating: Number(formData.rating),
                date: localDate,
                onBehalfOf: null,
                deliveredToHome: formData.deliveredToHome ? 1 : 0,
                verifiedAddress: formData.verifiedAddress || null,
                identityVerified: formData.identityVerified ? 1 : 0
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            // Upload any pending media concurrently now that we have the adoption ID
            if (pendingImages.length > 0 && result?.id) {
                const uploadPromises = pendingImages.map(async (pending) => {
                    if (pending.isVideo && pending.file) {
                        const fd = new FormData();
                        fd.append('file', pending.file);
                        fd.append('adopterId', adopterId);
                        fd.append('adoptionId', result.id);
                        fd.append('caption', `Video for ${formData.animalName}`);
                        fd.append('mediaType', 'video');
                        if (pending.thumbnail) fd.append('thumbnail', dataUrlToBlob(pending.thumbnail), 'thumb.jpg');
                        return fetch('/api/upload-media', { method: 'POST', body: fd });
                    } else {
                        const { saveImage } = await import('@/app/actions');
                        return saveImage(adopterId, pending.data, `Photo for ${formData.animalName}`, result.id, 'image');
                    }
                });
                await Promise.all(uploadPromises);
                setPendingImages([]);
            }

            // Track adoption event in Amplitude via Zaraz
            zarazTrack('adoption_created', {
                species: formData.species,
                recordType: formData.recordType,
                rating: Number(formData.rating),
                hasMedia: (pendingImages.length + adoptionImages.length) > 0 ? 1 : 0,
            });

            if (onSuccess) onSuccess();
            else {
                setIsOpen(false);
                setFormData({ id: undefined, animalName: '', details: '', status: 'completed', rating: 5, comments: '', species: '', adopterId, recordType: 'adoption', date: new Date().toISOString().split('T')[0], deliveredToHome: false, verifiedAddress: '', identityVerified: false });
                setPendingImages([]);
                await new Promise(resolve => setTimeout(resolve, 100));
                router.refresh();
            }
        } catch (err) {
            console.error(err);
            toast.error(t('errors.generic'), t('errors.save_adoption_failed'), extractErrorId(err));
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        if (onCancel) onCancel();
        else setIsOpen(false);
    }

    if (!isOpen && !initialData) {
        return (
            <button onClick={() => {
                const isAuthenticated = (currentUser && currentUser !== '') || !!session?.user;
                if (!isAuthenticated) { openLogin(); return; }
                setIsOpen(true);
            }} className="flex items-center gap-1.5 ml-auto py-2 px-4 text-sm text-teal-700 font-semibold rounded-lg hover:bg-teal-50 transition-all duration-200 mb-4">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {t('adoption.record_new')}
            </button>
        )
    }

    const isObservation = formData.recordType === 'observation';
    const isFollowUpOrReturn = formData.recordType === 'follow_up' || formData.recordType === 'returned_pet';

    // Defensive: ensure all arrays are actually arrays (guards against undefined from any source)
    const safeAdoptionImages = Array.isArray(adoptionImages) ? adoptionImages : [];
    const safePendingImages = Array.isArray(pendingImages) ? pendingImages : [];
    const safeAvailableAnimals = Array.isArray(availableAnimals) ? availableAnimals : [];
    const safeAdopterAdoptions = Array.isArray(adopterAdoptions) ? adopterAdoptions : [];

    // For follow_up / returned_pet, source the picker from past adoption rows
    // for *this* adopter (animals already placed with them), not the rescuer's
    // unlinked inventory. Skip the record being edited so users don't pick it
    // as its own parent.
    const previousAdoptionsForAdopter = isFollowUpOrReturn
        ? safeAdopterAdoptions.filter(a => a && a.recordType === 'adoption' && a.animalName && a.id !== initialData?.id)
        : [];
    const effectiveAnimalsList = isFollowUpOrReturn ? previousAdoptionsForAdopter : safeAvailableAnimals;

    // Hide switcher when wizard already made the new/existing choice (newAdoptionParam or continueToAdoption)
    // and always for observation records (no animal involved).
    const showModeSwitcher = !initialData && !shouldOpenFromWizard && effectiveAnimalsList.length > 0 && !isObservation;
    const effectiveMode = showModeSwitcher ? mode : 'new';

    return (
        <>
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
            <div id="adoption-form-section" className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-white p-5 rounded-xl border-2 border-teal-400/50 shadow-lg relative ring-4 ring-teal-50/50">
                <h3 className="text-lg font-semibold mb-4 text-teal-900 tracking-tight flex items-center gap-2">
                    <div className="p-1.5 bg-teal-100 rounded-lg text-teal-700">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={initialData ? "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" : "M12 4v16m8-8H4"} /></svg>
                    </div>
                    {initialData ? (t('adoption.record_edit') || 'Edit Adoption') : t('adoption.record_new')}
                </h3>

                {showModeSwitcher && (
                    <div className="flex gap-2 mb-4 p-1 bg-teal-50 rounded-lg">
                        <button type="button" onClick={() => setMode('existing')} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${effectiveMode === 'existing' ? 'bg-white text-teal-700 shadow-sm' : 'text-teal-700 hover:text-teal-800'}`}>{t('adoption.select_existing') || 'Select Existing'} ({effectiveAnimalsList.length})</button>
                        <button type="button" onClick={() => { setMode('new'); setFormData(prev => ({ ...prev, id: undefined, animalName: '', species: '', details: '', status: 'completed', rating: 5, recordType: 'adoption' })); }} className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${effectiveMode === 'new' ? 'bg-white text-teal-700 shadow-sm' : 'text-teal-700 hover:text-teal-800'}`}>{t('adoption.create_new') || 'Create New'}</button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    {!isObservation && effectiveMode === 'existing' && (
                        <div className="mb-4">
                            <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">
                                {isFollowUpOrReturn ? (t('adoption.previous_adoption_picker_label') || 'Animal already adopted') : (t('adoption.select_animal') || 'Select Animal')}
                            </label>
                            <select className="w-full h-10 pl-4 pr-10 rounded-lg border border-teal-200 bg-teal-50 text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-base md:text-sm" onChange={(e) => handleSelectExisting(e.target.value)} value={formData.id || ''}>
                                <option value="">{t('adoption.choose_animal') || '-- Choose an animal --'}</option>
                                {effectiveAnimalsList.map(a => (<option key={a.id} value={a.id}>{a.animalName} ({a.species}){a.date ? ` — ${formatShortDate(new Date(a.date))}` : ''}</option>))}
                            </select>
                        </div>
                    )}

                    {/* Block 1: Core Details — animal inputs hidden for observations */}
                    <div className="space-y-4" style={isObservation ? { display: 'none' } : undefined}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-semibold text-teal-800 uppercase tracking-wider">
                                        {t('adoption.animal_name')}
                                    </label>
                                    {!initialData?.animalName && (
                                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                            <span className="text-stone-500">{t('common.unknown') || 'Unknown'}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setUnknownAnimal(!unknownAnimal);
                                                    if (!unknownAnimal) {
                                                        setFormData({ ...formData, animalName: '' });
                                                    }
                                                }}
                                                className={`relative w-9 h-5 rounded-full transition-colors ${unknownAnimal ? 'bg-amber-500' : 'bg-stone-200'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${unknownAnimal ? 'translate-x-4' : 'translate-x-0'}`} />
                                            </button>
                                        </label>
                                    )}
                                </div>
                                <input
                                    required={!unknownAnimal && !isObservation}
                                    disabled={unknownAnimal || isObservation}
                                    className={`w-full h-10 px-4 rounded-lg border border-teal-200 text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-sm ${unknownAnimal ? 'bg-stone-100 text-stone-500 cursor-not-allowed' : 'bg-white'}`}
                                    value={unknownAnimal ? '' : formData.animalName}
                                    onChange={e => setFormData({ ...formData, animalName: e.target.value })}
                                    placeholder={unknownAnimal ? (t('adoption.unknown_animal') || 'Unknown animal') : t('adoption.animal_placeholder')}
                                />
                            </div>

                        <div>
                            <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">
                                {t('adoption.species')}
                            </label>
                            {customSpecies ? (
                                <div className="flex gap-2">
                                    <input
                                        required={!isObservation}
                                        autoFocus
                                        className="flex-1 h-10 px-4 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-sm"
                                        value={formData.species}
                                        onChange={e => setFormData({ ...formData, species: e.target.value })}
                                        placeholder={t('adoption.species_other_placeholder') || 'Enter species...'}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomSpecies(false);
                                            setFormData({ ...formData, species: 'cat' });
                                        }}
                                        className="px-3 h-10 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-xs font-medium hover:bg-teal-100 transition-colors whitespace-nowrap"
                                        title={t('adoption.species_select_preset') || 'Select preset'}
                                    >
                                        ↩ {t('adoption.species_presets') || 'Presets'}
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <select
                                        required={!isObservation}
                                        className="w-full h-10 pl-4 pr-10 rounded-lg border border-teal-200 bg-white text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-base md:text-sm"
                                        value={formData.species.toLowerCase() || 'cat'}
                                        onChange={e => {
                                            if (e.target.value === '_other') {
                                                setCustomSpecies(true);
                                                setFormData({ ...formData, species: '' });
                                            } else {
                                                setFormData({ ...formData, species: e.target.value });
                                            }
                                        }}
                                    >
                                        <option value="cat">{t('species.cat') || 'Cat'} 🐱</option>
                                        <option value="dog">{t('species.dog') || 'Dog'} 🐶</option>
                                        <option value="bird">{t('species.bird') || 'Bird'} 🐦</option>
                                        <option value="_other">{t('species.other') || 'Other...'}</option>
                                    </select>
                                    <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-teal-700">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Animal details (read-only context when editing) */}
                    {initialData && (initialData.estimatedBirthDate || initialData.age || initialData.sex || initialData.color || initialData.microchip || initialData.neutered != null) && (
                        <div>
                            <p className="text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wider">{t('adoption.animal_info') || 'Animal Info'}</p>
                            <div className="flex flex-wrap gap-1.5">
                            {initialData.sex && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                    {['male', 'macho'].includes(initialData.sex.toLowerCase()) ? '♂️' : ['female', 'hembra'].includes(initialData.sex.toLowerCase()) ? '♀️' : ''} {t(`adoption.sex_${initialData.sex.toLowerCase()}`) || initialData.sex}
                                </span>
                            )}
                            {(initialData.estimatedBirthDate || initialData.age) && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                    🎂 {initialData.estimatedBirthDate
                                        ? formatAge(initialData.estimatedBirthDate, locale as 'es' | 'en')
                                        : initialData.age}
                                </span>
                            )}
                            {initialData.neutered === 1 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                    ✓ {t('adoption.neutered') || 'Neutered'}
                                </span>
                            )}
                            {initialData.neutered === 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-500">
                                    ✗ {t('adoption.neutered_no_label') || 'Not neutered'}
                                </span>
                            )}
                            {initialData.color && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                    🎨 {initialData.color}
                                </span>
                            )}
                            {initialData.microchip && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                    💉 {initialData.microchip}
                                </span>
                            )}
                            </div>
                        </div>
                    )}
                    </div>
                    {/* End of Block 1 — animal-specific fields hidden for observations */}

                    {/* Contract screenshot link */}
                    {initialData?.comments && (() => {
                        try {
                            const parsed = JSON.parse(initialData.comments);
                            if (parsed.contractScreenshot) {
                                return (
                                    <a
                                        href={parsed.contractScreenshot}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 p-2 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                                    >
                                        <span className="text-sm">📋</span>
                                        <span className="text-sm font-medium text-teal-700">{t('dashboard.view_signed_contract') || 'View Signed Contract'}</span>
                                        <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                    </a>
                                );
                            }
                        } catch { /* not JSON */ }
                        return null;
                    })()}

                    {/* Record type — read-only on edit. Changing the type after creation is rare
                        enough that we don't expose a switcher (mirrors the wizard's intent-driven
                        flow); if the user really mis-typed it, they can delete the record and
                        re-create. Kept as a colored badge so they still see what they're editing. */}
                    <div>
                        <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.record_type') || 'Record Type'}</label>
                        {(() => {
                            const types = [
                                { value: 'adoption', icon: '🏠', label: t('adoption.type_adoption') || 'Adoption' },
                                { value: 'adoption_request', icon: '📝', label: t('adoption.type_request') || 'Request' },
                                { value: 'observation', icon: '👁️', label: t('adoption.type_observation') || 'Note' },
                                { value: 'follow_up', icon: '📞', label: t('adoption.type_followup') || 'Follow-up' },
                                { value: 'returned_pet', icon: '↩️', label: t('adoption.type_returned') || 'Returned' },
                            ];
                            const selected = types.find(t => t.value === formData.recordType) || types[0];
                            const colors = getRecordTypeColors(selected.value);
                            return (
                                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${colors.bg} ${colors.border} ${colors.text}`}>
                                    <span>{selected.icon}</span><span>{selected.label}</span>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">
                            {t('adoption.date') || 'Date'}
                        </label>
                        <DatePicker
                            value={formData.date}
                            onChange={date => setFormData({ ...formData, date })}
                            maxDate={new Date().toISOString().split('T')[0]}
                            dayOptional
                        />
                    </div>

                    {/* Delivered to Home - Only for adoption record type */}
                    {formData.recordType === 'adoption' && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🚗</span>
                                    <label className="text-sm font-medium text-blue-800">
                                        {t('adoption.delivered_to_home') || 'Delivered to adopter\'s home?'}
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const newDelivered = !formData.deliveredToHome;
                                        setFormData({
                                            ...formData,
                                            deliveredToHome: newDelivered,
                                            verifiedAddress: newDelivered ? (formData.verifiedAddress || extractAddressFromContact(adopterAddress)) : ''
                                        });
                                    }}
                                    className={`relative w-12 h-6 rounded-full transition-colors ${formData.deliveredToHome ? 'bg-blue-500' : 'bg-stone-200'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.deliveredToHome ? 'translate-x-6' : 'translate-x-0'}`} />
                                </button>
                            </div>

                            {/* Address Verification Section */}
                            {formData.deliveredToHome && (
                                <div className="mt-4 pt-4 border-t border-blue-100">
                                    <label className="block text-xs font-semibold text-blue-800 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                                        <span>📍</span>
                                        {t('adoption.verify_address') || 'Verify Address'}
                                    </label>
                                    <textarea
                                        className="w-full p-3 rounded-lg border border-blue-200 bg-white text-blue-950 placeholder-blue-800/40 font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none resize-none text-base md:text-sm"
                                        rows={2}
                                        value={formData.verifiedAddress}
                                        onChange={e => setFormData({ ...formData, verifiedAddress: e.target.value })}
                                        placeholder={t('adoption.address_placeholder') || 'Enter or confirm the delivery address...'}
                                    />
                                    {formData.verifiedAddress && (
                                        <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            {t('adoption.address_will_be_verified') || 'Address will be verified on save'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Identity Verification Toggle */}
                    <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">🪪</span>
                                <label className="text-sm font-medium text-teal-800">
                                    {t('adoption.identity_verified') || 'Did you verify their identity?'}
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, identityVerified: !formData.identityVerified })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${formData.identityVerified ? 'bg-teal-500' : 'bg-stone-200'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.identityVerified ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        {formData.identityVerified && (
                            <p className="mt-2 text-xs text-teal-700">
                                {t('adoption.identity_verified_note') || 'This will mark the adopter profile as ID verified.'}
                            </p>
                        )}
                    </div>

                    {/* Rating only (Status hidden/inferred) */}
                    <div>
                        <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.rating')}</label>
                        <StarRating
                            value={formData.rating}
                            onChange={(r) => setFormData({ ...formData, rating: r })}
                            size="lg"
                            showLabel
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider">{t('adoption.notes')}</label>
                        <textarea className="w-full p-3 rounded-lg border border-teal-200 bg-white text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-none text-base md:text-sm" rows={3} value={formData.details} onChange={e => setFormData({ ...formData, details: e.target.value })} placeholder={t('adoption.notes_placeholder')} />
                    </div>

                    {/* Photo Upload */}
                    <div className="p-3 bg-teal-50 rounded-lg border border-teal-100/50">
                        <label className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            {t('adopter.upload_media') || 'Media'}
                        </label>

                        {/* Display existing adoption images (saved records) */}
                        {safeAdoptionImages.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {safeAdoptionImages.map((img) => {
                                    const imgIsVideo = isVideoItem({ url: img.url, mediaType: img.mediaType });
                                    return (
                                        <div key={img.id} className="relative group">
                                            {imgIsVideo ? (
                                                <div
                                                    className="w-20 h-20 rounded-lg border border-teal-200 cursor-pointer hover:border-teal-400 transition-colors overflow-hidden relative"
                                                    onClick={(e) => { e.preventDefault(); setLightboxItem({ url: img.url, caption: img.caption, mediaType: 'video', thumbnailUrl: img.thumbnailUrl }); }}
                                                >
                                                    {img.thumbnailUrl ? (
                                                        <img
                                                            src={proxyR2Url(img.thumbnailUrl)}
                                                            alt={img.caption || 'Video'}
                                                            className="w-full h-full object-cover"
                                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-800" />
                                                    )}
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <div className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center">
                                                            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <img
                                                    src={proxyR2Url(img.url)}
                                                    alt={img.caption || 'Adoption photo'}
                                                    className="w-20 h-20 object-cover rounded-lg border border-teal-200 cursor-pointer hover:border-teal-400 transition-colors"
                                                    onClick={(e) => { e.preventDefault(); setLightboxItem({ url: img.url, caption: img.caption, mediaType: 'image' }); }}
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!confirm(t('dialogs.confirm_delete_media'))) return;
                                                    try {
                                                        await deleteImage(img.id, adopterId);
                                                        setAdoptionImages(prev => prev.filter(i => i.id !== img.id));
                                                    } catch (e) {
                                                        toast.error(t('errors.generic'), t('errors.delete_media_failed'), extractErrorId(e));
                                                    }
                                                }}
                                                className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-semibold md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                                title={t('common.delete')}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Display pending images (not yet saved) */}
                        {safePendingImages.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {safePendingImages.map((pending, idx) => (
                                    <div key={idx} className="relative group">
                                        {pending.isVideo ? (
                                            <div className="w-20 h-20 rounded-lg border border-amber-300 ring-2 ring-amber-200 overflow-hidden relative">
                                                {pending.thumbnail ? (
                                                    <img src={pending.thumbnail} alt="Video thumbnail" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-800" />
                                                )}
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center">
                                                        <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <img
                                                src={pending.data}
                                                alt={`Pending photo ${idx + 1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-amber-300 ring-2 ring-amber-200"
                                            />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                            className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-semibold md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                            title={t('common.delete')}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                                <p className="w-full text-xs text-amber-600 mt-1">📎 {safePendingImages.length} file(s) will be uploaded when you save</p>
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <label className={`px-4 py-2 bg-white border border-teal-200 text-teal-700 rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                {uploading ? 'Uploading...' : (t('common.add_media') || '+ Add Media')}
                                <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => {
                                    // Yield to main thread immediately to ensure UI updates
                                    setUploading(true);
                                    setTimeout(() => handleImageUpload(e), 0);
                                }} disabled={uploading} />
                            </label>
                            <span className="text-xs text-teal-700">{safeAdoptionImages.length + safePendingImages.length} {t('common.files_attached') || 'file(s) attached'}</span>
                        </div>
                    </div>

                    {/* Sticky Bottom Actions Bar — pb adds safe-area inset on iOS so the bar
                        clears the home indicator and stays above the soft keyboard. */}
                    <div className="sticky bottom-4 left-0 right-0 z-20 mt-6 bg-white/80 backdrop-blur-xl border border-teal-200 shadow-xl shadow-teal-900/5 p-4 rounded-xl flex justify-between items-center" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                        {onDelete && initialData && (
                            <button type="button" onClick={onDelete} className="px-4 py-2 text-sm font-semibold text-stone-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title={t('common.delete')}>
                                {/* Trash Icon */}
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                        )}
                        <div className={`flex gap-3 ${(!onDelete || !initialData) ? 'w-full justify-end' : ''}`}>
                            <button type="button" onClick={handleCancel} className="px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">{t('common.cancel')}</button>
                            <button type="submit" disabled={loading || uploading} className="px-6 py-2 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-md shadow-teal-700/20 disabled:opacity-50 transition-all active:scale-95">{loading ? t('adoption.saving') : t('adoption.submit')}</button>
                        </div>
                    </div>
                </form>
            </div>
        </>
    );
}
