'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { flagAdopter, findAdopters, getDuplicateCandidates } from '@/app/actions';
import type { DuplicateCandidate, DiscoveryMatch } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { zarazTrack } from '@/lib/zaraz';
import { formatShortDate } from '@/lib/dates';

export interface AdopterFlaggingHandle {
    openAction: (action: string) => void;
}

/** Collapsible expander for < 15% confidence suggestions. */
function ShowLowConfidenceSuggestions({ suppressed, targetAdopter, setTargetAdopter }: {
    suppressed: DuplicateCandidate[];
    targetAdopter: { id: string; name: string } | null;
    setTargetAdopter: (v: { id: string; name: string }) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div>
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1 mt-1 transition-colors"
            >
                <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {expanded ? 'Ocultar' : `Ver`} {suppressed.length} coincidencia{suppressed.length !== 1 ? 's' : ''} de baja confianza
            </button>
            {expanded && (
                <div className="space-y-1.5 mt-1.5 opacity-70">
                    {suppressed.map(sug => (
                        <div
                            key={sug.id}
                            className={`p-3 border rounded-lg cursor-pointer text-sm transition-all ${targetAdopter?.id === sug.otherAdopterId
                                ? 'bg-teal-100 border-teal-500 ring-1 ring-teal-500'
                                : 'bg-stone-50 border-stone-200 hover:border-stone-400'
                                }`}
                            onClick={() => setTargetAdopter({ id: sug.otherAdopterId, name: sug.otherAdopterName })}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-stone-700">{sug.otherAdopterName}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">{sug.confidencePercent}% match</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {sug.matchTypes.map(type => (
                                    <span key={type} className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">{type.replace('_', ' ')}</span>
                                ))}
            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export const AdopterFlagging = forwardRef<AdopterFlaggingHandle, { adopterId: string, adopterName: string, existingFlags: any[], hasVerifiedAdoption?: boolean, hasVerifiedAddress?: boolean, tooManyAdoptions?: { count: number; actualSpanDays?: number; periodDays: number; startDate?: Date | null; endDate?: Date | null }, tooManyRequests?: { count: number; actualSpanDays?: number; periodDays: number; startDate?: Date | null; endDate?: Date | null }, hasDuplicateBanner?: boolean }>(function AdopterFlagging({ adopterId, adopterName: _adopterName, existingFlags, hasVerifiedAdoption = false, hasVerifiedAddress: _hasVerifiedAddress = false, tooManyAdoptions, tooManyRequests, hasDuplicateBanner = false }, ref) {
    const router = useRouter();
    const { t } = useLanguage();
    const { data: _session } = useSession();
    const { openLogin: _openLogin } = useAuthContext();
    const toast = useShowToast();
    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState('duplicate');
    const [details, setDetails] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<DiscoveryMatch[]>([]);
    const [targetAdopter, setTargetAdopter] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);
    const [systemSuggestions, setSystemSuggestions] = useState<DuplicateCandidate[]>([]);
    // Data-request form fields (for inaccuracy/deletion — open to anyone)
    const [requesterName, setRequesterName] = useState('');
    const [requesterEmail, setRequesterEmail] = useState('');
    const [dataRequestSubmitted, setDataRequestSubmitted] = useState(false);
    
    // Tap-to-expand context hints for flags
    const [showAdoptionsHint, setShowAdoptionsHint] = useState(false);
    const [showRequestsHint, setShowRequestsHint] = useState(false);
    const [showInaccurateHint, setShowInaccurateHint] = useState(false);
    const [showIdentityHint, setShowIdentityHint] = useState(false);
    const [_showAddressHint, _setShowAddressHint] = useState(false);

    // Fetch system-detected duplicate candidates on mount
    useEffect(() => {
        getDuplicateCandidates(adopterId).then(setSystemSuggestions).catch(() => { });
    }, [adopterId]);

    const duplicateFlags = existingFlags.filter(f => f.reason === 'duplicate');
    const isFlaggedAsDuplicate = duplicateFlags.length > 0;

    const inaccurateFlags = existingFlags.filter(f => f.reason === 'inaccurate_information' || f.reason === 'inaccurate');
    const isFlaggedAsInaccurate = inaccurateFlags.length > 0;

    // Verification flags - include adoption-based verification
    const identityVerifiedFlag = existingFlags.find(f => f.reason === 'verified_identity');
    const identityVerified = identityVerifiedFlag || hasVerifiedAdoption;
    const _addressVerifiedFlag = existingFlags.find(f => f.reason === 'verified_address');
    const _addressVerified = _addressVerifiedFlag || _hasVerifiedAddress;







    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (searchTerm && reason === 'duplicate') {
                setIsSearching(true);
                try {
                    const response = await findAdopters(
                        { raw: searchTerm },
                        { mode: 'discovery', enrich: false },
                    );
                    setSearchResults(response.results as DiscoveryMatch[]);
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
            const response = await findAdopters(
                { raw: searchTerm },
                { mode: 'discovery', enrich: false },
            );
            setSearchResults(response.results as DiscoveryMatch[]);
            setHasSearched(true);
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSubmit = async () => {
        if (!reason) return;

        // Duplicate flow — uses flagAdopter (auth required)
        if (reason === 'duplicate') {
            if (!targetAdopter) return;
            setSubmitLoading(true);
            try {
                const res = await flagAdopter(adopterId, reason, details, targetAdopter.id);
                if (res.success) {
                    toast.success(t('flagging.submit_success') || 'Report submitted successfully');
                    zarazTrack('flag_submitted', { flagType: 'duplicate' });
                    resetAndClose();
                    router.refresh();
                } else {
                    toast.error(t('errors.generic'), t('errors.submit_report_failed'));
                }
            } catch (e) {
                console.error(e);
                toast.error(t('errors.generic'), t('errors.report_error'), extractErrorId(e));
            } finally {
                setSubmitLoading(false);
            }
            return;
        }

        // Inaccuracy / Deletion flow — uses data-request API (no auth needed)
        if (reason === 'inaccuracy' || reason === 'deletion') {
            if (!requesterName.trim() || !details.trim()) return;
            setSubmitLoading(true);
            try {
                const res = await fetch('/api/data-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adopterId,
                        requesterName: requesterName.trim(),
                        requesterEmail: requesterEmail.trim() || null,
                        requestType: reason,
                        details: details.trim(),
                    }),
                });
                if (res.ok) {
                    zarazTrack('flag_submitted', { flagType: reason });
                    setDataRequestSubmitted(true);
                } else {
                    const body = await res.json().catch(() => ({})) as { error?: string; errorId?: string };
                    toast.error(t('errors.generic'), body.error || t('errors.submit_request_failed'), body.errorId);
                }
            } catch (e) {
                toast.error(t('errors.generic'), t('errors.request_error'), extractErrorId(e));
            } finally {
                setSubmitLoading(false);
            }
            return;
        }

        // Inaccurate information flag (legacy — auth flow)
        setSubmitLoading(true);
        try {
            const res = await flagAdopter(adopterId, reason, details);
            if (res.success) {
                toast.success(t('flagging.submit_success') || 'Report submitted successfully');
                zarazTrack('flag_submitted', { flagType: reason });
                resetAndClose();
                router.refresh();
            } else {
                toast.error(t('errors.generic'), t('errors.submit_report_failed'));
            }
        } catch (e) {
            console.error(e);
            toast.error(t('errors.generic'), t('errors.report_error'), extractErrorId(e));
        } finally {
            setSubmitLoading(false);
        }
    };

    const resetAndClose = () => {
        setIsOpen(false);
        setDetails('');
        setReason('duplicate');
        setTargetAdopter(null);
        setSearchTerm('');
        setRequesterName('');
        setRequesterEmail('');
        setDataRequestSubmitted(false);
    };

    const openAction = (action: string) => {
        setReason(action);
        setDataRequestSubmitted(false);
        setIsOpen(true);
    };

    useImperativeHandle(ref, () => ({
        openAction,
    }));




    const [showDuplicateHint, setShowDuplicateHint] = useState(false);

    return (
        <>
            {/* Flag Pills — split into warnings and verifications */}
            <div className="space-y-2 mb-4">
                {/* ⚠ Warnings: things that need attention */}
                {(isFlaggedAsInaccurate || isFlaggedAsDuplicate || tooManyAdoptions || tooManyRequests) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Inaccurate Information Flag */}
                        {isFlaggedAsInaccurate && (
                            <button
                                type="button"
                                onClick={() => setShowInaccurateHint(!showInaccurateHint)}
                                aria-pressed={showInaccurateHint}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all hover:opacity-90 ${showInaccurateHint ? 'shadow-inner' : ''} animate-in fade-in`}
                                style={{
                                    background: 'var(--status-error-bg)',
                                    color: 'var(--status-error-text)',
                                    borderColor: 'var(--status-error-border)',
                                }}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showInaccurateHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {t('flags.inaccurate') || 'Inaccurate'}
                            </button>
                        )}

                        {/* Duplicate - click to expand hint */}
                        {isFlaggedAsDuplicate && !hasDuplicateBanner && (
                            <button
                                type="button"
                                onClick={() => setShowDuplicateHint(!showDuplicateHint)}
                                aria-pressed={showDuplicateHint}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all hover:opacity-90 ${showDuplicateHint ? 'shadow-inner' : ''} animate-in fade-in`}
                                style={{
                                    background: 'var(--status-warning-bg)',
                                    color: 'var(--status-warning-text)',
                                    borderColor: 'var(--status-warning-border)',
                                }}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showDuplicateHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                                    <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                                </svg>
                                {t('flags.duplicate') || 'Duplicate'}
                            </button>
                        )}

                        {/* Too Many Adoptions Warning */}
                        {tooManyAdoptions && (
                            <button
                                type="button"
                                onClick={() => setShowAdoptionsHint(!showAdoptionsHint)}
                                aria-pressed={showAdoptionsHint}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all hover:opacity-90 ${showAdoptionsHint ? 'shadow-inner' : ''} animate-in fade-in`}
                                style={{
                                    background: 'var(--status-warning-bg)',
                                    color: 'var(--status-warning-text)',
                                    borderColor: 'var(--status-warning-border)',
                                }}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showAdoptionsHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {tooManyAdoptions.count} {t('stats.adoptions') || 'adopciones'} {t('common.in') || 'en'} {Math.max(1, Math.round(tooManyAdoptions.actualSpanDays || tooManyAdoptions.periodDays))} {t('common.days') || 'días'}
                            </button>
                        )}

                        {/* Too Many Requests Warning */}
                        {tooManyRequests && (
                            <button
                                type="button"
                                onClick={() => setShowRequestsHint(!showRequestsHint)}
                                aria-pressed={showRequestsHint}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all hover:opacity-90 ${showRequestsHint ? 'shadow-inner' : ''} animate-in fade-in`}
                                style={{
                                    background: 'var(--status-purple-bg)',
                                    color: 'var(--status-purple-text)',
                                    borderColor: 'var(--status-purple-border)',
                                }}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showRequestsHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {tooManyRequests.count} {t('stats.requests') || 'solicitudes'} {t('common.in') || 'en'} {Math.max(1, Math.round(tooManyRequests.actualSpanDays || tooManyRequests.periodDays))} {t('common.days') || 'días'}
                            </button>
                        )}
                        
                        {/* Context hints revealed on tap */}
                        {showInaccurateHint && isFlaggedAsInaccurate && (
                            <div className="w-full mt-1 p-3 bg-rose-50 dark:bg-stone-800/80 border border-rose-100 dark:border-rose-900/50 rounded-lg text-xs leading-relaxed text-rose-800 dark:text-rose-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-rose-100 dark:border-b-stone-700"></div>
                                <span className="font-semibold text-rose-900 dark:text-rose-300 block mb-0.5">{t('flags.hint_title') || 'Por qué está marcado'}</span>
                                {inaccurateFlags[0]?.details || t('flags.inaccurate_desc') || 'Este perfil fue reportado como inexacto.'}
                            </div>
                        )}
                        {showDuplicateHint && isFlaggedAsDuplicate && !hasDuplicateBanner && (
                            <div className="w-full mt-1 p-3 bg-amber-50 dark:bg-stone-800/80 border border-amber-100 dark:border-amber-900/50 rounded-lg text-xs leading-relaxed text-amber-800 dark:text-amber-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-amber-100 dark:border-b-stone-700"></div>
                                <span className="font-semibold text-amber-900 dark:text-amber-300 block mb-0.5">{t('flags.hint_title') || 'Por qué está marcado'}</span>
                                {t('flags.duplicate_desc') || 'Este perfil podría ser un duplicado de otro adoptante.'}
                                {duplicateFlags[0]?.details && (
                                    <span className="block mt-1 font-medium italic text-amber-700 dark:text-amber-400">"{duplicateFlags[0].details}"</span>
                                )}
                                {duplicateFlags[0]?.targetAdopterId && (
                                    <a
                                        href={`/adopter/${duplicateFlags[0].targetAdopterId}`}
                                        className="inline-flex items-center gap-1 mt-2 text-amber-700 dark:text-amber-300 font-semibold hover:text-amber-900 dark:hover:text-amber-100 hover:underline transition-colors"
                                    >
                                        {t('flags.view_original') || 'View Original'}
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                        </svg>
                                    </a>
                                )}
                            </div>
                        )}
                        {showAdoptionsHint && tooManyAdoptions && (
                            <div className="w-full mt-1 p-3 bg-orange-50 dark:bg-stone-800/80 border border-orange-100 dark:border-orange-900/50 rounded-lg text-xs leading-relaxed text-orange-800 dark:text-orange-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-orange-100 dark:border-b-stone-700"></div>
                                <span className="font-semibold text-orange-900 dark:text-orange-300 block mb-0.5">{t('flags.hint_title') || 'Por qué está marcado'}</span>
                                {t('flags.adoptions_warning_p1') || 'Registró '}{tooManyAdoptions.count}{t('flags.adoptions_warning_p2') || ' adopciones en '}{Math.max(1, Math.round(tooManyAdoptions.actualSpanDays || 0))}{t('flags.adoptions_warning_p3') || ' días'}
                                {tooManyAdoptions.startDate && tooManyAdoptions.endDate && (
                                    <> {t('flags.warning_dates') || '(ocurrido entre'} {formatShortDate(tooManyAdoptions.startDate)} {t('flags.and') || 'y'} {formatShortDate(tooManyAdoptions.endDate)})</>
                                )}. {t('flags.adoptions_risk') || 'Una frecuencia inusualmente alta indica un posible riesgo de acumulación o falta de capacidad de seguimiento.'}
                            </div>
                        )}
                        {showRequestsHint && tooManyRequests && (
                            <div className="w-full mt-1 p-3 bg-purple-50 dark:bg-stone-800/80 border border-purple-100 dark:border-purple-900/50 rounded-lg text-xs leading-relaxed text-purple-800 dark:text-purple-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-purple-100 dark:border-b-stone-700"></div>
                                <span className="font-semibold text-purple-900 dark:text-purple-300 block mb-0.5">{t('flags.hint_title') || 'Por qué está marcado'}</span>
                                {t('flags.requests_warning_p1') || 'Registró '}{tooManyRequests.count}{t('flags.requests_warning_p2') || ' solicitudes en '}{Math.max(1, Math.round(tooManyRequests.actualSpanDays || 0))}{t('flags.requests_warning_p3') || ' días'}
                                {tooManyRequests.startDate && tooManyRequests.endDate && (
                                    <> {t('flags.warning_dates') || '(ocurrido entre'} {formatShortDate(tooManyRequests.startDate)} {t('flags.and') || 'y'} {formatShortDate(tooManyRequests.endDate)})</>
                                )}. {t('flags.requests_risk') || 'Solicitar múltiples animales de forma simultánea requiere verificación adicional.'}
                            </div>
                        )}
                    </div>
                )}

                {/* ✓ Verifications: inline interactive pills */}
                {(identityVerified) && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        {identityVerified && (
                            <button
                                type="button"
                                onClick={() => setShowIdentityHint(!showIdentityHint)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${showIdentityHint ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border-teal-200 dark:border-teal-700 shadow-inner' : 'bg-transparent text-teal-700 dark:text-teal-300 border-transparent hover:bg-teal-50 dark:hover:bg-teal-900/20'}`}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showIdentityHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                {t('flags.id_verified') || '✓ Identity'}
                            </button>
                        )}

                    </div>
                )}
                
                {/* Verification Context Hints */}
                {showIdentityHint && identityVerified && (
                    <div className="w-full mt-1 p-3 bg-teal-50 dark:bg-stone-800/80 border border-teal-100 dark:border-teal-900/50 rounded-lg text-xs leading-relaxed text-teal-800 dark:text-teal-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                        <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-teal-100 dark:border-b-stone-700"></div>
                        <span className="font-semibold text-teal-900 dark:text-teal-300 block mb-0.5">{t('flags.id_verified') || 'Identidad Verificada'}</span>
                        {identityVerifiedFlag?.details || t('flags.legend_verified') || 'Confirmamos que esta persona es quien dice ser.'}
                    </div>
                )}

            </div>




            {/* Modal */}
            {isOpen && (
                <div className="fixed inset-0 bg-teal-950/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 max-h-[90vh] overflow-y-auto transform transition-all scale-100 border border-teal-100">
                        <div className="flex justify-between items-start mb-6">
                            <h3 className="text-2xl font-semibold text-teal-900 tracking-tight">
                                {reason === 'duplicate' && (t('flagging.title_duplicate') || 'Report Duplicate')}
                                {reason === 'inaccuracy' && (t('flagging.title_inaccuracy') || 'Report Inaccuracy')}
                                {reason === 'deletion' && (t('flagging.title_deletion') || 'Request Removal')}
                            </h3>
                            <button onClick={resetAndClose} className="text-stone-500 hover:text-teal-700 transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* Success state for data requests */}
                        {dataRequestSubmitted ? (
                            <div className="text-center py-6">
                                <div className="text-4xl mb-3">✅</div>
                                <p className="text-lg font-semibold text-teal-800 mb-2">
                                    {t('flagging.request_received') || 'Request received'}
                                </p>
                                <p className="text-sm text-stone-500 mb-6">
                                    {t('flagging.request_review_time') || 'We will review your request within 10 business days.'}
                                </p>
                                <button
                                    onClick={resetAndClose}
                                    className="px-6 py-2.5 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors"
                                >
                                    {t('common.close') || 'Close'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Duplicate flow — search for original profile */}
                                {reason === 'duplicate' && (
                                    <div className="p-5 bg-teal-50 rounded-xl border border-teal-100">
                                        <label className="block text-sm font-semibold text-teal-800 mb-3">{t('flagging.find_original')}</label>
                                        <div className="flex gap-2 mb-3">
                                            <div className="relative flex-1">
                                                <input
                                                    className="w-full h-10 px-3 pl-10 rounded-lg border border-teal-200 bg-white text-teal-900 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-200 outline-none transition-shadow"
                                                    placeholder={t('flagging.search_placeholder')}
                                                    value={searchTerm}
                                                    onChange={e => setSearchTerm(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                                                />
                                                <div className="absolute left-3 top-2.5 text-teal-700">
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

                                        {/* System-suggested matches */}
                                        {systemSuggestions.length > 0 && !searchTerm && (() => {
                                            const LOW_CONFIDENCE_THRESHOLD = 15;
                                            const sorted = [...systemSuggestions].sort((a, b) => b.confidencePercent - a.confidencePercent);
                                            const visible = sorted.filter(s => s.confidencePercent >= LOW_CONFIDENCE_THRESHOLD);
                                            const suppressed = sorted.filter(s => s.confidencePercent < LOW_CONFIDENCE_THRESHOLD);
                                            return (
                                                <div className="mb-3">
                                                    <p className="text-xs font-medium text-stone-500 mb-1.5">🤖 {t('flagging.system_suggestions') || 'System-suggested matches'}</p>
                                                    <div className="space-y-1.5">
                                                        {visible.map(sug => (
                                                            <div
                                                                key={sug.id}
                                                                className={`p-3 border rounded-lg cursor-pointer text-sm transition-all ${targetAdopter?.id === sug.otherAdopterId
                                                                    ? 'bg-teal-100 border-teal-500 ring-1 ring-teal-500'
                                                                    : 'bg-blue-50 border-blue-200 hover:border-blue-400 hover:shadow-sm'
                                                                    }`}
                                                                onClick={() => setTargetAdopter({ id: sug.otherAdopterId, name: sug.otherAdopterName })}
                                                            >
                                                                <div className="flex items-center justify-between">
                                                                    <span className="font-semibold text-stone-900">{sug.otherAdopterName}</span>
                                                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                                                                        sug.confidencePercent >= 75 ? 'bg-red-100 text-red-700' :
                                                                        sug.confidencePercent >= 40 ? 'bg-amber-100 text-amber-700' :
                                                                        'bg-blue-100 text-blue-600'
                                                                    }`}>{sug.confidencePercent}% match</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {sug.matchTypes.map(type => (
                                                                        <span key={type} className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600">{type.replace('_', ' ')}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {suppressed.length > 0 && (
                                                            <ShowLowConfidenceSuggestions suppressed={suppressed} targetAdopter={targetAdopter} setTargetAdopter={setTargetAdopter} />
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {searchTerm && !isSearching && searchResults.length === 0 && hasSearched && (
                                            <div className="text-center py-4 bg-white/50 rounded-lg border border-dashed border-teal-200/50">
                                                <p className="text-sm text-teal-700">No matching profiles found.</p>
                                            </div>
                                        )}

                                        {searchResults.length > 0 && (
                                            <div className="max-h-48 overflow-y-auto space-y-2 mb-3 custom-scrollbar">
                                                {searchResults.map(res => (
                                                    <div
                                                        key={res.adopter.id}
                                                        className={`p-3 border rounded-lg cursor-pointer text-sm transition-all ${targetAdopter?.id === res.adopter.id
                                                            ? 'bg-teal-100 border-teal-500 ring-1 ring-teal-500'
                                                            : 'bg-white border-teal-100 hover:border-teal-300 hover:shadow-sm'}`}
                                                        onClick={() => setTargetAdopter(res.adopter)}
                                                    >
                                                        <div className="font-semibold text-teal-900 truncate" title={res.adopter.name}>{res.adopter.name}</div>
                                                        <div className="text-teal-700 truncate" title={res.adopter.contactInfo || undefined}>{res.adopter.contactInfo}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {targetAdopter && (
                                            <div className="flex items-center gap-2 text-sm text-teal-800 bg-white px-3 py-2 rounded-lg border border-teal-200 shadow-sm">
                                                <svg className="w-4 h-4 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                <span className="font-semibold">{t('flagging.selected_original')}: {targetAdopter.name}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Inaccuracy / Deletion — contact info form */}
                                {(reason === 'inaccuracy' || reason === 'deletion') && (
                                    <div className="space-y-4">
                                        <p className="text-sm text-stone-600">
                                            {reason === 'inaccuracy'
                                                ? (t('flagging.inaccuracy_desc') || 'If this profile contains incorrect information about you, let us know:')
                                                : (t('flagging.deletion_desc') || 'To request removal of your data from this platform, please provide your details:')}
                                        </p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <input
                                                type="text"
                                                placeholder={t('flagging.your_name') || 'Your name *'}
                                                value={requesterName}
                                                onChange={e => setRequesterName(e.target.value)}
                                                className="px-3 py-2.5 text-sm border border-teal-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 outline-none"
                                            />
                                            <input
                                                type="email"
                                                placeholder={t('flagging.your_email') || 'Your email (optional)'}
                                                value={requesterEmail}
                                                onChange={e => setRequesterEmail(e.target.value)}
                                                className="px-3 py-2.5 text-sm border border-teal-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 outline-none"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Details field — shown for all reason types */}
                                <div>
                                    <label className="block text-sm font-semibold text-teal-800 mb-2 uppercase tracking-wider">
                                        {reason === 'duplicate'
                                            ? (t('flagging.details') || 'Details (Optional)')
                                            : (t('flagging.details_required') || 'Details *')}
                                    </label>
                                    <textarea
                                        className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-none"
                                        rows={4}
                                        value={details}
                                        onChange={e => setDetails(e.target.value)}
                                        placeholder={
                                            reason === 'inaccuracy'
                                                ? (t('flagging.inaccuracy_placeholder') || 'What information is incorrect?')
                                                : reason === 'deletion'
                                                    ? (t('flagging.deletion_placeholder') || 'Why should this data be removed?')
                                                    : t('flagging.details_placeholder')
                                        }
                                    />
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-teal-100">
                                    <button
                                        onClick={resetAndClose}
                                        className="px-5 py-2.5 text-teal-700 font-semibold hover:bg-teal-50 rounded-xl transition-colors"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={submitLoading || (reason === 'duplicate' && !targetAdopter) || ((reason === 'inaccuracy' || reason === 'deletion') && (!requesterName.trim() || !details.trim()))}
                                        className={`px-6 py-2.5 font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:shadow-none transition-all ${reason === 'deletion'
                                            ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                                            : 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/30'
                                            }`}
                                    >
                                        {submitLoading
                                            ? (t('flagging.submitting') || 'Submitting...')
                                            : reason === 'deletion'
                                                ? (t('flagging.submit_deletion') || 'Submit Removal Request')
                                                : (t('flagging.submit') || 'Submit Report')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
});
