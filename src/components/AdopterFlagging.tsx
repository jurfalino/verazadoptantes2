'use client';

import { useState, useEffect } from 'react';
import { flagAdopter, searchAdopter } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

export function AdopterFlagging({ adopterId, adopterName, existingFlags }: { adopterId: string, adopterName: string, existingFlags: any[] }) {
    const router = useRouter();
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState('duplicate');
    const [details, setDetails] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [targetAdopter, setTargetAdopter] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);

    // Filter duplicates from existing flags
    const duplicateFlags = existingFlags.filter(f => f.reason === 'duplicate');
    const isFlaggedAsDuplicate = duplicateFlags.length > 0;

    // Debounce Logic
    useEffect(() => {
        if (!isOpen) {
            // Reset when closed
            setSearchTerm('');
            setSearchResults([]);
            setHasSearched(false);
            return;
        }

        const timeoutId = setTimeout(async () => {
            if (!searchTerm.trim()) {
                setSearchResults([]);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            setHasSearched(true);
            try {
                // Perform search
                const res = await searchAdopter(searchTerm);
                // Exclude current adopter
                setSearchResults(res.filter(r => r.adopter.id !== adopterId));
            } catch (e) {
                console.error(e);
            } finally {
                setIsSearching(false);
            }
        }, 500); // 500ms delay

        return () => clearTimeout(timeoutId);
    }, [searchTerm, adopterId, isOpen]);

    const handleManualSearch = async () => {
        if (!searchTerm.trim()) return;
        setIsSearching(true);
        setHasSearched(true);
        try {
            const res = await searchAdopter(searchTerm);
            setSearchResults(res.filter(r => r.adopter.id !== adopterId));
        } finally {
            setIsSearching(false);
        }
    };

    const handleSubmit = async () => {
        setSubmitLoading(true);
        try {
            await flagAdopter(
                adopterId,
                reason,
                details,
                targetAdopter?.id
            );
            setIsOpen(false);
            router.refresh();
        } catch (error) {
            console.error(error);
            alert("Failed to save report");
        } finally {
            setSubmitLoading(false);
        }
    };

    return (
        <>
            {/* Warning Banner */}
            {isFlaggedAsDuplicate && (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6 rounded-r-lg shadow-sm">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-amber-800 font-medium">
                                {t('flagging.banner_duplicate')}
                                {duplicateFlags[0].targetAdopterId && (
                                    <span> {t('flagging.banner_check')} <a href={`/adopter/${duplicateFlags[0].targetAdopterId}`} className="font-bold underline hover:text-amber-900 transition-colors">{t('flagging.check_link')}</a>.</span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Header Button */}
            <div className="absolute top-0 right-0 mt-4 mr-4">
                <button
                    onClick={() => setIsOpen(true)}
                    className="group flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-full transition-all duration-200"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-8a2 2 0 012-2h10a2 2 0 012 2v6l-3-2-3 2-3-2-3 2zm4-8V5a2 2 0 012-2h6a2 2 0 012 2v2m-6 9l2-2 2 2" />
                    </svg>
                    <span className="text-sm font-semibold tracking-wide">{t('flagging.report_merge')}</span>
                </button>
            </div>

            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 bg-emerald-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 max-h-[90vh] overflow-y-auto transform transition-all scale-100 border border-emerald-100">
                        <div className="flex justify-between items-start mb-6">
                            <h3 className="text-2xl font-bold text-emerald-900 tracking-tight">
                                {t('flagging.report_title')} <span className="text-emerald-500">{adopterName}</span>
                            </h3>
                            <button onClick={() => setIsOpen(false)} className="text-emerald-900/40 hover:text-emerald-700 transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('flagging.reason')}</label>
                                <select
                                    className="w-full h-12 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 font-medium focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none"
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                >
                                    <option value="duplicate">{t('flagging.reason_duplicate')}</option>
                                    <option value="fake">{t('flagging.reason_fake')}</option>
                                    <option value="abusive">{t('flagging.reason_abusive')}</option>
                                </select>
                            </div>

                            {reason === 'duplicate' && (
                                <div className="p-5 bg-emerald-50 rounded-xl border border-emerald-100">
                                    <label className="block text-sm font-bold text-emerald-800 mb-3">{t('flagging.find_original')}</label>
                                    <div className="flex gap-2 mb-3">
                                        <div className="relative flex-1">
                                            <input
                                                className="w-full h-10 px-3 pl-10 rounded-lg border border-emerald-200 bg-white text-emerald-900 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-shadow"
                                                placeholder={t('flagging.search_placeholder')}
                                                value={searchTerm}
                                                onChange={e => setSearchTerm(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                                            />
                                            <div className="absolute left-3 top-2.5 text-emerald-400">
                                                {isSearching ? (
                                                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                    </svg>
                                                ) : (
                                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {searchTerm && !isSearching && searchResults.length === 0 && hasSearched && (
                                        <div className="text-center py-4 bg-white/50 rounded-lg border border-dashed border-emerald-200/50">
                                            <p className="text-sm text-emerald-600/60">No matching profiles found.</p>
                                        </div>
                                    )}

                                    {searchResults.length > 0 && (
                                        <div className="max-h-48 overflow-y-auto space-y-2 mb-3 custom-scrollbar">
                                            {searchResults.map(res => (
                                                <div
                                                    key={res.adopter.id}
                                                    className={`p-3 border rounded-lg cursor-pointer text-sm transition-all ${targetAdopter?.id === res.adopter.id
                                                        ? 'bg-emerald-100 border-emerald-500 ring-1 ring-emerald-500'
                                                        : 'bg-white border-emerald-100 hover:border-emerald-300 hover:shadow-sm'}`}
                                                    onClick={() => setTargetAdopter(res.adopter)}
                                                >
                                                    <div className="font-bold text-emerald-900">{res.adopter.name}</div>
                                                    <div className="text-emerald-600 truncate">{res.adopter.email || res.adopter.phone}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {targetAdopter && (
                                        <div className="flex items-center gap-2 text-sm text-emerald-800 bg-white px-3 py-2 rounded-lg border border-emerald-200 shadow-sm">
                                            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            <span className="font-bold">{t('flagging.selected_original')}: {targetAdopter.name}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">{t('flagging.details')}</label>
                                <textarea
                                    className="w-full p-4 rounded-xl border border-emerald-200 bg-white text-emerald-900 placeholder-emerald-800/40 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all outline-none resize-none"
                                    rows={4}
                                    value={details}
                                    onChange={e => setDetails(e.target.value)}
                                    placeholder={t('flagging.details_placeholder')}
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-emerald-100">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="px-5 py-2.5 text-emerald-700 font-semibold hover:bg-emerald-50 rounded-xl transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitLoading || (reason === 'duplicate' && !targetAdopter)}
                                    className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/30 disabled:opacity-50 disabled:shadow-none transition-all"
                                >
                                    {submitLoading ? t('flagging.submitting') : t('flagging.submit')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
