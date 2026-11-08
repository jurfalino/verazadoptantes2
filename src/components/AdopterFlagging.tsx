'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, type MouseEvent } from 'react';
import { flagAdopter, findAdopters, getDuplicateCandidates } from '@/app/actions';
import type { DuplicateCandidate, DiscoveryMatch } from '@/app/actions';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId, reportClientError } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import MatchCompare, { type MatchSourceKind } from '@/components/MatchCompare';
import { zarazTrack } from '@/lib/zaraz';
import { useDateFormat } from '@/context/TimezoneContext';
import { matchTypeLabel } from '@/lib/matchTypeLabels';
import { contactBlobForDisplay } from '@/lib/contactEntries';
import { isOpenDuplicateFlag } from '@/domain/dedupPair';
import { openFlagKindsOfRows, rescuerFlagKinds } from '@/domain/flags';
import { CheckCircle2 } from 'lucide-react';
import { AlertPill } from '@/components/AlertPill';
import { HOUSEHOLD_SECTION_HREF, type HousemateAlertSummary } from '@/domain/profileHouseholds';
import { formatRating } from '@/domain/ratings';
import { Modal, ModalActions } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/** Where the header's housemate chips lead: «Familiares / Convivientes» (AdopterForm's section; one constant, re-review M-d/M-g). */
export { HOUSEHOLD_SECTION_HREF };

export interface AdopterFlaggingHandle {
    openAction: (action: string) => void;
}

/** Collapsible expander for < 15% confidence suggestions. */
function ShowLowConfidenceSuggestions({ suppressed, targetAdopter, setTargetAdopter }: {
    suppressed: DuplicateCandidate[];
    targetAdopter: { id: string; name: string } | null;
    setTargetAdopter: (v: { id: string; name: string }) => void;
}) {
    const { t } = useLanguage();
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
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {sug.matchTypes.map(type => (
                                    <span key={type} className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">{matchTypeLabel(type, t)}</span>
                                ))}
            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export const AdopterFlagging = forwardRef<AdopterFlaggingHandle, { adopterId: string, adopterName: string, existingFlags: any[], verifiedIdentity?: boolean, verifiedAddress?: boolean, tooManyAdoptions?: { count: number; actualSpanDays?: number; periodDays: number; startDate?: Date | null; endDate?: Date | null }, tooManyRequests?: { count: number; actualSpanDays?: number; periodDays: number; startDate?: Date | null; endDate?: Date | null }, hasDuplicateBanner?: boolean, compareSource?: { kind: MatchSourceKind; name: string; entries: Array<{ type: string; value: string }> }, housemateAlert?: HousemateAlertSummary, onHousemateAlert?: (e: MouseEvent<HTMLAnchorElement>) => void }>(function AdopterFlagging({ adopterId, adopterName: _adopterName, compareSource, existingFlags, verifiedIdentity = false, verifiedAddress = false, tooManyAdoptions, tooManyRequests, hasDuplicateBanner = false, housemateAlert, onHousemateAlert }, ref) {
    const router = useRouter();
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
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
    // Inaccuracy / deletion: who is asking comes from the session (the API reads it).
    const [dataRequestSubmitted, setDataRequestSubmitted] = useState(false);
    
    // Tap-to-expand context hints for flags
    const [showAdoptionsHint, setShowAdoptionsHint] = useState(false);
    const [showRequestsHint, setShowRequestsHint] = useState(false);
    const [showIdentityHint, setShowIdentityHint] = useState(false);
    const [showAddressHint, setShowAddressHint] = useState(false);

    // Fetch system-detected duplicate candidates on mount
    useEffect(() => {
        getDuplicateCandidates(adopterId).then(setSystemSuggestions).catch(e => {
            // Degraded: the search box still works. Logged, not swallowed.
            void reportClientError({ message: 'flagging: system duplicate suggestions could not load', source: 'AdopterFlagging', level: 'warn', extra: { adopterId, error: e instanceof Error ? e.message : String(e) } });
        });
    }, [adopterId]);

    // The open flags, by the one rule every surface draws them with
    // (openFlagKindsOfRows, then rescuerFlagKinds): «Duplicado» only for an
    // OPEN duplicate question — a merged flag ("Merged into … by …") or a
    // declined merge request ("Kept separate: …") is settled, and its details
    // are bookkeeping. «Inexacto» is never drawn here, for any viewer (Jon,
    // 2026-11-01: only admins care about it, in the admin UI).
    const flagKinds = rescuerFlagKinds(openFlagKindsOfRows(existingFlags.map(f => ({ adopterId, ...f }))));
    const duplicateFlags = existingFlags.filter(f => isOpenDuplicateFlag({ adopterId, ...f }));
    const isFlaggedAsDuplicate = flagKinds.includes('duplicate');

    // The verification badges are decided by the caller with the one rule every surface uses
    // (profileVerifications, src/domain/flags.ts); a filed identity mark only lends the hint its words.
    const identityVerifiedFlag = existingFlags.find(f => f.reason === 'verified_identity');
    const identityVerified = verifiedIdentity;
    const addressVerified = verifiedAddress;







    // «Buscar perfil original»: never the profile you are on (Jon 2026-10-31: picking
    // it was refused with an error), and a failed search says so — it used to look
    // like «no results».
    const runSearch = async (term: string) => {
        setIsSearching(true);
        try {
            const response = await findAdopters({ raw: term }, { mode: 'discovery', enrich: false });
            setSearchResults((response.results as DiscoveryMatch[]).filter(r => r.adopter.id !== adopterId));
            setHasSearched(true);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('errors.search_failed'), resolveErrorId(e, 'AdopterFlagging.search'));
        } finally {
            setIsSearching(false);
        }
    };

    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            if (searchTerm && reason === 'duplicate') void runSearch(searchTerm);
            else setSearchResults([]);
        }, 500);

        return () => clearTimeout(delayDebounceFn);
        // runSearch is recreated each render; the search reruns only when the term or reason changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, reason]);

    const handleManualSearch = async () => {
        if (!searchTerm) return;
        await runSearch(searchTerm);
    };

    const handleSubmit = async () => {
        if (!reason) return;

        // Duplicate flow — uses flagAdopter (auth required)
        if (reason === 'duplicate') {
            if (!targetAdopter) return;
            setSubmitLoading(true);
            try {
                const res = await flagAdopter(adopterId, reason, details, targetAdopter.id);
                if (res.success && res.already) {
                    // An open duplicate flag already covers this pair: nothing new was written or sent.
                    toast.info(t('adopter.dup_hint_pending'));
                    resetAndClose();
                } else if (res.success) {
                    toast.success(t('flagging.submit_success') || 'Report submitted successfully');
                    zarazTrack('flag_submitted', { flagType: 'duplicate' });
                    resetAndClose();
                    router.refresh();
                } else if (res.error === 'said_no' || res.error === 'settled_separate') {
                    // Someone already said they are two people / they're recorded as such — the reason «Ya está en otro perfil» gives.
                    toast.info(t(res.error === 'said_no' ? 'adopter.dup_hint_said_no' : 'adopter.dup_hint_settled'));
                } else {
                    toast.error(t('errors.generic'), t('errors.submit_report_failed'), res.errorId);
                }
            } catch (e) {
                console.error(e);
                toast.error(t('errors.generic'), t('errors.report_error'), resolveErrorId(e, 'AdopterFlagging'));
            } finally {
                setSubmitLoading(false);
            }
            return;
        }

        // Inaccuracy / Deletion flow — the data-request API (signed in; it knows who is asking)
        if (reason === 'inaccuracy' || reason === 'deletion') {
            if (!details.trim()) return;
            setSubmitLoading(true);
            try {
                const res = await fetch('/api/data-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adopterId,
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
                toast.error(t('errors.generic'), t('errors.request_error'), resolveErrorId(e, 'AdopterFlagging'));
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
            toast.error(t('errors.generic'), t('errors.report_error'), resolveErrorId(e, 'AdopterFlagging'));
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
    // Someone in their home (Jon 2026-11-01): the same two alerts the cards carry, decided on the
    // server by the same rules (housemateLowRating / housemateHasAlerts — readProfileHouseholds).
    const housemateLow = housemateAlert?.lowRating ?? null;
    const housemateAlerts = !!housemateAlert?.hasAlerts;
    const hasHousemateAlert = housemateLow != null || housemateAlerts;

    return (
        <>
            {/* Flag Pills — split into warnings and verifications */}
            <div className="space-y-2 mb-4">
                {/* ⚠ Warnings: things that need attention */}
                {((isFlaggedAsDuplicate && !hasDuplicateBanner) || tooManyAdoptions || tooManyRequests || hasHousemateAlert) && (
                    // gap-y-3: wrapped rows of 32px pills keep their 44px tap targets apart.
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                        {/* Alerts first (computed from the records)… */}
                        {/* Too Many Adoptions Warning */}
                        {tooManyAdoptions && (
                            <AlertPill kind="too_many_adoptions" size="md" onClick={() => setShowAdoptionsHint(!showAdoptionsHint)} pressed={showAdoptionsHint}>
                                {t('alerts.too_many_adoptions').replace('{count}', String(tooManyAdoptions.count)).replace('{days}', String(Math.max(1, Math.round(tooManyAdoptions.actualSpanDays || tooManyAdoptions.periodDays))))}
                            </AlertPill>
                        )}

                        {/* Too Many Requests Warning */}
                        {tooManyRequests && (
                            <AlertPill kind="too_many_requests" size="md" onClick={() => setShowRequestsHint(!showRequestsHint)} pressed={showRequestsHint}>
                                {t('alerts.too_many_requests').replace('{count}', String(tooManyRequests.count)).replace('{days}', String(Math.max(1, Math.round(tooManyRequests.actualSpanDays || tooManyRequests.periodDays))))}
                            </AlertPill>
                        )}

                        {/* …the housemate alerts: links to «Familiares / Convivientes», where everyone is listed (review fix 7:
                            a real link, so focus moves there too — onHousemateAlert smooths the scroll)… */}
                        {housemateLow != null && (
                            <AlertPill kind="housemate_low_rating" size="md" wrap href={HOUSEHOLD_SECTION_HREF} onNavigate={onHousemateAlert} testId="profile-housemate-alert-rating">
                                {t('alerts.housemate_low_rating').replace('{rating}', formatRating(housemateLow))}
                            </AlertPill>
                        )}
                        {housemateAlerts && (
                            <AlertPill kind="housemate_alerts" size="md" wrap href={HOUSEHOLD_SECTION_HREF} onNavigate={onHousemateAlert} testId="profile-housemate-alert-alerts">
                                {t('alerts.housemate_alerts')}
                            </AlertPill>
                        )}

                        {/* …then the flags (a rescuer's report): the neutral chip, by name. Tap for the hint. */}
                        {isFlaggedAsDuplicate && !hasDuplicateBanner && (
                            <AlertPill kind="duplicate" size="md" onClick={() => setShowDuplicateHint(!showDuplicateHint)} pressed={showDuplicateHint}>
                                {t('flags.duplicate') || 'Duplicate'}
                            </AlertPill>
                        )}

                        {/* Context hints revealed on tap */}
                        {showDuplicateHint && isFlaggedAsDuplicate && !hasDuplicateBanner && (
                            <div className="w-full mt-1 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs leading-relaxed text-amber-800 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-amber-100"></div>
                                <span className="font-semibold text-amber-900 block mb-0.5">{t('flags.hint_title') || 'Por qué está marcado'}</span>
                                {t('flags.duplicate_desc') || 'Este perfil podría ser un duplicado de otro adoptante.'}
                                {duplicateFlags[0]?.details && (
                                    <span className="block mt-1 font-medium italic text-amber-700">"{duplicateFlags[0].details}"</span>
                                )}
                                {duplicateFlags[0]?.targetAdopterId && (
                                    <a
                                        href={`/adopter/${duplicateFlags[0].targetAdopterId}`}
                                        className="inline-flex items-center gap-1 mt-2 text-amber-700 font-semibold hover:text-amber-900 hover:underline transition-colors"
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
                            <div className="w-full mt-1 p-3 bg-orange-50 border border-orange-100 rounded-lg text-xs leading-relaxed text-orange-800 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-orange-100"></div>
                                <span className="font-semibold text-orange-900 block mb-0.5">{t('alerts.hint_title') || 'Por qué está marcado'}</span>
                                {t('alerts.adoptions_warning_p1') || 'Registró '}{tooManyAdoptions.count}{t('alerts.adoptions_warning_p2') || ' adopciones en '}{Math.max(1, Math.round(tooManyAdoptions.actualSpanDays || 0))}{t('alerts.adoptions_warning_p3') || ' días'}
                                {tooManyAdoptions.startDate && tooManyAdoptions.endDate && (
                                    <> {t('alerts.warning_dates') || '(ocurrido entre'} {formatShortDate(tooManyAdoptions.startDate)} {t('alerts.and') || 'y'} {formatShortDate(tooManyAdoptions.endDate)})</>
                                )}. {t('alerts.adoptions_risk') || 'Una frecuencia inusualmente alta indica un posible riesgo de acumulación o falta de capacidad de seguimiento.'}
                            </div>
                        )}
                        {showRequestsHint && tooManyRequests && (
                            <div className="w-full mt-1 p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs leading-relaxed text-purple-800 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                                <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-purple-100"></div>
                                <span className="font-semibold text-purple-900 block mb-0.5">{t('alerts.hint_title') || 'Por qué está marcado'}</span>
                                {t('alerts.requests_warning_p1') || 'Registró '}{tooManyRequests.count}{t('alerts.requests_warning_p2') || ' solicitudes en '}{Math.max(1, Math.round(tooManyRequests.actualSpanDays || 0))}{t('alerts.requests_warning_p3') || ' días'}
                                {tooManyRequests.startDate && tooManyRequests.endDate && (
                                    <> {t('alerts.warning_dates') || '(ocurrido entre'} {formatShortDate(tooManyRequests.startDate)} {t('alerts.and') || 'y'} {formatShortDate(tooManyRequests.endDate)})</>
                                )}. {t('alerts.requests_risk') || 'Solicitar múltiples animales de forma simultánea requiere verificación adicional.'}
                            </div>
                        )}
                    </div>
                )}

                {/* ✓ Verifications: inline interactive pills */}
                {(identityVerified || addressVerified) && (
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
                        {addressVerified && (
                            <button
                                type="button"
                                onClick={() => setShowAddressHint(!showAddressHint)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${showAddressHint ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border-teal-200 dark:border-teal-700 shadow-inner' : 'bg-transparent text-teal-700 dark:text-teal-300 border-transparent hover:bg-teal-50 dark:hover:bg-teal-900/20'}`}
                            >
                                <svg className={`w-3.5 h-3.5 transform transition-transform ${showAddressHint ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                {t('flags.addr_verified') || 'Verified address'}
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
                {showAddressHint && addressVerified && (
                    <div className="w-full mt-1 p-3 bg-teal-50 dark:bg-stone-800/80 border border-teal-100 dark:border-teal-900/50 rounded-lg text-xs leading-relaxed text-teal-800 dark:text-teal-200 animate-in slide-in-from-top-1 fade-in duration-200 shadow-sm relative">
                        <div className="absolute top-0 left-6 -translate-y-[5px] border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-teal-100 dark:border-b-stone-700"></div>
                        <span className="font-semibold text-teal-900 dark:text-teal-300 block mb-0.5">{t('flags.addr_verified') || 'Dirección Verificada'}</span>
                        {t('flags.legend_verified') || 'Confirmamos esta información mediante soporte documentario o visita.'}
                    </div>
                )}

            </div>




            {/* Modal */}
            {isOpen && (
                // The shared dialog shell (audit B8): 16px title, ×, matrix buttons.
                <Modal size="lg" testId="flag-dialog" onClose={resetAndClose} busy={submitLoading}
                    title={reason === 'duplicate' ? (t('flagging.title_duplicate') || 'Report duplicate')
                        : reason === 'inaccuracy' ? (t('flagging.title_inaccuracy') || 'Report inaccuracy')
                        : (t('flagging.title_deletion') || 'Request removal')}>
                        {/* Success state for data requests */}
                        {dataRequestSubmitted ? (
                            <div className="text-center py-6">
                                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-teal-600" aria-hidden="true" />
                                <p className="text-lg font-semibold text-teal-800 mb-2">
                                    {t('flagging.request_received') || 'Request received'}
                                </p>
                                <p className="text-sm text-stone-500 mb-6">
                                    {reason === 'inaccuracy'
                                        ? t('flagging.inaccuracy_sent')
                                        : (t('flagging.request_review_time') || 'We will review your request within 10 business days.')}
                                </p>
                                <Button type="button" onClick={resetAndClose}>{t('common.close') || 'Close'}</Button>
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
                                            const visible = sorted.filter(s => s.confidencePercent >= LOW_CONFIDENCE_THRESHOLD).slice(0, 5);
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
                                                                </div>
                                                                {compareSource ? (
                                                                    <MatchCompare
                                                                        adopterId={sug.otherAdopterId}
                                                                        matchTypes={sug.matchTypes}
                                                                        profileName={sug.otherAdopterName}
                                                                        source={compareSource}
                                                                        target="other"
                                                                        score={sug.confidencePercent}
                                                                        defaultOpen={visible.length === 1}
                                                                        t={t}
                                                                    />
                                                                ) : (
                                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                                        {sug.matchTypes.map(type => (
                                                                            <span key={type} className="text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600">{matchTypeLabel(type, t)}</span>
                                                                        ))}
                                                                    </div>
                                                                )}
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
                                                        <div className="text-teal-700 truncate" title={contactBlobForDisplay(res.adopter.contactInfo, t('adopter.ce_type_alias')) || undefined}>{contactBlobForDisplay(res.adopter.contactInfo, t('adopter.ce_type_alias'))}</div>
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

                                {/* Inaccuracy / Deletion — what happens next; no name or email to type, we know who is asking */}
                                {(reason === 'inaccuracy' || reason === 'deletion') && (
                                    <p className="text-sm text-stone-600">
                                        {reason === 'inaccuracy'
                                            ? (t('flagging.inaccuracy_desc') || 'Tell us what information on this profile is wrong.')
                                            : (t('flagging.deletion_desc') || 'Tell us why this data should be removed.')}
                                    </p>
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

                                <ModalActions onCancel={resetAndClose} busy={submitLoading}
                                    confirm={{
                                        label: reason === 'deletion' ? (t('flagging.submit_deletion') || 'Submit Removal Request') : (t('flagging.submit') || 'Submit Report'),
                                        onClick: () => { void handleSubmit(); },
                                        disabled: (reason === 'duplicate' && !targetAdopter) || ((reason === 'inaccuracy' || reason === 'deletion') && !details.trim()),
                                        testId: 'flag-submit',
                                    }} />
                            </div>
                        )}
                </Modal>
            )}
        </>
    );
});
