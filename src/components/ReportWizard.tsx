'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { findAdopters } from '@/app/actions';
import type { DiscoveryMatch, SnippetField } from '@/app/actions';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { StarRating } from '@/components/StarRating';
import { RatingBadge } from '@/components/RatingBadge';
import LegalConsent from '@/components/LegalConsent';


const SNIPPET_ICONS: Record<SnippetField, string> = {
    name: '👤', contact: '📞', address: '📍',
    family: '👨‍👩‍👧', adoption: '🐾', history: '📝',
};

export default function ReportWizard() {
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();
    const [isOpen, setIsOpen] = useState(false);

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);

    // Step 1: Adopter Data (search-first flow)
    const [selectedAdopterId, setSelectedAdopterId] = useState<string>('');
    const [adopterSearch, setAdopterSearch] = useState('');
    const [searchResults, setSearchResults] = useState<DiscoveryMatch[]>([]);
    const [previewAdopter, setPreviewAdopter] = useState<DiscoveryMatch | null>(null);
    const [searchPerformed, setSearchPerformed] = useState(false);

    // Step 2: Observation Details
    const [observationData, setObservationData] = useState({
        details: '',
        rating: 3
    });

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
        setSelectedAdopterId('');
        setAdopterSearch('');
        setSearchResults([]);
        setPreviewAdopter(null);
        setSearchPerformed(false);
        setObservationData({ details: '', rating: 3 });
    };

    const handleSearch = async (term: string) => {
        setAdopterSearch(term);
        setSelectedAdopterId('');
        setPreviewAdopter(null);
        if (term.length > 2) {
            const response = await findAdopters(
                { raw: term },
                { mode: 'discovery', enrich: true },
            );
            setSearchResults(response.results as DiscoveryMatch[]);
            setSearchPerformed(true);
        } else {
            setSearchResults([]);
            setSearchPerformed(false);
        }
    };

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleCreateNew = () => {
        const params = new URLSearchParams({
            newAdoption: 'observation',
            rating: String(observationData.rating),
            details: observationData.details,
            continueToAdoption: 'true'
        });
        if (adopterSearch.trim()) params.set('name', adopterSearch.trim());
        router.push(`/adopter/create?${params.toString()}`);
    };

    const handleFinish = async () => {
        setLoading(true);
        try {
            // Encode observation data for URL
            const params = new URLSearchParams({
                newAdoption: 'observation',
                rating: String(observationData.rating),
                details: observationData.details
            });

            if (!selectedAdopterId) {
                // No adopter selected — redirect to create
                handleCreateNew();
                return;
            }

            // Navigate to adopter profile with observation data
            router.push(`/adopter/${selectedAdopterId}?${params.toString()}#adoption-form`);
            handleClose();

        } catch (e) {
            console.error(e);
            toast.error(t('errors.generic'), t('errors.unexpected'), extractErrorId(e));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <div
                data-testid="report-wizard-btn"
                className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-rose-200 transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer"
                onClick={handleStart}
            >
                <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-700 group-hover:scale-110 transition-transform">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <h3 className="text-xl font-semibold text-stone-900 mb-2">{t('home.action_report_title')}</h3>
                <p className="text-stone-500 mb-4 text-sm">{t('home.action_report_desc')}</p>
                <button
                    className="inline-block px-6 py-2.5 bg-rose-200 text-rose-900 font-semibold rounded-xl hover:bg-rose-300 transition-colors shadow-sm"
                >
                    {t('home.action_report_btn')}
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl mx-auto max-h-[90vh] overflow-y-auto relative">
                <button onClick={handleClose} className="absolute top-4 right-4 text-stone-500 hover:text-stone-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h2 className="text-2xl font-semibold text-stone-800 mb-6 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-rose-100 text-rose-800 flex items-center justify-center text-sm">{step}</span>
                    {step === 1 ? (t('wizard.who_is_adopter') || 'Who is the adopter?') : (t('wizard.step_observation') || 'Observation Details')}
                </h2>

                {step === 1 && (
                    <div className="space-y-5">
                        {/* Preview Panel */}
                        {previewAdopter ? (
                            <div className="animate-in slide-in-from-right duration-200">
                                <div className="border border-teal-200 rounded-xl overflow-hidden bg-teal-50">
                                    {/* Preview Header */}
                                    <div className="p-4 border-b border-teal-100 flex items-center gap-3">
                                        {previewAdopter.thumbnail ? (
                                            <img src={previewAdopter.thumbnail} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm" />
                                        ) : (
                                            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold text-lg">
                                                {previewAdopter.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-stone-800 text-lg">{previewAdopter.adopter.name}</div>
                                            {previewAdopter.matchSnippet && (
                                                <div className="text-xs text-rose-600">{SNIPPET_ICONS[previewAdopter.matchSnippet.field as SnippetField]} {t(`search.snippet_${previewAdopter.matchSnippet.field}`)}</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Preview Details */}
                                    <div className="p-4 space-y-3">
                                        {previewAdopter.adopter.contactInfo && (
                                            <div>
                                                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.contact') || 'Contact'}</div>
                                                <div className="text-sm text-stone-700 whitespace-pre-line line-clamp-3">{previewAdopter.adopter.contactInfo}</div>
                                            </div>
                                        )}
                                        <div className="flex gap-4 text-sm">
                                            {previewAdopter.avgRating != null && (
                                                <RatingBadge rating={previewAdopter.avgRating} variant="inline" size="sm" />
                                            )}
                                            {previewAdopter.stats?.adoptions != null && (
                                                <div className="text-stone-500">
                                                    {previewAdopter.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}
                                                </div>
                                            )}
                                        </div>
                                        {previewAdopter.adopter.familyMembers && (
                                            <div>
                                                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.family_members') || 'Family'}</div>
                                                <div className="text-sm text-stone-600 line-clamp-2">{previewAdopter.adopter.familyMembers}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Preview Actions */}
                                    <div className="p-4 border-t border-teal-100 flex justify-between">
                                        <button
                                            onClick={() => setPreviewAdopter(null)}
                                            className="text-stone-500 text-sm font-semibold hover:text-stone-800 transition-colors"
                                        >
                                            {t('wizard.back_to_results') || '← Back to results'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedAdopterId(previewAdopter.adopter.id);
                                                setPreviewAdopter(null);
                                            }}
                                            className="px-5 py-2 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors text-sm"
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
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-500">
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
                                        <span className="text-sm font-semibold text-teal-800 flex-1">
                                            {searchResults.find(r => r.adopter.id === selectedAdopterId)?.adopter.name || 'Adopter selected'}
                                        </span>
                                        <button onClick={() => setSelectedAdopterId('')} className="text-stone-400 hover:text-stone-600 text-xs font-semibold">✕</button>
                                    </div>
                                )}

                                {/* Hint when empty */}
                                {!searchPerformed && !selectedAdopterId && (
                                    <div className="text-center py-6 text-stone-500 text-sm">
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
                                                className={`flex items-center gap-3 p-3 hover:bg-teal-50 transition-colors ${selectedAdopterId === res.adopter.id ? 'bg-teal-50 border-l-2 border-l-teal-500' : ''}`}
                                            >
                                                {/* Thumbnail */}
                                                {res.thumbnail ? (
                                                    <img src={res.thumbnail} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 font-semibold text-sm flex-shrink-0">
                                                        {res.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                                    </div>
                                                )}

                                                {/* Info */}
                                                <button
                                                    onClick={() => setSelectedAdopterId(res.adopter.id)}
                                                    className="flex-1 text-left min-w-0"
                                                >
                                                    <div className="font-semibold text-sm text-stone-800 truncate">{res.adopter.name}</div>
                                                    <div className="flex items-center gap-2 text-xs text-stone-500">
                                                        {res.avgRating != null && (
                                                            <RatingBadge rating={res.avgRating} variant="inline" size="sm" />
                                                        )}
                                                        {res.stats?.adoptions > 0 && (
                                                            <span>{res.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}</span>
                                                        )}
                                                        {res.matchSnippet && <span className="text-rose-600">· {SNIPPET_ICONS[res.matchSnippet.field as SnippetField]} {t(`search.snippet_${res.matchSnippet.field}`)}</span>}
                                                    </div>
                                                </button>

                                                {/* Preview Button */}
                                                <button
                                                    onClick={() => setPreviewAdopter(res)}
                                                    className="p-2 text-stone-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors flex-shrink-0"
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
                                    <div className="text-center py-4 text-stone-500 text-sm">
                                        {t('wizard.no_results_for') || 'No records found for'} &quot;{adopterSearch}&quot;
                                    </div>
                                )}

                                {/* Create New CTA */}
                                {searchPerformed && (
                                    <button
                                        onClick={handleCreateNew}
                                        className="w-full p-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-600 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50 transition-all text-sm font-semibold text-center"
                                    >
                                        {adopterSearch.trim()
                                            ? `${t('wizard.create_new_named') || '+ Create new record for'} "${adopterSearch.trim()}"`
                                            : (t('wizard.create_new_record') || '+ Create new adopter record')
                                        }
                                    </button>
                                )}
                            </>
                        )}

                        <div className="flex justify-end pt-4">
                            <button
                                onClick={handleNext}
                                disabled={!selectedAdopterId}
                                className="px-6 py-2 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50"
                            >
                                {t('wizard.next') || 'Next: Details'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-6">
                        {/* Rating */}
                        <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-2">
                                {t('adoption.rating') || 'Rating'}
                            </label>
                            <StarRating
                                value={observationData.rating}
                                onChange={(r) => setObservationData({ ...observationData, rating: r })}
                                size="lg"
                            />
                            <p className="text-xs text-stone-500 mt-1">1 = {t('ratings.dangerous') || 'Dangerous'}, 5 = {t('ratings.excellent') || 'Excellent'}</p>
                        </div>

                        {/* Details */}
                        <div>
                            <label className="block text-sm font-semibold text-stone-700 mb-2">
                                {t('adoption.details') || 'Details'}
                            </label>
                            <textarea
                                className="w-full p-3 rounded-xl border border-stone-300 h-24"
                                placeholder={t('wizard.observation_details_placeholder') || 'What did you observe about this adopter?'}
                                value={observationData.details}
                                onChange={e => setObservationData({ ...observationData, details: e.target.value })}
                            />
                        </div>


                        <LegalConsent />

                        <div className="flex justify-between pt-4">
                            <button
                                onClick={handleBack}
                                className="text-stone-500 font-semibold hover:text-stone-800"
                            >
                                {t('common.back') || 'Back'}
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={loading}
                                className="px-6 py-2 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50"
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
