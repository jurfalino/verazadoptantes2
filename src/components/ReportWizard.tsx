'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { saveAdoption, searchAdopter } from '@/app/actions';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { getRatingColors } from '@/lib/ratingColors';

export default function ReportWizard() {
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [isOpen, setIsOpen] = useState(false);

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Step 1: Adopter Data
    const [adopterMode, setAdopterMode] = useState<'existing' | 'new'>('existing');
    const [selectedAdopterId, setSelectedAdopterId] = useState<string>('');
    const [adopterSearch, setAdopterSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // Step 2: Observation Details
    const [observationData, setObservationData] = useState({
        details: '',
        rating: 3
    });

    const handleStart = () => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }
        setIsOpen(true);
    };

    const handleClose = () => {
        setIsOpen(false);
        setStep(1);
        setAdopterMode('existing');
        setSelectedAdopterId('');
        setAdopterSearch('');
        setSearchResults([]);
        setObservationData({ details: '', rating: 3 });
    };

    const handleSearch = async (term: string) => {
        setAdopterSearch(term);
        if (term.length > 2) {
            const results = await searchAdopter(term);
            setSearchResults(results);
        } else {
            setSearchResults([]);
        }
    };

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleFinish = async () => {
        setLoading(true);
        try {
            if (adopterMode === 'new') {
                // Redirect to create adopter page with observation intent
                router.push('/adopter/create?intent=observation');
                return;
            }

            // Create observation record for existing adopter
            const result = await saveAdoption({
                adopterId: selectedAdopterId,
                animalName: '',
                recordType: 'observation',
                status: 'noted',
                rating: observationData.rating,
                details: observationData.details
            } as any);

            // Navigate to adopter profile with editAdoption param
            router.push(`/adopter/${selectedAdopterId}?editAdoption=${result.id}`);
            router.refresh();

        } catch (e) {
            console.error(e);
            alert('Error creating observation');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <div
                className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-rose-200 transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer"
                onClick={handleStart}
            >
                <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-700 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <h3 className="text-xl font-bold text-stone-900 mb-2">{t('home.action_report_title')}</h3>
                <p className="text-stone-500 mb-4 text-sm">{t('home.action_report_desc')}</p>
                <button
                    className="inline-block px-6 py-2.5 bg-rose-200 text-rose-900 font-bold rounded-xl hover:bg-rose-300 transition-colors shadow-sm"
                >
                    {t('home.action_report_btn')}
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl mx-auto max-h-[90vh] overflow-y-auto relative">
                <button onClick={handleClose} className="absolute top-4 right-4 text-stone-400 hover:text-stone-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h2 className="text-2xl font-bold text-stone-800 mb-6 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-rose-100 text-rose-800 flex items-center justify-center text-sm">{step}</span>
                    {step === 1 ? (t('wizard.step_adopter') || 'Identify Adopter') : (t('wizard.step_observation') || 'Observation Details')}
                </h2>

                {step === 1 && (
                    <div className="space-y-6">
                        <div className="flex gap-4 p-1 bg-stone-100 rounded-lg">
                            <button
                                onClick={() => setAdopterMode('existing')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${adopterMode === 'existing' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                            >
                                {t('wizard.existing_adopter') || 'Search Existing'}
                            </button>
                            <button
                                onClick={() => setAdopterMode('new')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${adopterMode === 'new' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                            >
                                {t('wizard.new_adopter') || 'New Adopter'}
                            </button>
                        </div>

                        {adopterMode === 'existing' ? (
                            <div>
                                <input
                                    className="w-full p-3 rounded-xl border border-stone-300 mb-2"
                                    placeholder={t('wizard.search_placeholder') || 'Search by name, phone, email...'}
                                    value={adopterSearch}
                                    onChange={e => handleSearch(e.target.value)}
                                />
                                <div className="max-h-48 overflow-y-auto border border-stone-200 rounded-xl divide-y">
                                    {searchResults.length === 0 && adopterSearch.length > 2 && (
                                        <div className="p-4 text-center text-stone-400 text-sm">
                                            {t('wizard.no_results') || 'No adopters found'}
                                        </div>
                                    )}
                                    {searchResults.map(res => (
                                        <button
                                            key={res.adopter.id}
                                            onClick={() => setSelectedAdopterId(res.adopter.id)}
                                            className={`w-full text-left p-3 hover:bg-rose-50 ${selectedAdopterId === res.adopter.id ? 'bg-rose-100' : ''}`}
                                        >
                                            <div className="font-bold text-sm">{res.adopter.name}</div>
                                            <div className="text-xs text-stone-500">{res.matchContext}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-stone-50 rounded-xl text-stone-600 text-sm">
                                {t('wizard.new_adopter_redirect') || 'You will be redirected to create a new adopter profile with observation details.'}
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <button
                                onClick={adopterMode === 'new' ? handleFinish : handleNext}
                                disabled={adopterMode === 'existing' && !selectedAdopterId}
                                className="px-6 py-2 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 disabled:opacity-50"
                            >
                                {adopterMode === 'new' ? (t('wizard.continue') || 'Continue') : (t('wizard.next') || 'Next: Details')}
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6">
                        {/* Rating */}
                        <div>
                            <label className="block text-sm font-bold text-stone-700 mb-2">
                                {t('adoption.rating') || 'Rating'}
                            </label>
                            <div className="flex gap-2">
                                {[1, 2, 3, 4, 5].map(r => {
                                    const colors = getRatingColors(r);
                                    const isSelected = observationData.rating === r;
                                    return (
                                        <button
                                            key={r}
                                            onClick={() => setObservationData({ ...observationData, rating: r })}
                                            className={`w-10 h-10 rounded-lg font-bold transition-all border-2 ${isSelected
                                                    ? `${colors.bg} ${colors.text} ${colors.border} shadow-sm`
                                                    : 'bg-stone-100 text-stone-600 border-transparent hover:bg-stone-200'
                                                }`}
                                        >
                                            {r}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-stone-400 mt-1">1 = {t('ratings.dangerous') || 'Dangerous'}, 5 = {t('ratings.excellent') || 'Excellent'}</p>
                        </div>

                        {/* Details */}
                        <div>
                            <label className="block text-sm font-bold text-stone-700 mb-2">
                                {t('adoption.details') || 'Details'}
                            </label>
                            <textarea
                                className="w-full p-3 rounded-xl border border-stone-300 h-24"
                                placeholder={t('wizard.observation_details_placeholder') || 'What did you observe about this adopter?'}
                                value={observationData.details}
                                onChange={e => setObservationData({ ...observationData, details: e.target.value })}
                            />
                        </div>


                        <div className="flex justify-between pt-4">
                            <button
                                onClick={handleBack}
                                className="text-stone-500 font-bold hover:text-stone-800"
                            >
                                {t('common.back') || 'Back'}
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={loading}
                                className="px-6 py-2 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 disabled:opacity-50"
                            >
                                {loading ? (t('common.processing') || 'Processing...') : (t('wizard.submit_observation') || 'Submit Observation')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
