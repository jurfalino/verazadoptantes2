'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAdopter, saveImage, findAdopters } from "@/app/actions";
import type { DiscoveryMatch } from "@/app/actions";
import { linkFormSubmissionToAdopter } from '@/app/actions/formSubmission';
import { useLanguage } from "@/context/LanguageContext";

import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { RatingBadge } from '@/components/RatingBadge';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';

import { getSourceIcon } from '@/lib/sourceIcons';
import { getCountryByCode } from '@/config/countries';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { renderTextWithLinks } from '@/lib/textUtils';
import { AdopterFlagging } from '@/components/AdopterFlagging';
import type { AdopterFlaggingHandle } from '@/components/AdopterFlagging';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdoptionConfig } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';

interface AdopterFormProps {
    initialData?: Adopter | null;
    currentUser?: string;
    images?: AdopterImage[];
    adopterId?: string;
    avgRating?: number | null;
    profileViews?: number;
    flags?: AdopterFlag[];
    adoptions?: AdoptionRecord[];
    adoptionConfig?: AdoptionConfig;
    isAdmin?: boolean;
    formPrefill?: FormSubmissionPrefill | null;
    hasDuplicateBanner?: boolean;
}

export function AdopterForm({ initialData, currentUser, images = [], adopterId, avgRating, profileViews, flags = [], adoptions = [], adoptionConfig, isAdmin: _isAdmin = false, formPrefill = null, hasDuplicateBanner = false }: AdopterFormProps) {
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

    // Sliding window logic strictly memoized to avoid expensive sorting on every render
    const periodDays = adoptionConfig?.periodDays || 90;
    const threshold = adoptionConfig?.threshold || 5;
    const requestsPeriodDays = adoptionConfig?.requestsPeriodDays || 30;
    const requestsThreshold = adoptionConfig?.requestsThreshold || 3;

    const adoptionsDensity = useMemo(() => {
        return computeMaxDensityPeriod(adoptions, 'adoption', periodDays);
    }, [adoptions, periodDays]);

    const requestsDensity = useMemo(() => {
        return computeMaxDensityPeriod(adoptions, 'adoption_request', requestsPeriodDays);
    }, [adoptions, requestsPeriodDays]);

    const [isEditing, setIsEditing] = useState(isNew);
    const [loading, setLoading] = useState(false);

    // Duplicate detection (create only): while-typing results + save confirmation modal
    const [duplicateResults, setDuplicateResults] = useState<DiscoveryMatch[] | null>(null);
    const [duplicateSearching, setDuplicateSearching] = useState(false);
    const [saveDuplicateModal, setSaveDuplicateModal] = useState<{ matches: DiscoveryMatch[] } | null>(null);
    const saveDuplicateModalRef = useRef<HTMLDivElement>(null);
    const createAnywayButtonRef = useRef<HTMLButtonElement>(null);
    const duplicateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const DUPLICATE_DEBOUNCE_MS = 350;

    // ── Avatar profile-photo upload (empty-state only) ──────────────────────
    // When an adopter has no photo yet, the initials placeholder is clickable
    // for any authenticated user. Funnels into the same saveImage pipeline used
    // by ImageGallery; flagged isProfilePicture so the avatar fills immediately.
    const avatarFileInputRef = useRef<HTMLInputElement>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const compressAvatar = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('Canvas context failed')); return; }
                const max = 1200;
                let w = img.width, h = img.height;
                if (w > h) { if (w > max) { h = (h * max) / w; w = max; } }
                else { if (h > max) { w = (w * max) / h; h = max; } }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => reject(new Error('Image decode failed'));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });

    const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('common.error') || 'Error', t('adopter.upload_invalid_type') || 'Please choose an image file.');
            return;
        }
        if (!id) {
            // Brand-new adopter being created — no id to attach to yet.
            toast.warning(t('common.error') || 'Heads up', t('adopter.upload_save_first') || 'Save the profile first, then add a photo.');
            return;
        }
        setAvatarUploading(true);
        try {
            const dataUrl = await compressAvatar(file);
            await saveImage(id, dataUrl, t('adopter.profile_photo_caption') || 'Profile photo', undefined, 'image', true);
            toast.success('✓', t('adopter.upload_success') || 'Profile photo updated.');
            // Refresh the page so the server-fetched images list (and the avatar) updates.
            window.location.reload();
        } catch (err) {
            console.error('[AdopterForm] avatar upload failed:', err);
            toast.error(t('common.error') || 'Error', t('adopter.upload_failed') || 'Could not upload the photo. Try again.');
        } finally {
            setAvatarUploading(false);
            // Reset the input so picking the same file again still triggers onChange
            if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
        }
    };

    // Focus "Create new profile anyway" when save duplicate modal opens (accessibility)
    useEffect(() => {
        if (saveDuplicateModal) {
            const id = setTimeout(() => createAnywayButtonRef.current?.focus(), 100);
            return () => clearTimeout(id);
        }
    }, [saveDuplicateModal]);
    const MIN_NAME_LENGTH_FOR_SEARCH = 2;
    const MAX_DUPLICATE_CARD_RESULTS = 5;

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

    // Name can come from URL when coming from homepage search or Adoption/Report wizard
    const nameFromUrl = searchParams.get('name')?.trim() || '';
    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || formPrefill?.name || nameFromUrl || '',
        status: initialData?.status || defaultStatus,
        contactInfo: initialData?.contactInfo || formPrefill?.contactInfo || '',

        familyMembers: initialData?.familyMembers || '',
    });

    // Build search query from name + contact for duplicate check
    const getDuplicateSearchQuery = useCallback(() => {
        const parts = [data.name.trim(), data.contactInfo.trim()].filter(Boolean);
        return parts.join(' ').trim();
    }, [data.name, data.contactInfo]);

    // Debounced duplicate search while typing (create only)
    useEffect(() => {
        if (!isNew) {
            setDuplicateResults(null);
            return;
        }
        const query = getDuplicateSearchQuery();
        if (data.name.trim().length < MIN_NAME_LENGTH_FOR_SEARCH) {
            setDuplicateResults(null);
            return;
        }
        if (duplicateDebounceRef.current) clearTimeout(duplicateDebounceRef.current);
        duplicateDebounceRef.current = setTimeout(async () => {
            duplicateDebounceRef.current = null;
            setDuplicateSearching(true);
            try {
                const response = await findAdopters(
                    { raw: query || data.name.trim() },
                    { mode: 'discovery', enrich: true, minRelevance: 15 },
                );
                const confident = (response.results as DiscoveryMatch[]);
                if (response.validationError || !confident.length) {
                    setDuplicateResults(null);
                } else {
                    setDuplicateResults(confident.slice(0, MAX_DUPLICATE_CARD_RESULTS));
                }
            } catch {
                setDuplicateResults(null);
            } finally {
                setDuplicateSearching(false);
            }
        }, DUPLICATE_DEBOUNCE_MS);
        return () => {
            if (duplicateDebounceRef.current) clearTimeout(duplicateDebounceRef.current);
        };
    }, [isNew, data.name, data.contactInfo, getDuplicateSearchQuery]);

    // Perform the actual save (used after "Create new anyway" or when no duplicates)
    const performActualSave = useCallback(async () => {
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
                        const date = searchParams.get('date');
                        if (date) params.set('date', date);
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
    }, [data, isNew, formPrefill, searchParams, router, t]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAuthenticated) {
            openLogin();
            return;
        }
        if (isNew) {
            const query = getDuplicateSearchQuery() || data.name.trim();
            if (query.length >= MIN_NAME_LENGTH_FOR_SEARCH) {
                try {
                    const response = await findAdopters(
                        { raw: query },
                        { mode: 'discovery', enrich: true, minRelevance: 15 },
                    );
                    const confident = response.results as DiscoveryMatch[];
                    if (!response.validationError && confident.length) {
                        setSaveDuplicateModal({ matches: confident });
                        return;
                    }
                } catch {
                    // Proceed to save on search error
                }
            }
        }
        await performActualSave();
    };

    const handleCancel = () => {
        if (isNew) {
            router.back();
        } else {
            // Reset data and exit edit mode
            setData({
                id: initialData?.id || '',
                name: initialData?.name || formPrefill?.name || nameFromUrl || '',
                status: initialData?.status || '5',
                contactInfo: initialData?.contactInfo || formPrefill?.contactInfo || '',

                familyMembers: initialData?.familyMembers || '',
            });
            setIsEditing(false);
        }
    };

    return (
        <div className={`bg-white rounded-2xl shadow-sm border border-stone-200 relative group transition-all duration-300 overflow-hidden ${isEditing ? 'ring-4 ring-teal-50/50' : ''}`}>

            <form onSubmit={handleSave} className="p-5">
                {/* ═══ IDENTITY HEADER ═══ */}
                <div className="flex flex-col gap-3 mb-4">
                    {/* Identity header row features avatar, name/input, and actions all inline */}
                    <div className="flex items-start md:items-center gap-3">
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
                            const placeholder = (
                                <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl bg-gradient-to-br from-teal-400 to-teal-500 flex items-center justify-center shadow-sm">
                                    {avatarUploading ? (
                                        <svg className="w-5 h-5 text-white animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                                            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                        </svg>
                                    ) : (
                                        <span className="text-white font-semibold text-sm md:text-lg">{initials || '?'}</span>
                                    )}
                                </div>
                            );
                            // Only authenticated users see the upload affordance.
                            // Anonymous viewers get a non-interactive placeholder.
                            if (!isAuthenticated) {
                                return <div className="flex-shrink-0">{placeholder}</div>;
                            }
                            return (
                                <div className="relative flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => avatarFileInputRef.current?.click()}
                                        disabled={avatarUploading}
                                        aria-label={t('adopter.add_profile_photo') || 'Add profile photo'}
                                        title={t('adopter.add_profile_photo') || 'Add profile photo'}
                                        className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 hover:opacity-90 transition-opacity"
                                    >
                                        {placeholder}
                                    </button>
                                    {/* Camera badge — bottom-right of the avatar circle.
                                        Persistent (not hover-only) so it works on touch. */}
                                    {!avatarUploading && (
                                        <span
                                            className="pointer-events-none absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-stone-200 flex items-center justify-center shadow-sm text-stone-600"
                                            aria-hidden="true"
                                        >
                                            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M3 7a1 1 0 0 1 1-1h2.5l1-1.5h5l1 1.5H16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
                                                <circle cx="10" cy="11" r="2.5" />
                                            </svg>
                                        </span>
                                    )}
                                    <input
                                        ref={avatarFileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleAvatarFileChange}
                                    />
                                </div>
                            );
                        })()}
                        <div className="min-w-0 flex-1">
                            {/* Inline-editable name + Actions */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
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
                                </div>
                                {/* Actions (right-aligned inline) */}
                                <div className="flex items-center justify-end gap-2 flex-shrink-0">
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
                                                className="flex items-center justify-center w-8 h-8 text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                                                title={t('common.edit') || 'Edit'}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
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
                                                                {/* Share Profile */}
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        const url = `${window.location.origin}/adopter/${id}`;
                                                                        if (navigator.share) {
                                                                            try { await navigator.share({ title: initialData?.name || '', url }); } catch { /* cancelled */ }
                                                                        } else {
                                                                            try { await navigator.clipboard.writeText(url); } catch {
                                                                                const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                                                                            }
                                                                        }
                                                                        setShowReportMenu(false);
                                                                    }}
                                                                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                                                                >
                                                                    <span className="text-lg mt-0.5">🔗</span>
                                                                    <div>
                                                                        <div className="text-sm font-semibold text-stone-900">{t('common.share') || 'Share Profile'}</div>
                                                                        <div className="text-xs text-stone-500 mt-0.5">{t('common.copy_link') || 'Copy link or share'}</div>
                                                                    </div>
                                                                </button>
                                                                <div className="border-t border-stone-100" />
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
                            </div>
                            {/* Metadata row */}
                            {!isNew && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs">
                                    {initialData?.country && (() => {
                                        const c = getCountryByCode(initialData.country!);
                                        if (!c) return null;
                                        return <span className="text-stone-500">{currentLocale === 'es' ? c.nameEs : c.name}</span>;
                                    })()}
                                    {profileViews !== undefined && profileViews > 0 && (
                                        <span className="text-stone-500 inline-flex items-center gap-1">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            {profileViews} {t('stats.views') || 'views'}
                                        </span>
                                    )}
                                    {initialData?.sourceUrl && (
                                        <a href={initialData.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors">
                                            {getSourceIcon(initialData.sourceUrl, 'w-3 h-3')}
                                            <span>{t('adopter.view_source') || 'Source'}</span>
                                        </a>
                                    )}
                                    {/* Rating badge — colored pill for severity visibility */}
                                    {avgRating !== null && avgRating !== undefined && (
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            data-testid="rating-badge"
                                            onClick={() => document.getElementById('adoptions-section')?.scrollIntoView({ behavior: 'smooth' })}
                                            className="cursor-pointer hover:shadow-md transition-shadow"
                                        >
                                            <RatingBadge rating={avgRating} size="sm" />
                                        </div>
                                    )}
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
                            tooManyAdoptions={adoptionsDensity.count >= threshold ? { count: adoptionsDensity.count, actualSpanDays: adoptionsDensity.timeSpanDays, periodDays, startDate: adoptionsDensity.startDate, endDate: adoptionsDensity.endDate } : undefined}
                            tooManyRequests={requestsDensity.count >= requestsThreshold ? { count: requestsDensity.count, actualSpanDays: requestsDensity.timeSpanDays, periodDays: requestsPeriodDays, startDate: requestsDensity.startDate, endDate: requestsDensity.endDate } : undefined}
                            hasDuplicateBanner={hasDuplicateBanner}
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

                    {/* Possible matching profiles (create only, non-blocking) */}
                    {isNew && isEditing && (
                        <>
                            {duplicateSearching && (
                                <div className="md:col-span-2 flex items-center gap-2 text-sm text-stone-500">
                                    <span className="inline-block w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" aria-hidden />
                                    {t('common.searching') || 'Searching'}…
                                </div>
                            )}
                            {!duplicateSearching && duplicateResults && duplicateResults.length > 0 && (
                                <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4" role="region" aria-labelledby="duplicate-card-title">
                                    <h4 id="duplicate-card-title" className="text-sm font-semibold text-amber-900 mb-1">
                                        {t('import.duplicateCard_title') || 'Possible matching profiles'}
                                    </h4>
                                    <p className="text-xs text-amber-700 mb-3">
                                        {t('import.duplicateCard_subtitle') || 'Similar names in your records'}
                                    </p>
                                    <ul className="space-y-2">
                                        {duplicateResults.map((result) => (
                                            <li key={result.adopter.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white/80 border border-amber-100">
                                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                                    {result.thumbnail ? (
                                                        <img src={result.thumbnail} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                                                    ) : (
                                                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm flex-shrink-0">
                                                            {result.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-stone-800 text-sm truncate">{result.adopter.name}</p>
                                                        {result.adopter.contactInfo && (
                                                            <p className="text-xs text-stone-500 truncate">{result.adopter.contactInfo}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <a
                                                        href={`/adopter/${result.adopter.id}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-2 py-1 text-xs font-medium text-stone-600 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors"
                                                    >
                                                        {t('import.duplicateCard_view') || 'View'}
                                                    </a>
                                                    <a
                                                        href={`/adopter/${result.adopter.id}`}
                                                        className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                                                    >
                                                        {t('import.duplicateCard_use_profile') || 'Use this profile'}
                                                    </a>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}

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

                </div>
            </form>

            {/* Save confirmation modal when possible duplicates found */}
            {saveDuplicateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setSaveDuplicateModal(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="save-duplicate-modal-title"
                    aria-describedby="save-duplicate-modal-desc"
                >
                    <div
                        ref={saveDuplicateModalRef}
                        className="relative bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 id="save-duplicate-modal-title" className="text-lg font-semibold text-stone-900 p-5 pb-2">
                            {t('import.saveModal_title') || 'Possible duplicate profiles'}
                        </h2>
                        <p id="save-duplicate-modal-desc" className="text-sm text-stone-600 px-5 pb-4">
                            {t('import.saveModal_body') || 'Creating a new profile may create a duplicate. You can link to an existing profile instead.'}
                        </p>
                        <ul className="px-5 space-y-2 max-h-48 overflow-y-auto">
                            {saveDuplicateModal.matches.map((result) => (
                                <li key={result.adopter.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-stone-50 border border-stone-200">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        {result.thumbnail ? (
                                            <img src={result.thumbnail} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold flex-shrink-0">
                                                {result.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="font-semibold text-stone-800 truncate">{result.adopter.name}</p>
                                            {result.adopter.contactInfo && (
                                                <p className="text-xs text-stone-500 truncate">{result.adopter.contactInfo}</p>
                                            )}
                                        </div>
                                    </div>
                                    <a
                                        href={`/adopter/${result.adopter.id}`}
                                        className="px-3 py-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors flex-shrink-0"
                                    >
                                        {t('import.saveModal_use_existing') || 'Use existing profile'}
                                    </a>
                                </li>
                            ))}
                        </ul>
                        <div className="p-5 pt-4 flex flex-col sm:flex-row gap-2 sm:justify-end border-t border-stone-100">
                            <button
                                type="button"
                                ref={createAnywayButtonRef}
                                onClick={async () => {
                                    setSaveDuplicateModal(null);
                                    await performActualSave();
                                }}
                                className="px-4 py-2.5 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors"
                            >
                                {t('import.saveModal_create_anyway') || 'Create new profile anyway'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSaveDuplicateModal(null)}
                                className="px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
                            >
                                {t('common.cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
