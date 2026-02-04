'use client';

import { useState } from 'react';
import { saveAdoption } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';

export default function AdoptionForm({ adopterId, initialData, onCancel, onSuccess, availableAnimals = [], currentUser }: { adopterId: string, initialData?: any, onCancel?: () => void, onSuccess?: () => void, availableAnimals?: any[], currentUser?: string }) {
    const router = useRouter();
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [isOpen, setIsOpen] = useState(!!initialData);
    const [loading, setLoading] = useState(false);

    // New Feature State: "existing" or "new"
    const [mode, setMode] = useState<'existing' | 'new'>('existing'); // Default to existing if available

    // Initial State check: if no available animals, force "new"
    // Use effect/memo to set initial mode based on availability? 
    // Just default in useState initialization logic or component render.

    const [formData, setFormData] = useState({
        id: initialData?.id,
        animalName: initialData?.animalName || '',
        details: initialData?.details || '',
        status: initialData?.status || 'completed',
        rating: initialData?.rating || 5,
        comments: initialData?.comments || '',
        species: initialData?.species || '',
        adopterId: initialData?.adopterId || adopterId
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
            adopterId: initialData.adopterId || adopterId
        });
        setIsOpen(true);
        setMode('new'); // Editing is always "editing specific record", conceptually "new data entry" vs linking
    }

    const handleSelectExisting = (animalId: string) => {
        if (!animalId) return;
        const animal = availableAnimals.find(a => a.id === animalId);
        if (animal) {
            setFormData({
                ...formData,
                id: animal.id, // Important: we are updating THIS animal
                animalName: animal.animalName,
                species: animal.species,
                details: animal.details || '',
                // Preserve status/rating from existing or default?
                // Probably default 'completed' since we are now completing the adoption
                status: 'completed',
                rating: 5,
                // Ensure we link it
                adopterId: adopterId
            });
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const isAuthenticated =
            (currentUser && (currentUser.startsWith('User:') || currentUser.startsWith('Anon:'))) ||
            session?.user ||
            document.cookie.includes('anon_user=true');

        if (!isAuthenticated) {
            openLogin();
            return;
        }

        setLoading(true);
        try {
            await saveAdoption({
                ...formData,
                adopterId: adopterId, // Enforce this adopter
                rating: Number(formData.rating)
            } as any);

            if (onSuccess) {
                onSuccess();
            } else {
                setIsOpen(false);
                setFormData({ id: undefined, animalName: '', details: '', status: 'completed', rating: 5, comments: '', species: '', adopterId });
                router.refresh();
            }
        } catch (err) {
            console.error(err);
            alert('Failed to save adoption');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        } else {
            setIsOpen(false);
        }
    }

    if (!isOpen && !initialData) {
        return (
            <button onClick={() => {
                const isAuthenticated =
                    (currentUser && (currentUser.startsWith('User:') || currentUser.startsWith('Anon:'))) ||
                    session?.user ||
                    document.cookie.includes('anon_user=true');

                if (!isAuthenticated) {
                    openLogin();
                    return;
                }
                setIsOpen(true);
            }} className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all duration-300 transform active:scale-[0.99] mb-4">
                + {t('adoption.record_new')}
            </button>
        )
    }

    // Determine effective mode options
    const showModeSwitcher = !initialData && availableAnimals && availableAnimals.length > 0;
    // If no animals available, force new
    const effectiveMode = showModeSwitcher ? mode : 'new';

    return (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-white p-5 rounded-xl border-2 border-emerald-400/50 shadow-lg relative ring-4 ring-emerald-50/50">
            <h3 className="text-lg font-bold mb-4 text-emerald-900 tracking-tight flex items-center gap-2">
                {initialData ? (
                    <>
                        <div className="p-1.5 bg-emerald-100 rounded-lg text-emerald-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </div>
                        {t('adoption.record_edit') || 'Edit Adoption'}
                    </>
                ) : (
                    <>
                        <div className="p-1.5 bg-emerald-100 rounded-lg text-emerald-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        </div>
                        {t('adoption.record_new')}
                    </>
                )}
            </h3>

            {showModeSwitcher && (
                <div className="flex gap-2 mb-4 p-1 bg-emerald-50 rounded-lg">
                    <button
                        type="button"
                        onClick={() => setMode('existing')}
                        className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${effectiveMode === 'existing' ? 'bg-white text-emerald-700 shadow-sm' : 'text-emerald-600/70 hover:text-emerald-800'}`}
                    >
                        Select Existing ({availableAnimals.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMode('new');
                            // Reset form data if switching to new to avoid carrying over ID
                            setFormData(prev => ({ ...prev, id: undefined, animalName: '', species: '', details: '', status: 'completed', rating: 5 }));
                        }}
                        className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${effectiveMode === 'new' ? 'bg-white text-emerald-700 shadow-sm' : 'text-emerald-600/70 hover:text-emerald-800'}`}
                    >
                        Create New
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {effectiveMode === 'existing' && (
                    <div className="mb-4">
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">Select Animal</label>
                        <select
                            className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
                            onChange={(e) => handleSelectExisting(e.target.value)}
                            value={formData.id || ''}
                        >
                            <option value="">-- Choose an animal --</option>
                            {availableAnimals.map(a => (
                                <option key={a.id} value={a.id}>{a.animalName} ({a.species}) - {new Date(a.date).toLocaleDateString()}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.animal_name')}</label>
                        <input
                            required
                            className="w-full h-10 px-4 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                            value={formData.animalName}
                            onChange={e => setFormData({ ...formData, animalName: e.target.value })}
                            placeholder={t('adoption.animal_placeholder')}
                        // If linking existing, maybe read-only? Or allow edit? 
                        // Current requirement implies we select and add details. Allowing edit is fine.
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.species')}</label>
                        <input
                            required
                            className="w-full h-10 px-4 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none text-sm"
                            value={formData.species}
                            onChange={e => setFormData({ ...formData, species: e.target.value })}
                            placeholder={t('adoption.species_placeholder')}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.status')}</label>
                        <div className="relative">
                            <select
                                className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-white text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
                                value={formData.status}
                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                            >
                                <option value="completed">{t('adoption.status_completed')}</option>
                                <option value="returned">{t('adoption.status_returned')}</option>
                                <option value="featured">{t('adoption.status_failed')}</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-emerald-600">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.rating')}</label>
                        <div className="relative">
                            <select
                                className="w-full h-10 pl-4 pr-10 rounded-lg border border-emerald-200 bg-white text-emerald-950 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none appearance-none text-sm"
                                value={formData.rating}
                                onChange={e => setFormData({ ...formData, rating: Number(e.target.value) })}
                            >
                                <option value="5">{t('ratings.5')}</option>
                                <option value="4">{t('ratings.4')}</option>
                                <option value="3">{t('ratings.3')}</option>
                                <option value="2">{t('ratings.2')}</option>
                                <option value="1">{t('ratings.1')}</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-emerald-600">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-emerald-800 mb-1.5 uppercase tracking-wider">{t('adoption.notes')}</label>
                    <textarea
                        className="w-full p-3 rounded-lg border border-emerald-200 bg-white text-emerald-950 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-none text-sm"
                        rows={3}
                        value={formData.details}
                        onChange={e => setFormData({ ...formData, details: e.target.value })}
                        placeholder={t('adoption.notes_placeholder')}
                    />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-emerald-100/50">
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="px-6 py-2 text-sm font-bold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 shadow-md shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95"
                    >
                        {loading ? t('adoption.saving') : t('adoption.submit')}
                    </button>
                </div>
            </form>
        </div>
    );
}
