'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { saveAdoption, searchAdopter, getAvailableAnimals } from '@/app/actions';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';

export default function AdoptionWizard() {
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [isOpen, setIsOpen] = useState(false);

    // Data state
    const [availableAnimals, setAvailableAnimals] = useState<any[]>([]);

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (session?.user) {
            getAvailableAnimals().then(setAvailableAnimals).catch(console.error);
        }
    }, [session]);

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
        // Reset data?
    };

    // Step 1: Animal Data
    const [animalMode, setAnimalMode] = useState<'existing' | 'new'>('new');
    const [selectedAnimalId, setSelectedAnimalId] = useState<string>('');
    const [animalData, setAnimalData] = useState({
        animalName: '',
        species: 'cat',
        details: '',
        status: 'completed',
        rating: 5,
        comments: ''
    });

    // Track if user selected "Other" for species
    const [customSpecies, setCustomSpecies] = useState(false);

    // Step 2: Adopter Data
    const [adopterMode, setAdopterMode] = useState<'existing' | 'new'>('new');
    const [selectedAdopterId, setSelectedAdopterId] = useState<string>('');
    const [adopterSearch, setAdopterSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    const handleAnimalSelect = (id: string) => {
        setSelectedAnimalId(id);
        const animal = availableAnimals.find(a => a.id === id);
        if (animal) {
            setAnimalData({
                animalName: animal.animalName,
                species: animal.species,
                details: animal.details || '',
                status: 'completed',
                rating: 5,
                comments: ''
            });
        }
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
            // Logic to link everything
            // If linking existing animal + existing adopter: update adoption with adopterId
            // If new animal + existing adopter: create adoption with adopterId
            // "New Adopter" flow in wizard is complex (form fields). 
            // MVP: Redirect to "Create Adopter" page with animal intent? 

            // For now, let's just support linking to EXISTING adopter or redirecting to create new adopter.

            if (adopterMode === 'new') {
                // Pass animal data to create adopter page so it can continue to adoption form after save
                const query = new URLSearchParams();
                query.set('continueToAdoption', 'true');
                if (animalMode === 'existing') {
                    query.set('linkAnimalId', selectedAnimalId);
                } else {
                    // Pass new animal data
                    if (animalData.animalName) query.set('animalName', animalData.animalName);
                    if (animalData.species) query.set('species', animalData.species);
                }
                router.push(`/adopter/create?${query.toString()}`);
                return;
            }

            // Existing Adopter mode
            let newAdoptionId: string | undefined;

            if (animalMode === 'existing') {
                // Update existing adoption
                const result = await saveAdoption({
                    id: selectedAnimalId,
                    adopterId: selectedAdopterId,
                    status: animalData.status,
                    rating: animalData.rating
                    // details? comments?
                } as any);
                newAdoptionId = result.id;
            } else {
                // Create new adoption for existing adopter
                const result = await saveAdoption({
                    adopterId: selectedAdopterId,
                    ...animalData
                } as any);
                newAdoptionId = result.id;
            }

            // Navigate to adopter profile with editAdoption param to auto-expand the card
            router.push(`/adopter/${selectedAdopterId}?editAdoption=${newAdoptionId}`);
            router.refresh();

        } catch (e) {
            console.error(e);
            alert('Error processing adoption');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-teal-200 transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer" onClick={handleStart}>
                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4 text-teal-700 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-xl font-bold text-stone-900 mb-2">{t('home.action_register_title')}</h3>
                <p className="text-stone-500 mb-4 text-sm">{t('home.action_register_desc')}</p>
                <button
                    className="inline-block px-6 py-2.5 bg-teal-200 text-teal-900 font-bold rounded-xl hover:bg-teal-300 transition-colors shadow-sm"
                >
                    {t('home.action_register_btn')}
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
                    <span className="w-8 h-8 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-sm">{step}</span>
                    {step === 1 ? 'Identify Animal' : 'Identify Adopter'}
                </h2>

                {step === 1 && (
                    <div className="space-y-6">
                        {/* Animal Mode Switcher */}
                        {availableAnimals.length > 0 && (
                            <div className="flex gap-4 p-1 bg-stone-100 rounded-lg">
                                <button
                                    onClick={() => setAnimalMode('new')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${animalMode === 'new' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                                >
                                    New Animal
                                </button>
                                <button
                                    onClick={() => setAnimalMode('existing')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${animalMode === 'existing' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                                >
                                    Existing ({availableAnimals.length})
                                </button>
                            </div>
                        )}

                        {animalMode === 'existing' ? (
                            <div>
                                <select className="w-full p-3 rounded-xl border border-stone-300" onChange={(e) => handleAnimalSelect(e.target.value)} value={selectedAnimalId}>
                                    <option value="">Select Existing Animal...</option>
                                    {availableAnimals.map(a => (
                                        <option key={a.id} value={a.id}>{a.animalName} ({a.species})</option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <input
                                    className="p-3 rounded-xl border border-stone-300"
                                    placeholder="Animal Name"
                                    value={animalData.animalName}
                                    onChange={e => setAnimalData({ ...animalData, animalName: e.target.value })}
                                />
                                {customSpecies ? (
                                    <div className="flex gap-2">
                                        <input
                                            autoFocus
                                            className="flex-1 p-3 rounded-xl border border-stone-300"
                                            placeholder={t('adoption.species_other_placeholder') || 'Enter species...'}
                                            value={animalData.species}
                                            onChange={e => setAnimalData({ ...animalData, species: e.target.value })}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCustomSpecies(false);
                                                setAnimalData({ ...animalData, species: 'cat' });
                                            }}
                                            className="px-3 rounded-xl border border-stone-300 bg-stone-50 text-stone-600 text-xs font-medium hover:bg-stone-100 transition-colors whitespace-nowrap"
                                            title={t('adoption.species_select_preset') || 'Select preset'}
                                        >
                                            ↩ {t('adoption.species_presets') || 'Presets'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <select
                                            className="w-full p-3 rounded-xl border border-stone-300 appearance-none bg-white"
                                            value={animalData.species.toLowerCase() || 'cat'}
                                            onChange={e => {
                                                if (e.target.value === '_other') {
                                                    setCustomSpecies(true);
                                                    setAnimalData({ ...animalData, species: '' });
                                                } else {
                                                    setAnimalData({ ...animalData, species: e.target.value });
                                                }
                                            }}
                                        >
                                            <option value="cat">{t('species.cat') || 'Cat'} 🐱</option>
                                            <option value="dog">{t('species.dog') || 'Dog'} 🐶</option>
                                            <option value="bird">{t('species.bird') || 'Bird'} 🐦</option>
                                            <option value="_other">{t('species.other') || 'Other...'}</option>
                                        </select>
                                        <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-stone-500">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end pt-4">
                            <button
                                onClick={handleNext}
                                disabled={animalMode === 'existing' && !selectedAnimalId || animalMode === 'new' && !animalData.animalName}
                                className="px-6 py-2 bg-stone-800 text-white font-bold rounded-xl hover:bg-stone-900 disabled:opacity-50"
                            >
                                Next: Adopter
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6">
                        <div className="flex gap-4 p-1 bg-stone-100 rounded-lg">
                            <button
                                onClick={() => setAdopterMode('new')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${adopterMode === 'new' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                            >
                                New Adopter
                            </button>
                            <button
                                onClick={() => setAdopterMode('existing')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${adopterMode === 'existing' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                            >
                                Existing Database
                            </button>
                        </div>

                        {adopterMode === 'existing' ? (
                            <div>
                                <input
                                    className="w-full p-3 rounded-xl border border-stone-300 mb-2"
                                    placeholder="Search Adopter Name..."
                                    value={adopterSearch}
                                    onChange={e => handleSearch(e.target.value)}
                                />
                                <div className="max-h-40 overflow-y-auto border border-stone-200 rounded-xl divide-y">
                                    {searchResults.map(res => (
                                        <button
                                            key={res.adopter.id}
                                            onClick={() => setSelectedAdopterId(res.adopter.id)}
                                            className={`w-full text-left p-3 hover:bg-teal-50 ${selectedAdopterId === res.adopter.id ? 'bg-teal-100' : ''}`}
                                        >
                                            <div className="font-bold text-sm">{res.adopter.name}</div>
                                            <div className="text-xs text-stone-500">{res.matchContext}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-stone-50 rounded-xl text-stone-600 text-sm">
                                You will be redirected to the Adopter Creation page to fill in their details. The animal will be linked afterwards.
                            </div>
                        )}

                        <div className="flex justify-between pt-4">
                            <button
                                onClick={handleBack}
                                className="text-stone-500 font-bold hover:text-stone-800"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={loading || (adopterMode === 'existing' && !selectedAdopterId)}
                                className="px-6 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? 'Processing...' : 'Complete Adoption'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
