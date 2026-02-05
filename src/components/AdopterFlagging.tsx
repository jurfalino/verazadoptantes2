'use client';

import { useState, useEffect } from 'react';
import { flagAdopter, searchAdopter, removeVerification } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';

export function AdopterFlagging({ adopterId, adopterName, existingFlags, hasVerifiedAdoption = false, hasVerifiedAddress = false, tooManyAdoptions, tooManyRequests }: { adopterId: string, adopterName: string, existingFlags: any[], hasVerifiedAdoption?: boolean, hasVerifiedAddress?: boolean, tooManyAdoptions?: { count: number; threshold: number; periodDays: number }, tooManyRequests?: { count: number; threshold: number; periodDays: number } }) {
    const router = useRouter();
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState('duplicate');
    const [details, setDetails] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [targetAdopter, setTargetAdopter] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);

    const duplicateFlags = existingFlags.filter(f => f.reason === 'duplicate');
    const isFlaggedAsDuplicate = duplicateFlags.length > 0;

    const inaccurateFlags = existingFlags.filter(f => f.reason === 'inaccurate_information');
    const isFlaggedAsInaccurate = inaccurateFlags.length > 0;

    // Verification flags - include adoption-based verification
    const identityVerifiedFlag = existingFlags.find(f => f.reason === 'verified_identity');
    const identityVerified = identityVerifiedFlag || hasVerifiedAdoption;
    const addressVerifiedFlag = existingFlags.find(f => f.reason === 'verified_address');
    const addressVerified = addressVerifiedFlag || hasVerifiedAddress;

    const [isVerifying, setIsVerifying] = useState(false);
    const [isUnverifying, setIsUnverifying] = useState(false);



    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchTerm && reason === 'duplicate') {
                setIsSearching(true);
                try {
                    const results = await searchAdopter(searchTerm);
                    setSearchResults(results);
                    setHasSearched(true);
                } catch (error) {
                    console.error("Search failed", error);
                } finally {
                    setIsSearching(false);
                }
            } else {
                setSearchResults([]);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, reason]);

    const handleManualSearch = async () => {
        if (!searchTerm) return;
        setIsSearching(true);
        try {
            const results = await searchAdopter(searchTerm);
            setSearchResults(results);
            setHasSearched(true);
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSubmit = async () => {
        if (!reason) return;
        if (reason === 'duplicate' && !targetAdopter) return;

        setSubmitLoading(true);
        try {
            const targetId = reason === 'duplicate' ? targetAdopter?.id : undefined;
            const res = await flagAdopter(adopterId, reason, details, targetId);

            if (res.success) {
                alert(t('flagging.submit_success') || 'Report submitted successfully');
                setIsOpen(false);
                setDetails('');
                setReason('duplicate');
                setTargetAdopter(null);
                setSearchTerm('');
                router.refresh();
            } else {
                alert('Failed to submit report');
            }
        } catch (e) {
            console.error(e);
            alert('Error submitting report');
        } finally {
            setSubmitLoading(false);
        }
    };

    const handleVerify = async (type: 'verified_identity' | 'verified_address') => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }
        setIsVerifying(true);
        try {
            const res = await flagAdopter(adopterId, type, `Verified by user`);
            if (res.success) {
                router.refresh();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsVerifying(false);
        }
    };

    const handleUnverify = async (type: 'verified_identity' | 'verified_address') => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }
        if (!confirm(t('flags.confirm_unverify') || 'Remove this verification?')) return;

        setIsUnverifying(true);
        try {
            const res = await removeVerification(adopterId, type);
            if (res.success) {
                router.refresh();
            }
        } catch (e) {
            console.error(e);
            alert(t('flags.unverify_error') || 'Could not remove verification. You may only remove verifications you added.');
        } finally {
            setIsUnverifying(false);
        }
    };

    const [showDuplicateModal, setShowDuplicateModal] = useState(false);

    return (
        <>
            {/* Compact Flag Pills Row */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {/* Inaccurate Information Flag */}
                {isFlaggedAsInaccurate && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-100 text-rose-700 rounded-full text-xs font-bold border border-rose-200 animate-in fade-in">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {t('flags.inaccurate') || 'Inaccurate'}
                    </span>
                )}

                {/* Duplicate - with See button */}
                {isFlaggedAsDuplicate && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold border border-amber-200">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                            <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                        </svg>
                        {t('flags.duplicate') || 'Duplicate'}
                        {duplicateFlags[0]?.targetAdopterId && (
                            <button
                                onClick={() => setShowDuplicateModal(true)}
                                className="ml-1 px-1.5 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-800 rounded text-[10px] font-bold transition-colors"
                            >
                                {t('common.see') || 'See'}
                            </button>
                        )}
                    </span>
                )}

                {/* Verified Identity */}
                {identityVerified && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        {t('flags.id_verified') || '✓ Identidad'}
                    </span>
                )}

                {/* Verified Address */}
                {addressVerified && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                        {t('flags.addr_verified') || '✓ Direccion'}
                    </span>
                )}

                {/* Too Many Adoptions Warning */}
                {tooManyAdoptions && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold border border-orange-200">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {`${tooManyAdoptions.count} ${t('stats.adoptions') || 'adoptions'} ${t('common.in') || 'in'} ${tooManyAdoptions.periodDays}d`}
                    </span>
                )}

                {/* Too Many Requests Warning */}
                {tooManyRequests && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full text-xs font-bold border border-purple-200">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        {`${tooManyRequests.count} ${t('stats.requests') || 'requests'} ${t('common.in') || 'in'} ${tooManyRequests.periodDays}d`}
                    </span>
                )}
            </div>

            {/* Duplicate Details Modal */}
            {showDuplicateModal && duplicateFlags[0]?.targetAdopterId && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
                    onClick={() => setShowDuplicateModal(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-amber-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-lg font-bold text-amber-800 flex items-center gap-2">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                                    <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                                </svg>
                                {t('flags.duplicate_detected') || 'Duplicate Detected'}
                            </h3>
                            <button
                                onClick={() => setShowDuplicateModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <p className="text-sm text-gray-600 mb-4">
                            {t('flags.duplicate_desc') || 'This profile may be a duplicate of another adopter.'}
                        </p>

                        {duplicateFlags[0].details && (
                            <div className="bg-amber-50 rounded-lg p-3 mb-4 text-sm text-amber-800">
                                <span className="font-medium">{t('common.details') || 'Details'}:</span> {duplicateFlags[0].details}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <a
                                href={`/adopter/${duplicateFlags[0].targetAdopterId}`}
                                className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium text-center transition-colors"
                            >
                                {t('flags.view_original') || 'View Original'}
                            </a>
                            <button
                                onClick={() => setShowDuplicateModal(false)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                            >
                                {t('common.close') || 'Close'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header Button */}
            <div className="absolute top-0 right-0 mt-4 mr-4">
                <button
                    onClick={() => {
                        const isAnon = document.cookie.includes('anon_user=true');
                        if (!session?.user && !isAnon) {
                            openLogin();
                            return;
                        }
                        setIsOpen(true);
                    }}
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
                                    <option value="inaccurate_information">{t('flagging.reason_inaccurate')}</option>
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
