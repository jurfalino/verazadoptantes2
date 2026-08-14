'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useSetEditActions } from "@/context/EditActionsContext";
import { InlineEditField } from "@/components/InlineEditField";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAdopter, saveImage, findFormDuplicates, appendToExistingAdopter } from "@/app/actions";
import { buildMatchChips, hasStrongMatch, type MatchChip } from "@/lib/matchChips";
import DuplicatePeek from "@/components/DuplicatePeek";
import StrongMatchStrip from "@/components/StrongMatchStrip";
import { zarazTrack } from "@/lib/zaraz";
import type { DiscoveryMatch } from "@/app/actions";
import { linkFormSubmissionToAdopter } from '@/app/actions/formSubmission';
import { useLanguage } from "@/context/LanguageContext";
import ContactEntriesSection from "@/components/ContactEntriesSection";
import { deserializeContactEntries, parseBlobToContactEntries, contactEntriesToBlob, type ContactEntry, type ContactEntryType } from "@/lib/contactEntries";
import type { VisibilityBadge } from "@/domain/visibilityBadge";
import { hasMinimumIdentifier } from "@/domain/adopterIdentity";
import { adopterDisplayName, namelessSubIdentifier } from "@/lib/adopterDisplay";

import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { RatingBadge } from '@/components/RatingBadge';
import ProfilePhotoChooser from '@/components/ProfilePhotoChooser';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { reportClientError } from '@/lib/clientErrorReporter';

import { getSourceIcon } from '@/lib/sourceIcons';
import { getCountryByCode } from '@/config/countries';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { renderTextWithLinks } from '@/lib/textUtils';
import { AdopterFlagging } from '@/components/AdopterFlagging';
import type { AdopterFlaggingHandle } from '@/components/AdopterFlagging';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, AdoptionConfig } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';

interface AdopterFormProps {
    initialData?: Adopter | null;
    currentUser?: string;
    /** v2.26.1: ALL adopter images (profile-level + activity-linked) — used for
     *  avatar resolution and the profile-photo chooser. The Photos gallery uses
     *  the profile-level list separately (ImageGallery in AdopterProfileV2). */
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
    /** v2.18.15: creator + org attribution shown as a byline in the metadata
     *  row below the H1, alongside country / views / rating. Replaces the
     *  orphaned mid-page chip that lived in AdopterProfileV2. */
    attribution?: { creatorName: string; orgName: string | null; orgSlug: string | null } | null;
    /** Whether the viewer shares an org with the creator — drives the chip
     *  accent color (teal "this is my teammate" vs neutral grey). */
    isOrgMateOfOwner?: boolean;
    /** Whether the viewer is "privileged" per piiAccess — gates whether the
     *  org part of the byline is shown (strangers see name only). */
    isPrivileged?: boolean;
    /**
     * Mirrors the server-side `canEditAdopterRecord` decision. When false, the
     * form blocks entry into edit mode (no pencil, no click-to-edit hover
     * affordance, no-op handler). Default `true` preserves legacy behavior on
     * surfaces that don't compute it (e.g. the new-adopter form).
     */
    canEdit?: boolean;
    /**
     * Click handler for a masked contact entry chip on a PII-gated profile.
     * When provided, masked chips open the parent-owned verify/request popover.
     * When absent (gating off, or viewer is privileged), the chips render the
     * un-masked value directly via the existing ContactEntriesSection display.
     */
    onMaskedContactClick?: (entryType: ContactEntryType) => void;
    /**
     * Click handler for the (partially-revealed) name header on a PII-gated
     * profile. Opens the parent-owned verify popover so the viewer can type
     * the full name they expect and have matching tokens unlocked. Absent
     * when gating is off or the viewer is privileged.
     */
    onMaskedNameClick?: () => void;
    /** Visibility verdict for the profile header pill — mirror of the search card's
     *  Público/Protegido badge. Computed by the parent from the SAME piiAccess
     *  masking signal. Null (default) = no pill (new/edit form, or a privileged
     *  viewer who can see the contact). Only rendered in the read (non-editing) view. */
    visibilityBadge?: VisibilityBadge | null;
    /** Opens the visibility/access explanatory modal when the badge is tapped.
     *  Provided by the profile; absent on the new-adopter form (no badge there). */
    onBadgeClick?: () => void;
}

function MatchChipsRow({ chips }: { chips: MatchChip[] }) {
    if (chips.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1.5">
            {chips.map(chip => (
                <span
                    key={chip.key}
                    className={
                        chip.isStrong
                            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200"
                            : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200"
                    }
                    title={chip.label}
                >
                    <span aria-hidden="true">{chip.icon}</span>
                    <span className="truncate max-w-[160px]">{chip.label}</span>
                </span>
            ))}
        </div>
    );
}

export function AdopterForm({ initialData, currentUser, images = [], adopterId, avgRating, profileViews, flags = [], adoptions = [], adoptionConfig, isAdmin = false, formPrefill = null, hasDuplicateBanner = false, attribution = null, isOrgMateOfOwner = false, isPrivileged = false, canEdit = true, onMaskedContactClick, onMaskedNameClick, visibilityBadge = null, onBadgeClick }: AdopterFormProps) {
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
    // Publishes edit state to the global nav so, on MOBILE, it shows Cancelar/Guardar
    // (keyboard-proof) while editing an existing profile. `formRef` lets the nav's
    // Save trigger the same submit path as the desktop button (incl. HTML validation
    // on the required name). `handleCancelRef` keeps the published handler stable.
    const setEditActions = useSetEditActions();
    const formRef = useRef<HTMLFormElement>(null);
    const handleCancelRef = useRef<() => void>(() => {});

    // Auth check — single source of truth for both click-to-edit and save
    const isAuthenticated = useMemo(
        () => (currentUser && currentUser !== '') || !!session?.user,
        [currentUser, session]
    );

    // v2.26.2: changing the profile photo (pick existing OR upload-as-avatar) is
    // gated the same as editing the record's contact info — owner ∨ admin ∨
    // org-mate — mirroring the server gate in setProfilePicture / saveImage.
    // NOT reusing `canEdit` (it's PII-flag-based and true for everyone in prod);
    // this computes the real record-edit permission the server enforces.
    const canChangeProfilePhoto = !isNew && isAuthenticated
        && (isAdmin || isOrgMateOfOwner || (!!currentUser && currentUser === (initialData?.addedBy ?? '')));

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

    // Manual-create friction gate (nameless-adopter-profiles design): saving
    // with an empty name shows a gentle prompt instead of hard-blocking via
    // HTML `required`. `dontKnowName` is the explicit opt-in that lets the
    // rescuer proceed with a contact-only record; `nameHint` toggles the
    // inline prompt/error under the name input. See handleSave.
    const [dontKnowName, setDontKnowName] = useState(false);
    const [nameHint, setNameHint] = useState(false);
    // Anonymous (no-name) records default to Público (findable) so their
    // contact info isn't invisible; the rescuer can flip this to Protegido.
    // Only meaningful (and only sent to saveAdopter) when dontKnowName is true.
    const [anonPublic, setAnonPublic] = useState(true);

    // Duplicate detection (create only): while-typing results + save confirmation modal
    const [duplicateResults, setDuplicateResults] = useState<DiscoveryMatch[] | null>(null);
    const [duplicateSearching, setDuplicateSearching] = useState(false);
    const [saveDuplicateModal, setSaveDuplicateModal] = useState<{ matches: DiscoveryMatch[] } | null>(null);
    // v2.19.65: gate the create-flow duplicate-detection on whether the
    // search-relevant content has actually changed from what the rescuer
    // already saw in search.
    //
    // The rescuer landed on /adopter/create with name (+ optional phone)
    // prefilled from their search query. By construction, the form-time
    // finder running on those prefilled values would surface the same
    // records search already showed them. We snapshot the normalized
    // prefilled query on first render; the effect + save-modal both skip
    // while the current normalized query equals the snapshot.
    //
    // v2.19.63 used a coarse `hasUserEdited` dirty flag here. The flag
    // fired on ANY mutation — trailing space, case toggle, deleting and
    // retyping the same character — input changes that don't change what
    // search would have returned. Replaced with a content-based comparison
    // so meaningless edits don't re-surface dismissed records.
    //
    // Normalization is conservative on purpose: trim + lowercase +
    // whitespace collapse. NO accent-strip — typing "María" over a
    // prefilled "Maria" is a more specific spelling and warrants a fresh
    // check.
    const normalizeDetectionQuery = useCallback(
        (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' '),
        []
    );
    // Snapshot of the prefilled query at mount time. Captured ONCE from the
    // initial form values (whatever search routed into name + contactInfo).
    // If the form started empty (direct nav, no search), the ref stays null
    // and the detection effect runs normally on the rescuer's first input.
    const initialDetectedQuery = useRef<string | null>(null);
    useEffect(() => {
        if (!isNew) return;
        const initial = (getDuplicateSearchQuery() || data.name).trim();
        if (!initial) return;
        initialDetectedQuery.current = normalizeDetectionQuery(initial);
        // Run once on mount — capture the prefilled state before the rescuer
        // can edit it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const saveDuplicateModalRef = useRef<HTMLDivElement>(null);
    const createAnywayButtonRef = useRef<HTMLButtonElement>(null);
    const duplicateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Strong-match dismissal: ids the user explicitly ×-ed off the strong strip.
    // Save-time modal only fires for strong matches NOT in this set.
    const [dismissedStrongIds, setDismissedStrongIds] = useState<Set<string>>(() => new Set());
    // "Continuar con este perfil" loading guard — one in-flight call at a time.
    const [continueBusyId, setContinueBusyId] = useState<string | null>(null);
    // Confirmation modal — pending append target until the user confirms.
    const [pendingMerge, setPendingMerge] = useState<{ adopterId: string; adopterName: string } | null>(null);

    const DUPLICATE_DEBOUNCE_MS = 350;

    // ── Avatar profile-photo upload (empty-state only) ──────────────────────
    // When an adopter has no photo yet, the initials placeholder is clickable
    // for any authenticated user. Funnels into the same saveImage pipeline used
    // by ImageGallery; flagged isProfilePicture so the avatar fills immediately.
    const avatarFileInputRef = useRef<HTMLInputElement>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    // Chooser for setting the avatar to one of the profile's existing photos
    // (or uploading a new one). Opened from the avatar / camera affordance.
    const [chooserOpen, setChooserOpen] = useState(false);
    // Real (persisted) profile photos that can be picked as the avatar.
    const pickableImages = images.filter((img) => img.id && !img.id.startsWith('temp-'));
    // Avatar entry point: offer the existing-photo chooser when there's something
    // to pick; otherwise (no photos yet) go straight to the file picker to upload.
    const openAvatarEditor = () => {
        if (pickableImages.length > 0) setChooserOpen(true);
        else avatarFileInputRef.current?.click();
    };

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
            toast.error(t('errors.generic'), t('adopter.upload_invalid_type') || 'Please choose an image file.');
            return;
        }
        if (!id) {
            // Brand-new adopter being created — no id to attach to yet.
            toast.warning(t('errors.generic'), t('adopter.upload_save_first') || 'Save the profile first, then add a photo.');
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
            toast.error(t('errors.generic'), t('adopter.upload_failed') || 'Could not upload the photo. Try again.', extractErrorId(err));
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


    // Status uses numeric values 1-5 only
    const defaultStatus = intent === 'report' ? '1' : '5';

    // Name can come from URL when coming from homepage search or Adoption/Report wizard
    const nameFromUrl = searchParams.get('name')?.trim() || '';
    // v2.19.35: phone can come from URL when the homepage search tokenized a
    // mixed query like "Susana 11-2345-6789" — see SearchSection.handleCreateNew.
    // Captured as a contact-entry chip below, NOT shoved into data.contactInfo
    // (the form's source of truth for entries is `contactEntries`, and the
    // contactInfo blob is regenerated from it on every state update).
    const phoneFromUrl = searchParams.get('phone')?.trim() || '';
    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || formPrefill?.name || nameFromUrl || '',
        status: initialData?.status || defaultStatus,
        contactInfo: initialData?.contactInfo || formPrefill?.contactInfo || '',

        familyMembers: initialData?.familyMembers || '',
    });

    // Structured contact entries. Initialized from the stored JSON, falling
    // back to a best-effort parse of the legacy contactInfo blob so editing an
    // old (un-migrated) record still shows typed chips. data.contactInfo is
    // kept in sync as the derived blob for the existing read sites below.
    //
    // v2.19.35: when no `initialData` and no `formPrefill` blob exist but the
    // URL carries a `phone=` param (from SearchSection's tokenized "create
    // new" flow), seed a single phone entry. Falls through to the legacy blob
    // parse otherwise. The `id` is generated here so the chip is stable
    // across re-renders without relying on deserializeContactEntries to
    // backfill it.
    const [contactEntries, setContactEntries] = useState<ContactEntry[]>(() => {
        if (initialData?.contactEntries) return deserializeContactEntries(initialData.contactEntries);
        const blob = initialData?.contactInfo || formPrefill?.contactInfo || '';
        if (blob) return parseBlobToContactEntries(blob);
        if (isNew && phoneFromUrl) {
            return [{ id: crypto.randomUUID(), type: 'phone', value: phoneFromUrl }];
        }
        return [];
    });
    // Sync read-mode state from `initialData` when the prop reference changes.
    // The two useState initializers above run ONCE on mount, so without this
    // effect a `router.refresh()` triggered elsewhere — e.g. PiiVerifyPopover
    // unlocks a contact entry → page re-fetches → new `initialData` arrives —
    // would leave the form's local state stale and the masked values wouldn't
    // visibly update until a full reload. Guarded by `isEditing` so a draft
    // isn't clobbered by a background refresh.
    useEffect(() => {
        if (isEditing || !initialData) return;
        setData({
            id: initialData.id || '',
            name: initialData.name || formPrefill?.name || nameFromUrl || '',
            status: initialData.status || defaultStatus,
            contactInfo: initialData.contactInfo || formPrefill?.contactInfo || '',
            familyMembers: initialData.familyMembers || '',
        });
        setContactEntries(
            initialData.contactEntries
                ? deserializeContactEntries(initialData.contactEntries)
                : parseBlobToContactEntries(initialData.contactInfo || formPrefill?.contactInfo || ''),
        );
        // Intentional: re-sync only on a new `initialData` reference. The
        // `isEditing` read is a guard, not a trigger — including it would
        // cause edit-toggle to re-clobber state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData]);

    // Build search query from name + contact for duplicate check
    const getDuplicateSearchQuery = useCallback(() => {
        const parts = [data.name.trim(), data.contactInfo.trim()].filter(Boolean);
        return parts.join(' ').trim();
    }, [data.name, data.contactInfo]);

    // Structured input for the duplicate engine (findFormDuplicates). Pulling
    // phone/email/social from the STRUCTURED contactEntries — not the free-text
    // blob — is what lets phone-suffix normalization fire (e.g. "1165851333"
    // matching a stored "+5491165851333"). The blob path frequently omitted the
    // phone entirely, so detection rode on the name alone. v2.26.5.
    const getDuplicateInput = useCallback(() => {
        const pick = (t: ContactEntryType) =>
            contactEntries.filter(e => e.type === t).map(e => e.value.trim()).filter(Boolean);
        return {
            name: data.name.trim(),
            phones: pick('phone'),
            emails: pick('email'),
            socials: pick('social'),
        };
    }, [data.name, contactEntries]);

    // "Continuar con este perfil" — open the confirmation modal first so the
    // user knows their in-progress data will be merged into the existing record.
    // The actual append fires only from confirmMerge() below.
    const handleContinueWith = useCallback((targetId: string) => {
        if (continueBusyId) return;
        const match = duplicateResults?.find(r => r.adopter.id === targetId);
        if (!match) return;
        setPendingMerge({ adopterId: targetId, adopterName: match.adopter.name });
    }, [continueBusyId, duplicateResults]);

    const confirmMerge = useCallback(async () => {
        if (!pendingMerge || continueBusyId) return;
        const targetId = pendingMerge.adopterId;
        setContinueBusyId(targetId);
        try {
            const result = await appendToExistingAdopter(targetId, {
                contactInfo: data.contactInfo || undefined,
                contactEntries: contactEntries.length ? JSON.stringify(contactEntries) : undefined,
                familyMembers: data.familyMembers || undefined,
            });
            if (result.success && result.adopterId) {
                router.push(`/adopter/${result.adopterId}`);
            } else {
                // eslint-disable-next-line no-alert
                alert(result.error || 'No se pudo continuar con este perfil');
                setContinueBusyId(null);
                setPendingMerge(null);
            }
        } catch (e) {
            // eslint-disable-next-line no-alert
            alert(e instanceof Error ? e.message : 'Error inesperado');
            setContinueBusyId(null);
            setPendingMerge(null);
        }
    }, [pendingMerge, continueBusyId, data.contactInfo, data.familyMembers, contactEntries, router]);

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
        // v2.19.65: skip if the current normalized query still equals what
        // the rescuer's prefill (captured at mount) already showed in search.
        // Whitespace, case, "type-then-undo" all collapse to the snapshot
        // and don't re-fire detection. Once the content meaningfully
        // diverges, the snapshot is stale and we resume detection.
        const currentNorm = normalizeDetectionQuery(query || data.name.trim());
        if (initialDetectedQuery.current !== null && currentNorm === initialDetectedQuery.current) {
            setDuplicateResults(null);
            return;
        }
        if (duplicateDebounceRef.current) clearTimeout(duplicateDebounceRef.current);
        duplicateDebounceRef.current = setTimeout(async () => {
            duplicateDebounceRef.current = null;
            setDuplicateSearching(true);
            try {
                const response = await findFormDuplicates(getDuplicateInput(), { minRelevance: 15 });
                const confident = (response.results as DiscoveryMatch[]);
                if (!confident.length) {
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
    }, [isNew, data.name, data.contactInfo, getDuplicateSearchQuery, getDuplicateInput, normalizeDetectionQuery]);

    // Perform the actual save (used after "Create new anyway" or when no duplicates)
    const performActualSave = useCallback(async () => {
        setLoading(true);
        try {
            // For existing adopters, contact entries are mutated via the unified
            // ContactEntriesSection (per-entry add/edit/remove server actions).
            // Strip them from the saveAdopter payload so the bulk replace path
            // doesn't override what those actions wrote.
            const payload = isNew
                ? { ...data, contactEntries: JSON.stringify(contactEntries), ...(dontKnowName ? { isPublic: anonPublic } : {}) }
                : { ...data, contactEntries: undefined, contactInfo: undefined };
            const res = await saveAdopter(payload);
            // v2.19.43: defensive check. saveAdopter is supposed to either return
            // { success: true | false, ... } or throw with an embedded errorId, but
            // we've seen rare cases (transient edge-runtime panic, network hiccup
            // mid-response) where `res` arrives undefined. Without this guard, the
            // next `res.success` read throws `Cannot read properties of undefined`
            // — a client-side runtime error with no server-side log to correlate
            // against. Treat undefined as a failure and route through the same
            // error-id path as a thrown server error.
            if (!res) {
                const errorId = await reportClientError({
                    message: 'saveAdopter returned undefined',
                    source: 'AdopterForm.performActualSave',
                    extra: { adopterId: data.id || null, isNew },
                });
                toast.error(t('toast.save_error_title'), t('errors.save_adopter_failed'), errorId);
                return;
            }
            if (res.success) {
                if (isNew) {
                    // Funnel-tracking event for Amplitude (via Zaraz). Fires
                    // only on the CREATE path; updates don't trigger it. The
                    // `continuesToAdoption` flag separates onboarding-completion
                    // ("they came to log activity and ended up here") from
                    // pure-profile-create.
                    zarazTrack('adopter_created', {
                        hasContactInfo: data.contactInfo ? 1 : 0,
                        hasFamilyMembers: data.familyMembers ? 1 : 0,
                        fromForm: formPrefill ? 1 : 0,
                        continuesToAdoption: searchParams.get('continueToAdoption') === 'true' ? 1 : 0,
                    });
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
                    // v2.19.0: animalId is the new canonical name that the
                    // AdoptionFormWizard reads to pre-select an inventory
                    // animal. linkAnimalId stays as a legacy alias for the
                    // older AdoptionWizard call sites.
                    const animalId = searchParams.get('animalId') || '';

                    let redirectUrl = `/adopter/${res.id}`;
                    if (continueToAdoption === 'true') {
                        // Redirect to profile with all wizard params (adoption or observation)
                        const params = new URLSearchParams();
                        // Forward animal-related params (AdoptionWizard)
                        if (linkAnimalId) params.set('linkAnimalId', linkAnimalId);
                        if (animalId) params.set('animalId', animalId);
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
                // v2.19.43: server-returned failure with no success flag. Report
                // it via reportClientError so the toast carries a correlatable
                // id. The server's `res.error` (if any) goes into the report's
                // `extra` for the Axiom row; the user sees only the id.
                const errorId = await reportClientError({
                    message: `saveAdopter returned success=false${res && 'error' in res && res.error ? `: ${res.error}` : ''}`,
                    source: 'AdopterForm.performActualSave',
                    extra: { adopterId: data.id || null, isNew, serverError: res && 'error' in res ? res.error : null },
                });
                toast.error(t('errors.generic'), t('errors.save_adopter_failed'), errorId);
            }
        } catch (err: any) {
            console.error("Save Error:", err);
            // v2.19.43: every error toast must carry an id (per user reminder).
            // Server-thrown errors (saveAdopter's catch block re-throws with the
            // id embedded in the message — see adopters.ts:357-358) yield an id
            // via extractErrorId. Client-side runtime errors (TypeError, network
            // failure, etc.) don't carry one, so we fall back to reportClientError
            // which logs to Axiom and returns a fresh id.
            let errorId = extractErrorId(err);
            if (!errorId) {
                errorId = await reportClientError({
                    message: err?.message ?? 'unknown error',
                    stack: err?.stack,
                    source: 'AdopterForm.performActualSave',
                    extra: { adopterId: data.id || null, isNew },
                });
            }
            toast.error(t('toast.save_error_title'), err?.message || t('errors.unexpected'), errorId);
        } finally {
            setLoading(false);
        }
    }, [data, contactEntries, isNew, formPrefill, searchParams, router, t, dontKnowName, anonPublic]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAuthenticated) {
            openLogin();
            return;
        }
        // Manual-create friction gate: no HTML `required` on the name input —
        // instead a save-time check. Neither name nor any contact → hard
        // error (can't identify the adopter at all). Name empty but contact
        // present → gentle prompt with an explicit "No conozco el nombre"
        // opt-in before the save is allowed through.
        const nameEmpty = !data.name.trim();
        const hasContact = hasMinimumIdentifier({ name: data.name, contactEntries: JSON.stringify(contactEntries), contactInfo: data.contactInfo });
        if (nameEmpty && !hasContact) { setNameHint(true); return; }
        if (nameEmpty && !dontKnowName) { setNameHint(true); return; }
        if (isNew) {
            // v2.19.65: if the rescuer's input still normalizes to what
            // search already showed them, skip the save-time modal — they're
            // explicitly accepting the state they evaluated upstream. The
            // null-check covers the very rare case where the detection
            // effect never ran (sub-MIN_NAME_LENGTH name): no snapshot, so
            // fall through to the normal flow.
            const query = getDuplicateSearchQuery() || data.name.trim();
            const currentNorm = normalizeDetectionQuery(query);
            const queryUnchanged = initialDetectedQuery.current !== null
                && currentNorm === initialDetectedQuery.current;
            if (!queryUnchanged && query.length >= MIN_NAME_LENGTH_FOR_SEARCH) {
                try {
                    const response = await findFormDuplicates(getDuplicateInput(), { minRelevance: 15 });
                    const confident = response.results as DiscoveryMatch[];
                    // Gate: only fire the modal for STRONG matches the user hasn't already
                    // dismissed from the strong strip. Weak-only result sets save silently
                    // (the peek bar was enough). Per Phase D of the dedup-UX redesign.
                    const strongUndismissed = confident.filter(m =>
                        hasStrongMatch(m.matchValues) && !dismissedStrongIds.has(m.adopter.id),
                    );
                    if (strongUndismissed.length > 0) {
                        setSaveDuplicateModal({ matches: strongUndismissed });
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
    handleCancelRef.current = handleCancel;

    // Latest `data` for inline per-field saves (avoids stale closures if two fields
    // are edited in quick succession).
    const dataRef = useRef(data);
    dataRef.current = data;

    // Per-field autosave for the unified direct-edit fields (name, family) on an
    // EXISTING profile — reuses saveAdopter with the existing-record payload (contact
    // is saved separately). Optimistic; reverts + toasts on failure so nothing is
    // silently lost. The returned boolean drives InlineEditField's 5-second undo.
    const saveField = useCallback(async (field: 'name' | 'familyMembers', next: string): Promise<boolean> => {
        const prevData = dataRef.current;
        const updated = { ...prevData, [field]: next };
        setData(updated);
        dataRef.current = updated;
        const res = await saveAdopter({ ...updated, contactEntries: undefined, contactInfo: undefined }).catch(() => null);
        if (!res?.success) {
            setData(prevData);
            dataRef.current = prevData;
            const errorId = await reportClientError({
                message: 'saveAdopter (inline field) failed',
                source: 'AdopterForm.saveField',
                extra: { field, adopterId: prevData.id || null },
            });
            toast.error(t('toast.save_error_title'), t('errors.save_adopter_failed'), errorId);
            return false;
        }
        return true;
    }, [toast, t]);

    // Publish/clear the nav's mobile actions — now ONLY for the new-adopter creation
    // flow (existing profiles edit each field inline, with no global Save). Re-runs on
    // `loading` without unregistering (no mid-save flicker); clears on exit + unmount.
    useEffect(() => {
        if (isEditing && isNew) {
            setEditActions({
                active: true,
                loading,
                onCancel: () => handleCancelRef.current(),
                onSave: () => formRef.current?.requestSubmit(),
            });
        } else {
            setEditActions(null);
        }
    }, [isEditing, isNew, loading, setEditActions]);
    useEffect(() => () => setEditActions(null), [setEditActions]);

    return (
        <div className={`bg-white rounded-2xl shadow-sm border border-stone-200 relative group transition-all duration-300 overflow-hidden ${isEditing ? 'ring-4 ring-teal-50/50' : ''}`}>

            {/* Hoisted hidden file input — triggered by both the empty-state camera button
                AND the "Cambiar foto" action inside the profile-photo lightbox. Single ref,
                single handler, two callers. Gated to those who may change the profile photo. */}
            {canChangeProfilePhoto && (
                <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarFileChange}
                />
            )}

            {/* Profile-photo chooser — opens when an editor taps the avatar/camera.
                Lets them set one of the profile's existing photos as the avatar, or
                upload a new one (which triggers the hidden input). */}
            {canChangeProfilePhoto && id && (
                <ProfilePhotoChooser
                    isOpen={chooserOpen}
                    onClose={() => setChooserOpen(false)}
                    images={images}
                    adopterId={id}
                    onUploadNew={() => avatarFileInputRef.current?.click()}
                />
            )}

            <form ref={formRef} onSubmit={handleSave} className="p-5">
                {/* On MOBILE, edit-mode Cancelar/Guardar live in the global nav (see
                    NavBar + EditActionsContext) — keyboard-proof, no extra bar. Desktop
                    keeps its inline header buttons below. */}
                {isNew && isEditing && (
                    <>
                        <DuplicatePeek
                            results={duplicateResults}
                            searching={duplicateSearching}
                            onContinueWith={handleContinueWith}
                            busyAdopterId={continueBusyId}
                        />
                        <StrongMatchStrip
                            results={duplicateResults}
                            dismissedIds={dismissedStrongIds}
                            onDismiss={(id) => setDismissedStrongIds(prev => {
                                const next = new Set(prev);
                                next.add(id);
                                return next;
                            })}
                            onContinueWith={handleContinueWith}
                            busyAdopterId={continueBusyId}
                        />
                    </>
                )}
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
                            // v2.26.1: `images` is now ALL images (profile-level +
                            // activity-linked). The avatar is the explicitly-flagged
                            // profile picture wherever it lives, else the newest
                            // profile-level photo — an activity photo never becomes
                            // the avatar unless it was set as the profile picture.
                            const profilePic = images.find(img => img.isProfilePicture === 1)
                                || images.filter(img => !img.adoptionId)[0]
                                || null;
                            if (profilePic) {
                                const displayUrl = profilePic.url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(profilePic.url)}` : profilePic.url;
                                const photoEl = (
                                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-xl bg-teal-100 overflow-hidden ring-2 ring-teal-200 shadow-sm">
                                        <img src={displayUrl} alt="" className="w-full h-full object-cover" />
                                    </div>
                                );
                                return (
                                    <div className="relative flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={canChangeProfilePhoto ? openAvatarEditor : undefined}
                                            disabled={avatarUploading}
                                            aria-label={canChangeProfilePhoto ? (t('adopter.change_profile_photo') || 'Change photo') : undefined}
                                            title={canChangeProfilePhoto ? (t('adopter.change_profile_photo') || 'Change photo') : undefined}
                                            className={`block rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition-opacity ${canChangeProfilePhoto ? 'hover:opacity-90 cursor-pointer' : 'cursor-default'}`}
                                        >
                                            {photoEl}
                                        </button>
                                        {/* Camera badge — same affordance as the empty state, so the
                                            "you can change this" cue is present only for those who may. */}
                                        {canChangeProfilePhoto && !avatarUploading && (
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
                            // Only those who may change the profile photo (owner ∨
                            // admin ∨ org-mate) see the add affordance. Everyone else
                            // — anonymous or non-editor — gets a static placeholder.
                            if (!canChangeProfilePhoto) {
                                return <div className="flex-shrink-0">{placeholder}</div>;
                            }
                            return (
                                <div className="relative flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={openAvatarEditor}
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
                                </div>
                            );
                        })()}
                        <div className="min-w-0 flex-1">
                            {/* Inline-editable name + Actions */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    {isEditing ? (
                                        <>
                                        <input
                                            type="text"
                                            className="w-full text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight bg-transparent border-b-2 border-teal-300 focus:border-teal-500 outline-none py-0.5 placeholder-stone-500 transition-all"
                                            value={data.name}
                                            onChange={e => setData({ ...data, name: e.target.value })}
                                            placeholder={t('adopter.placeholder_name_aliases')}
                                            autoFocus
                                        />
                                        {(nameHint || dontKnowName) && (
                                            <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                                                {nameHint && (
                                                    <>
                                                        <p>{t('adopter.name_empty_prompt')}</p>
                                                        {hasMinimumIdentifier({ name: data.name, contactEntries: JSON.stringify(contactEntries), contactInfo: data.contactInfo })
                                                            ? (<label className="inline-flex items-center gap-1.5 mt-1 cursor-pointer">
                                                                 <input type="checkbox" checked={dontKnowName} onChange={(e) => { setDontKnowName(e.target.checked); if (e.target.checked) setNameHint(false); }} />
                                                                 <span>{t('adopter.dont_know_name')}</span>
                                                               </label>)
                                                            : (<p className="text-rose-600 mt-1">{t('adopter.name_or_contact_required')}</p>)}
                                                    </>
                                                )}
                                                {dontKnowName && (
                                                    <div className="mt-1.5">
                                                        <p>{t('adopter.anon_public_notice')}</p>
                                                        <label className="inline-flex items-center gap-1.5 mt-1 cursor-pointer">
                                                            <input type="checkbox" checked={anonPublic} onChange={(e) => setAnonPublic(e.target.checked)} />
                                                            <span>{anonPublic ? t('search.public_label') : t('search.protected_label')}</span>
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        </>
                                    ) : (
                                      <>
                                      <div className="flex items-center gap-2 min-w-0">
                                        {(() => {
                                        const displayName = !isNew && initialData ? adopterDisplayName(initialData, t('adopter.nameless')) : t('adopter.title_new');
                                        // Initial-only tokens (1-char words separated by whitespace) are
                                        // the visual signature of `partialRevealName` — when present the
                                        // viewer has only the initials of those tokens. Make the whole
                                        // h1 a tap target that opens the verify popover so they can
                                        // confirm a hypothesis about the full name. No-op when the
                                        // parent didn't supply the handler (gating off / privileged
                                        // viewer / new-adopter form).
                                        const tokens = (displayName ?? '').trim().split(/\s+/);
                                        const looksPartiallyRevealed = tokens.some(t => t.length === 1);
                                        if (onMaskedNameClick && looksPartiallyRevealed) {
                                            return (
                                                <button
                                                    type="button"
                                                    onClick={onMaskedNameClick}
                                                    aria-label={t('adopter.pii_masked_name_aria') || displayName}
                                                    title={t('adopter.pii_masked_name_title') || ''}
                                                    className="min-w-0 text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight truncate text-left hover:underline underline-offset-4 decoration-teal-400 transition-colors cursor-pointer"
                                                >
                                                    {displayName}
                                                </button>
                                            );
                                        }
                                        // Unified direct-edit: tap the name → inline input → autosaves
                                        // on blur → Deshacer. Display stays an <h1> (heading role, e2e).
                                        return (
                                            <InlineEditField
                                                value={data.name}
                                                canEdit={canEdit}
                                                required
                                                ariaLabel={displayName}
                                                editButtonTestId="name-edit-btn"
                                                onSave={(next) => saveField('name', next)}
                                                rootClassName="min-w-0 flex-1"
                                                inputClassName="w-full text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight bg-transparent border-b-2 border-teal-300 focus:border-teal-500 outline-none py-0.5 placeholder-stone-500 transition-all"
                                                placeholder={t('adopter.placeholder_name_aliases')}
                                                emptyLabel={t('adopter.nameless')}
                                                displayRender={(v) => (
                                                    <h1 className="text-xl md:text-2xl font-extrabold text-teal-950 tracking-tight truncate">{v}</h1>
                                                )}
                                            />
                                        );
                                        })()}
                                        {/* Visibility badge — INLINE with the name, mirroring the search
                                            card (Nielsen #4). Now a button: tapping opens the
                                            visibility/access explanatory modal. Three states:
                                            público (eye/sky), protegido-locked (closed padlock/gray,
                                            no access), protegido-unlocked (open padlock/teal, viewer
                                            has full access — the state that used to show no badge). */}
                                        {visibilityBadge && (() => {
                                            const common = "flex-none inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded transition-opacity hover:opacity-80";
                                            if (visibilityBadge === 'public') {
                                                return (
                                                    <button type="button" onClick={onBadgeClick} aria-haspopup="dialog" title={t('search.public_title')}
                                                        className={common} style={{ backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' }}>
                                                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                                            <path d="M2.5 12S6 5.5 12 5.5s9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                                                            <circle cx="12" cy="12" r="3" />
                                                        </svg>
                                                        {t('search.public_label')}
                                                    </button>
                                                );
                                            }
                                            if (visibilityBadge === 'protected-unlocked') {
                                                return (
                                                    <button type="button" onClick={onBadgeClick} aria-haspopup="dialog" title={t('search.protected_unlocked_title')}
                                                        className={common} style={{ backgroundColor: 'var(--accent-badge-bg)', color: 'var(--accent-badge-text)' }}>
                                                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                                            <rect x="3.5" y="11" width="17" height="10" rx="2" />
                                                            <path d="M7.5 11V7a4.5 4.5 0 0 1 8.5-2" />
                                                        </svg>
                                                        {t('search.protected_unlocked_label')}
                                                    </button>
                                                );
                                            }
                                            // protected-locked
                                            return (
                                                <button type="button" onClick={onBadgeClick} aria-haspopup="dialog" title={t('search.protected_title')}
                                                    className={`${common} bg-stone-100 text-stone-500`}>
                                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                                        <rect x="3.5" y="11" width="17" height="10" rx="2" />
                                                        <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
                                                    </svg>
                                                    {t('search.protected_label')}
                                                </button>
                                            );
                                        })()}
                                      </div>
                                      {/* Sub-identifier for a nameless adopter — only when the
                                          contact reaching this form is unmasked for the viewer
                                          (isPrivileged); a masked contact would be useless noise. */}
                                      {!isNew && initialData && !initialData.name?.trim() && isPrivileged && (() => {
                                          const subId = namelessSubIdentifier(initialData.contactInfo);
                                          return subId ? (
                                              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                                                  {subId}
                                              </p>
                                          ) : null;
                                      })()}
                                      </>
                                    )}
                                </div>
                                {/* Actions (right-aligned inline) */}
                                <div className="flex items-center justify-end gap-2 flex-shrink-0">
                                    {isEditing ? (
                                        // Desktop: inline Cancel/Save in the header. On mobile these
                                        // are hidden so the name input gets the full row width; the
                                        // sticky bottom bar (below, md:hidden) carries the actions there.
                                        <div className="hidden md:flex items-center gap-2">
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
                                                data-testid="adopter-form-submit"
                                                className="px-4 py-1.5 text-sm font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 focus:ring-4 focus:ring-teal-200 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-700/30 transform active:scale-95"
                                            >
                                                {loading ? t('common.loading') : t('common.save')}
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {/* No batch "edit" pencil anymore — each field on an existing
                                                profile is directly editable inline (see InlineEditField). */}
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
                            {/* Verdict — the rating is the single most important at-a-glance
                                signal on a vetting tool, so it's promoted (md, with label) to its
                                own prominent row right under the name, not buried in the meta row. */}
                            {!isNew && avgRating !== null && avgRating !== undefined && (
                                <div className="mt-2">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        data-testid="rating-badge"
                                        onClick={() => document.getElementById('adoptions-section')?.scrollIntoView({ behavior: 'smooth' })}
                                        className="inline-block cursor-pointer hover:shadow-md transition-shadow rounded-full"
                                    >
                                        <RatingBadge rating={avgRating} size="md" label="short" />
                                    </div>
                                </div>
                            )}
                            {/* Metadata row */}
                            {!isNew && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs">
                                    {/* Creator byline (v2.18.15). First item in the meta
                                        row because "who created this" is the most
                                        identifying piece of record metadata. Privileged
                                        viewers see name + org chip; strangers see name
                                        only (no org membership leak). */}
                                    {attribution && attribution.creatorName && (
                                        <span className="inline-flex items-center gap-1.5 text-stone-500">
                                            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                            <span className="truncate max-w-[10rem]" title={attribution.creatorName}>{attribution.creatorName}</span>
                                            {isPrivileged && attribution.orgName && (
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${isOrgMateOfOwner ? 'bg-teal-50 text-teal-700' : 'bg-stone-100 text-stone-600'}`}>
                                                    {attribution.orgName}
                                                </span>
                                            )}
                                        </span>
                                    )}
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
                    {/* Contact — same surface for both jobs (consistency
                        across new vs existing). ContactEntriesSection runs
                        in local mode for new-adopter creation (no adopterId,
                        with onChange wiring) and in server mode for existing
                        adopters (with adopterId, calls the per-entry actions).
                        Either way the add UX, edit UX and chip rendering are
                        identical. */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.contact')}</h3>
                        {isNew ? (
                            <ContactEntriesSection
                                entries={contactEntries}
                                canEditAll={true}
                                currentUser={currentUser}
                                onChange={next => {
                                    setContactEntries(next);
                                    setData(d => ({ ...d, contactInfo: contactEntriesToBlob(next) }));
                                }}
                                adopterIsPublic={false}
                            />
                        ) : initialData && (() => {
                            // Legacy rows have a contactInfo blob but no
                            // structured contactEntries column — fall back to
                            // parsing the blob so the section still displays
                            // the data. Parsed-from-blob entries have no `id`,
                            // which ContactEntriesSection uses to suppress
                            // edit/delete affordances (no stable anchor to
                            // mutate). Adding a fresh entry via the composer
                            // writes a real contactEntries row, and from there
                            // chips gain real IDs and become editable.
                            const stored = deserializeContactEntries(initialData.contactEntries);
                            const entriesForSection = stored.length > 0
                                ? stored
                                : parseBlobToContactEntries(initialData.contactInfo);
                            const isOwner = initialData.addedBy === currentUser;
                            return (
                                <ContactEntriesSection
                                    entries={entriesForSection}
                                    adopterId={id}
                                    canEditAll={isOwner || isAdmin}
                                    currentUser={currentUser}
                                    onMaskedClick={onMaskedContactClick}
                                    adopterIsPublic={!!initialData.isPublic}
                                    // The header pill already carries the "público" signal in the
                                    // read view, so suppress the now-duplicate eye line here. The
                                    // owner-only "solo visible para vos" (padlock) line is untouched.
                                    hidePublicMicrocopy={!isEditing && visibilityBadge === 'public'}
                                />
                            );
                        })()}
                    </div>


                    {/* Family Members (Full Width) */}
                    <div className="md:col-span-2">
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.family_members')}</h3>
                        {isNew ? (
                            <textarea
                                rows={2}
                                className="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[60px]"
                                value={data.familyMembers}
                                onChange={e => setData({ ...data, familyMembers: e.target.value })}
                                placeholder={t('adopter.placeholder_family')}
                            />
                        ) : (
                            // Unified direct-edit (existing profile): tap → inline textarea →
                            // autosaves on blur → Deshacer. Same model as the contact entries.
                            <InlineEditField
                                value={data.familyMembers}
                                canEdit={canEdit}
                                multiline
                                onSave={(next) => saveField('familyMembers', next)}
                                placeholder={t('adopter.placeholder_family')}
                                emptyLabel={t('adopter.no_family')}
                                displayRender={(v) => renderTextWithLinks(v, { emptyLabel: t('audit.empty_val') })}
                                displayClassName={`w-full p-4 rounded-xl border bg-white text-teal-900 font-medium leading-relaxed min-h-[60px] transition-colors ${canEdit ? 'border-teal-200 hover:border-teal-400' : 'border-teal-200'}`}
                                inputClassName="w-full p-4 rounded-xl border border-teal-200 bg-white text-teal-900 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-y min-h-[60px]"
                            />
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
                        className="relative bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md max-h-[90svh] overflow-y-auto animate-in zoom-in-95 duration-200"
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
                                            <MatchChipsRow chips={buildMatchChips(result.matchValues, t)} />
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

            {/* Confirmation: "Continuar con este perfil" merges typed data into target */}
            {pendingMerge && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => continueBusyId ? undefined : setPendingMerge(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="continue-merge-title"
                >
                    <div
                        className="relative bg-white rounded-2xl shadow-xl border border-stone-200 w-full max-w-md animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-5 pb-3 border-b border-stone-100">
                            <h2 id="continue-merge-title" className="text-lg font-semibold text-stone-900">
                                {(t('adopter.merge_confirm_title') || '¿Continuar con el perfil de {name}?').replace('{name}', pendingMerge.adopterName)}
                            </h2>
                            <p className="text-sm text-stone-600 mt-2">
                                {t('adopter.merge_confirm_body') || 'La información que ingresaste se agregará a este perfil. Los datos que ya existan en el perfil no se duplicarán.'}
                            </p>
                        </div>
                        {(data.contactInfo?.trim() || data.familyMembers?.trim()) ? (
                            <div className="px-5 py-3 bg-amber-50 border-y border-amber-100">
                                <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
                                    {t('adopter.merge_confirm_preview') || 'Se agregará:'}
                                </p>
                                <ul className="space-y-1.5 text-sm text-stone-800">
                                    {data.contactInfo?.trim() && (
                                        <li>
                                            <span className="text-xs font-medium text-stone-500">{t('adopter.contact') || 'Contacto'}: </span>
                                            <span className="break-words">{data.contactInfo.trim()}</span>
                                        </li>
                                    )}
                                    {data.familyMembers?.trim() && (
                                        <li>
                                            <span className="text-xs font-medium text-stone-500">{t('adopter.family_members') || 'Familia'}: </span>
                                            <span className="break-words">{data.familyMembers.trim()}</span>
                                        </li>
                                    )}
                                </ul>
                            </div>
                        ) : (
                            <div className="px-5 py-3 bg-stone-50 border-y border-stone-100">
                                <p className="text-sm text-stone-600">
                                    {t('adopter.merge_confirm_no_new') || 'No hay información nueva para agregar. Solo abriremos el perfil existente.'}
                                </p>
                            </div>
                        )}
                        <div className="p-5 pt-4 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setPendingMerge(null)}
                                disabled={!!continueBusyId}
                                className="px-4 py-2.5 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 rounded-xl transition-colors"
                            >
                                {t('common.cancel') || 'Cancelar'}
                            </button>
                            <button
                                type="button"
                                onClick={confirmMerge}
                                disabled={!!continueBusyId}
                                autoFocus
                                className="px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded-xl transition-colors shadow-lg shadow-teal-700/30"
                            >
                                {continueBusyId
                                    ? (t('common.processing') || 'Procesando...')
                                    : (t('adopter.merge_confirm_action') || 'Sí, continuar')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
