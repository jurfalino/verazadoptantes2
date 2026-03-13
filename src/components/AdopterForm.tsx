'use client';

import { useState, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAdopter, saveImage } from "@/app/actions";
import { linkFormSubmissionToAdopter } from '@/app/actions/formSubmission';
import { useLanguage } from "@/context/LanguageContext";
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { StarRating } from '@/components/StarRating';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { formatDateTime, formatShortDate } from '@/lib/dates';
import { getRatingColors, getRatingDescription } from '@/lib/ratingColors';
import { getSourceIcon } from '@/lib/sourceIcons';
import { getCountryByCode } from '@/config/countries';
import { countRecordsInPeriod } from '@/lib/adoptionFilters';
import { renderTextWithLinks } from '@/lib/textUtils';
import { AdopterFlagging } from '@/components/AdopterFlagging';
import type { AdopterFlaggingHandle } from '@/components/AdopterFlagging';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdoptionConfig } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';

interface AdopterFormProps {
    initialData?: Adopter | null;
    history?: HistoryEntry[];
    currentUser?: string;
    images?: AdopterImage[];
    adopterId?: string;
    avgRating?: number | null;
    flags?: AdopterFlag[];
    adoptions?: AdoptionRecord[];
    adoptionConfig?: AdoptionConfig;
    isAdmin?: boolean;
    formPrefill?: FormSubmissionPrefill | null;
}

export function AdopterForm({ initialData, history = [], currentUser, images = [], adopterId, avgRating, flags = [], adoptions = [], adoptionConfig, isAdmin = false, formPrefill = null }: AdopterFormProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const intent = searchParams.get('intent');
    const { t, locale: currentLocale } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();
    const isNew = !initialData?.id;
    const id = adopterId || initialData?.id || '';
    const [showReportMenu, setShowReportMenu] = useState(false);
    const flaggingRef = useRef<AdopterFlaggingHandle>(null);

    // Auth check — single source of truth for both click-to-edit and save
    const isAuthenticated = useMemo(
        () => (currentUser && currentUser !== '') || !!session?.user,
        [currentUser, session]
    );

    // Stable reference date for period filtering (avoids hydration mismatch)
    const referenceDate = useMemo(() => new Date(), []);
    const periodDays = adoptionConfig?.periodDays || 90;
    const threshold = adoptionConfig?.threshold || 5;
    const adoptionsInPeriod = countRecordsInPeriod(adoptions, 'adoption', periodDays, referenceDate);
    const requestsPeriodDays = adoptionConfig?.requestsPeriodDays || 30;
    const requestsThreshold = adoptionConfig?.requestsThreshold || 3;
    const requestsInPeriod = countRecordsInPeriod(adoptions, 'adoption_request', requestsPeriodDays, referenceDate);

    const [isEditing, setIsEditing] = useState(isNew);
    const [loading, setLoading] = useState(false);

    // Auth-gated click-to-edit: clicking any view field enables editing
    const handleClickToEdit = () => {
        if (isEditing) return;
        if (!isAuthenticated) {
            openLogin();
            return;
        }
        setIsEditing(true);
    };

    // Status uses numeric values 1-5 only
    const defaultStatus = intent === 'report' ? '1' : '5';

    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || formPrefill?.name || '',
        status: initialData?.status || defaultStatus,
        contactInfo: initialData?.contactInfo || formPrefill?.contactInfo || '',

        familyMembers: initialData?.familyMembers || '',
        notes: initialData?.notes || formPrefill?.notes || '',
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAuthenticated) {
            openLogin();
            return;
        }


        setLoading(true);
        try {
            const res = await saveAdopter(data);
            if (res.success) {
                if (isNew) {
                    if (formPrefill?.selfieUrl) {
                        try {
                            await saveImage(res.id, formPrefill.selfieUrl, t('formResults.selfie_alt') || 'Applicant selfie');
                        } catch (imgErr) {
                            console.warn('[AdopterForm] Save selfie from form prefill failed', imgErr);
                        }
                    }
                    const fromFormId = searchParams.get('fromForm');
                    if (fromFormId?.trim()) {
                        try {
                            await linkFormSubmissionToAdopter(fromFormId.trim(), res.id);
                        } catch (linkErr) {
                            console.warn('[AdopterForm] Link form submission to adopter failed', linkErr);
                        }
                    }
                    // Check if we should continue to adoption form
                    const continueToAdoption = searchParams.get('continueToAdoption');
                    const animalName = searchParams.get('animalName') || '';
                    const species = searchParams.get('species') || '';
                    const linkAnimalId = searchParams.get('linkAnimalId') || '';

                    let redirectUrl = `/adopter/${res.id}`;
                    if (continueToAdoption === 'true') {
                        // Redirect to profile with all wizard params (adoption or observation)
                        const params = new URLSearchParams();
                        // Forward animal-related params (AdoptionWizard)
                        if (linkAnimalId) params.set('linkAnimalId', linkAnimalId);
                        if (animalName) params.set('animalName', animalName);
                        if (species) params.set('species', species);
                        // Forward observation params (ReportWizard)
                        const newAdoption = searchParams.get('newAdoption');
                        const rating = searchParams.get('rating');
                        const details = searchParams.get('details');
                        if (newAdoption) params.set('newAdoption', newAdoption);
                        else params.set('newAdoption', 'true');
                        if (rating) params.set('rating', rating);
                        if (details) params.set('details', details);
                        redirectUrl = `/adopter/${res.id}?${params.toString()}`;
                    }


                    try {
                        router.push(redirectUrl);
                        // Fallback: Force navigation if router.push doesn't work
                        setTimeout(() => {
                            if (window.location.pathname === '/adopter/create') {
                                console.warn("[ADOPTER FORM] router.push failed, using window.location");
                                window.location.href = redirectUrl;
                            }
                        }, 500);
                    } catch (navError) {
                        console.error("[ADOPTER FORM] Navigation error:", navError);
                        window.location.href = redirectUrl;
                    }
                } else {
                    setIsEditing(false);
                    router.refresh();
                }
            } else {
                console.error("[ADOPTER FORM] Save failed - no success flag");
                toast.error('Error', 'Failed to save adopter profile.');
            }
        } catch (err: any) {
            console.error("Save Error:", err);
            toast.error('Save Error', err?.message || 'An unexpected error occurred while saving.', extractErrorId(err));
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        if (isNew) {
            router.back();
        } else {
            // Reset data and exit edit mode
            setData({
                id: initialData?.id || '',
                name: initialData?.name || formPrefill?.name || '',
                status: initialData?.status || '5',
                contactInfo: initialData?.contactInfo || formPrefill?.contactInfo || '',

                familyMembers: initialData?.familyMembers || '',
                notes: initialData?.notes || formPrefill?.notes || '',
            });
            setIsEditing(false);
        }
    };

    return (
        <div className={`bg-white rounded-2xl shadow-sm border border-stone-200 relative group transition-all duration-300 overflow-hidden ${isEditing ? 'ring-4 ring-teal-50/50' : ''}`}>

            <form onSubmit={handleSave} className="p-5">
                {/* ═══ IDENTITY HEADER ═══ */}
                <div className="flex flex-col gap-3 mb-4">
                    {/* Top row: actions (right-aligned) */}
                    <div className="flex items-center justify-end gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-4 py-1.5 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 focus:ring-4 focus:ring-teal-200 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-700/30 transform active:scale-95"
                                >
                                    {loading ? t('common.loading') : t('common.save')}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={handleClickToEdit}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    {t('common.edit')}
                                </button>
                                {/* Overflow menu */}
                                {!isNew && initialData && (
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setShowReportMenu(!showReportMenu)}
                                            className="flex items-center gap-1 p-1.5 rounded-lg text-stone-500 bg-stone-50 hover:text-stone-600 hover:bg-stone-100 transition-all duration-150"
                                            title={t('flagging.report_actions') || 'Report'}
                                        >
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <circle cx="5" cy="12" r="2" />
                                                <circle cx="12" cy="12" r="2" />
                                                <circle cx="19" cy="12" r="2" />
                                            </svg>
                                        </button>
                                        {showReportMenu && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setShowReportMenu(false)} />
                                                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-stone-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!session?.user) { openLogin(); setShowReportMenu(false); return; }
                                                            setShowReportMenu(false);
                                                            flaggingRef.current?.openAction('duplicate');
                                                        }}
                                                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                                                    >
                                                        <span className="text-lg mt-0.5">🔀</span>
                                                        <div>
                                                            <div className="text-sm font-semibold text-stone-900">{t('flagging.menu_duplicate') || 'Report Duplicate'}</div>
                                                            <div className="text-xs text-stone-500 mt-0.5">{t('flagging.menu_duplicate_desc') || 'Flag as duplicate of another profile'}</div>
                                                        </div>
                                                    </button>
                                                    <div className="border-t border-stone-100" />
                                                    <button
                                                        type="button"
                                                        onClick={() => { setShowReportMenu(false); flaggingRef.current?.openAction('inaccuracy'); }}
                                                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                                                    >
                                                        <span className="text-lg mt-0.5">✏️</span>
                                                        <div>
                                                            <div className="text-sm font-semibold text-stone-900">{t('flagging.menu_inaccuracy') || 'Report Inaccuracy'}</div>
                                                            <div className="text-xs text-stone-500 mt-0.5">{t('flagging.menu_inaccuracy_desc') || 'Information about me is wrong'}</div>
                                                        </div>
                                                    </button>
                                                    <div className="border-t border-stone-100" />
                                                    <button
                                                        type="button"
                                                        onClick={() => { setShowReportMenu(false); flaggingRef.current?.openAction('deletion'); }}
                                                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                                                    >
                                                        <span className="text-lg mt-0.5">🗑️</span>
                                                        <div>
                                                            <div className="text-sm font-semibold text-rose-700">{t('flagging.menu_deletion') || 'Request Removal'}</div>
                                                            <div className="text-xs text-stone-500 mt-0.5">{t('flagging.menu_deletion_desc') || 'Remove my data from this platform'}</div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Identity row: avatar + name + metadata */}
                    <div className="flex items-center gap-3">
                        {/* Avatar */}
                        {isNew && formPrefill?.selfieUrl ? (
                            <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl bg-teal-100 overflow-hidden ring-2 ring-teal-200 shadow-sm flex-shrink-0">
                                <img
                                    src={formPrefill.selfieUrl.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(formPrefill.selfieUrl)}` : formPrefill.selfieUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        ) : !isNew && (() => {
                            const profilePic = images.length > 0
                                ? (images.find(img => img.isProfilePicture === 1) || images[0])
                                : null;
                            if (profilePic) {
                                return (
                                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl bg-teal-100 overflow-hidden ring-2 ring-teal-200 shadow-sm flex-shrink-0">
                                        <img src={profilePic.url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(profilePic.url)}` : profilePic.url} alt="" className="w-full h-full object-cover" />
                                    </div>
                                );
                            }
                            const name = initialData?.name || '';
                            const initials = name.split(' ').filter(Boolean).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
                            return (
                                <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-teal-400 to-teal-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                                    <span className="text-white font-semibold text-sm md:text-lg">{initials || '?'}</span>
                                </div>
                            );
                        })()}
                        <div className="min-w-0 flex-1">
                            {/* Inline-editable name */}
                            {isEditing ? (
                                <input
                                    type="text"
                                    required
                                    className="w-full text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight bg-transparent border-b-2 border-teal-300 focus:border-teal-500 outline-none py-0.5 placeholder-stone-500 transition-all"
                                    value={data.name}
                                    onChange={e => setData({ ...data, name: e.target.value })}
                                    placeholder={t('adopter.placeholder_name_aliases')}
                                    autoFocus
                                />
                            ) : (
                                <h1 className="text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight truncate">
                                    {!isNew && initialData ? initialData.name : t('adopter.title_new')}
                                </h1>
                            )}
                            {/* Metadata row */}
                            {!isNew && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs">
                                    <span className="text-stone-500 font-mono break-all">ID: {id}</span>
                                    {initialData?.country && (() => {
                                        const c = getCountryByCode(initialData.country!);
                                        if (!c) return null;
                                        return <span className="text-stone-500">{currentLocale === 'es' ? c.nameEs : c.name}</span>;
                                    })()}
                                    {initialData?.sourceUrl && (
                                        <a href={initialData.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors">
                                            {getSourceIcon(initialData.sourceUrl, 'w-3 h-3')}
                                            <span>{t('adopter.view_source') || 'Source'}</span>
                                        </a>
                                    )}
                                    {/* Rating badge */}
                                    {avgRating !== null && avgRating !== undefined && (() => {
                                        const colors = getRatingColors(avgRating);
                                        const descKey = getRatingDescription(Math.round(avgRating));
                                        return (
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                data-testid="rating-badge"
                                                onClick={() => document.getElementById('adoptions-section')?.scrollIntoView({ behavior: 'smooth' })}
                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${colors.bg} border ${colors.border} rounded-full cursor-pointer hover:shadow-sm transition-shadow`}
                                            >
                                                <StarRating value={Math.round(avgRating)} size="sm" />
                                                <span className={`${colors.text} font-semibold text-xs`}>{avgRating.toFixed(1)}</span>
                                                <span className={`${colors.text} text-xs font-medium opacity-75`}>{t(`ratings.${descKey}` as any)}</span>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ═══ FLAG PILLS ═══ */}
                {!isNew && initialData && (
                    <div className="mb-4">
                        <AdopterFlagging
                            ref={flaggingRef}
                            adopterId={id}
                            adopterName={initialData.name}
                            existingFlags={flags}
                            hasVerifiedAdoption={adoptions.some(a => a.identityVerified === 1)}
                            hasVerifiedAddress={adoptions.some(a => a.verifiedAddress && a.verifiedAddress.trim() !== '')}
                            tooManyAdoptions={adoptionsInPeriod >= threshold ? { count: adoptionsInPeriod, threshold, periodDays } : undefined}
                            tooManyRequests={requestsInPeriod >= requestsThreshold ? { count: requestsInPeriod, threshold: requestsThreshold, periodDays: requestsPeriodDays } : undefined}
                        />
                    </div>
                )}

                {/* ═══ DIVIDER ═══ */}
                <div className="border-b border-teal-100/60 mb-6" />

                {/* SHARED CONTENT GRID */}
                <div className={`grid md:grid-cols-2 gap-6 ${isEditing ? 'opacity-100' : 'opacity-90'}`}>
                    {/* Contact Info */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.contact')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[80px]"
                                value={data.contactInfo}
                                onChange={e => setData({ ...data, contactInfo: e.target.value })}
                                placeholder={t('adopter.placeholder_contact')}
                            />
                        ) : (
                            <div
                                className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-teal-400 transition-colors"
                                style={{ overflowWrap: 'anywhere' }}
                                onClick={handleClickToEdit}
                                title={t('common.edit') || 'Click to edit'}
                            >
                                {renderTextWithLinks(data.contactInfo, { emptyLabel: t('audit.empty_val'), type: 'text' })}
                            </div>
                        )}
                    </div>



                    {/* Family Members (Full Width) */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.family_members')}</h3>
                        {isEditing ? (
                            <textarea
                                rows={2}
                                className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[60px]"
                                value={data.familyMembers}
                                onChange={e => setData({ ...data, familyMembers: e.target.value })}
                                placeholder={t('adopter.placeholder_family')}
                            />
                        ) : (
                            data.familyMembers ? (
                                <div
                                    className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-teal-400 transition-colors"
                                    style={{ overflowWrap: 'anywhere' }}
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {renderTextWithLinks(data.familyMembers, { emptyLabel: t('audit.empty_val') })}
                                </div>
                            ) : (
                                <div
                                    className="text-stone-500 italic p-4 rounded-xl border border-dashed border-teal-200 bg-white cursor-pointer hover:border-teal-400 transition-colors"
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {t('adopter.no_family')}
                                </div>
                            )
                        )}
                    </div>

                    {/* Notes (Full Width) */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.notes') || 'Notes'}</h3>
                        {isEditing ? (
                            <textarea
                                rows={3}
                                className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[80px]"
                                value={data.notes}
                                onChange={e => setData({ ...data, notes: e.target.value })}
                                placeholder={t('adopter.placeholder_notes') || 'Additional observations, age, behavior, etc.'}
                            />
                        ) : (
                            data.notes ? (
                                <div
                                    className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 font-medium leading-relaxed min-h-[60px] cursor-pointer hover:border-teal-400 transition-colors"
                                    style={{ overflowWrap: 'anywhere' }}
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {renderTextWithLinks(data.notes, { emptyLabel: t('audit.empty_val') })}
                                </div>
                            ) : (
                                <div
                                    className="text-stone-500 italic p-4 rounded-xl border border-dashed border-teal-200 bg-white cursor-pointer hover:border-teal-400 transition-colors"
                                    onClick={handleClickToEdit}
                                    title={t('common.edit') || 'Click to edit'}
                                >
                                    {t('adopter.no_notes') || 'No notes.'}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </form>

            {/* MERGED HISTORY LOG */}
            {history && history.length > 0 && !isEditing && (
                <CollapsibleSection
                    title={t('audit.log_title')}
                    count={history.length}
                    defaultOpen={false}
                    className="border-t border-teal-100/60 rounded-none shadow-none border-x-0 border-b-0"
                >
                    <div className="space-y-6 pb-6">
                        {history.map((h) => {
                            let changes = null;
                            let eventType = 'update';
                            try {
                                const parsed = JSON.parse(h.changes as string);
                                // Determine event type and data
                                if (parsed.adoption_updated) {
                                    eventType = 'adoption_updated';
                                    changes = parsed.adoption_updated;
                                } else if (parsed.adoption_added) {
                                    eventType = 'adoption_added';
                                    changes = parsed.adoption_added;
                                } else if (parsed.adoption_deleted) {
                                    eventType = 'adoption_deleted';
                                    changes = parsed.adoption_deleted;
                                } else if (parsed.image_deleted) {
                                    eventType = 'image_deleted';
                                    changes = parsed.image_deleted;
                                } else {
                                    // Fallback for old/direct profile updates
                                    changes = parsed;
                                }
                            } catch (e) { console.warn('[AdopterForm] Failed to parse history changes', e); }

                            return (
                                <div key={h.id} className="text-sm border-l-4 border-teal-200 pl-4 py-3 bg-teal-50/30 rounded-r-lg mb-2">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-teal-700 text-xs font-semibold uppercase tracking-wider">
                                                {formatDateTime(new Date(h.changedAt as string | number))}
                                            </span>
                                            {/* Badge for event type */}
                                            {eventType === 'adoption_added' && <span className="bg-teal-100 text-teal-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_adoption_added')}</span>}
                                            {eventType === 'adoption_deleted' && <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_adoption_deleted')}</span>}
                                            {eventType === 'image_deleted' && <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_image_deleted')}</span>}
                                        </div>
                                        <span className="text-xs px-2.5 py-0.5 bg-white border border-teal-100 rounded-full text-teal-700 font-medium shadow-sm">
                                            {t('audit.by')} {h.changedBy || t('common.anonymous')}
                                        </span>
                                    </div>

                                    <div className="space-y-1.5">
                                        {changes ? (
                                            <>
                                                {/* Profile Updates / Adoption Updates (Diffs) */}
                                                {(eventType === 'update' || eventType === 'adoption_updated') && Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                    <div key={key} className="grid grid-cols-[120px_1fr] gap-3 items-start text-sm">
                                                        <span className="font-semibold text-teal-800 capitalize truncate" title={key}>{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                                                        <div className="text-teal-700 break-words font-medium">
                                                            <div className="line-through text-rose-400 text-xs mr-2 opacity-70 inline-block">
                                                                {typeof delta.from === 'string' && delta.from.length > 30 ? delta.from.substring(0, 30) + '...' : (delta.from || t('audit.empty_val'))}
                                                            </div>
                                                            <span className="text-teal-700 mr-2">➜</span>
                                                            <span className="text-teal-900 bg-teal-100/50 px-1.5 rounded">
                                                                {delta.to || t('audit.empty_val')}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* Added Adoption (Snapshot) */}
                                                {eventType === 'adoption_added' && (
                                                    <div className="text-teal-800 font-medium">
                                                        {t('audit.desc_adoption_added')} <span className="font-semibold">{changes.animalName}</span> ({changes.species}) - {changes.status}
                                                    </div>
                                                )}

                                                {/* Deleted Adoption (Snapshot) */}
                                                {eventType === 'adoption_deleted' && (
                                                    <div className="space-y-1 text-teal-800">
                                                        <div><span className="font-semibold">{t('adoption.animal_name')}:</span> {changes.animalName} ({changes.species})</div>
                                                        <div><span className="font-semibold">{t('adoption.status')}:</span> {changes.status}</div>
                                                        <div className="flex items-center gap-1"><span className="font-semibold">{t('adoption.rating')}:</span> <StarRating value={changes.rating} size="sm" showLabel /></div>
                                                        {changes.details && <div className="text-xs italic mt-1">"{changes.details}"</div>}
                                                    </div>
                                                )}

                                                {/* Deleted Image */}
                                                {eventType === 'image_deleted' && (
                                                    <div className="text-teal-800">
                                                        {t('audit.desc_image_deleted')} <span className="italic opacity-75">"{changes.caption || t('common.untitled')}"</span> ({t('audit.by')} {formatShortDate(new Date(changes.uploadedAt))})
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-teal-700 italic text-xs">{t('audit.metadata_update')}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CollapsibleSection>
            )}
        </div>
    );
}
