'use client';

import { useState } from 'react';
import { saveAdoption } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

export default function AdoptionForm({ adopterId }: { adopterId: string }) {
    const router = useRouter();
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        animalName: '',
        details: '',
        status: 'completed',
        rating: 5,
        comments: '',
        species: '' // Add state for species
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await saveAdoption({
                ...formData,
                adopterId: adopterId,
                rating: Number(formData.rating)
            } as any);
            setIsOpen(false);
            setFormData({ animalName: '', details: '', status: 'completed', rating: 5, comments: '', species: '' });
            router.refresh();
        } catch (err) {
            console.error(err);
            alert('Failed to save adoption');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <button onClick={() => setIsOpen(true)} className="mt-4 w-full py-4 border-2 border-dashed border-emerald-200/60 rounded-xl text-emerald-600 font-bold hover:border-emerald-400 hover:bg-emerald-50 transition-all duration-300">
                + {t('adoption.record_new')}
            </button>
        )
    }

    return (
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-emerald-100/60 p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-xl font-bold mb-6 text-emerald-900 tracking-tight">{t('adoption.record_new')}</h3>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('adoption.animal_name')}</label>
                        <input
                            required
                            className="w-full h-12 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none"
                            value={formData.animalName}
                            onChange={e => setFormData({ ...formData, animalName: e.target.value })}
                            placeholder={t('adoption.animal_placeholder')}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('adoption.species')}</label>
                        <input
                            required
                            className="w-full h-12 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none"
                            value={formData.species}
                            onChange={e => setFormData({ ...formData, species: e.target.value })}
                            placeholder={t('adoption.species_placeholder')}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('adoption.status')}</label>
                        <select
                            className="w-full h-12 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none"
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                        >
                            <option value="completed">{t('adoption.status_completed')}</option>
                            <option value="returned">{t('adoption.status_returned')}</option>
                            <option value="featured">{t('adoption.status_failed')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('adoption.rating')}</label>
                        <select
                            className="w-full h-12 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none"
                            value={formData.rating}
                            onChange={e => setFormData({ ...formData, rating: Number(e.target.value) })}
                        >
                            <option value="5">5 - Excellent</option>
                            <option value="4">4 - Good</option>
                            <option value="3">3 - Average</option>
                            <option value="2">2 - Poor</option>
                            <option value="1">1 - Bad</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('adoption.notes')}</label>
                    <textarea
                        className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-none"
                        rows={3}
                        value={formData.details}
                        onChange={e => setFormData({ ...formData, details: e.target.value })}
                        placeholder={t('adoption.notes_placeholder')}
                    />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-emerald-100">
                    <button type="button" onClick={() => setIsOpen(false)} className="px-5 py-2.5 text-emerald-700 font-semibold hover:bg-emerald-50 rounded-xl transition-colors">{t('common.cancel')}</button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="px-8 py-2.5 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 shadow-lg shadow-emerald-500/30 disabled:opacity-50 transition-all transform hover:-translate-y-0.5"
                    >
                        {loading ? t('adoption.saving') : t('adoption.submit')}
                    </button>
                </div>
            </form>
        </div>
    );
}
