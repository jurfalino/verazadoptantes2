'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StarRating } from '@/components/StarRating';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import { MediaLightbox } from '@/components/ui/MediaLightbox';
import type { MediaItem } from '@/components/ui/MediaLightbox';
import LegalConsent from '@/components/LegalConsent';
import { extractVideoThumbnail, extractVideoThumbnailFromUrl } from '@/lib/videoThumbnail';
import { zarazTrack } from '@/lib/zaraz';
import { findAdopters, addHouseholdPerson } from '@/app/actions';
import type { DuplicateMatch } from '@/app/actions';
import { confidenceBand } from '@/lib/scoring';
import type { ExtractedAdopterData } from '@/lib/gemini';
import ContactEntriesInput from '@/components/ContactEntriesInput';
import { buildContactEntries, contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { humanMatchSentence } from '@/lib/importMatch';
import { dedupeImages } from '@/domain/facebookExtraction';
import { WarningIcon, CloseIcon, CheckIcon, AttachIcon, UploadIcon, VideoIcon, SparkIcon, SaveIcon } from '@/components/ui/Glyph';

/**
 * How many scraped images the review step keeps. The grid renders all of them
 * and the selection is built from the same list, so the two cannot drift.
 */
const MAX_FETCHED_IMAGES = 12;

/**
 * Style guide §2.1, Standard × Primary — kept as a constant so the wizard's step
 * CTAs cannot drift apart again. `min-h-[44px]` is the §1.5 tap-target floor,
 * which these buttons sat 4px under at `py-2.5`.
 * The component form lives in `components/ui/Button.tsx`; see the 2026-09-04
 * audit for the plan to migrate the remaining inline buttons onto it.
 */
const BTN_PRIMARY =
    'inline-flex items-center justify-center gap-2 min-h-[44px] py-3 px-6 rounded-xl ' +
    'font-bold text-sm bg-teal-600 text-white shadow-sm transition-all duration-200 ' +
    'hover:bg-teal-700 hover:shadow-md focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-teal-500 disabled:opacity-40 disabled:cursor-not-allowed';
import { parseVcard, type ParsedVcardContact } from '@/lib/vcard';
import { CONTACT_IMPORT_STASH_KEY } from '@/components/ContactPickerLauncher';
import { handledAsStale } from '@/lib/errorMessage';
import { resolveErrorId, reportClientError } from '@/lib/clientErrorReporter';
import { splitLinkAndText, appendContext, canSaveImportedProfile, suggestedRating, monthOf, recordDateFrom, aliasForMerge, cleanOtherPeople, extractionQuality, type PostPerson, type ExtractionIssue } from '@/domain/importInput';
import { needsIdentityChoice as needsIdentityChoiceFor } from '@/domain/identityChoice';
import { ImportRelativeCheck, type RelativeChoice } from '@/components/import/ImportRelativeCheck';
import type { HouseholdContactInput } from '@/app/actions/households';
import DatePicker from '@/components/ui/DatePicker';
import MatchCompare from '@/components/MatchCompare';
import { buttonClasses } from '@/components/ui/Button';
import StickyActions from '@/components/import/StickyActions';
import MediaPicker from '@/components/import/MediaPicker';

interface PersonMatch {
    id: string;
    name: string;
    contactInfo?: string | null;
    sourceUrl?: string | null;
    thumbnail?: string | null;
    confidence: 'high' | 'medium' | 'low';
    /** Search score — shown to admins only. */
    score?: number;
    /**
     * Raw token-type signals from the duplicate-detection backend (e.g.
     * 'phone_suffix', 'name_word', 'source_url'). The wizard converts these
     * to a user-facing sentence at render time via humanMatchSentence — we
     * don't pre-translate here so the same data can be rendered in either
     * locale or used to drive non-text affordances later.
     */
    matchTypes: string[];
}

export default function ImportWizard() {

    const { t, locale } = useLanguage();
    const { data: _session } = useSession();
    const { openLogin: _openLogin } = useAuthContext();
    const router = useRouter();
    const searchParams = useSearchParams();
    const toast = useShowToast();

    // How the rescuer got here. The share target is the main mobile path, so
    // every import event carries it — without it no drop-off can be attributed.
    // Read once: the share parameters are stripped from the address after mount.
    const [entry] = useState<'share' | 'contacts' | 'paste'>(() =>
        searchParams.get('shared') === 'true' || searchParams.has('shared_url') || searchParams.has('shared_text') ? 'share'
            : searchParams.get('contact_import') === '1' ? 'contacts'
                : 'paste');
    const trackImport = (event: string, props: Record<string, string | number | boolean> = {}) =>
        zarazTrack(event, { entry, ...props });
    /**
     * Every problem that affects the rescuer goes to Axiom (warn), not only hard
     * failures: a hint shown, a file refused, a lookup that degraded. Codes and
     * counts only — never names, contacts or post text (Jon, 2026-10-22).
     */
    const logUxIssue = (message: string, extra: Record<string, unknown> = {}) => {
        void reportClientError({ message, source: 'ImportWizard', level: 'warn', extra: { entry, ...extra } });
    };

    // The saved draft (sessionStorage) is read in the state initializers below,
    // which the server cannot do: it renders an empty field and a DISABLED
    // «Continuar». Hydrating that with a restored draft is a mismatch React does
    // not repair for attributes — the button stayed disabled forever while the
    // field showed the link, even after editing it (Jon's phone, 2026-10-22,
    // after the tab reloaded). Render nothing until mounted, so the first
    // client render matches the server and the draft applies cleanly.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    // Steps: 1=Input, 2=Content/Extract, 3=Review, 4=Confirm
    const [step, setStep] = useState(() => {
        if (typeof window === 'undefined') return 1;
        const saved = sessionStorage.getItem('import_wizard_state');
        if (!saved) return 1;
        try {
            const parsed = JSON.parse(saved);
            const persistedStep = parsed.step || 1;
            // Only Steps 1 and 2 can be resumed from storage.
            // - Step 3 needs `extractedData` and `contactEntries`, neither
            //   of which is persisted (we'd have to serialize the entire
            //   AI extraction result + chip state). Returning 3 from cold
            //   start renders nothing — Step 3 is gated on extractedData,
            //   Step 1 is gated on step === 1, hence the blank screen below
            //   the step indicator users reported in v2.16.0-40/-41.
            // - Step 4 is the confirm modal; the persistence effect already
            //   wipes storage when step hits 4, but defend against a stale
            //   state anyway.
            // - The v2.16.0-40 check (allowing step 3 if inputContent or
            //   editableText was present) was too lenient: those fields
            //   carry over from prior Step-1 typing across the contact-
            //   import flow, so a user who had ever typed in Step 1 then
            //   used contact-import would always pass the check and land
            //   on a blank Step 3.
            if (persistedStep > 2) {
                sessionStorage.removeItem('import_wizard_state');
                return 1;
            }
            if (persistedStep === 2 && !(parsed.inputContent?.trim() || parsed.editableText?.trim())) {
                sessionStorage.removeItem('import_wizard_state');
                return 1;
            }
            return persistedStep;
        } catch { return 1; }
    });
    const [loading, setLoading] = useState(false);
    // Which wait the spinner stands for — step 1 now runs both the link fetch
    // and (for pasted text) the AI read.
    const [loadingKind, setLoadingKind] = useState<'fetch' | 'extract'>('fetch');
    const [error, setError] = useState<string | null>(null);
    // A real failure (not a hint) carries an errorId — logged to Axiom under the
    // same id — and names the operation that failed, so "Reintentar" retries
    // that operation. It used to always re-run step 1, which on a failed AI read
    // just re-showed step 2 and did nothing (audit 2026-10-21, A3).
    const [errorId, setErrorId] = useState<string | null>(null);
    const [failedOp, setFailedOp] = useState<'fetch' | 'extract' | null>(null);
    const clearError = () => { setError(null); setErrorId(null); setFailedOp(null); };
    /** Report a caught failure: banner + errorId, unless it is a stale tab (the "new version" notice covers that). */
    const showFailure = (err: unknown, fallback: string, op: 'fetch' | 'extract' | null, source: string) => {
        if (handledAsStale(err)) return;
        // The translated sentence, not err.message: thrown messages are English
        // server strings or raw browser errors ("Failed to fetch"). The raw text
        // still reaches Axiom with the report under the same Error ID.
        setError(fallback);
        setErrorId(resolveErrorId(err, source));
        setFailedOp(op);
    };
    const [fetchProgress, setFetchProgress] = useState(0);

    // Fake progress bar: non-linear ease-out curve over ~110s
    useEffect(() => {
        if (!loading) {
            setFetchProgress(0);
            return;
        }
        const startTime = Date.now();
        const duration = 110_000; // 110 seconds
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const linear = Math.min(elapsed / duration, 1);
            // Ease-out: fast start, slow finish — caps at 95%
            const eased = 1 - Math.pow(1 - linear, 2.5);
            setFetchProgress(Math.round(eased * 95));
        }, 500);
        return () => clearInterval(timer);
    }, [loading]);

    // Unified input state (single smart field)
    const [inputContent, setInputContent] = useState(() => {
        if (typeof window === 'undefined') return '';
        const saved = sessionStorage.getItem('import_wizard_state');
        if (saved) {
            try { return JSON.parse(saved).inputContent || ''; } catch { return ''; }
        }
        return '';
    });
    const [manualImages, setManualImages] = useState<Array<{ data: string; mimeType: string; preview: string; file?: File; thumbnail?: string }>>([]);
    const [sharedFrom, setSharedFrom] = useState<string | null>(null);
    // Contact-import (v2.16.0-33): true when this wizard run was hydrated from
    // a device contact (homepage CTA picker or PWA share-target vCard) instead
    // of the social-media post flow. Drives the Step 3 breadcrumb so the user
    // knows why animal fields are empty.
    const [fromContacts, setFromContacts] = useState(false);
    // Set when Facebook named the poster but served none of the post's text — i.e.
    // the source is not publicly readable. Flips the import to protected and swaps
    // the "it came from a public source" explainer, which would otherwise be a
    // false claim about the data. The toggle stays available: the signal is
    // "Facebook withheld the caption", which a transient block also produces, so
    // the rescuer must be able to correct a false positive.
    //
    // Restored from the draft because the warning tells the rescuer to go and copy
    // the caption. Leaving to do that and coming back would otherwise re-init this
    // to false and the toggle to public, silently undoing the protection on
    // exactly the flow the message sends them down.
    const [sourceNotPublic, setSourceNotPublic] = useState(() => {
        if (typeof window === 'undefined') return false;
        const saved = sessionStorage.getItem('import_wizard_state');
        if (saved) {
            try { return Boolean(JSON.parse(saved).sourceNotPublic); } catch { return false; }
        }
        return false;
    });

    // v2.19.47: explicit per-record consent toggle for social-URL imports.
    // Default ON — historically these records were treated as public (the
    // contact data came from a public Facebook/Instagram post). The toggle
    // lets the rescuer flip the import to private if they actually want
    // the record gated. Sent to the API as `isPublic` in the POST body;
    // the route honours `isPublic === false` by skipping the `stampPublic`
    // block (per-entry `isPublic:true` stamping). Hidden for Google Contacts
    // (`fromContacts`) and text-only AI extractions — those aren't from a
    // public channel, so the consent question doesn't apply.
    //
    // v2.49.19: the "came from a public post" premise fails when Facebook
    // withheld the caption, so such imports start protected instead.
    const [isPublicProfile, setIsPublicProfile] = useState(() => !sourceNotPublic);

    // Extracted/fetched state
    const [_fetchedText, setFetchedText] = useState('');
    const [editableText, setEditableText] = useState(() => {
        if (typeof window === 'undefined') return '';
        const saved = sessionStorage.getItem('import_wizard_state');
        if (saved) {
            try { return JSON.parse(saved).editableText || ''; } catch { return ''; }
        }
        return '';
    });
    const [fetchedImages, setFetchedImages] = useState<string[]>([]);
    const [selectedFetchedImages, setSelectedFetchedImages] = useState<Set<number>>(new Set());
    // The link as the rescuer shared it, when Facebook resolved it to another
    // one. Both are checked for "already imported": links stored before 2.56.213
    // are the share links themselves (review of 2.56.213, item 2).
    const [sharedLinkAsGiven, setSharedLinkAsGiven] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        try { return JSON.parse(sessionStorage.getItem('import_wizard_state') || '{}').sharedLinkAsGiven || null; } catch { return null; }
    });
    const [sourceUrl, setSourceUrl] = useState(() => {
        if (typeof window === 'undefined') return '';
        const saved = sessionStorage.getItem('import_wizard_state');
        if (saved) {
            try { return JSON.parse(saved).sourceUrl || ''; } catch { return ''; }
        }
        return '';
    });
    const [_sourceType, setSourceType] = useState<string>('');
    const [isVideoPost, setIsVideoPost] = useState(false);
    // Facebook served no caption (or no post at all): a fact about the fetch,
    // part of the extraction quality (Jon, 2026-10-22).
    const [postTextMissing, setPostTextMissing] = useState(false);
    // What the extraction knew when it finished; the quality is computed live from
    // these plus the fields the rescuer is editing, so a fixed problem disappears.
    const [extractionFacts, setExtractionFacts] = useState<{
        aiConfidence: unknown; aiIssues: unknown; aiFailed: boolean; postTextMissing: boolean; videoOnly: boolean;
    } | null>(null);
    const [fetchedVideos, setFetchedVideos] = useState<string[]>([]);
    const [_videoLoading, _setVideoLoading] = useState(false);
    const [retryCountdown, setRetryCountdown] = useState(0);

    // Persist wizard state to sessionStorage (survives page refresh).
    // Only the four fields below are persisted — extractedData /
    // contactEntries are not, which is why the step initializer above
    // rejects any persisted step > 2 (Step 3 can't render without them).
    useEffect(() => {
        if (step === 4) {
            // Clear on completion
            sessionStorage.removeItem('import_wizard_state');
            return;
        }
        // Steps higher than 2 are unresumable from cold start (see the step
        // initializer comment). The contact-import fast path (v2.16.0-33)
        // sets step=3 in memory but writing that to storage just creates
        // the blank-screen state on the next visit. Don't persist > 2.
        if (step > 2) {
            return;
        }
        sessionStorage.setItem('import_wizard_state', JSON.stringify({
            step, inputContent, editableText, sourceUrl, sourceNotPublic, sharedLinkAsGiven
        }));
    }, [step, inputContent, editableText, sourceUrl, sourceNotPublic, sharedLinkAsGiven]);

    // Retry countdown timer
    useEffect(() => {
        if (retryCountdown <= 0) return;
        const timer = setInterval(() => {
            setRetryCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [retryCountdown]);

    // AI extraction state
    const [extractedData, setExtractedData] = useState<ExtractedAdopterData | null>(null);
    // When it happened: 'YYYY-MM' (month and year), 'YYYY-MM-DD', or '' (no date).
    // Edited with the shared DatePicker, as on the adoption form.
    const [reportDate, setReportDate] = useState('');
    // Other people the post names: saved as relatives of the profile (Jon, 2026-10-22).
    const [relatives, setRelatives] = useState<PostPerson[]>([]);
    // «¿Es este perfil?» per relative (a rescuer is here): the profile to link, keyed by the relative.
    const [relativeChoices, setRelativeChoices] = useState<Record<string, RelativeChoice>>({});
    // Merging into a profile matched only on phone/email/address: is the post's
    // person the same one under another name, or someone in that household?
    const [mergeAs, setMergeAs] = useState<'alias' | 'relative' | null>(null);
    const [contactEntries, setContactEntries] = useState<ContactEntry[]>([]);
    const [processedImages, setProcessedImages] = useState<Array<{ data: string; mimeType: string; originalUrl?: string }>>([]);
    // Media the rescuer has de-selected in the review step so it is NOT imported.
    // Keys: `p:<i>` a processed (scraped) image, `m:<i>` a manual/uploaded item
    // (image or video, indexed into manualImages), `fv:<i>` a fetched video.
    // Empty by default — everything imports unless explicitly excluded here.
    const [excludedMedia, setExcludedMedia] = useState<Set<string>>(new Set());
    const isMediaExcluded = (key: string) => excludedMedia.has(key);
    const toggleMediaExcluded = (key: string) => setExcludedMedia(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [selectedModel, setSelectedModel] = useState<string>('');
    // v2.19.52: `unknownAnimal` state removed alongside the step-3 checkbox.
    // Empty/missing animalName is now the first-class "no name yet" outcome —
    // see AdoptionFormWizard for the matching change in the new-activity path.
    const [_customSpecies, setCustomSpecies] = useState(false);

    // Save state
    const [isSaving, setIsSaving] = useState(false);
    // v2.19.21: which CTA fired the save — lets the modal swap to a
    // mode-aware loading state ("Creando perfil..." vs "Agregando datos a X...").
    // Cleared in the finally block alongside isSaving.
    const [savingMode, setSavingMode] = useState<'create' | 'merge' | null>(null);
    const [savingTargetName, setSavingTargetName] = useState<string>('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [duplicateAdopter, setDuplicateAdopter] = useState<any>(null);
    // Every profile this post was already saved to (the first is duplicateAdopter).
    const [duplicateAdopters, setDuplicateAdopters] = useState<Array<{ id: string; name: string | null; canEdit?: boolean }>>([]);
    const [personMatches, setPersonMatches] = useState<PersonMatch[]>([]);
    const [selectedMatch, setSelectedMatch] = useState<PersonMatch | null>(null);
    const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
    const [fieldOverlapHints, setFieldOverlapHints] = useState<DuplicateMatch[]>([]);
    const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);

    // Load shared images from Service Worker cache
    const loadSharedImages = async () => {
        try {
            const cache = await caches.open('share-target-media');
            const keys = await cache.keys();
            if (keys.length === 0) return;

            const images: Array<{ data: string; mimeType: string; preview: string }> = [];

            for (const request of keys) {
                const response = await cache.match(request);
                if (!response) continue;
                const blob = await response.blob();
                const mimeType = blob.type || 'image/jpeg';

                // Convert blob to base64
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const result = reader.result as string;
                        resolve(result.split(',')[1]);
                    };
                    reader.readAsDataURL(blob);
                });

                const preview = `data:${mimeType};base64,${base64}`;
                images.push({ data: base64, mimeType, preview });
            }

            if (images.length > 0) {
                setManualImages(prev => [...prev, ...images]);
            }

            // Clean up the cache
            for (const request of keys) {
                await cache.delete(request);
            }
        } catch (e) {
            logUxIssue('import: shared images could not be loaded', { error: e instanceof Error ? e.message : String(e) });
        }
    };

    /**
     * Synthesize the wizard's Step 3 state from a parsed vCard contact. Used
     * by both the homepage CTA path (sessionStorage handoff) and the PWA
     * share-target path (SW cache handoff). Bypasses Steps 1–2 entirely —
     * we already have structured fields and don't need AI extraction.
     */
    const hydrateFromContact = (c: ParsedVcardContact) => {
        const addressEntries: ContactEntry[] = [];
        for (const addr of c.addresses) {
            const joined = [addr.streetAndNumber, addr.locality].filter(Boolean).join(', ').trim();
            const value = (joined || addr.raw || '').trim();
            if (!value) continue;
            addressEntries.push({
                type: 'address',
                value,
                ...(addr.streetAndNumber ? { streetAndNumber: addr.streetAndNumber } : {}),
                ...(addr.locality ? { locality: addr.locality } : {}),
                ...(addr.raw && !addr.streetAndNumber && !addr.locality ? { raw: addr.raw } : {}),
            });
        }
        setContactEntries([
            ...buildContactEntries({ phones: c.phones, emails: c.emails }),
            ...addressEntries,
        ]);
        // Confidence is 'low' because the OS picker / vCard gives us identity
        // data but the wizard's Step 3 panel grades that signal alongside the
        // (intentionally empty) adoption details.
        setExtractedData({
            name: c.name || '',
            phones: c.phones,
            emails: c.emails,
            addresses: c.addresses.map(a => a.raw || [a.streetAndNumber, a.locality].filter(Boolean).join(', ')).filter(Boolean) as string[],
            socialProfiles: [],
            notes: '',
            confidence: 'low',
            adoptionDetected: false,
        });
        setFromContacts(true);
        setStep(3);
    };

    /**
     * Read the contact stash written by `ContactPickerLauncher` and hydrate
     * Step 3 from it. Idempotent — the stash is consumed on read so a refresh
     * doesn't loop the wizard back into the contact-import path.
     */
    const loadStashedContact = (): boolean => {
        try {
            const raw = sessionStorage.getItem(CONTACT_IMPORT_STASH_KEY);
            if (!raw) return false;
            sessionStorage.removeItem(CONTACT_IMPORT_STASH_KEY);
            const parsed = JSON.parse(raw) as ParsedVcardContact;
            hydrateFromContact(parsed);
            return true;
        } catch {
            return false;
        }
    };

    /**
     * Read a vCard from the service-worker share-target cache (the file the
     * user shared from their phone's Contacts app), parse it, and hydrate
     * Step 3. Mirrors `loadSharedImages` for the image-share path.
     */
    const loadSharedVcard = async (): Promise<boolean> => {
        try {
            const cache = await caches.open('share-target-media');
            const response = await cache.match('/share-target-vcard');
            if (!response) return false;
            const text = await response.text();
            await cache.delete('/share-target-vcard');
            const parsed = parseVcard(text);
            if (!parsed) return false;
            hydrateFromContact(parsed);
            return true;
        } catch (e) {
            logUxIssue('import: shared contact could not be loaded', { error: e instanceof Error ? e.message : String(e) });
            return false;
        }
    };

    // Pre-fill from URL params (for Share Intent / Web Share Target)
    useEffect(() => {
        const sharedUrl = searchParams.get('shared_url') || searchParams.get('url');
        const sharedText = searchParams.get('shared_text') || searchParams.get('text');
        const hasSharedImages = searchParams.get('shared_images') === 'true';
        const imagesLost = searchParams.get('shared_images_lost') === 'true';
        const isContactImport = searchParams.get('contact_import') === '1';
        const isSharedVcard = searchParams.get('shared_vcard') === 'true';
        const sharedVcardLost = searchParams.get('shared_vcard_lost') === 'true';

        // The shared link and caption ride in the address (?shared_url=…&shared_text=…),
        // and analytics record the address with every event and pageview. A caption can
        // carry the adopter's name or phone, so drop the parameters once read; the
        // draft survives a reload through sessionStorage (review of v2.56.210, item 5).
        if ([...searchParams.keys()].some(k => k.startsWith('shared') || k === 'url' || k === 'text' || k === 'title')) {
            window.history.replaceState(window.history.state, '', window.location.pathname);
        }

        // Contact-import fast path (v2.16.0-33): the user picked a contact
        // on the homepage (or shared one from their phone's Contacts app)
        // and we already have structured fields. Skip Steps 1–2 entirely
        // — no URL to fetch, no AI extraction needed. Run BEFORE the other
        // share-intent branches so a query that carries both wins fast.
        if (isContactImport && loadStashedContact()) {
            return;
        }
        if (sharedVcardLost) {
            // SW was inactive when the share arrived — file body never made it
            // to the cache. Show a soft hint, leave the user on Step 1.
            setError(t('import.vcard_parse_failed'));
            logUxIssue('import: shared contact lost (service worker inactive)');
            return;
        }
        if (isSharedVcard) {
            loadSharedVcard().then(loaded => {
                if (!loaded) {
                    logUxIssue('import: shared contact could not be read');
                    setError(t('import.vcard_parse_failed'));
                }
            });
            return;
        }

        // Load cached images from SW (if any)
        if (hasSharedImages) {
            loadSharedImages();
        }

        // Show warning if SW wasn't active and images were lost
        if (imagesLost) {
            setError(t('import.images_lost'));
            logUxIssue('import: shared images lost (service worker inactive)');
        }

        if (sharedUrl) {
            // Share intent with URL: skip Step 1, auto-fetch. Any text shared
            // alongside the link rides along as context — it used to be dropped.
            setSharedFrom(sharedUrl);
            setLoading(true);
            setStep(2);
            handleFetchUrl(sharedUrl, sharedText || '').then(ok => {
                if (ok) return;
                // Fetch failed — back to Step 1 with the link (and its text) still
                // in the field, so "Reintentar" works and nothing has to be copied
                // again. handleFetchUrl reports failure by its result: it used to
                // swallow the error, so this fallback never ran and the rescuer
                // was left on an empty step 2 (audit 2026-10-21, A1).
                setStep(1);
                // Some apps put the link in both share fields; never write it twice.
                setInputContent(sharedText && !sharedText.includes(sharedUrl) ? `${sharedText}\n${sharedUrl}` : (sharedText || sharedUrl));
                setSharedFrom(null);
            });
        } else if (sharedText) {
            // Share intent with text: skip Step 1, go to content review
            setSharedFrom('shared');
            setFetchedText(sharedText);
            setEditableText(sharedText);
            setStep(2);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Drop a scraped image from the review step entirely.
     *
     * Distinct from deselecting it: a duplicate or an irrelevant grab (Facebook's
     * own chrome often lands in the scrape) should leave the grid rather than sit
     * there dimmed. Selection is stored as a Set of indices, so every index above
     * the removed one shifts down by one — rebuilding it is not optional, or the
     * wrong photos end up selected.
     */
    const removeFetchedImage = (idx: number) => {
        setFetchedImages(prev => prev.filter((_, i) => i !== idx));
        setSelectedFetchedImages(prev => {
            const next = new Set<number>();
            prev.forEach(i => {
                if (i < idx) next.add(i);
                else if (i > idx) next.add(i - 1);
            });
            return next;
        });
    };

    /**
     * Fetch a post and move to step 2. `context` is what the rescuer wrote around
     * the link; it is kept below the fetched text. Resolves true when the wizard
     * moved on (including the "paste the text yourself" path), false on failure —
     * the caller decides where the rescuer lands.
     */
    const handleFetchUrl = async (url?: string, context = ''): Promise<boolean> => {
        const targetUrl = url || inputContent;
        if (!targetUrl.trim()) return false;

        setLoading(true);
        setLoadingKind('fetch');
        clearError();
        setPostTextMissing(false);
        // Re-evaluated per attempt so retrying against a readable URL clears it.
        setSourceNotPublic(false);

        try {
            // Check if it's a Facebook URL — redirect to specialized scraper
            const fbPattern = /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i;
            const isFacebook = fbPattern.test(targetUrl);

            let responseData: any;

            if (isFacebook) {
                const res = await fetch('/api/facebook/fetch-post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: targetUrl }),
                });
                responseData = await res.json();

                if (!res.ok) {
                    throw new Error(responseData.error || 'Failed to fetch Facebook post');
                }

                if (responseData.success && responseData.data) {
                    // Facebook can answer with the photo and the poster's name but no
                    // caption at all. That reads as a successful fetch and lands the
                    // rescuer on step 2 with a placeholder, so without this they get no
                    // signal that the part carrying the adopter's details is missing.
                    // Everything scraped is still kept and still removable below.
                    if (responseData.missingPostText) {
                        setPostTextMissing(true);
                        setError(t('import.missing_post_text'));
                        if (responseData.sourceNotPublic) {
                            setSourceNotPublic(true);
                            setIsPublicProfile(false);
                        }
                    }
                    setFetchedText(responseData.data.text || '');
                    setEditableText(appendContext(responseData.data.text || '', context));
                    // Facebook serves one photo under many signed URLs, and the
                    // Playwright scraper path does no de-duplication of its own, so
                    // collapse them here as well as in the route. Capped so that what
                    // is rendered and what is selected can never diverge — the grid
                    // used to show the first 12 while selecting all of them, quietly
                    // importing images the rescuer could not see or remove.
                    const imgs = dedupeImages(responseData.data.images || []).slice(0, MAX_FETCHED_IMAGES);
                    setFetchedImages(imgs);
                    setSelectedFetchedImages(new Set(imgs.map((_: string, i: number) => i)));

                    // Video post detection: inject thumbnail for OCR
                    if (responseData.isVideo || responseData.data.isVideo) {
                        setIsVideoPost(true);
                        if (responseData.data.videoThumbnailBase64) {
                            const dataUrl = responseData.data.videoThumbnailBase64 as string;
                            // The thumbnail IS images[0] re-fetched as base64, so OCR has
                            // real pixels even when the signed CDN URL cannot be fetched
                            // again later. Substitute it for the image it came from —
                            // appending it showed the same photo twice on every
                            // video-typed post, which is most of them: Facebook types
                            // plain photo posts `video.other` too.
                            setFetchedImages(prev => prev.length > 0
                                ? [dataUrl, ...prev.slice(1)]
                                : [dataUrl]);
                            setSelectedFetchedImages(sel => new Set([...sel, 0]));
                        }
                    }
                } else if (responseData.extractionFailed) {
                    if (responseData.requiresManualInput) {
                        setPostTextMissing(true);
                        // Private group post or restricted content — skip to manual
                        // input. The URL is still worth keeping: it is the audit trail
                        // for where the record came from, even when we could not read it.
                        // A /share/ link resolved by the fetcher is stored as the post's
                        // own link, so the same post is recognised next time (audit D1).
                        setSourceUrl(responseData.resolvedUrl || targetUrl);
                        setSharedLinkAsGiven(responseData.resolvedUrl && responseData.resolvedUrl !== targetUrl ? targetUrl : null);
                        if (responseData.sourceNotPublic) {
                            setSourceNotPublic(true);
                            setIsPublicProfile(false);
                        }
                        setError(responseData.sourceNotPublic
                            ? t('import.source_not_public')
                            : t('import.manual_input_needed'));
                        setEditableText(appendContext('', context));
                        trackImport('import_fetch_failed', { reason: responseData.sourceNotPublic ? 'not_public' : 'manual_input', facebook: true });
                        setStep(2);
                        return true;
                    }
                    // Temporary extraction failure — start 30s retry countdown
                    setRetryCountdown(30);
                    throw new Error(t('import.post_unreadable'));
                }
            } else {
                const res = await fetch('/api/import/fetch-content', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: targetUrl }),
                });
                responseData = await res.json();

                if (!res.ok) {
                    throw new Error(responseData.error || 'Failed to fetch content');
                }

                if (responseData.success && responseData.data) {
                    const titlePrefix = responseData.data.title ? `[${responseData.data.title}]\n\n` : '';
                    setFetchedText(titlePrefix + (responseData.data.text || ''));
                    setEditableText(appendContext(titlePrefix + (responseData.data.text || ''), context));
                    const imgs = responseData.data.images || [];
                    setFetchedImages(imgs);
                    setSelectedFetchedImages(new Set(imgs.map((_: string, i: number) => i)));
                    setFetchedVideos(responseData.data.videos || []);
                    if ((responseData.data.videos || []).length > 0) setIsVideoPost(true);
                    setSourceType(responseData.data.sourceType || 'web');
                }
            }

            setSourceUrl(responseData?.resolvedUrl || targetUrl);
            setSharedLinkAsGiven(responseData?.resolvedUrl && responseData.resolvedUrl !== targetUrl ? targetUrl : null);
            setStep(2);
            return true;
        } catch (err) {
            showFailure(err, t('import.fetch_failed'), 'fetch', 'ImportWizard.fetch');
            trackImport('import_fetch_failed', { reason: 'error', facebook: /facebook\.com|fb\.com/i.test(targetUrl) });
            return false;
        } finally {
            setLoading(false);
        }
    };

    // Smart submit: auto-detect URL vs text
    const handleSmartSubmit = () => {
        const content = inputContent.trim();
        if (!content && manualImages.length === 0) return;
        clearError();

        // A single link — alone or inside a caption — is fetched; the words
        // around it are kept as context (audit 2026-10-21, A4).
        const { url, text } = splitLinkAndText(content);
        if (url) {
            handleFetchUrl(url, text);
        } else {
            // Plain text and/or screenshots go straight to the AI read. The
            // review-content step only repeated what was just pasted, under a
            // wrong "Texto Extraído" label (design change 12, approved 2026-10-21).
            // It stays for fetched links, where there is a scraped caption and
            // photos to check first.
            setFetchedText(content);
            setEditableText(content);
            handleExtract(content);
        }
    };

    /** Add picked, dropped or pasted files. Videos over 50 MB are refused out loud. */
    const addFiles = async (files: File[]) => {
        for (const file of files) {
            const isVideoFile = file.type.startsWith('video/');

            if (isVideoFile) {
                // Video: store File object only — don't read as base64
                // Videos will be uploaded via FormData after adopter creation
                if (file.size > 50 * 1024 * 1024) {
                    // Used to be skipped silently: the rescuer believed it was attached.
                    toast.warning(t('import.video_too_large').replace('{name}', file.name));
                    logUxIssue('import: video over 50 MB refused', { sizeMb: Math.round(file.size / 1048576) });
                    continue;
                }
                // Generate thumbnail
                let thumbnail: string | undefined;
                try {
                    thumbnail = await extractVideoThumbnail(file);
                } catch (err) {
                    logUxIssue('import: video thumbnail could not be made', { error: (err as Error).message });
                }
                setManualImages(prev => [...prev, {
                    data: '',
                    mimeType: file.type,
                    preview: thumbnail || '', // Use thumbnail as preview
                    file,
                    thumbnail,
                }]);
            } else if (file.type.startsWith('image/')) {
                // Image: read as base64 for preview and sending in JSON
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    const base64 = result.split(',')[1];
                    setManualImages(prev => [...prev, {
                        data: base64,
                        mimeType: file.type,
                        preview: result,
                    }]);
                };
                reader.readAsDataURL(file);
            }
        }
    };

    /**
     * A screenshot pasted anywhere on steps 1–2 is attached (audit A8). Text
     * pastes are left alone so the textarea behaves as usual.
     */
    const handlePaste = (e: React.ClipboardEvent) => {
        if (step > 2 || showConfirmModal) return;
        const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        addFiles(files);
    };

    const removeImage = (index: number) => {
        setManualImages(prev => prev.filter((_, i) => i !== index));
    };

    // AI Extraction — text + images sent together; hardened prompt prevents hallucination
    const handleExtract = async (textOverride?: string) => {
        // Called straight from step 1 for pasted text, before the state update lands.
        const text = textOverride ?? editableText;
        setLoading(true);
        setLoadingKind('extract');
        clearError();

        try {
            const imagesToSend: Array<{ data: string; mimeType: string }> = [];
            for (const img of manualImages) {
                imagesToSend.push({ data: img.data, mimeType: img.mimeType });
            }

            const imageUrls = fetchedImages.filter((_, i) => selectedFetchedImages.has(i));
            trackImport('import_extract_started', {
                hasUrl: !!sourceUrl,
                hasText: !!text.trim(),
                images: imagesToSend.length + imageUrls.length,
            });

            const response = await fetch('/api/ai/extract-from-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text || undefined,
                    images: imagesToSend.length > 0 ? imagesToSend : undefined,
                    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                    model: selectedModel || undefined,
                    language: locale,
                }),
            });

            const result = await response.json() as {
                success?: boolean;
                data?: ExtractedAdopterData;
                error?: string;
                processedImages?: Array<{ data: string; mimeType: string; originalUrl?: string }>;
            };

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Extraction failed');
            }

            const aiData = result.data || { confidence: 'low' as const };
            // Only a whole 1–5 suggestion is pre-filled; anything else stays unrated.
            aiData.adoptionRating = suggestedRating(aiData.adoptionRating) ?? undefined;
            // Month and year: the day is rarely in a post, and would be invented.
            setReportDate(monthOf(aiData.adoptionDate));
            setRelatives(cleanOtherPeople(aiData.otherPeople, aiData.name));

            const aiFailed = !!aiData.extractionFailed;
            // The rescuer filled in what the fetch could not get (pasted the text or
            // added screenshots): the missing caption is no longer a problem.
            const addedOwnContent = manualImages.length > 0 || text.trim() !== _fetchedText.trim();
            const facts = {
                aiConfidence: aiData.confidence,
                aiIssues: aiData.extractionIssues,
                aiFailed,
                postTextMissing: postTextMissing && !addedOwnContent,
                videoOnly: isVideoPost && manualImages.length === 0 && !text.trim(),
            };
            setExtractionFacts(facts);
            // What the rescuer is about to be told is missing — logged, so we know
            // how often each problem happens (Jon, 2026-10-22).
            const shown = extractionQuality({
                ...facts,
                name: aiData.name,
                entries: buildContactEntries({ phones: aiData.phones, emails: aiData.emails, socials: aiData.socialProfiles }),
            });
            const cannotSave = !canSaveImportedProfile(aiData.name, buildContactEntries({ phones: aiData.phones, emails: aiData.emails, socials: aiData.socialProfiles }));
            if (shown.issues.length || cannotSave) {
                logUxIssue('import: extraction problems shown', { issues: shown.issues, level: shown.level, cannotSave });
            }

            // Preserve original post text untouched, append any AI-extracted notes after
            // (never the "Extraction failed: …" diagnostic).
            if (text?.trim()) {
                const aiNotes = aiFailed ? '' : aiData.notes?.trim();
                aiData.notes = text + (aiNotes ? '\n\n---\n' + aiNotes : '');
            } else if (aiFailed) {
                aiData.notes = '';
            }

            setExtractedData(aiData);
            // Build typed contact entries from the AI-extracted arrays so the
            // categorization survives review instead of being flattened.
            if (aiData) {
                setContactEntries(buildContactEntries({
                    phones: aiData.phones,
                    emails: aiData.emails,
                    socials: aiData.socialProfiles,
                    addresses: aiData.addresses,
                }));
            }
            setCustomSpecies(false);
            if (result.processedImages) {
                setProcessedImages(result.processedImages);
            }
            trackImport('import_extract_succeeded', {
                aiConfidence: typeof aiData.confidence === 'string' ? aiData.confidence : 'unknown',
                aiFailed,
                aiIssues: Array.isArray(aiData.extractionIssues) ? aiData.extractionIssues.join(',') : '',
                adoptionDetected: !!aiData.adoptionDetected,
                hasName: !!aiData.name?.trim(),
            });
            setStep(3);
        } catch (err) {
            showFailure(err, t('import.extract_failed'), 'extract', 'ImportWizard.extract');
            trackImport('import_extract_failed');
        } finally {
            setLoading(false);
        }
    };

    // Debounced field overlap check for Step 3
    useEffect(() => {
        if (step !== 3 || !extractedData) return;
        const timer = setTimeout(async () => {
            try {
                const response = await findAdopters(
                    { name: extractedData.name, contactInfo: contactEntriesToBlob(contactEntries) },
                    { mode: 'duplicate' },
                );
                setFieldOverlapHints(response.results as DuplicateMatch[]);
            } catch {
                setFieldOverlapHints([]);
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [step, extractedData?.name, contactEntries]);

    // Pre-save duplicate check
    /**
     * Check for duplicates, then show the choice — or save straight away when
     * there is nothing to choose. `preselectId` is the match the rescuer picked
     * on the review screen ("Agregar a este perfil"): the same checks still run,
     * the same-post one first (review of 2.56.213, item 4).
     */
    const handlePreSave = async (preselect?: PersonMatch, opts: { skipUrlCheck?: boolean } = {}) => {
        setIsSaving(true);
        setDuplicateAdopter(null);
        setDuplicateAdopters([]);
        setPersonMatches([]);
        setSelectedMatch(null);
        setDuplicateCheckFailed(false);
        setMergeAs(null);
        // Local mirrors of the state above: the decision at the end must not
        // wait for a re-render.
        let foundMatches = false;
        let checkFailed = false;

        // Check for URL duplicate — skipped when the rescuer said "it is not the
        // same post" on that screen (Jon, 2026-10-21): link matching can still
        // misfire on shapes we have not seen, and the screen had no way out.
        if (sourceUrl && !opts.skipUrlCheck) {
            try {
                const query = [sourceUrl, sharedLinkAsGiven].filter(Boolean).map(u => `sourceUrl=${encodeURIComponent(u!)}`).join('&');
                const res = await fetch(`/api/adopters?${query}`);
                // M4: a 500 here used to fall through as "no duplicate" (res.json()
                // succeeds on an error body, matches undefined). Treat non-OK as a
                // failed check so the warning UI shows instead of silently skipping.
                if (!res.ok) throw new Error(`URL duplicate check failed (${res.status})`);
                const data = await res.json() as { matches: Array<{ id: string; name: string | null; canEdit?: boolean }>; matchType?: string };
                if (data.matches && data.matches.length > 0) {
                    setDuplicateAdopter(data.matches[0]);
                    setDuplicateAdopters(data.matches.map(m => ({ id: m.id, name: m.name, canEdit: !!m.canEdit })));
                    trackImport('import_duplicate_shown', { kind: 'url', count: data.matches.length });
                    setIsSaving(false);
                    setShowConfirmModal(true);
                    return;
                }
            } catch (e) {
                logUxIssue('import: same-post check failed', { error: e instanceof Error ? e.message : String(e) });
                setDuplicateCheckFailed(true);
                checkFailed = true;
            }
        }

        // Check for person match via token index.
        //
        // Pass ONLY `name` + the freshly-rebuilt contactInfo blob. We used to
        // also forward `phones`/`emails`/`socials` from `extractedData`, but
        // those fields are populated once (AI extraction or the contact-import
        // hydrator) and never updated when the user edits a chip in
        // ContactEntriesInput — the chip editor only mutates `contactEntries`.
        // findAdopters' input contract preferred the structured arrays over
        // the contactInfo blob (`input.phones?.length ? input.phones : extractPhones(blob)`),
        // so the stale fields silently overrode the user's edits and the
        // duplicate check ran against the original values. Dropping them
        // makes contactEntries the single source of truth (v2.16.0-44).
        if (extractedData) {
            try {
                const response = await findAdopters(
                    {
                        name: extractedData.name,
                        contactInfo: contactEntriesToBlob(contactEntries),
                    },
                    { mode: 'duplicate' },
                );
                const tokenResults = response.results as DuplicateMatch[];
                if (tokenResults.length > 0) {
                    const matches: PersonMatch[] = tokenResults.map(r => ({
                        id: r.adopterId,
                        name: r.adopterName,
                        confidence: confidenceBand(r.relevancePercent) as 'high' | 'medium' | 'low',
                        score: r.relevancePercent,
                        matchTypes: r.matchTypes,
                    }));
                    foundMatches = true;
                    // The match picked on the review screen stays on the list and selected.
                    const list = preselect && !matches.some(m => m.id === preselect.id) ? [preselect, ...matches] : matches;
                    setPersonMatches(list);
                    // Otherwise pre-select only a strong match. A weak one used to come
                    // pre-selected, one tap from merging into the wrong person;
                    // the spreadsheet import makes the rescuer choose (audit D5).
                    setSelectedMatch(preselect ? list.find(m => m.id === preselect.id)! : (matches[0].confidence === 'high' ? matches[0] : null));
                    trackImport('import_duplicate_shown', { kind: 'person', count: matches.length, topBand: matches[0].confidence });
                }
            } catch (e) {
                logUxIssue('import: duplicate (name/contact) check failed', { error: e instanceof Error ? e.message : String(e) });
                setDuplicateCheckFailed(true);
                checkFailed = true;
            }
        }

        // Keep the profile the rescuer picked even when a check failed — the
        // "couldn't verify" screen alone only offers "Crear perfil", pushing them
        // toward the duplicate they were avoiding (re-review of 2.56.214, C).
        if (preselect && !foundMatches) {
            setPersonMatches([preselect]);
            setSelectedMatch(preselect);
            foundMatches = true;
        }

        // Nothing to decide: save straight away. The "¿Crear nuevo perfil?"
        // screen only repeated the name (decision B3, 2026-10-21). It still
        // shows when there are matches, or when the check failed and the
        // rescuer has to look for themselves.
        if (!foundMatches && !checkFailed) {
            setShowConfirmModal(true);
            await handleConfirmSave();
            return;
        }

        setIsSaving(false);
        setShowConfirmModal(true);
    };

    // Save new adopter
    /** Problems still on screen when the rescuer saves anyway — worth knowing which ones. */
    const logOpenIssuesAtSave = (mode: 'create' | 'merge') => {
        if (quality?.issues.length) logUxIssue('import: saved with open extraction problems', { mode, issues: quality.issues, level: quality.level });
    };

    const handleConfirmSave = async () => {
        if (!extractedData) return;
        logOpenIssuesAtSave('create');
        setSavingMode('create');
        setSavingTargetName(extractedData.name || '');
        setIsSaving(true);

        try {
            // No import_high/medium/low flag any more: it was the AI's undefined
            // impression, stored as a moderation flag that inflated "Active Flags"
            // and the reported-content panel (Jon, 2026-10-22).

            // Generate thumbnails for fetched videos (via proxy for CORS)
            const videoPayloads = await Promise.all(
                fetchedVideos.filter((_, i) => !isMediaExcluded(`fv:${i}`)).map(async (videoUrl) => {
                    let thumbnail: string | undefined;
                    try {
                        thumbnail = await extractVideoThumbnailFromUrl(`/api/proxy-image?url=${encodeURIComponent(videoUrl)}`);
                    } catch (e) {
                        logUxIssue('import: fetched video thumbnail failed', { error: (e as Error).message });
                    }
                    return { data: '', mimeType: 'video/mp4', originalUrl: videoUrl, thumbnail };
                })
            );

            const payload = {
                name: extractedData.name,
                contactEntries: contactEntries.length ? JSON.stringify(contactEntries) : undefined,
                notes: extractedData.notes,
                sourceUrl,
                // Marks the row as imported-from-social so the API writes
                // source='imported' AND (when ENABLE_PUBLIC_PROFILES is on)
                // stamps isPublic=true on the contact entries it persists.
                source: 'imported' as const,
                // v2.19.47: per-record consent for the public-stamping. Only
                // sent for social-URL imports — for Google Contacts / text
                // extractions the field is omitted and the API keeps its
                // default (private). When `false`, the API skips the
                // stampPublic block entirely → entries land non-public.
                ...(sourceUrl && !fromContacts ? { isPublic: isPublicProfile } : {}),
                // The other people the post names, as relatives of this profile.
                // Those the rescuer recognised as an existing profile («¿Es este perfil?» → sí) are linked after the save.
                ...(relatives.some(p => !linkedProfileOf(p)) ? { householdMembers: JSON.stringify(relatives.filter(p => !linkedProfileOf(p)).map(toMember)) } : {}),
                images: [
                    // Honor the review-step de-selection: a processed image is
                    // excluded by `p:<i>`, a manual image by `m:<i>`.
                    ...(processedImages.length > 0
                        ? processedImages.filter((_, i) => !isMediaExcluded(`p:${i}`))
                        : manualImages.filter((img, i) => !img.file && !isMediaExcluded(`m:${i}`)).map(img => ({ data: img.data, mimeType: img.mimeType }))),
                    ...videoPayloads,
                ],
                // v2.19.17: contacts-import path no longer auto-stamps an
                // 'observation' activity record. The rescuer lands on the new
                // profile where VisitIntentCard already prompts for the real
                // activity type. Pre-fix this block always sent
                // recordType: 'observation' because hydrateFromContact()
                // skips Steps 1-2 and never asks for an intent.
                ...(fromContacts ? {} : {
                    adoption: {
                        // v2.19.52: blank goes through as undefined → API saves NULL.
                        // A social post is a report about the person (Jon, 2026-10-22):
                        // no activity type to pick, no animal fields. What matters is
                        // the rating the rescuer confirmed, and roughly when.
                        recordType: 'observation',
                        rating: extractedData.adoptionRating || undefined,
                        date: recordDateFrom(reportDate),
                    },
                }),
            };

            const response = await fetch('/api/adopters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json() as { id: string; error?: string; details?: string[]; errorId?: string };

            if (!response.ok) {
                // v2.19.66: surface the schema's per-field reason (`details`) and
                // the server errorId instead of the bare "Invalid input". The
                // 400 path already computes which field failed — show it so the
                // rescuer (and we) can see *why* the save was rejected.
                const base = result.details?.length
                    ? `${result.error || 'Invalid input'}: ${result.details.join('; ')}`
                    : (result.error || 'Failed to create adopter');
                // "Error ID:" so resolveErrorId reuses the server's id instead of minting a second one.
                throw new Error(result.errorId ? `${base} (Error ID: ${result.errorId})` : base);
            }

            const adopterId = result.id;

            // Relatives recognised as an existing profile join the new profile's household (credited, notified).
            for (const [i, p] of relatives.entries()) {
                const existingProfileId = linkedProfileOf(p);
                if (!existingProfileId) continue;
                const res = await addHouseholdPerson({
                    anchorAdopterId: adopterId, existingProfileId, relationship: p.relationship,
                    contactEntries: asHouseholdContacts(toMember(p).contactEntries),
                    fromImport: { sourceUrl: sourceUrl || null, slot: `r${i}` },
                });
                if (!res.ok && res.error !== 'already_there') {
                    toast.error(t('errors.generic'), t('import.relative_failed'), res.errorId ?? resolveErrorId(new Error(`addHouseholdPerson (import, linked): ${res.error}`), 'ImportWizard'));
                    break;
                }
            }

            // Upload any pending video files via FormData (they were excluded from JSON body)
            const pendingVideoFiles = manualImages.filter((img, i) => img.file && !isMediaExcluded(`m:${i}`));
            for (const vid of pendingVideoFiles) {
                if (!vid.file) continue;
                const fd = new FormData();
                fd.append('file', vid.file);
                fd.append('adopterId', adopterId);
                fd.append('caption', 'Imported video');
                fd.append('mediaType', 'video');
                if (vid.thumbnail) fd.append('thumbnail', vid.thumbnail);
                const upRes = await fetch('/api/upload-media', { method: 'POST', body: fd });
                if (!upRes.ok) {
                    const up = await upRes.json().catch(() => ({})) as { errorId?: string };
                    toast.error(t('errors.generic') || 'Error', t('import.video_upload_failed') || 'No se pudo subir el video', up.errorId);
                }
            }

            // Every import now lands on the new profile (decision B1, 2026-10-21),
            // so the toast carries no "→ Ver Perfil" link: it would point at the
            // page already loading. Contacts imports stay silent as before — the
            // redirect is their success signal.
            if (!fromContacts) {
                toast.success(t('import.profile_created'), extractedData.name?.trim() || undefined);
            }

            // Clear persisted wizard state on completion so reopening starts
            // fresh at step 1. The step===4 clear in the persist effect never
            // fires — completion happens via the confirm modal at step 3, which
            // left the stale step-2 snapshot in sessionStorage (reopen rehydrated
            // it → the "reopens at step 2 with old data" bug).
            sessionStorage.removeItem('import_wizard_state');

            // Track import event in Amplitude via Zaraz (mirrored to PostHog)
            trackImport('import_completed', {
                source: sourceUrl ? 'url' : (fromContacts ? 'contacts' : 'text'),
                hasImages: (processedImages.length + manualImages.length) > 0 ? 1 : 0,
                quality: quality?.level ?? 'n/a',
                openIssues: quality?.issues.join(',') ?? '',
                afterDuplicates: personMatches.length > 0,
            });

            // Land on the new profile, for every kind of import (decision B1):
            // it is where the rescuer checks what was saved. Contacts imports
            // also get the VisitIntentCard there to declare the real activity.
            router.push(`/adopter/${adopterId}`);
        } catch (err) {
            showFailure(err, t('import.save_failed'), null, 'ImportWizard.save');
            setShowConfirmModal(false);
            // Reset only on failure: on success the "saving" screen stays up while
            // the profile loads, so nothing can be tapped twice into a duplicate.
            setIsSaving(false);
            setSavingMode(null);
        }
    };

    // Merge into existing profile
    /** A post person as a household member: name, relationship, their own contacts. */
    const toMember = (p: PostPerson) => ({
        name: p.name,
        relationship: p.relationship,
        contactEntries: buildContactEntries({ phones: p.phones, socials: p.socialProfiles }),
    });
    /** The add actions' contact shape for a relative's (or the post person's) entries. */
    const asHouseholdContacts = (entries: ContactEntry[]): HouseholdContactInput[] => entries.map(e => ({
        type: e.type, value: e.value,
        ...(e.platform ? { platform: e.platform } : {}),
        ...(e.apps?.length ? { apps: e.apps } : {}),
        ...(e.streetAndNumber ? { streetAndNumber: e.streetAndNumber } : {}),
        ...(e.locality ? { locality: e.locality } : {}),
    }));
    /** A relative's «¿Es este perfil?» answer is kept under who they are, not their place in the list. */
    const relativeKey = (p: PostPerson) => JSON.stringify([p.name, p.phones, p.socialProfiles]);
    const linkedProfileOf = (p: PostPerson): string | null => {
        const c = relativeChoices[relativeKey(p)];
        return c && c !== 'new' ? c : null;
    };

    /**
     * Merging into a match that did NOT match on the name (only phone, email or
     * address) with a different name: ask whether the post's person is the same
     * one (alias) or someone in that household (relative) — Jon, 2026-10-22.
     */
    const needsIdentityChoice = (match: PersonMatch | null) =>
        !!match && !duplicateAdopter && needsIdentityChoiceFor({ matchTypes: match.matchTypes, nameA: extractedData?.name ?? '', nameB: match.name });

    const handleMerge = async (target?: { id: string; name: string }) => {
        const mergeTarget = target || selectedMatch;
        if (!extractedData || !mergeTarget) return;
        logOpenIssuesAtSave('merge');
        setSavingMode('merge');
        setSavingTargetName(mergeTarget.name || '');
        setIsSaving(true);

        try {

            // v2.19.18: contacts-merge path mirrors the contacts-create path:
            // no sham activity record is written. The rescuer is enriching an
            // existing profile with better contact data; the real activity
            // (if any) gets declared via the always-present VisitIntentCard
            // on the destination profile. `/api/adopters/[id]/add-record`
            // requires an `adoption` block and would create an activity row
            // we explicitly don't want; the appendToExistingAdopter server
            // action is the right primitive — it merges contact fields
            // without touching the activity timeline. Facebook / share-URL
            // merges keep the existing add-record flow because the AI
            // extraction step collects a real recordType worth recording.
            if (fromContacts) {
                const { appendToExistingAdopter } = await import('@/app/actions');
                const contactInfoBlob = contactEntriesToBlob(contactEntries) || undefined;
                const contactEntriesJson = contactEntries.length ? JSON.stringify(contactEntries) : undefined;
                const result = await appendToExistingAdopter(mergeTarget.id, {
                    contactInfo: contactInfoBlob,
                    contactEntries: contactEntriesJson,
                });
                if (!result.success) {
                    throw new Error(result.error || 'Failed to merge contact data');
                }
                trackImport('import_merged', {
                    hasImages: 0,
                    fromContacts: 1,
                    kind: duplicateAdopter ? 'url' : 'person',
                });
                router.push(`/adopter/${mergeTarget.id}`);
                return;
            }

            // Generate thumbnails for fetched videos (via proxy for CORS)
            const videoPayloads = await Promise.all(
                fetchedVideos.filter((_, i) => !isMediaExcluded(`fv:${i}`)).map(async (videoUrl) => {
                    let thumbnail: string | undefined;
                    try {
                        thumbnail = await extractVideoThumbnailFromUrl(`/api/proxy-image?url=${encodeURIComponent(videoUrl)}`);
                    } catch (e) {
                        logUxIssue('import: fetched video thumbnail failed', { error: (e as Error).message });
                    }
                    return { data: '', mimeType: 'video/mp4', originalUrl: videoUrl, thumbnail };
                })
            );

            // Contacts go to the profile's typed entries below (appendToExistingAdopter),
            // never into the activity note (audit 2026-10-21, D8).
            const payload = {
                sourceUrl,
                notes: extractedData.notes,
                adoption: {
                    // v2.19.52: was `|| 'Unknown'` — literal English string
                    // overwrote empty names with "Unknown" regardless of locale
                    // and stuffed it into the DB. Blank now passes through as
                    // undefined → API saves NULL.
                    // Same report shape as the create path (Jon, 2026-10-22).
                    recordType: 'observation',
                    rating: extractedData.adoptionRating || undefined,
                    date: recordDateFrom(reportDate),
                },
                images: [
                    // Honor the review-step de-selection: a processed image is
                    // excluded by `p:<i>`, a manual image by `m:<i>`.
                    ...(processedImages.length > 0
                        ? processedImages.filter((_, i) => !isMediaExcluded(`p:${i}`))
                        : manualImages.filter((img, i) => !img.file && !isMediaExcluded(`m:${i}`)).map(img => ({ data: img.data, mimeType: img.mimeType }))),
                    ...videoPayloads,
                ],
            };

            const response = await fetch(`/api/adopters/${mergeTarget.id}/add-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json() as { adoptionId?: string; adopterId?: string; adopterName?: string; error?: string; errorId?: string };

            if (!response.ok) {
                throw new Error(result.errorId ? `${result.error || 'Failed to add record'} (Error ID: ${result.errorId})` : (result.error || 'Failed to add record'));
            }

            const adopterId = result.adopterId || mergeTarget.id;
            const adopterName = result.adopterName || mergeTarget.name;

            // H1 (v2.20.2): add-record only records the reviewed contact data in
            // the new activity's `details`. Also MERGE it into the adopter's
            // contact fields + re-tokenize via appendToExistingAdopter, so the
            // edits the rescuer made in the review step actually land on the
            // profile and in the dedup index (the contacts-import path already
            // does this; the post-import merge path used to drop them).
            // Who is the post's person to this profile? Matched only on phone /
            // email / address with another name, the rescuer chose (Jon,
            // 2026-10-22): the same person → alias; someone in that household →
            // a relative carrying the post's contacts. Otherwise the post's name,
            // when it differs, stays as an alias (decision B8).
            const asRelative = mergeAs === 'relative' && needsIdentityChoice(selectedMatch);
            // Each with its place in the post (`slot`): a re-merge of the same post adds nobody twice.
            const members = [
                ...(asRelative ? [{ name: extractedData.name?.trim() || '', relationship: 'unknown' as const, contactEntries, slot: 's' }] : []),
                ...relatives.map((p, i) => ({ ...toMember(p), slot: `r${i}`, existingProfileId: linkedProfileOf(p) })),
            ];
            const alias = asRelative ? null : aliasForMerge(extractedData.name, mergeTarget.name);
            const entriesToMerge: ContactEntry[] = asRelative ? [] : (alias
                ? [...contactEntries, { type: 'alias', value: alias }]
                : contactEntries);
            if (entriesToMerge.length) {
                const { appendToExistingAdopter } = await import('@/app/actions');
                const appendRes = await appendToExistingAdopter(mergeTarget.id, {
                    contactInfo: contactEntriesToBlob(entriesToMerge) || undefined,
                    contactEntries: JSON.stringify(entriesToMerge),
                    sourceUrl: sourceUrl || undefined,
                    // Honour the "público" switch the rescuer saw (audit D8).
                    publicSource: !!sourceUrl && isPublicProfile,
                });
                if (!appendRes?.success) {
                    // Non-fatal: the activity record saved. Contacts and the alias go
                    // through the owner/teammate-only append; on another team's
                    // profile it is refused by design. With only the alias to add,
                    // that refusal is expected and not worth a toast (review of
                    // 2.56.213, item 6); with contacts, the rescuer has to know.
                    const refused = /not authorized/i.test(appendRes?.error ?? '');
                    if (refused && contactEntries.length === 0) {
                        logUxIssue('import: alias not kept (profile of another team)', { adopterId: mergeTarget.id });
                    } else {
                        const id = appendRes?.error?.match(/Error ID:\s*([a-f0-9-]{6,})/i)?.[1];
                        toast.error(t('errors.generic'), refused ? t('import.contact_merge_not_allowed') : t('import.contact_merge_failed'), id);
                    }
                }
            }
            // Relatives: households as profiles — each one becomes a profile (with their
            // own contacts) in the target's household, through the same add anyone signed
            // in uses (D54: credited, granted, the target's team told). The «¿Es este
            // perfil?» confirmation per relative comes with the household UI (Task 8).
            for (const m of members) {
                const linked = 'existingProfileId' in m && m.existingProfileId ? m.existingProfileId : null;
                const res = await addHouseholdPerson({
                    anchorAdopterId: mergeTarget.id,
                    ...(linked ? { existingProfileId: linked } : { name: m.name }),
                    relationship: m.relationship,
                    contactEntries: asHouseholdContacts(m.contactEntries),
                    fromImport: { sourceUrl: sourceUrl || null, slot: m.slot },
                });
                // 'already_there': someone of that name already lives there — nothing to add.
                if (!res.ok && res.error !== 'already_there') {
                    toast.error(t('errors.generic'), t('import.relative_failed'), res.errorId ?? resolveErrorId(new Error(`addHouseholdPerson (import): ${res.error}`), 'ImportWizard'));
                    break;
                }
            }

            // Upload any pending video files via FormData (they were excluded from JSON body)
            const pendingVideoFiles = manualImages.filter((img, i) => img.file && !isMediaExcluded(`m:${i}`));
            for (const vid of pendingVideoFiles) {
                if (!vid.file) continue;
                const fd = new FormData();
                fd.append('file', vid.file);
                fd.append('adopterId', adopterId);
                fd.append('caption', 'Imported video');
                fd.append('mediaType', 'video');
                if (vid.thumbnail) fd.append('thumbnail', vid.thumbnail);
                const upRes = await fetch('/api/upload-media', { method: 'POST', body: fd });
                if (!upRes.ok) {
                    const up = await upRes.json().catch(() => ({})) as { errorId?: string };
                    toast.error(t('errors.generic') || 'Error', t('import.video_upload_failed') || 'No se pudo subir el video', up.errorId);
                }
            }

            // Lands on the profile (decision B1), so no "→ Ver perfil" link.
            toast.success(t('import.record_added_to_profile'), adopterName);

            // Clear persisted wizard state on completion (see create path) so
            // reopening starts fresh instead of rehydrating the stale snapshot.
            sessionStorage.removeItem('import_wizard_state');

            // Track merge event in Amplitude via Zaraz (mirrored to PostHog)
            trackImport('import_merged', {
                hasImages: (processedImages.length + manualImages.length) > 0 ? 1 : 0,
                kind: duplicateAdopter ? 'url' : 'person',
                band: duplicateAdopter ? 'url' : (mergeTarget as PersonMatch).confidence ?? 'unknown',
            });

            router.push(`/adopter/${adopterId}`);
        } catch (err) {
            showFailure(err, t('import.save_failed'), null, 'ImportWizard.merge');
            setShowConfirmModal(false);
            // Reset only on failure (see handleConfirmSave).
            setIsSaving(false);
            setSavingMode(null);
        }
    };

    /**
     * "Agregar a este perfil" on the review screen (decision B7): run the same
     * checks as "Guardar" — the same-post one first — with this match selected.
     * It used to open the match screen directly and skip the same-post check
     * (review of 2.56.213, item 4).
     */
    const openMatchFromHint = (hint: DuplicateMatch) => {
        trackImport('import_duplicate_choice', { choice: 'hint', kind: 'person' });
        handlePreSave({
            id: hint.adopterId,
            name: hint.adopterName,
            confidence: confidenceBand(hint.relevancePercent) as 'high' | 'medium' | 'low',
            score: hint.relevancePercent,
            matchTypes: hint.matchTypes,
        });
    };

    // --- RENDER ---

    const stepLabels = [t('import.stepInput'), t('import.stepContent'), t('import.stepReview')];
    const spinner = <svg className="w-4 h-4 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
    const canRetry = (failedOp === 'extract' || (failedOp === 'fetch' && !!inputContent.trim())) && !loading;
    // Extraction quality, live: facts from the import + the AI's report + what the
    // rescuer has fixed since (a name, a contact).
    const quality = extractionFacts && extractedData && !fromContacts
        ? extractionQuality({ ...extractionFacts, name: extractedData.name, entries: contactEntries })
        : null;

    if (!mounted) {
        return (
            <div className="max-w-2xl mx-auto flex items-center justify-center py-20" aria-busy="true">
                <span className="w-8 h-8 rounded-full border-4 border-stone-200 border-t-teal-600 animate-spin" aria-hidden="true" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto" onPaste={handlePaste}>
            {/* Header. The top control leaves the wizard ("Cancelar", to home);
                only the bottom "Volver" steps back. Both used to read "Volver",
                and the top one was router.back(), which after a share left the
                app (design change 14, approved 2026-10-21). */}
            <div className="mb-6">
                <button
                    type="button"
                    onClick={() => {
                        sessionStorage.removeItem('import_wizard_state');
                        router.push('/');
                    }}
                    className="-ml-2 mb-1 inline-flex items-center gap-1 min-h-[44px] px-2 text-sm text-stone-500 hover:text-stone-700"
                >
                    <CloseIcon className="w-4 h-4" />
                    {t('common.cancel')}
                </button>
                <h1 className="text-2xl font-semibold text-stone-900">{t('import.title')}</h1>
                <p className="text-stone-500 text-sm mt-1">{t('import.subtitle')}</p>
            </div>

            {/* Step Indicator — teal (themed); the old blue-* did not remap in
                Azul Noche. On phones the labels don't fit, so the current step's
                name shows underneath instead of bare numbers (design change 15). */}
            {!showConfirmModal && (
                <div className="py-4 mb-6 bg-white rounded-xl border border-stone-200">
                    <ol className="flex items-center justify-center gap-4">
                        {stepLabels.map((label, i) => (
                            <li key={i} className="flex items-center gap-2" aria-current={step === i + 1 ? 'step' : undefined}>
                                {i > 0 && <span aria-hidden="true" className="w-8 h-px bg-stone-200" />}
                                <span className={`flex items-center gap-2 ${step >= i + 1 ? 'text-teal-700' : 'text-stone-500'}`}>
                                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold ${step >= i + 1 ? 'bg-teal-100' : 'bg-stone-100'}`}>
                                        {i + 1}
                                    </span>
                                    <span className="text-sm font-medium hidden sm:block">{label}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                    <p className="sm:hidden mt-2 text-center text-xs font-semibold text-teal-700">
                        {t('import.step_n_of')
                            .replace('{n}', String(Math.min(step, 3)))
                            .replace('{total}', '3')
                            .replace('{label}', stepLabels[Math.min(step, 3) - 1])}
                    </p>
                </div>
            )}

            {/* Error Display — rose (themed), with the Error ID logged under it. */}
            {error && (
                <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm" role="alert">
                    <div className="flex items-start gap-3">
                        <WarningIcon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-rose-700 font-medium break-words">{error}</p>
                            {errorId && (
                                <p className="text-xs text-rose-600 mt-1 font-mono select-all">Error ID: {errorId}</p>
                            )}
                            {retryCountdown > 0 && (
                                <p className="text-rose-600 mt-1">
                                    {t('import.retry_in').replace('{s}', String(retryCountdown))}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            {retryCountdown > 0 ? (
                                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-rose-100 text-rose-600 font-semibold text-sm tabular-nums">
                                    {retryCountdown}
                                </span>
                            ) : canRetry ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Retry what failed. A pasted text read from step 1 re-runs
                                        // step 1; a read from step 2 re-runs the read.
                                        if (failedOp === 'extract' && step !== 1) handleExtract();
                                        else handleSmartSubmit();
                                    }}
                                    className="min-h-[44px] px-4 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700 transition-colors"
                                >
                                    {t('import.retry')}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => { clearError(); setRetryCountdown(0); }}
                                aria-label={t('common.close')}
                                className="w-11 h-11 inline-flex items-center justify-center rounded-full text-rose-500 hover:text-rose-700"
                            >
                                <CloseIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* === STEP 1: Smart Input === */}
            {step === 1 && !showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-6">
                    {/* Smart textarea */}
                    <div>
                        <label htmlFor="import-input" className="block text-sm font-medium text-stone-700 mb-2">
                            {t('import.smartLabel')}
                        </label>
                        <textarea
                            id="import-input"
                            value={inputContent}
                            onChange={e => setInputContent(e.target.value)}
                            placeholder={t('import.smartPlaceholder')}
                            className="w-full px-4 py-3 border border-stone-300 rounded-xl outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100 text-base min-h-[120px] resize-y"
                            autoFocus
                        />
                        <p className="text-xs text-stone-500 mt-1">{t('import.smartHint')}</p>
                    </div>

                    <MediaPicker
                        items={manualImages}
                        onAddFiles={addFiles}
                        onRemove={removeImage}
                        label={t('import.photoUploadLabel')}
                        dropzoneText={t('import.dropzone')}
                        hint={t('import.paste_hint')}
                        removeLabel={t('import.removeImage')}
                        testId="import-dropzone"
                    />

                    <StickyActions>
                        <button
                            type="button"
                            onClick={handleSmartSubmit}
                            disabled={(!inputContent.trim() && manualImages.length === 0) || loading}
                            className={`${BTN_PRIMARY} w-full`}
                        >
                            {loading ? (
                                <>
                                    {spinner}
                                    {loadingKind === 'extract'
                                        ? t('import.aiAnalyzing')
                                        : <>{t('import.fetching')} {fetchProgress > 0 && <span className="tabular-nums">{fetchProgress}%</span>}</>}
                                </>
                            ) : (
                                <>{t('import.continueBtn')} →</>
                            )}
                        </button>
                    </StickyActions>
                </div>
            )}

            {/* === STEP 2: Content Review + Extract (fetched links only) === */}
            {step === 2 && !showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                    {/* Shared from badge */}
                    {sharedFrom && sharedFrom !== 'shared' && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-800 min-w-0">
                            <UploadIcon className="w-5 h-5 shrink-0" />
                            <span className="font-medium shrink-0">{t('import.sharedFrom')}:</span>
                            <span className="truncate">{(() => { try { return new URL(sharedFrom).hostname; } catch { return sharedFrom; } })()}</span>
                        </div>
                    )}

                    {/* Loading state for share intent auto-fetch */}
                    {loading && !editableText && (
                        <div className="flex flex-col items-center gap-3 py-8 text-stone-500">
                            <svg className="w-7 h-7 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                            <p className="text-sm">
                                {t('import.fetchingShared')} {fetchProgress > 0 && <span className="tabular-nums font-medium">{fetchProgress}%</span>}
                            </p>
                            <div className="w-48 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-teal-600 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${fetchProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <h3 className="text-lg font-semibold text-stone-900">{t('import.reviewTitle')}</h3>

                    {/* Video post warning */}
                    {isVideoPost && (
                        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                            <VideoIcon className="w-5 h-5 shrink-0" />
                            <div>
                                <p className="font-medium">{t('import.video_post_title')}</p>
                                <p className="mt-0.5 text-amber-700">{t('import.video_post_hint')}</p>
                            </div>
                        </div>
                    )}

                    {/* Editable text */}
                    <div>
                        <label htmlFor="import-fetched-text" className="block text-sm font-medium text-stone-600 mb-1">
                            {t('import.extractedText')}{' '}
                            {sourceUrl && (() => {
                                try { return <span className="text-stone-500">{t('import.from_host').replace('{host}', new URL(sourceUrl).hostname)}</span>; } catch { return null; }
                            })()}
                        </label>
                        <textarea
                            id="import-fetched-text"
                            value={editableText}
                            onChange={e => setEditableText(e.target.value)}
                            className="w-full px-4 py-3 border border-stone-300 rounded-xl text-base min-h-[150px] resize-y outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                        />
                    </div>

                    {/* Fetched images */}
                    {fetchedImages.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="block text-sm font-medium text-stone-600">
                                    {selectedFetchedImages.size} {t('import.imagesOf')} {fetchedImages.length} {fetchedImages.length !== 1 ? t('import.imagesFoundPlural') : t('import.imagesFound')} {t('import.imagesSelected')}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (selectedFetchedImages.size === fetchedImages.length) {
                                            setSelectedFetchedImages(new Set());
                                        } else {
                                            setSelectedFetchedImages(new Set(fetchedImages.map((_, i) => i)));
                                        }
                                    }}
                                    className="min-h-[44px] px-2 -mr-2 text-xs font-semibold text-teal-700 hover:text-teal-800"
                                >
                                    {selectedFetchedImages.size === fetchedImages.length ? t('import.deselectAll') : t('import.selectAll')}
                                </button>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                                {fetchedImages.map((url, i) => {
                                    const isSelected = selectedFetchedImages.has(i);
                                    return (
                                        <button
                                            key={i}
                                            type="button"
                                            aria-pressed={isSelected}
                                            onClick={() => {
                                                setSelectedFetchedImages(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(i)) next.delete(i);
                                                    else next.add(i);
                                                    return next;
                                                });
                                            }}
                                            className={`relative group rounded-lg overflow-hidden border-2 transition-all ${isSelected
                                                ? 'border-teal-400 shadow-sm'
                                                : 'border-transparent opacity-50 hover:opacity-75'
                                                }`}
                                        >
                                            <img
                                                src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
                                                alt=""
                                                className="w-full h-20 object-cover bg-stone-100"
                                            />
                                            {/* Selection mark — the whole tile is the control. */}
                                            <span aria-hidden="true" className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-all ${isSelected
                                                ? 'bg-teal-600 text-white'
                                                : 'bg-white/80 text-stone-500 border border-stone-300'
                                                }`}>
                                                {isSelected ? <CheckIcon className="w-3.5 h-3.5" /> : null}
                                            </span>
                                            {/* Expand and discard: <span role=button> because the tile
                                                itself is a button and nesting buttons is invalid HTML.
                                                24px visual, 44px hit area (§1.5) via ::after. */}
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setLightboxItem({ url: `/api/proxy-image?url=${encodeURIComponent(url)}`, mediaType: 'image' });
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setLightboxItem({ url: `/api/proxy-image?url=${encodeURIComponent(url)}`, mediaType: 'image' });
                                                }}
                                                className="absolute bottom-1 left-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 cursor-pointer after:absolute after:-inset-2.5 after:content-['']"
                                                title={t('nav.expand_image')}
                                                aria-label={t('nav.expand_image')}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                                                </svg>
                                            </span>
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeFetchedImage(i);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    removeFetchedImage(i);
                                                }}
                                                className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center cursor-pointer after:absolute after:-inset-2.5 after:content-['']"
                                                title={t('import.removeImage')}
                                                aria-label={t('import.removeImage')}
                                            >
                                                <CloseIcon className="w-3.5 h-3.5" />
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Fetched videos */}
                    {fetchedVideos.length > 0 && (
                        <div>
                            <span className="flex items-center gap-1 text-sm font-medium text-stone-600 mb-2">
                                <VideoIcon className="w-4 h-4" />{t('import.videos_found').replace('{count}', String(fetchedVideos.length))}
                            </span>
                            <div className="grid grid-cols-2 gap-3">
                                {fetchedVideos.map((url, i) => (
                                    <button
                                        type="button"
                                        key={i}
                                        className="relative rounded-xl overflow-hidden border-2 border-teal-300 aspect-video group bg-gradient-to-br from-teal-600 to-teal-800"
                                        onClick={() => setLightboxItem({ url, mediaType: 'video' })}
                                    >
                                        {/* Video placeholder — actual playback happens in lightbox */}
                                        <span className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                                <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </span>
                                            <span className="text-white/80 text-xs mt-2 font-medium">{t('import.video_n').replace('{n}', String(i + 1))}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* More photos — the same picker as step 1 (it was a bare file input). */}
                    <MediaPicker
                        items={manualImages}
                        onAddFiles={addFiles}
                        onRemove={removeImage}
                        label={t('import.addMoreImages')}
                        dropzoneText={t('import.dropzone')}
                        hint={t('import.paste_hint')}
                        removeLabel={t('import.removeImage')}
                    />

                    <StickyActions className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => { clearError(); setStep(1); }}
                            className="min-h-[44px] px-4 border border-stone-300 rounded-xl text-sm font-bold text-stone-600 hover:bg-stone-50"
                        >
                            ← {t('import.back')}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleExtract()}
                            disabled={loading || (!editableText.trim() && manualImages.length === 0 && selectedFetchedImages.size === 0)}
                            className={`${BTN_PRIMARY} flex-1`}
                        >
                            {loading ? (
                                <>{spinner}{t('import.aiAnalyzing')}</>
                            ) : (
                                <><SparkIcon className="w-4 h-4 shrink-0" />{t('import.extractWithAi')}</>
                            )}
                        </button>
                    </StickyActions>
                </div>
            )}

            {/* === STEP 3: Review Extracted Data === */}
            {step === 3 && !showConfirmModal && extractedData && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-stone-900">{t('import.reviewExtracted')}</h3>
                    </div>

                    {/* Contact-import breadcrumb — only shown when the wizard
                        was hydrated from a device contact (no AI extraction
                        ran), so the user knows why animal fields are empty. */}
                    {fromContacts && (
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800">
                            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>{t('import.from_contacts_breadcrumb')}</span>
                        </div>
                    )}

                    {/* What could not be extracted, and how to fix it (Jon, 2026-10-22).
                        Only when there is a problem — no generic "verify everything"
                        banner, no confidence grade. Each hint is a fact of the import or
                        something the AI says it could not read; never its opinion of
                        the post. Hints about missing source content offer the way
                        back to add it; the rest point at the field right here. */}
                    {quality && quality.issues.length > 0 && (
                        <ul data-testid="import-quality" className="space-y-2">
                            {quality.issues.map((issue: ExtractionIssue) => {
                                const goBack = ['post_text_unavailable', 'info_in_video', 'image_unreadable', 'text_cut_off'].includes(issue);
                                return (
                                    <li key={issue} data-issue={issue} className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                                        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span className="flex-1 min-w-0">{t(`import.issue_${issue}`)}</span>
                                        {goBack && (
                                            <button
                                                type="button"
                                                onClick={() => setStep(sourceUrl ? 2 : 1)}
                                                className="shrink-0 min-h-[44px] -my-2.5 px-2 text-sm font-semibold text-teal-800 underline underline-offset-2"
                                            >
                                                {t('import.issue_fix_add')}
                                            </button>
                                        )}
                                        {issue === 'extraction_failed' && (
                                            <button
                                                type="button"
                                                onClick={() => handleExtract()}
                                                className="shrink-0 min-h-[44px] -my-2.5 px-2 text-sm font-semibold text-teal-800 underline underline-offset-2"
                                            >
                                                {t('import.retry')}
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}


                    {/* v2.19.47: per-record public-visibility consent toggle.
                        Only rendered for social-URL imports — Google Contacts
                        and text-only flows don't have the "this came from a
                        public channel" semantic and should default private.
                        Default ON (preserves the historical FB-import-is-public
                        behaviour) but the rescuer can flip it off if they want
                        the record gated like a normal manual entry. */}
                    {/* The whole row is the switch: 44px+ target, and a line on what
                        "public" means for this person (decision B2, 2026-10-21). It
                        was a 36x20 toggle. */}
                    {!fromContacts && !!sourceUrl?.trim() && (
                        <button
                            type="button"
                            role="switch"
                            aria-checked={isPublicProfile}
                            onClick={() => setIsPublicProfile(p => !p)}
                            title={t('import.public_profile_toggle_title')}
                            className={`w-full text-left flex items-start gap-3 px-3 py-3 min-h-[44px] rounded-xl border transition-colors ${isPublicProfile ? 'bg-teal-50 border-teal-200' : 'bg-stone-50 border-stone-200'}`}
                        >
                            <span aria-hidden="true" className={`mt-0.5 relative w-11 h-6 rounded-full transition-colors shrink-0 ${isPublicProfile ? 'bg-teal-500' : 'bg-stone-300'}`}>
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isPublicProfile ? 'translate-x-5' : 'translate-x-0'}`} />
                            </span>
                            <span className="flex-1 min-w-0 text-xs">
                                <span className={`block text-sm font-semibold ${isPublicProfile ? 'text-teal-800' : 'text-stone-700'}`}>
                                    {isPublicProfile
                                        ? t('import.public_profile_on')
                                        : t('import.public_profile_off')}
                                </span>
                                {isPublicProfile && (
                                    <span className="block text-teal-800 mt-0.5">{t('import.public_profile_on_consequence')}</span>
                                )}
                                <span className="block text-stone-600 mt-0.5">
                                    {sourceNotPublic
                                        ? t('import.public_profile_explainer_private_source')
                                        : t('import.public_profile_explainer')}
                                </span>
                            </span>
                        </button>
                    )}

                    {/* Name */}
                    <div>
                        <h3 id="import-name-heading" className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.name')}</h3>
                        <input
                            aria-labelledby="import-name-heading"
                            value={extractedData.name || ''}
                            onChange={e => setExtractedData({ ...extractedData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-base outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                        />
                    </div>

                    {/* Rating — the point of a report (Jon, 2026-10-22). Social-post
                        imports are almost always call-outs, so there is no activity
                        type to choose: the record is a report, and the rating is what
                        protects other rescuers. The AI may suggest one from the
                        conduct described; it is tagged as a suggestion, with the
                        reason, until the rescuer touches the stars. Never saved
                        silently. Contacts imports keep their own flow. */}
                    {!fromContacts && (
                        <div data-testid="import-rating" className="rounded-xl border border-stone-200 p-4 space-y-3">
                            <h3 className="text-sm font-semibold text-teal-800 uppercase tracking-wider">{t('import.rating_title')}</h3>
                            {/* Pre-filled with the AI's suggestion when the post gives grounds;
                                the rescuer changes it with a tap (re-tapping clears). Kept terse
                                (Jon, 2026-10-22): no suggestion caption, no «Quitar». */}
                            <StarRating
                                value={extractedData.adoptionRating || 0}
                                onChange={(r: number) => setExtractedData({ ...extractedData, adoptionRating: r || undefined })}
                                size="md"
                                showLabel
                                clearable={false}
                            />
                            {extractedData.adoptionRating === 1 && (
                                <p className="text-xs text-rose-700">{t('import.rating_one_bans')}</p>
                            )}
                            <div>
                                <span className="block text-xs font-medium text-stone-500 mb-1">{t('import.report_month')}</span>
                                <DatePicker
                                    value={reportDate}
                                    onChange={setReportDate}
                                    maxDate={new Date().toISOString().split('T')[0]}
                                    dayOptional
                                />
                            </div>
                        </div>
                    )}

                    {/* Other people the post names (Jon, 2026-10-22): saved as relatives
                        of this profile in the same save. The rescuer can drop anyone the
                        AI got wrong. */}
                    {!fromContacts && relatives.length > 0 && (
                        <div data-testid="import-relatives" className="rounded-xl border border-stone-200 p-4 space-y-2">
                            <h3 className="text-sm font-semibold text-teal-800 uppercase tracking-wider">{t('import.relatives_title')}</h3>
                            <p className="text-xs text-stone-500">{t('import.relatives_hint')}</p>
                            <ul className="space-y-2">
                                {relatives.map((p, i) => (
                                    <li key={`${p.name}-${i}`} className="rounded-lg bg-stone-50 border border-stone-200">
                                    <div className="flex items-center justify-between gap-3 pl-3">
                                        <span className="min-w-0 py-2">
                                            <span className="block font-semibold text-stone-900 break-words">{p.name}</span>
                                            <span className="block text-xs text-stone-500">
                                                {t(p.relationship === 'unknown' ? 'adopter.hh_rel_unknown_display' : `adopter.hh_rel_${p.relationship}`)}
                                                {[...p.phones, ...p.socialProfiles].length > 0 && <> · {[...p.phones, ...p.socialProfiles].join(' · ')}</>}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setRelatives(prev => prev.filter((_, j) => j !== i))}
                                            aria-label={t('import.relative_remove').replace('{name}', p.name)}
                                            title={t('import.relative_remove').replace('{name}', p.name)}
                                            className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full text-stone-500 hover:text-rose-700"
                                        >
                                            <CloseIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <ImportRelativeCheck
                                        name={p.name}
                                        contactEntries={asHouseholdContacts(toMember(p).contactEntries)}
                                        excludeIds={selectedMatch ? [selectedMatch.id] : []}
                                        choice={relativeChoices[relativeKey(p)]}
                                        onChoose={c => setRelativeChoices(prev => ({ ...prev, [relativeKey(p)]: c }))}
                                    />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Contact Info — typed entries, AI-categorized and editable */}
                    <div>
                        <h3 className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('adopter.contact')}</h3>
                        <ContactEntriesInput entries={contactEntries} onChange={setContactEntries} />
                        {/* Field-overlap preview. Was a bare count ("1 posible
                            duplicado") the rescuer could not act on, so they kept
                            editing a profile they might end up merging. Now it
                            names the strongest match and offers to add to it
                            (decision B7, 2026-10-21); the decision still happens
                            on the duplicate screen, which opens pre-selected.
                            Hits under the 15% noise floor stay hidden. */}
                        {(() => {
                            const visible = fieldOverlapHints
                                .filter(h => h.relevancePercent >= 15)
                                .sort((x, y) => y.relevancePercent - x.relevancePercent);
                            if (visible.length === 0) return null;
                            const top = visible[0];
                            return (
                                <div data-testid="import-match-hint" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
                                    <p className="flex items-start gap-1.5">
                                        <WarningIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                                        <span>
                                            {t('import.review_hint_match')
                                                .replace('{name}', top.adopterName?.trim() || t('import.unnamed_profile'))
                                                .replace('{why}', humanMatchSentence(top.matchTypes || [], t))}
                                            {visible.length > 1 && <> {t('import.duplicates_found_count_other').replace('{count}', String(visible.length))}</>}
                                        </span>
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => openMatchFromHint(top)}
                                        disabled={isSaving}
                                        className="min-h-[44px] px-4 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-sm font-bold hover:bg-teal-100 disabled:opacity-40"
                                    >
                                        {t('import.review_hint_action')}
                                    </button>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Initial observation — for contacts imports we now skip the silent
                        observation entirely; the rescuer declares the real activity via the
                        prompted VisitIntentCard on the destination profile (v2.19.18). */}
                    {!fromContacts && (
                        <div>
                            <h3 id="import-observation-heading" className="text-sm font-semibold text-teal-800 mb-3 uppercase tracking-wider">{t('import.initial_observation')}</h3>
                            <textarea
                                aria-labelledby="import-observation-heading"
                                value={extractedData.notes || ''}
                                onChange={e => setExtractedData({ ...extractedData, notes: e.target.value })}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-base min-h-[80px] resize-y outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
                                placeholder={t('import.initial_observation_placeholder') || 'Saved as an observation record on the new profile.'}
                            />
                        </div>
                    )}

                    {/* Media preview — every image and video that WILL be saved,
                        each de-selectable so the rescuer drops what they don't want
                        imported. Keys match the save-payload filters (`p:` processed,
                        `m:` manual, `fv:` fetched video). */}
                    {(() => {
                        type MediaTile = { key: string; src: string; mediaType: 'image' | 'video'; label?: string };
                        const media: MediaTile[] = [];
                        // Processed images from fetch (base64)
                        processedImages.forEach((img, i) => media.push({
                            key: `p:${i}`,
                            src: `data:${img.mimeType};base64,${img.data}`,
                            mediaType: 'image',
                            label: img.originalUrl ? new URL(img.originalUrl).pathname.split('/').pop() : undefined,
                        }));
                        // Manual uploads — images and video files, keyed by their
                        // real index in manualImages so the key survives filtering.
                        manualImages.forEach((img, i) => media.push(
                            img.file
                                ? { key: `m:${i}`, src: img.thumbnail || img.preview, mediaType: 'video' }
                                : { key: `m:${i}`, src: img.preview, mediaType: 'image' },
                        ));
                        // Fetched (scraped) videos
                        fetchedVideos.forEach((url, i) => media.push({ key: `fv:${i}`, src: url, mediaType: 'video' }));

                        if (media.length === 0) return null;
                        const keptCount = media.filter(m => !isMediaExcluded(m.key)).length;
                        return (
                            <div>
                                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                                    {t('import.attachedImages') || 'Attached Media'} ({keptCount}/{media.length})
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {media.map((m) => {
                                        const excluded = isMediaExcluded(m.key);
                                        const isVideo = m.mediaType === 'video';
                                        return (
                                            <div key={m.key} className="relative group">
                                                {isVideo ? (
                                                    <div
                                                        className={`w-20 h-20 rounded-lg overflow-hidden border cursor-pointer transition-all ${excluded ? 'opacity-40 grayscale border-stone-200' : 'border-teal-300'} bg-gradient-to-br from-teal-600 to-teal-800`}
                                                        onClick={() => setLightboxItem({ url: m.src, mediaType: 'video' })}
                                                    >
                                                        {m.src && m.src !== '' && (
                                                            <img src={m.src} alt="" className="w-full h-full object-cover" />
                                                        )}
                                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                            <div className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center shadow">
                                                                <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <img
                                                        src={m.src}
                                                        alt={m.label || 'Image'}
                                                        className={`w-20 h-20 object-cover rounded-lg border transition-all cursor-pointer ${excluded ? 'opacity-40 grayscale border-stone-200' : 'border-stone-200 hover:ring-2 hover:ring-teal-300'}`}
                                                        onClick={() => setLightboxItem({ url: m.src, mediaType: 'image' })}
                                                    />
                                                )}
                                                {/* Include / exclude toggle. Excluded tiles dim and
                                                    the control flips to a re-add affordance. */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); toggleMediaExcluded(m.key); }}
                                                    aria-label={excluded ? (t('import.mediaInclude') || 'Include') : (t('import.mediaExclude') || 'Exclude')}
                                                    title={excluded ? (t('import.mediaInclude') || 'Include') : (t('import.mediaExclude') || 'Exclude')}
                                                    className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center shadow transition-all after:absolute after:-inset-2.5 after:content-[''] ${excluded ? 'bg-white text-teal-700 border border-teal-300 hover:bg-teal-50' : 'bg-black/60 text-white hover:bg-black/80'}`}
                                                >
                                                    {excluded
                                                        ? <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                                        : <CloseIcon className="w-3 h-3" />}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    <LegalConsent />

                    {(() => {
                        const canSave = canSaveImportedProfile(extractedData.name, contactEntries);
                        return (
                            <StickyActions>
                                {/* Why "Guardar" is off — it used to be disabled with no word (decision B4). */}
                                {!canSave && (
                                    <p id="import-save-hint" className="text-xs text-amber-800 mb-2">{t('import.save_needs_identifier')}</p>
                                )}
                                <div className="flex gap-3">
                                    {/* v2.19.20: contacts imports skip steps 1+2 entirely
                                        (hydrateFromContact jumps straight to step 3), so
                                        "Back" must not drop the rescuer onto step 2's AI
                                        text-paste screen they never saw. Send them home.
                                        Pasted text skips step 2 too, so it goes to step 1. */}
                                    <button
                                        type="button"
                                        onClick={() => fromContacts ? router.push('/') : setStep(sourceUrl ? 2 : 1)}
                                        className="min-h-[44px] px-4 border border-stone-300 rounded-xl text-sm font-bold text-stone-600 hover:bg-stone-50"
                                    >
                                        ← {t('import.back')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handlePreSave()}
                                        disabled={!canSave || isSaving}
                                        aria-describedby={!canSave ? 'import-save-hint' : undefined}
                                        className={`${BTN_PRIMARY} flex-1`}
                                    >
                                        {isSaving ? (
                                            <>{spinner} {t('import.checking')}</>
                                        ) : (
                                            <><SaveIcon className="w-4 h-4 shrink-0" />{t('import.saveAdopter')}</>
                                        )}
                                    </button>
                                </div>
                            </StickyActions>
                        );
                    })()}
                </div>
            )}

            {/* === Confirm Modal === */}
            {showConfirmModal && isSaving && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6">
                    {/* v2.19.21: full-modal loading takeover. The original
                        confirmation body stays hidden so the rescuer gets a
                        single, calm signal that work is happening + an
                        expectation that they're being navigated. No buttons
                        means no accidental double-submit during the lag. */}
                    <div className="flex flex-col items-center text-center py-10 gap-4">
                        <div
                            className="w-12 h-12 rounded-full border-4 border-stone-200 animate-spin"
                            style={{ borderTopColor: 'var(--accent)' }}
                            role="status"
                            aria-live="polite"
                            aria-label={savingMode === 'merge'
                                ? (t('import.saving_merging') || 'Agregando datos...')
                                : (t('import.saving_creating') || 'Creando perfil...')}
                        />
                        <div className="space-y-1">
                            <p className="text-lg font-semibold text-stone-900">
                                {savingMode === 'merge'
                                    ? `${t('import.saving_merging_prefix') || 'Agregando datos a'} ${savingTargetName || (t('import.thisProfile') || 'este perfil')}…`
                                    : `${savingTargetName ? t('import.saving_creating_for').replace('{name}', savingTargetName) : t('import.saving_creating')}…`}
                            </p>
                            <p className="text-sm text-stone-500">
                                {fromContacts
                                    ? (t('import.saving_subline_to_profile') || 'Te llevamos a su perfil.')
                                    : (t('import.saving_subline_generic') || 'Un momento.')}
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {showConfirmModal && !isSaving && (() => {
                const secondary = buttonClasses({ variant: 'secondary', fullWidth: true });
                const backToReview = (kind: 'url' | 'person' | 'none') => (
                    <button
                        type="button"
                        onClick={() => {
                            if (kind !== 'none') trackImport('import_duplicate_choice', { choice: 'back', kind });
                            setDuplicateAdopter(null);
                            setDuplicateAdopters([]);
                            setPersonMatches([]);
                            setSelectedMatch(null);
                            setShowConfirmModal(false);
                        }}
                        className="-ml-2 inline-flex items-center min-h-[44px] px-2 text-sm font-semibold text-stone-500 hover:text-stone-700"
                    >
                        {t('import.backToReview')}
                    </button>
                );

                // ── The post was already imported (decisions B9 + B6) ──
                if (duplicateAdopter) {
                    const first = duplicateAdopters[0] ?? { id: duplicateAdopter.id, name: duplicateAdopter.name, canEdit: false };
                    const firstName = first.name?.trim() || t('import.unnamed_profile');
                    return (
                        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                            {backToReview('url')}
                            <div className="flex items-start gap-3">
                                <span className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                                    <WarningIcon className="w-5 h-5" />
                                </span>
                                <div className="min-w-0">
                                    <h3 className="text-lg font-semibold text-stone-900">{t('import.already_imported_title')}</h3>
                                    <p className="text-sm text-stone-600 mt-0.5">{t('import.already_imported_desc')}</p>
                                </div>
                            </div>
                            <ul className="space-y-2">
                                {(duplicateAdopters.length ? duplicateAdopters : [first]).map(p => (
                                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2">
                                        <span className="font-semibold text-stone-900 line-clamp-2 break-words">{p.name?.trim() || t('import.unnamed_profile')}</span>
                                        <a
                                            href={`/adopter/${p.id}`}
                                            onClick={() => trackImport('import_duplicate_choice', { choice: 'view', kind: 'url' })}
                                            className="shrink-0 inline-flex items-center min-h-[44px] px-2 text-sm font-semibold text-teal-700 underline underline-offset-2"
                                        >
                                            {t('import.viewProfile')}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                onClick={() => {
                                    trackImport('import_duplicate_choice', { choice: 'not_same_post', kind: 'url' });
                                    setDuplicateAdopter(null);
                                    setDuplicateAdopters([]);
                                    setShowConfirmModal(false);
                                    // The name/contact check still runs.
                                    handlePreSave(undefined, { skipUrlCheck: true });
                                }}
                                className="inline-flex items-center min-h-[44px] text-sm font-semibold text-stone-600 underline underline-offset-2 hover:text-stone-800"
                            >
                                {t('import.not_same_post')}
                            </button>
                            <StickyActions className="flex flex-col gap-2">
                                <a
                                    href={`/adopter/${first.id}`}
                                    onClick={() => trackImport('import_duplicate_choice', { choice: 'view', kind: 'url' })}
                                    className={`${BTN_PRIMARY} w-full`}
                                >
                                    {t('import.view_profile_btn')}
                                </a>
                                <button type="button" onClick={() => handleMerge({ id: first.id, name: first.name || '' })} className={secondary}>
                                    {t('import.add_interaction_to').replace('{name}', firstName)}
                                </button>
                            </StickyActions>
                        </div>
                    );
                }

                // ── Possible matches by name / contact (decision B5, audit D5–D6) ──
                if (personMatches.length > 0) {
                    const mergeLeads = selectedMatch?.confidence === 'high';
                    const mergeBtn = (
                        <button
                            type="button"
                            onClick={() => handleMerge()}
                            disabled={!selectedMatch || (needsIdentityChoice(selectedMatch) && !mergeAs)}
                            className={mergeLeads ? `${BTN_PRIMARY} w-full` : secondary}
                        >
                            {t('import.add_to_selected')}
                        </button>
                    );
                    const createBtn = (
                        <button
                            type="button"
                            onClick={() => { trackImport('import_duplicate_choice', { choice: 'create', kind: 'person' }); handleConfirmSave(); }}
                            className={mergeLeads ? secondary : `${BTN_PRIMARY} w-full`}
                        >
                            {t('import.create_new_instead')}
                        </button>
                    );
                    return (
                        <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                            {backToReview('person')}
                            <div>
                                <h3 className="text-lg font-semibold text-stone-900">{t('import.possible_match_title')}</h3>
                                <p className="text-sm text-stone-600 mt-0.5">{t('import.possible_match_desc')}</p>
                            </div>
                            {/* A failed check is said here too, not only when nothing
                                matched (re-review of 2.56.214, D). */}
                            {duplicateCheckFailed && (
                                <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                                    <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{t('import.duplicateCheckFailed')}</span>
                                </div>
                            )}
                            <div className="space-y-2" role="radiogroup" aria-label={t('import.possible_match_title')}>
                                {personMatches.map(match => {
                                    const isSelected = selectedMatch?.id === match.id;
                                    return (
                                        <div
                                            key={match.id}
                                            role="radio"
                                            aria-checked={isSelected}
                                            tabIndex={0}
                                            onClick={() => { setMergeAs(null); setSelectedMatch(isSelected ? null : match); }}
                                            onKeyDown={e => {
                                                // Enter on the nested "Ver" link or "¿Por qué?" must not toggle the card.
                                                if (e.target !== e.currentTarget) return;
                                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                                e.preventDefault();
                                                setMergeAs(null);
                                                setSelectedMatch(isSelected ? null : match);
                                            }}
                                            className={`w-full text-left rounded-xl p-4 border-2 cursor-pointer transition-all ${isSelected
                                                ? 'border-teal-500 bg-teal-50'
                                                : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <span aria-hidden="true" className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-teal-600 bg-teal-600' : 'border-stone-300'}`}>
                                                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-stone-900 line-clamp-2 break-words" title={match.name}>{match.name?.trim() || t('import.unnamed_profile')}</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                    <a
                                                        href={`/adopter/${match.id}`}
                                                        target="_blank"
                                                        rel="noopener"
                                                        onClick={e => { e.stopPropagation(); trackImport('import_duplicate_choice', { choice: 'view', kind: 'person' }); }}
                                                        className="inline-flex items-center min-h-[44px] px-1 text-xs font-semibold text-teal-700 underline underline-offset-2"
                                                    >
                                                        {t('import.viewProfile')}
                                                    </a>
                                                </div>
                                            </div>
                                            {/* What matches and what doesn't, field by field (Jon, 2026-10-25).
                                                Full card width so the rows stay readable at 390px; open by
                                                default when it is the only possible match. */}
                                            <MatchCompare
                                                adopterId={match.id}
                                                matchTypes={match.matchTypes || []}
                                                profileName={match.name}
                                                source={{ kind: 'post', name: extractedData?.name, entries: contactEntries }}
                                                score={match.score}
                                                defaultOpen={personMatches.length === 1}
                                                t={t}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Matched on phone/email/address but not the name: who is the
                                post's person to that profile? (Jon, 2026-10-22) */}
                            {needsIdentityChoice(selectedMatch) && (
                                <fieldset data-testid="import-identity-choice" className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                                    <legend className="px-1 text-sm font-semibold text-amber-900">
                                        {t('import.identity_question')
                                            .replace('{post}', extractedData?.name?.trim() || t('import.unnamed_profile'))
                                            .replace('{profile}', selectedMatch?.name?.trim() || t('import.unnamed_profile'))}
                                    </legend>
                                    {(['alias', 'relative'] as const).map(choice => (
                                        <label key={choice} className="flex items-center gap-3 min-h-[44px] text-sm text-stone-800 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="import-identity"
                                                value={choice}
                                                checked={mergeAs === choice}
                                                onChange={() => setMergeAs(choice)}
                                                className="w-5 h-5 accent-teal-600"
                                            />
                                            {t(choice === 'alias' ? 'import.identity_alias' : 'import.identity_relative')}
                                        </label>
                                    ))}
                                </fieldset>
                            )}
                            <StickyActions className="flex flex-col gap-2">
                                {mergeLeads ? <>{mergeBtn}{createBtn}</> : <>{createBtn}{mergeBtn}</>}
                            </StickyActions>
                        </div>
                    );
                }

                // ── No match, but the check itself failed: the rescuer has to look ──
                return (
                    <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                        {backToReview('none')}
                        <h3 className="text-lg font-semibold text-stone-900">{t('import.confirmCreate')}</h3>
                        <p className="text-sm text-stone-600">
                            {t('import.aboutToCreate')} <strong className="text-stone-900">{extractedData?.name?.trim() || t('import.unnamed_profile')}</strong>.
                        </p>
                        {duplicateCheckFailed && (
                            <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                                <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
                                <span>{t('import.duplicateCheckFailed')}</span>
                            </div>
                        )}
                        <StickyActions>
                            <button type="button" onClick={handleConfirmSave} className={`${BTN_PRIMARY} w-full`}>
                                <CheckIcon className="w-4 h-4 shrink-0" />{t('import.createProfile')}
                            </button>
                        </StickyActions>
                    </div>
                );
            })()}

            {/* Image/Video Lightbox */}
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
        </div>
    );
}

