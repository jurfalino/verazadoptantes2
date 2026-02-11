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
import { formatShortDate } from '@/lib/dates';

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

export default function AdoptionForm({ adopterId, initialData, onCancel, onSuccess, onDelete, availableAnimals = [], currentUser, adopterAddress = '' }: { adopterId: string, initialData?: any, onCancel?: () => void, onSuccess?: () => void, onDelete?: () => void, availableAnimals?: any[], currentUser?: string, adopterAddress?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    // Check if we should auto-open the form with prefilled animal data (from new adopter flow)
    const newAdoptionParam = searchParams.get('newAdoption');
    const prefillAnimalName = searchParams.get('animalName') || '';
    const prefillSpecies = searchParams.get('species') || 'cat';
    // Support newAdoption=observation to preselect observation type
    const prefillRecordType = newAdoptionParam === 'observation' ? 'observation' : (initialData?.recordType || 'adoption');
    // Read rating and details from URL (from observation wizard)
    const prefillRating = searchParams.get('rating');
    const prefillDetails = searchParams.get('details') || '';

    const [isOpen, setIsOpen] = useState(!!initialData || !!newAdoptionParam);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [adoptionImages, setAdoptionImages] = useState<any[]>([]);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [unknownAnimal, setUnknownAnimal] = useState(!initialData?.animalName && initialData?.id ? true : false);
    const [customSpecies, setCustomSpecies] = useState(() => {
        // Check if initial species is not a preset
        const presets = ['cat', 'dog', 'bird', ''];
        const speciesValue = initialData?.species || prefillSpecies;
        return speciesValue && !presets.includes(speciesValue.toLowerCase());
    });

    // New Feature State: "existing" or "new"
    const [mode, setMode] = useState<'existing' | 'new'>('existing');

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
        date: initialData?.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        onBehalfOf: initialData?.onBehalfOf || '',
        deliveredToHome: initialData?.deliveredToHome || false,
        verifiedAddress: initialData?.verifiedAddress || '',
        identityVerified: initialData?.identityVerified || false
    });

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
            onBehalfOf: initialData.onBehalfOf || '',
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
        if (newAdoptionParam) {
            // Small delay to ensure the form is rendered
            setTimeout(() => {
                const formElement = document.getElementById('adoption-form-section');
                if (formElement) {
                    formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    }, [newAdoptionParam]);

    const handleSelectExisting = (animalId: string) => {
        if (!animalId) return;
        const animal = availableAnimals.find(a => a.id === animalId);
        if (animal) {
            setFormData({
                ...formData,
                id: animal.id,
                animalName: animal.animalName,
                species: animal.species,
                details: animal.details || '',
                status: 'completed',
                rating: 5,
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

        setUploading(true);
        try {
            const base64 = await compressImage(file);

            if (formData.id) {
                // Record already saved — upload immediately
                const { saveImage } = await import('@/app/actions');
                await saveImage(adopterId, base64, `Photo for ${formData.animalName}`, formData.id);
                const updatedImages = await getAdoptionImages(formData.id);
                setAdoptionImages(updatedImages);
            } else {
                // Record not yet saved — queue locally
                setPendingImages(prev => [...prev, base64]);
            }
        } catch (error) {
            console.error(error);
            toast.error('Upload Failed', 'Could not upload the image. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const isAuthenticated = (currentUser && currentUser !== '') || session?.user || document.cookie.includes('anon_user=true');
        if (!isAuthenticated) { openLogin(); return; }

        setLoading(true);
        try {
            // Parse date as local noon to avoid timezone issues (UTC midnight can shift to previous day)
            const [year, month, day] = formData.date.split('-').map(Number);
            const localDate = new Date(year, month - 1, day, 12, 0, 0);

            const result = await saveAdoption({
                ...formData,
                adopterId: adopterId,
                rating: Number(formData.rating),
                date: localDate,
                onBehalfOf: formData.onBehalfOf || null,
                deliveredToHome: formData.deliveredToHome ? 1 : 0,
                verifiedAddress: formData.verifiedAddress || null,
                identityVerified: formData.identityVerified ? 1 : 0
            } as any);

            // Upload any pending images now that we have the adoption ID
            if (pendingImages.length > 0 && result?.id) {
                const { saveImage } = await import('@/app/actions');
                for (const base64 of pendingImages) {
                    await saveImage(adopterId, base64, `Photo for ${formData.animalName}`, result.id);
                }
                setPendingImages([]);
            }

            if (onSuccess) onSuccess();
            else {
                setIsOpen(false);
                setFormData({ id: undefined, animalName: '', details: '', status: 'completed', rating: 5, comments: '', species: '', adopterId, recordType: 'adoption', date: new Date().toISOString().split('T')[0], onBehalfOf: '', deliveredToHome: false, verifiedAddress: '', identityVerified: false });
                setPendingImages([]);
                await new Promise(resolve => setTimeout(resolve, 100));
                router.refresh();
            }
        } catch (err) {
            console.error(err);
            toast.error('Error', 'Failed to save adoption record. Please try again.');
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
                const isAuthenticated = (currentUser && currentUser !== '') || session?.user || document.cookie.includes('anon_user=true');
                if (!isAuthenticated) { openLogin(); return; }
                setIsOpen(true);
            }} className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all duration-300 transform active:scale-[0.99] mb-4">
                + {t('adoption.record_new')}
            </button>
        )
    }

    const showModeSwitcher = !initialData && availableAnimals && availableAnimals.length > 0;
    const effectiveMode = showModeSwitcher ? mode : 'new';

    return (
        <div id="adoption-form-section" className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-white p-5 rounded-xl border-2 border-emerald-400/50 shadow-lg relative ring-4 ring-emerald-50/50">
            <h3 className="text-lg font-bold mb-4 text-emerald-900 tracking-tight flex items-center gap-2">
                <div className="p-1.5 bg-emerald-100 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={initialData ? "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" : "M12 4v16m8-8H4"} /></svg>
                </div>
                {initialData ? (t('adoption.record_edit') || 'Edit Adoption') : t('adoption.record_new')}
            </h3>

            {showModeSwitcher && (
                <div className="flex gap-2 mb-4 p-1 bg-emerald-50 rounded-lg">
                    <button type="button" onClick={() => setMode('existing')} className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${effectiveMode === 'existing' ? 'bg-white text-emerald-700 shadow-sm' : 'text-emerald-600/70 hover:text-emerald-800'}`}>Select Existing ({availableAnimals.length})</button>
                    <button type="button" onClick={() => { setMode('new'); setFormData(prev => ({ ...prev, id: undefined, animalName: '', species: '', details: '', status: 'completed', rating: 5, recordType: 'adoption' })); }} className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${effectiveMode === 'new' ? 'bg-white text-emerald-700 shadow-sm' : 'text-emerald-600/70 hover:text-emerald-800'}`}>Create New</button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {effectiveMode === 'existing' && (
                    <div className="mb-4">
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">Select Animal</label>
                        <select className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm" onChange={(e) => handleSelectExisting(e.target.value)} value={formData.id || ''}>
                            <option value="">-- Choose an animal --</option>
                            {availableAnimals.map(a => (<option key={a.id} value={a.id}>{a.animalName} ({a.species}) - {formatShortDate(new Date(a.date))}</option>))}
                        </select>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider">
                                {t('adoption.animal_name')}
                            </label>
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
                        </div>
                        <input
                            required={!unknownAnimal}
                            disabled={unknownAnimal}
                            className={`w-full h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm ${unknownAnimal ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-white'}`}
                            value={unknownAnimal ? '' : formData.animalName}
                            onChange={e => setFormData({ ...formData, animalName: e.target.value })}
                            placeholder={unknownAnimal ? (t('adoption.unknown_animal') || 'Unknown animal') : t('adoption.animal_placeholder')}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                            {t('adoption.species')}
                        </label>
                        {customSpecies ? (
                            <div className="flex gap-2">
                                <input
                                    required
                                    autoFocus
                                    className="flex-1 h-10 px-4 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
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
                                    className="px-3 h-10 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors whitespace-nowrap"
                                    title={t('adoption.species_select_preset') || 'Select preset'}
                                >
                                    ↩ {t('adoption.species_presets') || 'Presets'}
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <select
                                    required
                                    className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-white text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
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
                                <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-emerald-600">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.record_type') || 'Record Type'}</label>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { value: 'adoption', icon: '🏠', label: t('adoption.type_adoption') || 'Adoption' },
                            { value: 'adoption_request', icon: '📝', label: t('adoption.type_request') || 'Request' },
                            { value: 'observation', icon: '👁️', label: t('adoption.type_observation') || 'Note' },
                            { value: 'follow_up', icon: '📞', label: t('adoption.type_followup') || 'Follow-up' },
                            { value: 'returned_pet', icon: '↩️', label: t('adoption.type_returned') || 'Returned' }
                        ].map(type => {
                            const colors = getRecordTypeColors(type.value);
                            const isSelected = formData.recordType === type.value;
                            return (
                                <button key={type.value} type="button" onClick={() => setFormData({ ...formData, recordType: type.value })} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${isSelected ? `${colors.bg} ${colors.border} ${colors.text}` : 'bg-white border-stone-200 text-stone-600 hover:border-stone-300'}`}>
                                    <span>{type.icon}</span><span>{type.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Date and On Behalf Of */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                            {t('adoption.date') || 'Date'}
                        </label>
                        <input
                            type="date"
                            max={new Date().toISOString().split('T')[0]}
                            className="w-full h-10 px-4 rounded-lg border border-emerald-200 bg-white text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                            value={formData.date}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                            {t('adoption.on_behalf_of') || 'On Behalf Of'}
                        </label>
                        <input
                            className="w-full h-10 px-4 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                            value={formData.onBehalfOf}
                            onChange={e => setFormData({ ...formData, onBehalfOf: e.target.value })}
                            placeholder={t('adoption.on_behalf_placeholder') || 'Leave empty if recording for yourself'}
                        />
                    </div>
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
                                <label className="block text-xs font-bold text-blue-800 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                                    <span>📍</span>
                                    {t('adoption.verify_address') || 'Verify Address'}
                                </label>
                                <textarea
                                    className="w-full p-3 rounded-lg border border-blue-200 bg-white text-blue-950 placeholder-blue-800/40 font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none resize-none text-sm"
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
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🪪</span>
                            <label className="text-sm font-medium text-emerald-800">
                                {t('adoption.identity_verified') || 'Did you verify their identity?'}
                            </label>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, identityVerified: !formData.identityVerified })}
                            className={`relative w-12 h-6 rounded-full transition-colors ${formData.identityVerified ? 'bg-emerald-500' : 'bg-stone-200'}`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${formData.identityVerified ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    {formData.identityVerified && (
                        <p className="mt-2 text-xs text-emerald-600">
                            {t('adoption.identity_verified_note') || 'This will mark the adopter profile as ID verified.'}
                        </p>
                    )}
                </div>

                {/* Rating only (Status hidden/inferred) */}
                <div>
                    <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.rating')}</label>
                    <StarRating
                        value={formData.rating}
                        onChange={(r) => setFormData({ ...formData, rating: r })}
                        size="lg"
                    />
                    <p className="text-xs text-stone-400 mt-1">1 = {t('ratings.dangerous') || 'Dangerous'}, 5 = {t('ratings.excellent') || 'Excellent'}</p>
                </div>

                <div>
                    <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.notes')}</label>
                    <textarea className="w-full p-3 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-none text-sm" rows={3} value={formData.details} onChange={e => setFormData({ ...formData, details: e.target.value })} placeholder={t('adoption.notes_placeholder')} />
                </div>

                {/* Photo Upload */}
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100/50">
                    <label className="block text-xs font-bold text-emerald-800 mb-2 uppercase tracking-wider flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        {t('adopter.upload_image') || 'Upload Photo'}
                    </label>

                    {/* Display existing adoption images (saved records) */}
                    {adoptionImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {adoptionImages.map((img) => (
                                <div key={img.id} className="relative group">
                                    <img
                                        src={img.url}
                                        alt={img.caption || 'Adoption photo'}
                                        className="w-16 h-16 object-cover rounded-lg border border-emerald-200"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (!confirm('Delete this photo?')) return;
                                            try {
                                                await deleteImage(img.id, adopterId);
                                                setAdoptionImages(prev => prev.filter(i => i.id !== img.id));
                                            } catch (e) {
                                                toast.error('Error', 'Failed to delete image');
                                            }
                                        }}
                                        className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                        title="Delete photo"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Display pending images (not yet saved) */}
                    {pendingImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {pendingImages.map((base64, idx) => (
                                <div key={idx} className="relative group">
                                    <img
                                        src={base64}
                                        alt={`Pending photo ${idx + 1}`}
                                        className="w-16 h-16 object-cover rounded-lg border border-amber-300 ring-2 ring-amber-200"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                        className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                        title="Remove photo"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                            <p className="w-full text-xs text-amber-600 mt-1">📎 {pendingImages.length} photo(s) will be uploaded when you save</p>
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <label className={`px-4 py-2 bg-white border border-emerald-200 text-emerald-600 rounded-lg text-sm font-bold cursor-pointer hover:bg-emerald-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                            {uploading ? 'Uploading...' : '+ Add Photo'}
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                        </label>
                        <span className="text-xs text-emerald-600/60">{adoptionImages.length + pendingImages.length} photo(s) attached</span>
                    </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-emerald-100/50">
                    {onDelete && initialData && (
                        <button type="button" onClick={onDelete} className="px-4 py-2 text-sm font-bold text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title={t('common.delete')}>
                            {/* Trash Icon */}
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    )}
                    <div className={`flex gap-3 ${(!onDelete || !initialData) ? 'w-full justify-end' : ''}`}>
                        <button type="button" onClick={handleCancel} className="px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">{t('common.cancel')}</button>
                        <button type="submit" disabled={loading} className="px-6 py-2 text-sm font-bold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 shadow-md shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95">{loading ? t('adoption.saving') : t('adoption.submit')}</button>
                    </div>
                </div>
            </form>
        </div>
    );
}
