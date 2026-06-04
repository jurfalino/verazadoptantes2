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
import { findAdopters } from '@/app/actions';
import type { DuplicateMatch } from '@/app/actions';
import { confidenceBand } from '@/lib/scoring';
import type { ExtractedAdopterData } from '@/lib/gemini';
import ContactEntriesInput from '@/components/ContactEntriesInput';
import { buildContactEntries, contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { parseVcard, type ParsedVcardContact } from '@/lib/vcard';
import { CONTACT_IMPORT_STASH_KEY } from '@/components/ContactPickerLauncher';

interface PersonMatch {
    id: string;
    name: string;
    contactInfo?: string | null;
    sourceUrl?: string | null;
    thumbnail?: string | null;
    confidence: 'high' | 'medium' | 'low';
    /**
     * Raw token-type signals from the duplicate-detection backend (e.g.
     * 'phone_suffix', 'name_word', 'source_url'). The wizard converts these
     * to a user-facing sentence at render time via humanMatchSentence — we
     * don't pre-translate here so the same data can be rendered in either
     * locale or used to drive non-text affordances later.
     */
    matchTypes: string[];
}

/**
 * Map a duplicate-detection token type (from the tokenizer / findAdopters)
 * to its user-facing label key (v2.16.0-43). Synonym token types collapse
 * to one user-visible noun so the sentence builder never produces
 * "Comparte teléfono y teléfono" or "Shares name and name."
 *
 * Returns null for token types we deliberately don't surface (`like_fallback`
 * is noise; `name_word_fuzzy` is the fuzzy-match flag added by findAdopters
 * alongside a name_word and shouldn't render as a separate signal).
 */
function matchTypeToLabelKey(type: string): string | null {
    switch (type) {
        case 'phone': case 'phone_suffix': return 'import.match_label_phone';
        case 'email': return 'import.match_label_email';
        case 'social': return 'import.match_label_social';
        case 'name_full': case 'name_word': return 'import.match_label_name';
        case 'address_word': return 'import.match_label_address';
        case 'source_url': return 'import.match_label_source_url';
        case 'id_number': return 'import.match_label_id_number';
        default: return null;
    }
}

/**
 * Build a natural-language sentence describing what the proposed duplicate
 * shares with the user's input. Returns a string — the name is expected to
 * render separately (Step 4 cards stack name above the sentence), so we
 * don't include it here. Falls back to the low-band preamble if every
 * match type is filtered out by matchTypeToLabelKey.
 */
function humanMatchSentence(
    matchTypes: string[],
    t: (key: string) => string,
): string {
    const labelKeys = Array.from(new Set(
        matchTypes.map(matchTypeToLabelKey).filter((k): k is string => !!k)
    ));
    const labels = labelKeys.map(k => t(k));
    if (labels.length === 0) {
        return t('import.match_band_low');
    }
    if (labels.length === 1) {
        return t('import.shares_one').replace('{x}', labels[0]);
    }
    if (labels.length === 2) {
        return t('import.shares_two').replace('{x}', labels[0]).replace('{y}', labels[1]);
    }
    return t('import.shares_many').replace('{x}', labels[0]).replace('{y}', labels[1]);
}

/** Render the confidence-band pill — themed colours only (theme-safe). */
function MatchBandPill({ band, t }: { band: 'high' | 'medium' | 'low'; t: (key: string) => string }) {
    const styles = band === 'high'
        ? 'bg-rose-100 text-rose-900 border-rose-200'
        : band === 'medium'
            ? 'bg-amber-100 text-amber-900 border-amber-200'
            : 'bg-stone-100 text-stone-700 border-stone-200';
    const label = band === 'high'
        ? t('import.match_band_high')
        : band === 'medium'
            ? t('import.match_band_medium')
            : t('import.match_band_low');
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${styles}`}>
            {label}
        </span>
    );
}

export default function ImportWizard() {

    const { t, locale } = useLanguage();
    const { data: _session } = useSession();
    const { openLogin: _openLogin } = useAuthContext();
    const router = useRouter();
    const searchParams = useSearchParams();
    const toast = useShowToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

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
    const [error, setError] = useState<string | null>(null);
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
            step, inputContent, editableText, sourceUrl
        }));
    }, [step, inputContent, editableText, sourceUrl]);

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
    const [contactEntries, setContactEntries] = useState<ContactEntry[]>([]);
    const [processedImages, setProcessedImages] = useState<Array<{ data: string; mimeType: string; originalUrl?: string }>>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [unknownAnimal, setUnknownAnimal] = useState(false);
    const [_customSpecies, setCustomSpecies] = useState(false);

    // Save state
    const [isSaving, setIsSaving] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [duplicateAdopter, setDuplicateAdopter] = useState<any>(null);
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
            console.warn('[ImportWizard] Failed to load shared images from cache:', e);
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
        setUnknownAnimal(true);
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
            console.warn('[ImportWizard] Failed to load shared vCard from cache:', e);
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
            setError(t('import.vcard_parse_failed') || (locale === 'es'
                ? 'No se pudo cargar el contacto compartido. Probá nuevamente.'
                : 'Could not load the shared contact. Please try again.'));
            return;
        }
        if (isSharedVcard) {
            loadSharedVcard().then(loaded => {
                if (!loaded) {
                    setError(t('import.vcard_parse_failed') || (locale === 'es'
                        ? 'No se pudo cargar el contacto compartido. Probá nuevamente.'
                        : 'Could not load the shared contact. Please try again.'));
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
            setError(locale === 'es'
                ? 'Las imágenes compartidas no se pudieron cargar. Por favor, subilas manualmente.'
                : 'Shared images could not be loaded. Please upload them manually.');
        }

        if (sharedUrl) {
            // Share intent with URL: skip Step 1, auto-fetch
            setSharedFrom(sharedUrl);
            setLoading(true);
            setStep(2);
            handleFetchUrl(sharedUrl).catch(() => {
                // Fetch failed — fall back to Step 1 with pre-filled content
                setStep(1);
                setInputContent(sharedUrl);
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

    const handleFetchUrl = async (url?: string) => {
        const targetUrl = url || inputContent;
        if (!targetUrl.trim()) return;

        setLoading(true);
        setError(null);

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
                    setFetchedText(responseData.data.text || '');
                    setEditableText(responseData.data.text || '');
                    const imgs = responseData.data.images || [];
                    setFetchedImages(imgs);
                    setSelectedFetchedImages(new Set(imgs.map((_: string, i: number) => i)));

                    // Video post detection: inject thumbnail for OCR
                    if (responseData.isVideo || responseData.data.isVideo) {
                        setIsVideoPost(true);
                        if (responseData.data.videoThumbnailBase64) {
                            const dataUrl = responseData.data.videoThumbnailBase64 as string;
                            // Add thumbnail to fetchedImages (not manualImages) so it appears
                            // alongside other scraped images, not in the manual upload section
                            setFetchedImages(prev => {
                                const newIndex = prev.length;
                                setSelectedFetchedImages(sel => new Set([...sel, newIndex]));
                                return [...prev, dataUrl];
                            });
                        }
                    }
                } else if (responseData.extractionFailed) {
                    if (responseData.requiresManualInput) {
                        // Private group post or restricted content — skip to manual input
                        setSourceUrl(targetUrl);
                        setError(responseData.error || (locale === 'es'
                            ? 'No se pudo extraer contenido. Pegá el texto manualmente.'
                            : 'Could not extract content. Please paste text manually.'));
                        setStep(2);
                        return;
                    }
                    // Temporary extraction failure — start 30s retry countdown
                    setRetryCountdown(30);
                    throw new Error(
                        responseData.error || (locale === 'es'
                            ? 'No se pudo extraer contenido de esta publicación.'
                            : 'Could not extract content from this post.')
                    );
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
                    setEditableText(titlePrefix + (responseData.data.text || ''));
                    const imgs = responseData.data.images || [];
                    setFetchedImages(imgs);
                    setSelectedFetchedImages(new Set(imgs.map((_: string, i: number) => i)));
                    setFetchedVideos(responseData.data.videos || []);
                    if ((responseData.data.videos || []).length > 0) setIsVideoPost(true);
                    setSourceType(responseData.data.sourceType || 'web');
                }
            }

            setSourceUrl(targetUrl);
            setStep(2);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch content');
        } finally {
            setLoading(false);
        }
    };

    // Smart submit: auto-detect URL vs text
    const handleSmartSubmit = () => {
        const content = inputContent.trim();
        if (!content && manualImages.length === 0) return;

        // Auto-detect: if content looks like a URL, fetch it
        const urlPattern = /^https?:\/\/\S+$/i;
        if (urlPattern.test(content)) {
            handleFetchUrl(content);
        } else if (content) {
            // Plain text — go directly to content review
            setFetchedText(content);
            setEditableText(content);
            setStep(2);
        } else {
            // Images only — go to content review
            setStep(2);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        for (const file of Array.from(files)) {
            const isVideoFile = file.type.startsWith('video/');

            if (isVideoFile) {
                // Video: store File object only — don't read as base64
                // Videos will be uploaded via FormData after adopter creation
                if (file.size > 50 * 1024 * 1024) {
                    continue; // Skip oversized videos silently
                }
                // Generate thumbnail
                let thumbnail: string | undefined;
                try {
                    thumbnail = await extractVideoThumbnail(file);
                } catch (err) {
                    console.warn('Thumbnail extraction failed:', (err as Error).message);
                }
                setManualImages(prev => [...prev, {
                    data: '',
                    mimeType: file.type,
                    preview: thumbnail || '', // Use thumbnail as preview
                    file,
                    thumbnail,
                }]);
            } else {
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
        // Reset input so same file can be re-selected
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        setManualImages(prev => prev.filter((_, i) => i !== index));
    };

    // AI Extraction — text + images sent together; hardened prompt prevents hallucination
    const handleExtract = async () => {
        setLoading(true);
        setError(null);

        try {
            const imagesToSend: Array<{ data: string; mimeType: string }> = [];
            for (const img of manualImages) {
                imagesToSend.push({ data: img.data, mimeType: img.mimeType });
            }

            const imageUrls = fetchedImages.filter((_, i) => selectedFetchedImages.has(i));

            const response = await fetch('/api/ai/extract-from-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: editableText || undefined,
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

            // Preserve original post text untouched, append any AI-extracted notes after
            if (editableText?.trim()) {
                const aiNotes = aiData.notes?.trim();
                aiData.notes = editableText + (aiNotes ? '\n\n---\n' + aiNotes : '');
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
            setUnknownAnimal(!aiData.animalName);
            if (result.processedImages) {
                setProcessedImages(result.processedImages);
            }
            setStep(3);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to extract data');
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
    const handlePreSave = async () => {
        setIsSaving(true);
        setDuplicateAdopter(null);
        setPersonMatches([]);
        setSelectedMatch(null);
        setDuplicateCheckFailed(false);

        // Check for URL duplicate
        if (sourceUrl) {
            try {
                const res = await fetch(`/api/adopters?sourceUrl=${encodeURIComponent(sourceUrl)}`);
                const data = await res.json() as { matches: any[]; matchType?: string };
                if (data.matches && data.matches.length > 0) {
                    setDuplicateAdopter(data.matches[0]);
                    setIsSaving(false);
                    setShowConfirmModal(true);
                    return;
                }
            } catch (e) {
                console.warn('[ImportWizard] URL duplicate check failed', e);
                setDuplicateCheckFailed(true);
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
                        matchTypes: r.matchTypes,
                    }));
                    setPersonMatches(matches);
                    setSelectedMatch(matches[0]);
                }
            } catch (e) {
                console.error('[ImportWizard] Token match check failed', e);
                setDuplicateCheckFailed(true);
            }
        }

        setIsSaving(false);
        setShowConfirmModal(true);
    };

    // Save new adopter
    const handleConfirmSave = async () => {
        if (!extractedData) return;
        setIsSaving(true);

        try {
            const flags = [`import_${extractedData.confidence}`];

            // Generate thumbnails for fetched videos (via proxy for CORS)
            const videoPayloads = await Promise.all(
                fetchedVideos.map(async (videoUrl) => {
                    let thumbnail: string | undefined;
                    try {
                        thumbnail = await extractVideoThumbnailFromUrl(`/api/proxy-image?url=${encodeURIComponent(videoUrl)}`);
                    } catch (e) {
                        console.warn('[ImportWizard] Fetched video thumbnail failed:', (e as Error).message);
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
                flags,
                images: [
                    ...(processedImages.length > 0 ? processedImages : manualImages.filter(img => !img.file).map(img => ({ data: img.data, mimeType: img.mimeType }))),
                    ...videoPayloads,
                ],
                adoption: {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || ''),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'observation',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0],
                },
            };

            const response = await fetch('/api/adopters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json() as { id: string; error?: string };

            if (!response.ok) {
                throw new Error(result.error || 'Failed to create adopter');
            }

            const adopterId = result.id;

            // Upload any pending video files via FormData (they were excluded from JSON body)
            const pendingVideoFiles = manualImages.filter(img => img.file);
            for (const vid of pendingVideoFiles) {
                if (!vid.file) continue;
                const fd = new FormData();
                fd.append('file', vid.file);
                fd.append('adopterId', adopterId);
                fd.append('caption', 'Imported video');
                fd.append('mediaType', 'video');
                if (vid.thumbnail) fd.append('thumbnail', vid.thumbnail);
                await fetch('/api/upload-media', { method: 'POST', body: fd });
            }

            const successMessage = extractedData.adoptionDetected && extractedData.adoptionConfidence !== 'low'
                ? 'Profile + adoption record created'
                : (extractedData.name || 'New Profile');

            toast.success('¡Adoptante Creado!', successMessage, {
                label: '→ Ver Perfil',
                href: `/adopter/${adopterId}`,
            });

            // Track import event in Amplitude via Zaraz
            zarazTrack('import_completed', {
                source: sourceUrl ? 'url' : 'text',
                hasImages: (processedImages.length + manualImages.length) > 0 ? 1 : 0,
                confidence: extractedData.confidence || 'unknown',
            });

            router.push('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
            setShowConfirmModal(false);
        } finally {
            setIsSaving(false);
        }
    };

    // Merge into existing profile
    const handleMerge = async (target?: { id: string; name: string }) => {
        const mergeTarget = target || selectedMatch;
        if (!extractedData || !mergeTarget) return;
        setIsSaving(true);

        try {

            // Generate thumbnails for fetched videos (via proxy for CORS)
            const videoPayloads = await Promise.all(
                fetchedVideos.map(async (videoUrl) => {
                    let thumbnail: string | undefined;
                    try {
                        thumbnail = await extractVideoThumbnailFromUrl(`/api/proxy-image?url=${encodeURIComponent(videoUrl)}`);
                    } catch (e) {
                        console.warn('[ImportWizard] Fetched video thumbnail failed:', (e as Error).message);
                    }
                    return { data: '', mimeType: 'video/mp4', originalUrl: videoUrl, thumbnail };
                })
            );

            const payload = {
                sourceUrl,
                notes: extractedData.notes,
                contactInfo: contactEntriesToBlob(contactEntries) || undefined,
                adoption: {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || 'Unknown'),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'observation',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0],
                },
                images: [
                    ...(processedImages.length > 0 ? processedImages : manualImages.filter(img => !img.file).map(img => ({ data: img.data, mimeType: img.mimeType }))),
                    ...videoPayloads,
                ],
            };

            const response = await fetch(`/api/adopters/${mergeTarget.id}/add-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json() as { adoptionId?: string; adopterId?: string; adopterName?: string; error?: string };

            if (!response.ok) {
                throw new Error(result.error || 'Failed to add record');
            }

            const adopterId = result.adopterId || mergeTarget.id;
            const adopterName = result.adopterName || mergeTarget.name;

            // Upload any pending video files via FormData (they were excluded from JSON body)
            const pendingVideoFiles = manualImages.filter(img => img.file);
            for (const vid of pendingVideoFiles) {
                if (!vid.file) continue;
                const fd = new FormData();
                fd.append('file', vid.file);
                fd.append('adopterId', adopterId);
                fd.append('caption', 'Imported video');
                fd.append('mediaType', 'video');
                if (vid.thumbnail) fd.append('thumbnail', vid.thumbnail);
                await fetch('/api/upload-media', { method: 'POST', body: fd });
            }

            toast.success(t('import.record_added_to_profile') || 'Registro agregado al perfil', adopterName, {
                label: t('import.go_to_profile_link') || '→ Ver perfil',
                href: `/adopter/${adopterId}`,
            });

            // Track merge event in Amplitude via Zaraz
            zarazTrack('import_merged', {
                hasImages: (processedImages.length + manualImages.length) > 0 ? 1 : 0,
            });

            router.push('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add record');
            setShowConfirmModal(false);
        } finally {
            setIsSaving(false);
        }
    };

    // --- RENDER ---

    const stepLabels = [t('import.stepInput') || 'Input', t('import.stepContent') || 'Content', t('import.stepReview') || 'Review'];

    return (
        <div className="max-w-2xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={() => router.back()}
                    className="text-sm text-stone-500 hover:text-stone-700 mb-2 flex items-center gap-1"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    {t('import.back') || 'Back'}
                </button>
                <h1 className="text-2xl font-semibold text-stone-900">{t('import.title') || 'Import Content'}</h1>
                <p className="text-stone-500 text-sm mt-1">
                    {t('import.subtitle') || 'Extract adopter information from links, text, or images using AI'}
                </p>
            </div>

            {/* Step Indicator */}
            {!showConfirmModal && (
                <div className="flex items-center justify-center gap-4 py-4 mb-6 bg-white rounded-xl border border-stone-200">
                    {stepLabels.map((label, i) => (
                        <div key={i} className="flex items-center gap-2">
                            {i > 0 && <div className="w-8 h-px bg-stone-200" />}
                            <div className={`flex items-center gap-2 ${step >= i + 1 ? 'text-blue-600' : 'text-stone-500'}`}>
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold ${step >= i + 1 ? 'bg-blue-100' : 'bg-stone-100'}`}>
                                    {i + 1}
                                </span>
                                <span className="text-sm font-medium hidden sm:block">{label}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm">
                    <div className="flex items-start gap-3">
                        <span className="text-red-500 text-lg flex-shrink-0">⚠️</span>
                        <div className="flex-1">
                            <p className="text-red-700 font-medium">{error}</p>
                            {retryCountdown > 0 && (
                                <p className="text-red-500 mt-1">
                                    {locale === 'es'
                                        ? `Podés reintentar en ${retryCountdown}s`
                                        : `You can retry in ${retryCountdown}s`}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {retryCountdown > 0 ? (
                                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-red-100 text-red-400 font-semibold text-sm tabular-nums">
                                    {retryCountdown}
                                </span>
                            ) : retryCountdown === 0 && error && inputContent.trim() ? (
                                <button
                                    onClick={() => {
                                        setError(null);
                                        handleSmartSubmit();
                                    }}
                                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
                                >
                                    {locale === 'es' ? 'Reintentar' : 'Retry'}
                                </button>
                            ) : null}
                            <button onClick={() => { setError(null); setRetryCountdown(0); }} className="text-red-400 hover:text-red-600">
                                ✕
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
                        <label className="block text-sm font-medium text-stone-700 mb-2">
                            {t('import.smartLabel') || 'Paste a link or text about an adopter'}
                        </label>
                        <textarea
                            value={inputContent}
                            onChange={e => setInputContent(e.target.value)}
                            placeholder={t('import.smartPlaceholder') || 'Paste a URL, Instagram post, WhatsApp message, or any text with adopter info...'}
                            className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm min-h-[120px] resize-y"
                            autoFocus
                        />
                        <p className="text-xs text-stone-500 mt-1">
                            {t('import.smartHint') || 'Links are fetched automatically. Text is sent directly to AI extraction.'}
                        </p>
                    </div>

                    {/* Photo upload - always visible */}
                    <div>
                        <label className="block text-sm font-medium text-stone-700 mb-2">
                            {t('import.photoUploadLabel') || '📎 Add photos (optional)'}
                        </label>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-stone-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                        >
                            <svg className="w-8 h-8 mx-auto text-stone-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-sm text-stone-500">{t('import.imageDropzone') || 'Click to upload images'}</p>
                            <p className="text-xs text-stone-500 mt-0.5">{t('import.imageHint') || 'Screenshots of posts, chat messages, etc.'}</p>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={handleImageUpload}
                            className="hidden"
                        />

                        {/* Image previews */}
                        {manualImages.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mt-3">
                                {manualImages.map((img, i) => (
                                    <div key={i} className="relative group">
                                        {img.file ? (
                                            <div className="w-full h-20 rounded-lg bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center">
                                                <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center">
                                                    <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                </div>
                                            </div>
                                        ) : (
                                            <img src={img.preview} alt="" className="w-full h-20 object-cover rounded-lg" />
                                        )}
                                        <button
                                            onClick={() => removeImage(i)}
                                            className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Submit button */}
                    <button
                        onClick={handleSmartSubmit}
                        disabled={(!inputContent.trim() && manualImages.length === 0) || loading}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                {t('import.fetching') || 'Fetching content...'} {fetchProgress > 0 && <span className="tabular-nums">{fetchProgress}%</span>}
                            </>
                        ) : (
                            <>
                                {t('import.continueBtn') || 'Continue'} →
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* === STEP 2: Content Review + Extract === */}
            {step === 2 && !showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                    {/* Shared from badge */}
                    {sharedFrom && sharedFrom !== 'shared' && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                            <span>📤</span>
                            <span className="font-medium">{t('import.sharedFrom') || 'Shared from'}:</span>
                            <span className="truncate text-blue-600">{(() => { try { return new URL(sharedFrom).hostname; } catch { return sharedFrom; } })()}</span>
                        </div>
                    )}

                    {/* Loading state for share intent auto-fetch */}
                    {loading && !editableText && (
                        <div className="flex flex-col items-center gap-3 py-8 text-stone-500">
                            <span className="animate-spin text-2xl">⏳</span>
                            <p className="text-sm">
                                {t('import.fetchingShared') || 'Fetching shared content...'} {fetchProgress > 0 && <span className="tabular-nums font-medium">{fetchProgress}%</span>}
                            </p>
                            {/* Progress bar */}
                            <div className="w-48 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${fetchProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <h3 className="text-lg font-semibold text-stone-900">{t('import.reviewTitle') || 'Review Content'}</h3>

                    {/* Video post warning */}
                    {isVideoPost && (
                        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                            <span className="text-lg flex-shrink-0">📹</span>
                            <div>
                                <p className="font-medium">{locale === 'es' ? 'Este enlace contiene un video' : 'This link contains a video'}</p>
                                <p className="mt-0.5 text-amber-700">
                                    {locale === 'es'
                                        ? 'La información puede estar en el video. Adjuntá capturas de pantalla del video para que las analicemos mejor.'
                                        : 'The information may be in the video. Attach screenshots from the video for better extraction.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Editable text */}
                    <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">
                            {t('import.extractedText') || 'Extracted Text'} {sourceUrl && <span className="text-stone-500">(from {new URL(sourceUrl).hostname})</span>}
                        </label>
                        <textarea
                            value={editableText}
                            onChange={e => setEditableText(e.target.value)}
                            className="w-full px-4 py-3 border border-stone-300 rounded-xl text-sm min-h-[150px] resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Fetched images */}
                    {fetchedImages.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-stone-600">
                                    {selectedFetchedImages.size} {t('import.imagesOf') || 'of'} {fetchedImages.length} {fetchedImages.length !== 1 ? (t('import.imagesFoundPlural') || 'images') : (t('import.imagesFound') || 'image')} {t('import.imagesSelected') || 'selected'}
                                </label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (selectedFetchedImages.size === fetchedImages.length) {
                                            setSelectedFetchedImages(new Set());
                                        } else {
                                            setSelectedFetchedImages(new Set(fetchedImages.map((_, i) => i)));
                                        }
                                    }}
                                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                                >
                                    {selectedFetchedImages.size === fetchedImages.length ? (t('import.deselectAll') || 'Deselect All') : (t('import.selectAll') || 'Select All')}
                                </button>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                                {fetchedImages.slice(0, 12).map((url, i) => {
                                    const isSelected = selectedFetchedImages.has(i);
                                    return (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                                setSelectedFetchedImages(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(i)) next.delete(i);
                                                    else next.add(i);
                                                    return next;
                                                });
                                            }}
                                            className={`relative group rounded-lg overflow-hidden border-2 transition-all ${isSelected
                                                ? 'border-blue-500 shadow-sm'
                                                : 'border-transparent opacity-50 hover:opacity-75'
                                                }`}
                                        >
                                            <img
                                                src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
                                                alt=""
                                                className="w-full h-20 object-cover bg-stone-100"
                                            />
                                            {/* Checkmark overlay */}
                                            <div className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs transition-all ${isSelected
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-white/80 text-stone-500 border border-stone-300'
                                                }`}>
                                                {isSelected ? '✓' : ''}
                                            </div>
                                            {/* Expand button */}
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setLightboxItem({ url: `/api/proxy-image?url=${encodeURIComponent(url)}`, mediaType: 'image' });
                                                }}
                                                className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-xs md:opacity-0 md:group-hover:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer"
                                                title={t('nav.expand_image')}
                                            >
                                                ⤢
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Fetched videos */}
                    {fetchedVideos.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-stone-600 mb-2">
                                🎬 {fetchedVideos.length} {fetchedVideos.length !== 1 ? 'videos' : 'video'} {locale === 'es' ? 'encontrados' : 'found'}
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                {fetchedVideos.map((url, i) => (
                                    <div
                                        key={i}
                                        className="relative rounded-xl overflow-hidden border-2 border-teal-300 aspect-video cursor-pointer group bg-gradient-to-br from-teal-600 to-teal-800"
                                        onClick={() => setLightboxItem({ url, mediaType: 'video' })}
                                    >
                                        {/* Video placeholder — actual playback happens in lightbox */}
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                                <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                            <span className="text-white/80 text-xs mt-2 font-medium">Video {i + 1}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Manual image upload */}
                    <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">
                            {t('import.addMoreImages') || 'Add more images (optional)'}
                        </label>
                        <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={handleImageUpload}
                            className="text-sm"
                        />
                        {manualImages.length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mt-2">
                                {manualImages.map((img, i) => (
                                    <div key={i} className="relative group">
                                        <img src={img.preview} alt="" className="w-full h-20 object-cover rounded-lg" />
                                        <button
                                            onClick={() => removeImage(i)}
                                            className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setStep(1)}
                            className="px-4 py-2.5 border border-stone-300 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50"
                        >
                            ← {t('import.back') || 'Back'}
                        </button>
                        <button
                            onClick={handleExtract}
                            disabled={loading || (!editableText.trim() && manualImages.length === 0 && selectedFetchedImages.size === 0)}
                            className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <span className="animate-spin">⏳</span>
                                    {t('import.aiAnalyzing') || 'AI is analyzing...'}
                                </>
                            ) : (
                                <>
                                    {t('import.extractWithAi') || '🤖 Extract with AI'}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* === STEP 3: Review Extracted Data === */}
            {step === 3 && !showConfirmModal && extractedData && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-stone-900">{t('import.reviewExtracted') || 'Review Extracted Data'}</h3>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${extractedData.confidence === 'high' ? 'bg-green-100 text-green-700' :
                            extractedData.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                            }`}>
                            {extractedData.confidence} {t('import.confidence') || 'confidence'}
                        </span>
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

                    {/* Validation warning — only when AI extraction ran. The
                        contact-import path has no AI in the loop, so the
                        warning would be inaccurate. */}
                    {!fromContacts && (
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                            <span className="mt-0.5">⚠️</span>
                            <span>{t('import.aiValidationWarning') || 'AI-extracted data may contain errors. Please verify all fields before saving.'}</span>
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.name') || 'Name'}</label>
                        <input
                            value={extractedData.name || ''}
                            onChange={e => setExtractedData({ ...extractedData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Contact Info — typed entries, AI-categorized and editable */}
                    <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.contactInfo') || 'Contact Info'}</label>
                        <ContactEntriesInput entries={contactEntries} onChange={setContactEntries} />
                        {/* Field-overlap preview (v2.16.0-43 — Option B).
                            Step 3 previously surfaced every duplicate as its
                            own chip with type-list labels and a percentage,
                            duplicating the dedup decision UI on Step 4. Now
                            it shows a single count line — the user knows
                            something will surface at save-time, the decision
                            still happens on Step 4. We only count hits above
                            the 15% noise floor (same threshold the old
                            "visible" bucket used). */}
                        {(() => {
                            const visibleCount = fieldOverlapHints.filter(h => h.relevancePercent >= 15).length;
                            if (visibleCount === 0) return null;
                            const template = visibleCount === 1
                                ? t('import.duplicates_found_count_one')
                                : t('import.duplicates_found_count_other').replace('{count}', String(visibleCount));
                            return (
                                <p className="mt-1.5 text-xs text-amber-700 flex items-start gap-1.5">
                                    <svg className="w-3.5 h-3.5 flex-shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span>{template}</span>
                                </p>
                            );
                        })()}
                    </div>

                    {/* Initial observation — saved as a separate observation record on import */}
                    <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.initial_observation') || 'Initial observation'}</label>
                        <textarea
                            value={extractedData.notes || ''}
                            onChange={e => setExtractedData({ ...extractedData, notes: e.target.value })}
                            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm min-h-[80px] resize-y focus:ring-2 focus:ring-blue-500"
                            placeholder={t('import.initial_observation_placeholder') || 'Saved as an observation record on the new profile.'}
                        />
                    </div>

                    {/* Adoption / Record Detection */}
                    {extractedData.adoptionDetected && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                                <span>🐾</span>
                                {t('import.adoptionDetected') || '🐾 Adoption Detected'}
                                <span className={`px-2 py-0.5 rounded-full text-xs ${extractedData.adoptionConfidence === 'high' ? 'bg-green-200' :
                                    extractedData.adoptionConfidence === 'medium' ? 'bg-yellow-200' :
                                        'bg-stone-200'
                                    }`}>
                                    {extractedData.adoptionConfidence}
                                </span>
                            </div>

                            {/* Record Type Pills */}
                            <div>
                                <label className="block text-xs font-medium text-green-700 mb-1.5">
                                    {t('import.recordType') || 'Record Type'}
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {[
                                        { value: 'adoption', icon: '🏠', label: t('import.typeAdoption') || 'Adoption' },
                                        { value: 'adoption_request', icon: '📝', label: t('import.typeRequest') || 'Request' },
                                        { value: 'returned_pet', icon: '↩️', label: t('import.typeReturned') || 'Returned' },
                                        { value: 'follow_up', icon: '📞', label: t('import.typeFollowUp') || 'Follow-up' },
                                        { value: 'observation', icon: '👁️', label: t('import.typeObservation') || 'Note' }
                                    ].map(type => {
                                        const isSelected = (extractedData.recordType || 'adoption') === type.value;
                                        return (
                                            <button
                                                key={type.value}
                                                type="button"
                                                onClick={() => setExtractedData({ ...extractedData, recordType: type.value as any })}
                                                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${isSelected
                                                    ? 'bg-green-200 border-green-400 text-green-800'
                                                    : 'bg-white border-green-200 text-green-600 hover:border-green-300'
                                                    }`}
                                            >
                                                <span>{type.icon}</span>
                                                <span>{type.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.animalName') || 'Animal Name'}</label>
                                    <input
                                        value={unknownAnimal ? '' : (extractedData.animalName || '')}
                                        onChange={e => setExtractedData({ ...extractedData, animalName: e.target.value })}
                                        disabled={unknownAnimal}
                                        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm disabled:bg-stone-50"
                                    />
                                    <label className="flex items-center gap-1 mt-1 text-xs text-stone-500">
                                        <input type="checkbox" checked={unknownAnimal} onChange={e => setUnknownAnimal(e.target.checked)} />
                                        {t('import.unknownName') || 'Unknown name'}
                                    </label>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.species') || 'Species'}</label>
                                    <select
                                        value={extractedData.animalSpecies || ''}
                                        onChange={e => setExtractedData({ ...extractedData, animalSpecies: e.target.value as any })}
                                        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
                                    >
                                        <option value="dog">{t('import.speciesDog') || '🐕 Dog'}</option>
                                        <option value="cat">{t('import.speciesCat') || '🐱 Cat'}</option>
                                        <option value="bird">{t('import.speciesBird') || '🐦 Bird'}</option>
                                        <option value="other">{t('import.speciesOther') || 'Other'}</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.rating') || 'Rating'}</label>
                                <StarRating
                                    value={extractedData.adoptionRating || 2}
                                    onChange={(r: number) => setExtractedData({ ...extractedData, adoptionRating: r })}
                                    size="md"
                                    showLabel
                                />
                            </div>

                            {/* Adoption Date */}
                            <div>
                                <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.adoptionDate') || 'Date'}</label>
                                <input
                                    type="date"
                                    value={extractedData.adoptionDate || new Date().toISOString().split('T')[0]}
                                    onChange={e => setExtractedData({ ...extractedData, adoptionDate: e.target.value })}
                                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                />
                            </div>

                            <p className="text-xs text-green-600">
                                {t('import.adoptionNote') || 'A record will be created automatically.'}
                            </p>
                        </div>
                    )}

                    {/* Media preview — show all images and videos that will be saved */}
                    {(() => {
                        const allImages: { src: string; label?: string }[] = [];
                        // Processed images from fetch (base64)
                        processedImages.forEach((img, _i) => allImages.push({ src: `data:${img.mimeType};base64,${img.data}`, label: img.originalUrl ? new URL(img.originalUrl).pathname.split('/').pop() : undefined }));
                        // Manually uploaded images (not video files)
                        manualImages.filter(img => !img.file).forEach((img) => allImages.push({ src: img.preview }));
                        // Count manual videos separately
                        const manualVideoCount = manualImages.filter(img => img.file).length;
                        const totalMedia = allImages.length + fetchedVideos.length + manualVideoCount;
                        if (totalMedia === 0) return null;
                        return (
                            <div>
                                <label className="block text-xs font-medium text-stone-500 mb-1.5">
                                    {t('import.attachedImages') || 'Attached Media'} ({totalMedia})
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {allImages.map((img, i) => (
                                        <div key={`img-${i}`} className="relative group">
                                            <img
                                                src={img.src}
                                                alt={img.label || `Image ${i + 1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-stone-200 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                                                onClick={() => setLightboxItem({ url: img.src, mediaType: 'image' })}
                                            />
                                        </div>
                                    ))}
                                    {fetchedVideos.map((url: string, i: number) => (
                                        <div key={`vid-${i}`} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-teal-300 bg-gradient-to-br from-teal-600 to-teal-800 cursor-pointer"
                                            onClick={() => setLightboxItem({ url, mediaType: 'video' })}
                                        >
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <div className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center shadow">
                                                    <svg className="w-3 h-3 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    <LegalConsent />

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => setStep(2)}
                            className="px-4 py-2.5 border border-stone-300 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50"
                        >
                            ← {t('import.back') || 'Back'}
                        </button>
                        <button
                            onClick={handlePreSave}
                            disabled={!extractedData.name?.trim() || isSaving}
                            className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            {isSaving ? (
                                <><span className="animate-spin">⏳</span> {t('import.checking') || 'Checking...'}</>
                            ) : (
                                <>{t('import.saveAdopter') || '💾 Save Adopter'}</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* === Confirm Modal === */}
            {showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-6">
                    <div className="flex flex-col items-center text-center">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${duplicateAdopter ? 'bg-yellow-100 text-yellow-600' :
                            personMatches.length > 0 ? 'bg-purple-100 text-purple-600' :
                                'bg-blue-100 text-blue-600'
                            }`}>
                            {personMatches.length > 0 && !duplicateAdopter ? (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            ) : (
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                            )}
                        </div>

                        <h3 className="text-xl font-semibold text-stone-900 mb-2">
                            {duplicateAdopter
                                ? (t('import.duplicateWarning') || '⚠️ Duplicate Post Detected')
                                : personMatches.length > 0
                                    ? (t('import.personMatchTitle') || 'Existing Profiles Found')
                                    : (t('import.confirmCreate') || 'Create New Profile?')}
                        </h3>

                        <p className="text-stone-600 mb-4">
                            {duplicateAdopter
                                ? <>{t('import.duplicateUrl') || 'This URL was already imported. Existing profile:'} <a href={`/adopter/${duplicateAdopter.id}`} target="_blank" className="underline font-medium text-blue-600">{duplicateAdopter.name}</a></>
                                : personMatches.length > 0
                                    ? (t('import.personMatchDesc') || 'Select a profile to add this record to, or create a new one')
                                    : <>{t('import.aboutToCreate') || 'You are about to create a new profile for'} <strong className="text-stone-900">{extractedData?.name || (t('import.unknownName') || 'Unknown')}</strong>.</>
                            }
                        </p>

                        {/* Warning when duplicate check failed */}
                        {duplicateCheckFailed && !duplicateAdopter && personMatches.length === 0 && (
                            <div className="w-full px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 text-left flex items-start gap-2 mb-2">
                                <span className="mt-0.5">⚠️</span>
                                <span>{t('import.duplicateCheckFailed') || 'Could not verify if this person already exists. Please check manually before saving.'}</span>
                            </div>
                        )}

                        {/* Person Match Cards — selectable list */}
                        {personMatches.length > 0 && !duplicateAdopter && (
                            <div className="w-full space-y-2 mb-2">
                                {personMatches.map((match) => {
                                    const isSelected = selectedMatch?.id === match.id;
                                    return (
                                        <button
                                            key={match.id}
                                            type="button"
                                            onClick={() => setSelectedMatch(isSelected ? null : match)}
                                            className={`w-full text-left rounded-xl p-4 border-2 transition-all ${isSelected
                                                ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-200'
                                                : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-purple-500 bg-purple-500' : 'border-stone-300'
                                                        }`}>
                                                        {isSelected && <span className="text-white text-xs">✓</span>}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-semibold text-stone-900 line-clamp-2 break-words" title={match.name}>{match.name}</p>
                                                        {/* Natural-sentence dedup reason (v2.16.0-43). Replaced
                                                            the chip list of raw token-type labels with one line
                                                            that names what's shared in user-language. */}
                                                        <p className="text-xs text-stone-600 mt-1">
                                                            {humanMatchSentence(match.matchTypes || [], t)}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <MatchBandPill band={match.confidence} t={t} />
                                                    <a
                                                        href={`/adopter/${match.id}`}
                                                        target="_blank"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-blue-500 hover:text-blue-700 text-xs underline"
                                                    >{t('import.viewProfile') || 'View'}</a>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2">
                        {duplicateAdopter ? (
                            <>
                                <button
                                    onClick={() => {
                                        handleMerge({ id: duplicateAdopter.id, name: duplicateAdopter.name });
                                    }}
                                    disabled={isSaving}
                                    className="py-2.5 px-4 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isSaving ? <><span className="animate-spin">⏳</span> {t('import.addingRecord') || 'Adding...'}</> : <>{t('import.addInteraction') || '➕ Add New Interaction to This Profile'}</>}
                                </button>
                                <a
                                    href={`/adopter/${duplicateAdopter.id}`}
                                    className="py-2.5 px-4 bg-blue-600 text-white rounded-xl font-medium text-center hover:bg-blue-700"
                                >
                                    {t('import.viewExisting') || '→ View Existing Profile'}
                                </a>
                                <button
                                    onClick={() => { setDuplicateAdopter(null); setShowConfirmModal(false); }}
                                    className="py-2.5 px-4 border border-stone-300 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50"
                                >
                                    {t('import.backToReview') || '← Back to Review'}
                                </button>
                            </>
                        ) : personMatches.length > 0 ? (
                            <>
                                <button
                                    onClick={() => handleMerge()}
                                    disabled={isSaving || !selectedMatch}
                                    className="py-2.5 px-4 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isSaving ? <><span className="animate-spin">⏳</span> {t('import.addingRecord') || 'Adding record...'}</> : <>{t('import.addToExisting') || 'Add Record to Selected Profile'}</>}
                                </button>
                                <button
                                    onClick={handleConfirmSave}
                                    disabled={isSaving}
                                    className="py-2.5 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {t('import.createNewAnyway') || 'Create New Profile Instead'}
                                </button>
                                <button
                                    onClick={() => { setPersonMatches([]); setSelectedMatch(null); setShowConfirmModal(false); }}
                                    className="py-2.5 px-4 border border-stone-300 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50"
                                >
                                    {t('import.backToReview') || '← Back to Review'}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={handleConfirmSave}
                                    disabled={isSaving}
                                    className="py-2.5 px-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isSaving ? <><span className="animate-spin">⏳</span> {t('import.creating') || 'Creating...'}</> : <>{t('import.createProfile') || '✓ Create Profile'}</>}
                                </button>
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="py-2.5 px-4 border border-stone-300 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-50"
                                >
                                    {t('import.backToReview') || '← Back to Review'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Image/Video Lightbox */}
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
        </div>
    );
}

