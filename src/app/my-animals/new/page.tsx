'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { saveAdoption } from '@/app/actions';
import { extractErrorId } from '@/lib/errorUtils';
import Link from 'next/link';

/** Compress image to max 1200px and JPEG 80% */
function compressImage(file: File): Promise<string> {
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
}

interface ExistingImage {
    id: string;
    url: string;
    caption: string | null;
}

export default function NewAnimalPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const editId = searchParams.get('edit');
    const isEditMode = !!editId;

    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    const [loading, setLoading] = useState(false);
    const [loadingData, setLoadingData] = useState(isEditMode);
    const [uploading, setUploading] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
    const [customSpecies, setCustomSpecies] = useState(false);
    const [formData, setFormData] = useState({
        animalName: '',
        species: 'cat',
        details: '',
        comments: '',
        age: '',
        sex: '',
        color: '',
        microchip: '',
    });

    // Fetch existing animal data in edit mode
    useEffect(() => {
        if (!editId) return;
        async function fetchAnimal() {
            setLoadingData(true);
            try {
                const res = await fetch(`/api/my-animals?view=all`);
                if (!res.ok) throw new Error('Failed to fetch');
                const animals = await res.json() as any[];
                const animal = animals.find((a: any) => a.id === editId);
                if (animal) {
                    const knownSpecies = ['cat', 'dog', 'bird'];
                    const speciesVal = (animal.species || 'cat').toLowerCase();
                    const isCustom = !knownSpecies.includes(speciesVal);
                    setCustomSpecies(isCustom);
                    setFormData({
                        animalName: animal.animalName || '',
                        species: animal.species || 'cat',
                        details: animal.details || '',
                        comments: animal.comments || '',
                        age: animal.age || '',
                        sex: animal.sex || '',
                        color: animal.color || '',
                        microchip: animal.microchip || '',
                    });
                    if (animal.images && animal.images.length > 0) {
                        setExistingImages(animal.images);
                    }
                } else {
                    toast.error('Not Found', 'Could not find the animal record.');
                    router.push('/my-animals');
                }
            } catch (err) {
                console.error('Failed to load animal:', err);
                toast.error('Error', 'Failed to load animal data.', extractErrorId(err));
            } finally {
                setLoadingData(false);
            }
        }
        fetchAnimal();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editId]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Invalid File', 'Please select an image file.');
            return;
        }
        e.target.value = '';
        setUploading(true);
        try {
            const base64 = await compressImage(file);
            setPendingImages(prev => [...prev, base64]);
        } catch (error) {
            toast.error('Upload Failed', 'Could not process the image.', extractErrorId(error));
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!session?.user) { openLogin(); return; }

        setLoading(true);
        try {
            const payload: any = {
                animalName: formData.animalName,
                species: formData.species,
                details: formData.details,
                comments: formData.comments,
                age: formData.age || null,
                sex: formData.sex || null,
                color: formData.color || null,
                microchip: formData.microchip || null,
                recordType: 'available',
                status: 'active',
                rating: null,
                date: new Date(),
                adopterId: null,
                onBehalfOf: null,
                deliveredToHome: 0,
                verifiedAddress: null,
                identityVerified: 0,
            };

            // In edit mode, include the ID so saveAdoption updates instead of creates
            if (isEditMode && editId) {
                payload.id = editId;
            }

            const result = await saveAdoption(payload);

            // Upload any NEW pending images
            if (pendingImages.length > 0 && (result?.id || editId)) {
                const { saveImage } = await import('@/app/actions');
                const targetId = result?.id || editId || '';
                for (const img of pendingImages) {
                    await saveImage('__available__', img, `Photo for ${formData.animalName}`, targetId || undefined, 'image');
                }
            }

            toast.success(
                t('common.save') || 'Saved',
                isEditMode
                    ? (t('dashboard.animal_updated') || 'Animal updated!')
                    : `${formData.animalName} listed for adoption!`
            );
            router.push('/my-animals');
        } catch (err) {
            console.error(err);
            toast.error('Error', 'Failed to save animal. Please try again.', extractErrorId(err));
        } finally {
            setLoading(false);
        }
    };

    if (loadingData) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading') || 'Loading...'}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link href="/my-animals" className="text-stone-500 hover:text-stone-700 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </Link>
                    <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">
                        🐾 {isEditMode
                            ? (t('dashboard.edit_animal') || 'Edit Animal')
                            : (t('dashboard.add_animal') || 'Add Animal for Adoption')
                        }
                    </h1>
                </div>

                <div className="bg-white p-5 rounded-xl border-2 border-emerald-400/50 shadow-lg ring-4 ring-emerald-50/50">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Animal Name */}
                        <div>
                            <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                {t('adoption.animal_name') || 'Animal Name'} *
                            </label>
                            <input
                                required
                                className="w-full h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                                value={formData.animalName}
                                onChange={e => setFormData({ ...formData, animalName: e.target.value })}
                                placeholder={t('adoption.animal_placeholder') || 'e.g. Luna'}
                            />
                        </div>

                        {/* Species */}
                        <div>
                            <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                {t('adoption.species') || 'Species'} *
                            </label>
                            {customSpecies ? (
                                <div className="flex gap-2">
                                    <input
                                        required
                                        autoFocus
                                        className="flex-1 h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                                        value={formData.species}
                                        onChange={e => setFormData({ ...formData, species: e.target.value })}
                                        placeholder={t('adoption.species_other_placeholder') || 'Enter species...'}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setCustomSpecies(false); setFormData({ ...formData, species: 'cat' }); }}
                                        className="px-3 h-10 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-700 text-xs font-medium hover:bg-emerald-50 transition-colors whitespace-nowrap"
                                    >
                                        ↩ {t('adoption.species_presets') || 'Presets'}
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <select
                                        required
                                        className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
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
                                    <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-stone-400">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Age & Sex (side by side) */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                    {t('adoption.age') || 'Approximate Age'}
                                </label>
                                <input
                                    className="w-full h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                                    value={formData.age}
                                    onChange={e => setFormData({ ...formData, age: e.target.value })}
                                    placeholder={t('adoption.age_placeholder') || 'e.g. 2 years, 3 months'}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                    {t('adoption.sex') || 'Sex'}
                                </label>
                                <select
                                    className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
                                    value={formData.sex}
                                    onChange={e => setFormData({ ...formData, sex: e.target.value })}
                                >
                                    <option value="">{t('adoption.sex_unknown') || '—'}</option>
                                    <option value="macho">{t('adoption.sex_male') || 'Male ♂'}</option>
                                    <option value="hembra">{t('adoption.sex_female') || 'Female ♀'}</option>
                                </select>
                            </div>
                        </div>

                        {/* Color & Microchip (side by side) */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                    {t('adoption.color') || 'Color / Markings'}
                                </label>
                                <input
                                    className="w-full h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                                    value={formData.color}
                                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                                    placeholder={t('adoption.color_placeholder') || 'e.g. Black with white spots'}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                    {t('adoption.microchip') || 'Microchip N°'}
                                </label>
                                <input
                                    className="w-full h-10 px-4 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                                    value={formData.microchip}
                                    onChange={e => setFormData({ ...formData, microchip: e.target.value })}
                                    placeholder={t('adoption.microchip_placeholder') || 'Optional'}
                                />
                            </div>
                        </div>

                        {/* Details / Description */}
                        <div>
                            <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">
                                {t('common.details') || 'Details'}
                            </label>
                            <textarea
                                className="w-full p-3 rounded-lg border border-emerald-200 text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-none text-sm"
                                rows={4}
                                value={formData.details}
                                onChange={e => setFormData({ ...formData, details: e.target.value })}
                                placeholder={t('dashboard.animal_details_placeholder') || 'Age, color, personality, health status, any special needs...'}
                            />
                        </div>

                        {/* Photos */}
                        <div className="p-4 bg-emerald-50/50 rounded-lg border border-emerald-100">
                            <label className="block text-xs font-bold text-emerald-800 mb-2 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                {t('common.photos') || 'Photos'}
                            </label>

                            {/* Existing images (from DB, in edit mode) */}
                            {existingImages.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {existingImages.map((img) => (
                                        <div key={img.id} className="relative group">
                                            <img
                                                src={img.url}
                                                alt={img.caption || 'Photo'}
                                                className="w-20 h-20 object-cover rounded-lg border border-emerald-200"
                                            />
                                            <div className="absolute inset-0 bg-emerald-600/10 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-xs text-white bg-black/40 px-1 rounded">saved</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* New pending images */}
                            {pendingImages.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {pendingImages.map((img, idx) => (
                                        <div key={idx} className="relative group">
                                            <img
                                                src={img}
                                                alt={`New photo ${idx + 1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-emerald-300"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600 flex items-center justify-center shadow"
                                                title="Remove"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <label className={`px-4 py-2 bg-white border border-emerald-200 text-emerald-600 rounded-lg text-sm font-bold cursor-pointer hover:bg-emerald-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                    {uploading ? (t('adopter.uploading') || 'Uploading...') : (t('common.add_photo') || '+ Add Photo')}
                                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                                </label>
                                <span className="text-xs text-emerald-600">{existingImages.length + pendingImages.length} {t('common.photos') || 'photos'}</span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-4 border-t border-stone-100">
                            <Link
                                href="/my-animals"
                                className="px-5 py-2.5 text-sm font-bold text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                            >
                                {t('common.cancel') || 'Cancel'}
                            </Link>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-2.5 text-sm font-bold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 disabled:opacity-50 transition-all duration-300 active:scale-[0.99]"
                            >
                                {loading
                                    ? (t('common.processing') || 'Processing...')
                                    : isEditMode
                                        ? '💾 ' + (t('common.save') || 'Save Changes')
                                        : '🐾 ' + (t('dashboard.add_animal') || 'Add Animal')
                                }
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
