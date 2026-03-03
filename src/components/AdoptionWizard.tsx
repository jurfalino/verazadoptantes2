'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { saveAdoption, searchAdopter, getAvailableAnimals } from '@/app/actions';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import LegalConsent from '@/components/LegalConsent';
import DatePicker from '@/components/ui/DatePicker';

export default function AdoptionWizard() {
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();
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
        // Don't act while session is still loading — prevents false login prompts
        if (sessionStatus === 'loading') return;
        if (!session?.user) {
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
    const [adoptionDate, setAdoptionDate] = useState('');

    // Set default date on client to avoid SSR hydration mismatch
    useEffect(() => {
        if (!adoptionDate) {
            setAdoptionDate(new Date().toISOString().split('T')[0]);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Track if user selected "Other" for species
    const [customSpecies, setCustomSpecies] = useState(false);

    // Step 2: Adopter Data (search-first flow)
    const [selectedAdopterId, setSelectedAdopterId] = useState<string>('');
    const [adopterSearch, setAdopterSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [previewAdopter, setPreviewAdopter] = useState<any>(null);
    const [searchPerformed, setSearchPerformed] = useState(false);

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
        setSelectedAdopterId('');
        setPreviewAdopter(null);
        if (term.length > 2) {
            const response = await searchAdopter(term);
            setSearchResults(response.results);
            setSearchPerformed(true);
        } else {
            setSearchResults([]);
            setSearchPerformed(false);
        }
    };

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleCreateNew = () => {
        // Pass animal data to create adopter page so it can continue to adoption form after save
        const query = new URLSearchParams();
        query.set('continueToAdoption', 'true');
        query.set('date', adoptionDate);
        if (animalMode === 'existing') {
            query.set('linkAnimalId', selectedAnimalId);
        } else {
            if (animalData.animalName) query.set('animalName', animalData.animalName);
            if (animalData.species) query.set('species', animalData.species);
        }
        if (adopterSearch.trim()) query.set('name', adopterSearch.trim());
        router.push(`/adopter/create?${query.toString()}`);
    };

    const handleFinish = async () => {
        setLoading(true);
        try {
            if (!selectedAdopterId) {
                // No adopter selected — redirect to create
                handleCreateNew();
                return;
            }

            // Existing Adopter — link the adoption
            let newAdoptionId: string | undefined;

            // Parse date as local noon to avoid timezone issues
            const parts = adoptionDate.split('-').map(Number);
            const localDate = new Date(parts[0], parts[1] - 1, parts[2] || 1, 12, 0, 0);

            if (animalMode === 'existing') {
                // Update existing adoption
                const result = await saveAdoption({
                    id: selectedAnimalId,
                    adopterId: selectedAdopterId,
                    status: animalData.status,
                    rating: animalData.rating,
                    date: localDate
                } as any);
                newAdoptionId = result.id;
            } else {
                // Create new adoption for existing adopter
                const result = await saveAdoption({
                    adopterId: selectedAdopterId,
                    ...animalData,
                    date: localDate
                } as any);
                newAdoptionId = result.id;
            }

            // Navigate to adopter profile with editAdoption param to auto-expand the card
            router.push(`/adopter/${selectedAdopterId}?editAdoption=${newAdoptionId}`);
            router.refresh();

        } catch (e) {
            console.error(e);
            toast.error('Error', 'Error processing adoption. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <div data-testid="adoption-wizard-btn" className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-teal-200 transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer" onClick={handleStart}>
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
                    {step === 1 ? 'Identify Animal' : (t('wizard.who_is_adopter') || 'Who is the adopter?')}
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

                        {/* Adoption Date */}
                        <div>
                            <label className="block text-sm font-bold text-stone-700 mb-1">
                                {t('adoption.date') || 'Date'}
                            </label>
                            <DatePicker
                                value={adoptionDate}
                                onChange={setAdoptionDate}
                                maxDate={new Date().toISOString().split('T')[0]}
                                dayOptional
                            />
                        </div>

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
                    <div className="space-y-5">
                        {/* Preview Panel */}
                        {previewAdopter ? (
                            <div className="animate-in slide-in-from-right duration-200">
                                <div className="border border-teal-200 rounded-xl overflow-hidden bg-teal-50/30">
                                    {/* Preview Header */}
                                    <div className="p-4 border-b border-teal-100 flex items-center gap-3">
                                        {previewAdopter.thumbnail ? (
                                            <img src={previewAdopter.thumbnail} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm" />
                                        ) : (
                                            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-lg">
                                                {previewAdopter.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-stone-800 text-lg">{previewAdopter.adopter.name}</div>
                                            {previewAdopter.matchContext && (
                                                <div className="text-xs text-teal-600">{t(`wizard.${previewAdopter.matchContext}`) || previewAdopter.matchContext}</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Preview Details */}
                                    <div className="p-4 space-y-3">
                                        {previewAdopter.adopter.contactInfo && (
                                            <div>
                                                <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.contact') || 'Contact'}</div>
                                                <div className="text-sm text-stone-700 whitespace-pre-line line-clamp-3">{previewAdopter.adopter.contactInfo}</div>
                                            </div>
                                        )}
                                        <div className="flex gap-4 text-sm">
                                            {previewAdopter.avgRating != null && (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-amber-500">⭐</span>
                                                    <span className="font-bold text-stone-700">{Number(previewAdopter.avgRating).toFixed(1)}</span>
                                                </div>
                                            )}
                                            {previewAdopter.stats?.adoptions != null && (
                                                <div className="text-stone-500">
                                                    {previewAdopter.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}
                                                </div>
                                            )}
                                        </div>
                                        {previewAdopter.adopter.familyMembers && (
                                            <div>
                                                <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.family_members') || 'Family'}</div>
                                                <div className="text-sm text-stone-600 line-clamp-2">{previewAdopter.adopter.familyMembers}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Preview Actions */}
                                    <div className="p-4 border-t border-teal-100 flex justify-between">
                                        <button
                                            onClick={() => setPreviewAdopter(null)}
                                            className="text-stone-500 text-sm font-bold hover:text-stone-800 transition-colors"
                                        >
                                            {t('wizard.back_to_results') || '← Back to results'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedAdopterId(previewAdopter.adopter.id);
                                                setPreviewAdopter(null);
                                            }}
                                            className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors text-sm"
                                        >
                                            ✓ {t('wizard.select_this') || 'Select this person'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Search Input */}
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                    </div>
                                    <input
                                        autoFocus
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-all text-stone-800"
                                        placeholder={t('wizard.search_name_placeholder') || "Type adopter's name..."}
                                        value={adopterSearch}
                                        onChange={e => handleSearch(e.target.value)}
                                    />
                                </div>

                                {/* Selected Adopter Indicator */}
                                {selectedAdopterId && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 border border-teal-200 rounded-xl">
                                        <svg className="w-5 h-5 text-teal-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <span className="text-sm font-bold text-teal-800 flex-1">
                                            {searchResults.find(r => r.adopter.id === selectedAdopterId)?.adopter.name || 'Adopter selected'}
                                        </span>
                                        <button onClick={() => setSelectedAdopterId('')} className="text-teal-500 hover:text-teal-700 text-xs font-bold">✕</button>
                                    </div>
                                )}

                                {/* Hint when empty */}
                                {!searchPerformed && !selectedAdopterId && (
                                    <div className="text-center py-6 text-stone-400 text-sm">
                                        <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        {t('wizard.type_to_search') || 'Start typing to search existing adopters'}
                                    </div>
                                )}

                                {/* Search Results */}
                                {searchPerformed && searchResults.length > 0 && (
                                    <div className="max-h-52 overflow-y-auto border border-stone-200 rounded-xl divide-y">
                                        {searchResults.map(res => (
                                            <div
                                                key={res.adopter.id}
                                                className={`flex items-center gap-3 p-3 hover:bg-teal-50/50 transition-colors ${selectedAdopterId === res.adopter.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''}`}
                                            >
                                                {/* Thumbnail */}
                                                {res.thumbnail ? (
                                                    <img src={res.thumbnail} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 font-bold text-sm flex-shrink-0">
                                                        {res.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                                    </div>
                                                )}

                                                {/* Info */}
                                                <button
                                                    onClick={() => setSelectedAdopterId(res.adopter.id)}
                                                    className="flex-1 text-left min-w-0"
                                                >
                                                    <div className="font-bold text-sm text-stone-800 truncate">{res.adopter.name}</div>
                                                    <div className="flex items-center gap-2 text-xs text-stone-500">
                                                        {res.avgRating != null && (
                                                            <span className="flex items-center gap-0.5">
                                                                <span className="text-amber-500">⭐</span>{Number(res.avgRating).toFixed(1)}
                                                            </span>
                                                        )}
                                                        {res.stats?.adoptions > 0 && (
                                                            <span>{res.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}</span>
                                                        )}
                                                        {res.matchContext && <span className="text-teal-600">· {t(`wizard.${res.matchContext}`) || res.matchContext}</span>}
                                                    </div>
                                                </button>

                                                {/* Preview Button */}
                                                <button
                                                    onClick={() => setPreviewAdopter(res)}
                                                    className="p-2 text-stone-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors flex-shrink-0"
                                                    title={t('wizard.preview') || 'Preview'}
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* No Results */}
                                {searchPerformed && searchResults.length === 0 && (
                                    <div className="text-center py-4 text-stone-400 text-sm">
                                        {t('wizard.no_results_for') || 'No records found for'} &quot;{adopterSearch}&quot;
                                    </div>
                                )}

                                {/* Create New CTA */}
                                {searchPerformed && (
                                    <button
                                        onClick={handleCreateNew}
                                        className="w-full p-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-600 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50/30 transition-all text-sm font-bold text-center"
                                    >
                                        {adopterSearch.trim()
                                            ? `${t('wizard.create_new_named') || '+ Create new record for'} "${adopterSearch.trim()}"`
                                            : (t('wizard.create_new_record') || '+ Create new adopter record')
                                        }
                                    </button>
                                )}
                            </>
                        )}

                        <LegalConsent />

                        <div className="flex justify-between pt-4">
                            <button
                                onClick={handleBack}
                                className="text-stone-500 font-bold hover:text-stone-800"
                            >
                                {t('common.back') || 'Back'}
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={loading || !selectedAdopterId}
                                className="px-6 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? (t('common.processing') || 'Processing...') : 'Complete Adoption'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
