'use client';

import { useState, useRef, useEffect } from 'react';
import { StarRating } from '@/components/StarRating';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import type { ExtractedAdopterData } from '@/lib/gemini';

interface FacebookImportWizardProps {
    onClose?: () => void;
}

interface FetchedPostData {
    text: string;
    author?: string;
    images: string[];
}

export default function FacebookImportWizard({ onClose }: FacebookImportWizardProps) {
    const { t, locale } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState(1); // 1=URL, 2=Review fetched, 3=AI results
    const [loading, setLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState(''); // Status message during loading
    const [error, setError] = useState<string | null>(null);
    const [models, setModels] = useState<Array<{ name: string; displayName: string }>>([]);
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro');

    // Step 1: URL input
    const [postUrl, setPostUrl] = useState('');
    const [fetchSource, setFetchSource] = useState<'playwright' | 'fallback' | null>(null);
    const [scraperUnavailable, setScraperUnavailable] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const fetchAbortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [customSpecies, setCustomSpecies] = useState(false);
    const [unknownAnimal, setUnknownAnimal] = useState(true); // Default to unknown

    // Step 2: Fetched content (editable before AI extraction)
    const [fetchedData, setFetchedData] = useState<FetchedPostData | null>(null);
    const [editableText, setEditableText] = useState('');
    const [manualImages, setManualImages] = useState<Array<{ data: string; mimeType: string; preview: string }>>([]);

    // Step 3: AI extracted data
    const [extractedData, setExtractedData] = useState<ExtractedAdopterData | null>(null);
    const [processedImages, setProcessedImages] = useState<Array<{ data: string; mimeType: string; originalUrl?: string }>>([]);

    // Save state
    const toast = useShowToast();
    const [isSaving, setIsSaving] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [duplicateAdopter, setDuplicateAdopter] = useState<{ id: string; name: string } | null>(null);

    // Person match state (different post, same person)
    interface PersonMatch {
        id: string;
        name: string;
        contactInfo?: string | null;
        sourceUrl?: string | null;
        thumbnail?: string | null;
        confidence: 'high' | 'medium' | 'low';
        matchReasons: string[];
    }
    const [personMatch, setPersonMatch] = useState<PersonMatch | null>(null);

    const resetWizardState = () => {
        // Clean up in-flight requests
        if (fetchAbortRef.current) { fetchAbortRef.current.abort(); fetchAbortRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setStep(1);
        setLoading(false);
        setLoadingStatus('');
        setElapsedSeconds(0);
        setError(null);
        setPostUrl('');
        setFetchSource(null);
        setScraperUnavailable(false);
        setCustomSpecies(false);
        setUnknownAnimal(true);
        setFetchedData(null);
        setEditableText('');
        setManualImages([]);
        setExtractedData(null);
        setProcessedImages([]);
        setIsSaving(false);
        setShowConfirmModal(false);
        setDuplicateAdopter(null);
        setPersonMatch(null);
    };

    const handleOpen = () => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }
        resetWizardState();
        setIsOpen(true);
    };

    useEffect(() => {
        if (isOpen && models.length === 0) {
            fetch('/api/ai/models')
                .then(res => res.json())
                .then((data: any) => {
                    if (data.models && Array.isArray(data.models)) {
                        setModels(data.models);
                        // Check if selected model is in the list
                        const exactMatch = data.models.find((m: any) => m.name === selectedModel);
                        if (!exactMatch) {
                            // Prefer exact gemini-2.5-pro, then any pro, then first
                            const preferred = data.models.find((m: any) => m.name === 'gemini-2.5-pro')
                                || data.models.find((m: any) => m.name.includes('-pro'))
                                || data.models[0];
                            setSelectedModel(preferred?.name || 'gemini-2.5-pro');
                        }
                    }
                })
                .catch(err => console.error('Failed to fetch models:', err));
        }
    }, [isOpen]);

    const handleClose = () => {
        setIsOpen(false);
        resetWizardState();
        onClose?.();
    };

    // Phased status messages based on elapsed time
    const getProgressMessage = (seconds: number, isFallback: boolean): string => {
        if (isFallback) return t('facebook.progressBasic') || 'Using basic extraction...';
        if (seconds < 5) return t('facebook.progressConnecting') || 'Connecting to scraper...';
        if (seconds < 15) return t('facebook.progressLoading') || 'Loading Facebook page...';
        if (seconds < 30) return t('facebook.progressExtracting') || 'Extracting images and text...';
        if (seconds < 60) return t('facebook.progressSlow') || 'Still working — Facebook pages can be slow...';
        if (seconds < 90) return t('facebook.progressAlmost') || 'Almost there, hang tight...';
        return t('facebook.progressLong') || 'Taking longer than usual...';
    };

    const stopTimer = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };

    // Cancel in-flight scraper request and switch to fallback
    const handleCancelScraper = () => {
        if (fetchAbortRef.current) { fetchAbortRef.current.abort(); fetchAbortRef.current = null; }
        stopTimer();
        setLoading(false);
        setElapsedSeconds(0);
        setScraperUnavailable(true);
    };

    // Step 1: Fetch post from URL
    const handleFetchPost = async (options?: { useFallback?: boolean }) => {
        setLoading(true);
        setElapsedSeconds(0);
        setError(null);
        setFetchSource(null);
        setScraperUnavailable(false);

        // Start elapsed timer
        const isFallback = !!options?.useFallback;
        setLoadingStatus(getProgressMessage(0, isFallback));
        stopTimer();
        const startTime = Date.now();
        timerRef.current = setInterval(() => {
            const secs = Math.floor((Date.now() - startTime) / 1000);
            setElapsedSeconds(secs);
            setLoadingStatus(getProgressMessage(secs, isFallback));
        }, 1000);

        // Create abort controller for user-initiated cancellation
        const abortController = new AbortController();
        fetchAbortRef.current = abortController;

        try {
            const response = await fetch('/api/facebook/fetch-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: postUrl, useFallback: options?.useFallback }),
                signal: abortController.signal,
            });

            const result = await response.json() as {
                success?: boolean;
                data?: FetchedPostData;
                error?: string;
                requiresManualInput?: boolean;
                source?: 'playwright' | 'fallback';
                scraperUnavailable?: boolean;
                reason?: string;
            };

            // Handle scraper unavailable — prompt user
            if (result.scraperUnavailable) {
                setScraperUnavailable(true);
                setLoading(false);
                setLoadingStatus('');
                return;
            }

            if (!response.ok || !result.success) {
                if (result.requiresManualInput) {
                    setError('Could not fetch post automatically. You can enter the content manually below.');
                    setFetchedData({ text: '', images: [] });
                    setStep(2);
                } else {
                    throw new Error(result.error || 'Failed to fetch post');
                }
                return;
            }

            setFetchedData(result.data || null);
            setEditableText(result.data?.text || '');
            setFetchSource(result.source || 'fallback');
            setStep(2);
        } catch (err) {
            // Ignore abort errors (user clicked "Use Basic Method")
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Failed to fetch post');
        } finally {
            stopTimer();
            fetchAbortRef.current = null;
            setLoading(false);
            setLoadingStatus('');
            setElapsedSeconds(0);
        }
    };

    // Manual image upload for Step 2
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        const newImages: typeof manualImages = [];
        for (let i = 0; i < Math.min(files.length, 5 - manualImages.length); i++) {
            const file = files[i];
            const reader = new FileReader();

            await new Promise<void>((resolve) => {
                reader.onload = () => {
                    const result = reader.result as string;
                    const base64 = result.split(',')[1];
                    newImages.push({
                        data: base64,
                        mimeType: file.type,
                        preview: result,
                    });
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        }

        setManualImages([...manualImages, ...newImages]);
    };

    const removeManualImage = (index: number) => {
        setManualImages(manualImages.filter((_, i) => i !== index));
    };

    // Step 2: Send to AI for extraction
    const handleExtract = async () => {
        setLoading(true);
        setError(null);

        try {
            // Prepare images - combine fetched URLs and manual uploads
            const imagesToSend: Array<{ data: string; mimeType: string }> = [];

            // Add manual uploads
            for (const img of manualImages) {
                imagesToSend.push({ data: img.data, mimeType: img.mimeType });
            }

            // For fetched images, send the URLs to the server to download
            const imageUrls = fetchedData?.images || [];

            const response = await fetch('/api/ai/extract-from-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: editableText || undefined,
                    images: imagesToSend.length > 0 ? imagesToSend : undefined,
                    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                    model: selectedModel,
                    language: locale,
                }),
            });

            const result = await response.json() as { success?: boolean; data?: ExtractedAdopterData; error?: string; processedImages?: Array<{ data: string; mimeType: string; originalUrl?: string }> };

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Extraction failed');
            }

            setExtractedData(result.data || null);
            // Reset species/name states based on extracted data
            setCustomSpecies(false);
            // If AI found an animal name, turn off unknownAnimal
            setUnknownAnimal(!result.data?.animalName);
            // Store processed images for later saving
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

    const handlePreSave = async () => {
        setIsSaving(true);
        setDuplicateAdopter(null);
        setPersonMatch(null);

        // Step 1: Check for exact URL duplicate
        if (postUrl) {
            try {
                const res = await fetch(`/api/adopters?sourceUrl=${encodeURIComponent(postUrl)}`);
                const data = await res.json() as { matches: any[]; matchType?: string };
                if (data.matches && data.matches.length > 0) {
                    setDuplicateAdopter(data.matches[0]);
                    setIsSaving(false);
                    setShowConfirmModal(true);
                    return; // URL duplicate found, show warning and stop
                }
            } catch (err) {
                console.error('URL duplicate check failed:', err);
            }
        }

        // Step 2: Multi-field person matching (name, phone, address)
        if (extractedData) {
            try {
                const params = new URLSearchParams();
                if (extractedData.name) params.set('matchName', extractedData.name);
                if (extractedData.phones?.length) params.set('matchPhones', extractedData.phones.join(','));
                if (extractedData.addresses?.length) params.set('matchAddresses', extractedData.addresses.join(','));

                if (params.toString()) {
                    const res = await fetch(`/api/adopters?${params.toString()}`);
                    const data = await res.json() as {
                        matches: PersonMatch[];
                        matchType?: string;
                        confidence?: string;
                    };
                    if (data.matches && data.matches.length > 0 && data.matchType === 'person') {
                        setPersonMatch(data.matches[0]);
                    }
                }
            } catch (err) {
                console.error('Person match check failed:', err);
            }
        }

        setIsSaving(false);
        setShowConfirmModal(true);
    };

    const handleConfirmSave = async () => {
        if (!extractedData) return;
        setIsSaving(true);

        try {
            const flags = [`facebook_import_${extractedData.confidence}`];

            const payload = {
                name: extractedData.name,
                contactInfo: {
                    phones: extractedData.phones,
                    emails: extractedData.emails,
                    socialProfiles: extractedData.socialProfiles,
                    addresses: extractedData.addresses
                },
                notes: extractedData.notes,
                sourceUrl: postUrl,
                flags,
                // Include all processed images (combined from manual uploads + downloaded URLs)
                images: processedImages.length > 0 ? processedImages : manualImages.map(img => ({ data: img.data, mimeType: img.mimeType })),
                // Include adoption data if detected
                adoption: extractedData.adoptionDetected && extractedData.adoptionConfidence !== 'low' ? {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || 'Unknown'),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'adoption',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0]
                } : undefined
            };

            const response = await fetch('/api/adopters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json() as { id: string; error?: string };

            if (!response.ok) {
                throw new Error(result.error || 'Failed to create adopter');
            }

            // Capture ID before any state changes
            const adopterId = result.id;
            const successMessage = extractedData.adoptionDetected && extractedData.adoptionConfidence !== 'low'
                ? (t('facebook.successWithAdoption') || 'Profile + adoption record created')
                : (extractedData.name || 'New Profile');

            // Close wizard
            handleClose();

            // Show success toast with View Profile button
            toast.success(
                t('facebook.successTitle') || '¡Adoptante Creado!',
                successMessage,
                {
                    label: '→ ' + (t('facebook.viewProfile') || 'View Profile'),
                    href: `/adopter/${adopterId}`
                }
            );

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save adopter');
            setShowConfirmModal(false); // Close modal to show error
        } finally {
            setIsSaving(false);
        }
    };

    const handleMerge = async () => {
        if (!extractedData || !personMatch) return;
        setIsSaving(true);

        try {
            // Build contact info string
            const contactParts: string[] = [];
            if (extractedData.phones?.length) contactParts.push(`Phones: ${extractedData.phones.join(', ')}`);
            if (extractedData.emails?.length) contactParts.push(`Emails: ${extractedData.emails.join(', ')}`);
            if (extractedData.socialProfiles?.length) contactParts.push(`Socials: ${extractedData.socialProfiles.join(', ')}`);
            if (extractedData.addresses?.length) contactParts.push(`Address: ${extractedData.addresses.join(', ')}`);

            const payload = {
                sourceUrl: postUrl,
                notes: extractedData.notes,
                contactInfo: contactParts.length > 0 ? contactParts.join('\n') : undefined,
                adoption: {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || 'Unknown'),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'observation',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0]
                },
                images: processedImages.length > 0 ? processedImages : manualImages.map(img => ({ data: img.data, mimeType: img.mimeType }))
            };

            const response = await fetch(`/api/adopters/${personMatch.id}/add-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json() as { adoptionId?: string; adopterId?: string; adopterName?: string; error?: string };

            if (!response.ok) {
                throw new Error(result.error || 'Failed to add record');
            }

            const adopterId = result.adopterId || personMatch.id;
            const adopterName = result.adopterName || personMatch.name;

            handleClose();

            toast.success(
                t('facebook.mergeSuccess') || 'Record added to profile',
                adopterName,
                {
                    label: '→ ' + (t('facebook.viewProfile') || 'View Profile'),
                    href: `/adopter/${adopterId}`
                }
            );

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add record');
            setShowConfirmModal(false);
        } finally {
            setIsSaving(false);
        }
    };

    // Closed state - show button
    if (!isOpen) {
        return (
            <button
                data-testid="facebook-import-btn"
                onClick={handleOpen}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" />
                </svg>
                {t('facebook.importButton') || 'Import from Facebook'}
            </button>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-stone-200">
                    <div>
                        <h2 className="text-xl font-bold text-stone-900">
                            {t('facebook.title') || 'Import from Facebook'}
                        </h2>
                        <p className="text-sm text-stone-500">
                            {t('facebook.subtitle') || 'Extract adopter information using AI'}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Step Indicator */}
                {!showConfirmModal && (
                    <div className="flex items-center justify-center gap-4 py-4 border-b border-stone-100">
                        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-blue-600' : 'text-stone-400'}`}>
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step >= 1 ? 'bg-blue-100' : 'bg-stone-100'}`}>1</span>
                            <span className="text-sm font-medium hidden sm:block">URL</span>
                        </div>
                        <div className="w-8 h-px bg-stone-200" />
                        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-blue-600' : 'text-stone-400'}`}>
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step >= 2 ? 'bg-blue-100' : 'bg-stone-100'}`}>2</span>
                            <span className="text-sm font-medium hidden sm:block">Content</span>
                        </div>
                        <div className="w-8 h-px bg-stone-200" />
                        <div className={`flex items-center gap-2 ${step >= 3 ? 'text-blue-600' : 'text-stone-400'}`}>
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step >= 3 ? 'bg-blue-100' : 'bg-stone-100'}`}>3</span>
                            <span className="text-sm font-medium hidden sm:block">Review</span>
                        </div>
                    </div>
                )}

                {/* Content */}
                {showConfirmModal ? (
                    <div className="p-6 space-y-6">
                        <div className="flex flex-col items-center text-center">
                            {/* Icon changes based on scenario */}
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${duplicateAdopter ? 'bg-yellow-100 text-yellow-600' :
                                    personMatch ? 'bg-purple-100 text-purple-600' :
                                        'bg-blue-100 text-blue-600'
                                }`}>
                                {personMatch && !duplicateAdopter ? (
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                ) : (
                                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                )}
                            </div>

                            <h3 className="text-xl font-bold text-stone-900 mb-2">
                                {duplicateAdopter
                                    ? (t('facebook.duplicateWarning') || 'Duplicate Post Detected')
                                    : personMatch
                                        ? (t('facebook.personMatchTitle') || 'Person Match Found')
                                        : (t('facebook.confirmCreate') || 'Create New Profile?')
                                }
                            </h3>

                            {/* Different subtitle per scenario */}
                            <p className="text-stone-600 mb-4">
                                {duplicateAdopter
                                    ? <>This Facebook post was already imported. Existing Profile: <a href={`/adopter/${duplicateAdopter.id}`} target="_blank" className="underline font-medium text-blue-600 hover:text-blue-800">{duplicateAdopter.name}</a></>
                                    : personMatch
                                        ? (t('facebook.personMatchDesc') || 'A profile with similar information already exists')
                                        : <>You are about to create a new profile for <strong className="text-stone-900">{extractedData?.name || 'Unknown'}</strong>.</>
                                }
                            </p>

                            {/* Person Match: Profile Preview Card */}
                            {personMatch && !duplicateAdopter && (
                                <div className="w-full bg-stone-50 border border-stone-200 rounded-xl p-4 mb-4 text-left">
                                    {/* Confidence badge */}
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${personMatch.confidence === 'high' ? 'bg-green-100 text-green-800' :
                                                personMatch.confidence === 'medium' ? 'bg-amber-100 text-amber-800' :
                                                    'bg-red-100 text-red-800'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${personMatch.confidence === 'high' ? 'bg-green-500' :
                                                    personMatch.confidence === 'medium' ? 'bg-amber-500' :
                                                        'bg-red-500'
                                                }`} />
                                            {personMatch.confidence === 'high'
                                                ? (t('facebook.matchConfidenceHigh') || 'High Match')
                                                : personMatch.confidence === 'medium'
                                                    ? (t('facebook.matchConfidenceMedium') || 'Possible Match')
                                                    : (t('facebook.matchConfidenceLow') || 'Possible Match (Low)')
                                            }
                                        </span>
                                        <span className="text-xs text-stone-500">
                                            ({personMatch.matchReasons.map(r =>
                                                t(`facebook.matchReason${r.charAt(0).toUpperCase() + r.slice(1)}` as any) || r
                                            ).join(', ')})
                                        </span>
                                    </div>

                                    {/* Profile card */}
                                    <div className="flex items-start gap-3">
                                        {/* Thumbnail */}
                                        <div className="w-14 h-14 rounded-lg bg-stone-200 flex-shrink-0 overflow-hidden">
                                            {personMatch.thumbnail ? (
                                                <img src={personMatch.thumbnail.startsWith('http')
                                                    ? `/api/proxy-image?url=${encodeURIComponent(personMatch.thumbnail)}`
                                                    : personMatch.thumbnail}
                                                    alt="" className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-400">
                                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-stone-900 text-base truncate">{personMatch.name}</p>
                                            {personMatch.contactInfo && (
                                                <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">
                                                    {personMatch.contactInfo.split('\n').slice(0, 2).join(' · ')}
                                                </p>
                                            )}
                                            <a
                                                href={`/adopter/${personMatch.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1.5 font-medium"
                                            >
                                                {t('facebook.viewExistingProfile') || 'View Full Profile'} →
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Buttons */}
                            {personMatch && !duplicateAdopter ? (
                                /* Person match: two-button choice with confidence-based primary */
                                <div className="flex flex-col gap-2 w-full max-w-sm">
                                    <button
                                        onClick={handleMerge}
                                        disabled={isSaving}
                                        className={`w-full px-4 py-2.5 rounded-lg font-bold transition-colors disabled:bg-stone-300 ${personMatch.confidence === 'high'
                                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                                : 'border border-purple-300 text-purple-700 hover:bg-purple-50'
                                            }`}
                                    >
                                        {isSaving ? (t('facebook.mergingRecord') || 'Adding record...') : (t('facebook.addToExisting') || 'Add Record to This Profile')}
                                    </button>
                                    <button
                                        onClick={handleConfirmSave}
                                        disabled={isSaving}
                                        className={`w-full px-4 py-2.5 rounded-lg font-bold transition-colors disabled:bg-stone-300 ${personMatch.confidence === 'high'
                                                ? 'border border-stone-200 text-stone-600 hover:bg-stone-50'
                                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                            }`}
                                    >
                                        {isSaving ? 'Creating...' : (t('facebook.createNewAnyway') || 'Create New Profile Instead')}
                                    </button>
                                    <button
                                        onClick={() => setShowConfirmModal(false)}
                                        className="w-full px-4 py-2 text-stone-400 hover:text-stone-600 text-sm font-medium"
                                    >
                                        {t('common.back') || 'Back'}
                                    </button>
                                </div>
                            ) : (
                                /* URL duplicate or no match: existing two-button layout */
                                <div className="flex gap-3 w-full max-w-sm">
                                    <button
                                        onClick={() => setShowConfirmModal(false)}
                                        className="flex-1 px-4 py-2 border border-stone-200 rounded-lg hover:bg-stone-50 font-medium text-stone-600"
                                    >
                                        {t('common.back') || 'Back'}
                                    </button>
                                    <button
                                        onClick={handleConfirmSave}
                                        disabled={isSaving}
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:bg-stone-300"
                                    >
                                        {isSaving ? 'Creating...' : 'Create Profile'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="p-6 space-y-6">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        {/* Step 1: URL Input */}
                        {step === 1 && (
                            <div className="space-y-4">
                                {scraperUnavailable ? (
                                    /* Scraper Unavailable Prompt */
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-amber-800 text-sm">
                                                    {t('facebook.scraperUnavailableTitle') || 'Advanced Extraction Unavailable'}
                                                </h3>
                                                <p className="text-sm text-amber-700 mt-1">
                                                    {t('facebook.scraperUnavailableDesc') || 'The advanced scraping service could not be reached. You can use a basic extraction method, but it may capture fewer images and less text. You will need to manually add any missing information.'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <button
                                                onClick={() => handleFetchPost({ useFallback: true })}
                                                disabled={loading}
                                                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium text-sm disabled:bg-stone-300 flex items-center gap-2"
                                            >
                                                {loading && (
                                                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                    </svg>
                                                )}
                                                {loading ? (loadingStatus || 'Loading...') : (t('facebook.scraperUnavailableUseFallback') || 'Use Basic Method')}
                                            </button>
                                            <button
                                                onClick={() => handleFetchPost()}
                                                disabled={loading}
                                                className="px-4 py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100 font-medium text-sm disabled:opacity-50"
                                            >
                                                {t('facebook.scraperUnavailableRetry') || 'Retry'}
                                            </button>
                                            <button
                                                onClick={() => { setScraperUnavailable(false); setError(null); }}
                                                disabled={loading}
                                                className="px-4 py-2 text-stone-500 hover:text-stone-700 font-medium text-sm disabled:opacity-50"
                                            >
                                                {t('facebook.scraperUnavailableCancel') || 'Cancel'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-bold text-stone-700 mb-2">
                                            Facebook Post URL
                                        </label>
                                        <input
                                            type="url"
                                            value={postUrl}
                                            onChange={(e) => setPostUrl(e.target.value)}
                                            placeholder="https://www.facebook.com/groups/.../posts/..."
                                            aria-label="Facebook post URL"
                                            className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        />
                                        <p className="text-xs text-stone-400 mt-2">
                                            ⚠️ Only works with public posts. Private posts require manual input.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 2: Review Fetched Content */}
                        {step === 2 && (
                            <div className="space-y-6">
                                {/* AI Model Selection - Compact */}
                                <div className="flex items-center gap-2 text-xs text-stone-500">
                                    <span>Model:</span>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const dropdown = document.getElementById('model-dropdown');
                                                if (dropdown) dropdown.classList.toggle('hidden');
                                            }}
                                            className="px-2 py-1 bg-blue-50 border border-blue-200 rounded text-blue-700 font-medium hover:bg-blue-100 transition-colors flex items-center gap-1"
                                        >
                                            {models.find(m => m.name === selectedModel)?.displayName?.replace('models/', '') || selectedModel.replace('models/', '')}
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </button>
                                        <div id="model-dropdown" className="hidden absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 min-w-[200px] max-h-48 overflow-y-auto">
                                            {(models.length > 0 ? models : [
                                                { name: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro' },
                                                { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' }
                                            ]).map(model => (
                                                <button
                                                    key={model.name}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedModel(model.name);
                                                        document.getElementById('model-dropdown')?.classList.add('hidden');
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${selectedModel === model.name ? 'bg-blue-100 text-blue-700 font-medium' : 'text-stone-700'}`}
                                                >
                                                    {model.displayName?.replace('models/', '') || model.name.replace('models/', '')}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Text content */}
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-2">
                                        Post Content
                                        <span className="font-normal text-stone-400 ml-1">(editable)</span>
                                    </label>
                                    <textarea
                                        value={editableText}
                                        onChange={(e) => setEditableText(e.target.value)}
                                        placeholder="Paste or edit the post content here..."
                                        className="w-full h-32 px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-blue-500 resize-none"
                                    />
                                </div>

                                {/* Fetched Images */}
                                {fetchedData?.images && fetchedData.images.length > 0 && (
                                    <div>
                                        <label className="block text-sm font-bold text-stone-700 mb-2">
                                            Images from Post
                                        </label>
                                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                            {fetchedData.images.map((url, idx) => {
                                                const imgSrc = url.includes('facebook') || url.includes('fbcdn') || url.includes('fbsbx')
                                                    ? `/api/proxy-image?url=${encodeURIComponent(url)}`
                                                    : url;
                                                return (
                                                    <a
                                                        key={idx}
                                                        href={imgSrc}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="aspect-square block cursor-zoom-in hover:opacity-80 transition-opacity"
                                                    >
                                                        <img
                                                            src={imgSrc}
                                                            alt={`Post image ${idx + 1}`}
                                                            className="w-full h-full object-cover rounded-lg"
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).style.display = 'none';
                                                            }}
                                                        />
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Manual Image Upload */}
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-2">
                                        Upload Additional Screenshots
                                        <span className="font-normal text-stone-400 ml-1">({manualImages.length}/5)</span>
                                    </label>

                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleImageUpload}
                                        className="hidden"
                                    />

                                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                        {manualImages.map((img, idx) => (
                                            <div key={idx} className="relative aspect-square">
                                                <img
                                                    src={img.preview}
                                                    alt={`Upload ${idx + 1}`}
                                                    className="w-full h-full object-cover rounded-lg"
                                                />
                                                <button
                                                    onClick={() => removeManualImage(idx)}
                                                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}

                                        {manualImages.length < 5 && (
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="aspect-square border-2 border-dashed border-stone-300 rounded-lg flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                                            >
                                                <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Review AI Extracted Data */}
                        {step === 3 && extractedData && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${extractedData.confidence === 'high' ? 'bg-green-100 text-green-700' :
                                        extractedData.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-red-100 text-red-700'
                                        }`}>
                                        {t(`facebook.confidence.${extractedData.confidence}`) || `${extractedData.confidence} confidence`}
                                    </span>
                                </div>

                                {/* Images to be saved */}
                                {(processedImages.length > 0 || manualImages.length > 0) && (
                                    <div>
                                        <label className="block text-sm font-bold text-stone-700 mb-2">
                                            {t('facebook.imagesToSave') || 'Images'} ({processedImages.length || manualImages.length})
                                        </label>
                                        <div className="grid grid-cols-4 gap-2">
                                            {(processedImages.length > 0 ? processedImages : manualImages).map((img, idx) => (
                                                <div key={idx} className="aspect-square rounded-lg overflow-hidden bg-stone-100">
                                                    <img
                                                        src={'preview' in img ? img.preview : `data:${img.mimeType};base64,${img.data}`}
                                                        alt={`Image ${idx + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Editable Fields */}
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">
                                        {t('facebook.extractedName') || 'Name'}
                                    </label>
                                    <input
                                        type="text"
                                        value={extractedData.name || ''}
                                        onChange={(e) => setExtractedData({ ...extractedData, name: e.target.value })}
                                        className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder={t('facebook.noName') || 'No name detected'}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">
                                        {t('facebook.extractedPhones') || 'Phone Numbers'}
                                    </label>
                                    <input
                                        type="text"
                                        value={extractedData.phones?.join(', ') || ''}
                                        onChange={(e) => setExtractedData({ ...extractedData, phones: e.target.value.split(',').map(p => p.trim()).filter(Boolean) })}
                                        className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder={t('facebook.noPhones') || 'No phones detected'}
                                    />
                                </div>



                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">
                                        {t('facebook.extractedNotes') || 'Notes'}
                                    </label>
                                    <textarea
                                        value={extractedData.notes || ''}
                                        onChange={(e) => setExtractedData({ ...extractedData, notes: e.target.value })}
                                        className="w-full h-24 px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                                        placeholder={t('facebook.noNotes') || 'Additional notes'}
                                    />
                                </div>

                                {/* Adoption Detection Section */}
                                {extractedData.adoptionDetected && (
                                    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className="text-green-700 font-bold">🏠 {t('facebook.adoptionDetected') || 'Adoption Detected'}</span>
                                            {extractedData.adoptionConfidence && (
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${extractedData.adoptionConfidence === 'high' ? 'bg-green-200 text-green-800' :
                                                    extractedData.adoptionConfidence === 'medium' ? 'bg-yellow-200 text-yellow-800' :
                                                        'bg-red-200 text-red-800'
                                                    }`}>
                                                    {extractedData.adoptionConfidence}
                                                </span>
                                            )}
                                        </div>

                                        {/* Record Type Pills */}
                                        <div className="mb-3">
                                            <label className="block text-xs font-bold text-green-700 mb-1.5">
                                                {t('facebook.recordType') || 'Record Type'}
                                            </label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[
                                                    { value: 'adoption', icon: '🏠', label: t('facebook.typeAdoption') || 'Adoption' },
                                                    { value: 'adoption_request', icon: '📝', label: t('facebook.typeRequest') || 'Request' },
                                                    { value: 'returned_pet', icon: '↩️', label: t('facebook.typeReturned') || 'Returned' },
                                                    { value: 'follow_up', icon: '📞', label: t('facebook.typeFollowUp') || 'Follow-up' },
                                                    { value: 'observation', icon: '👁️', label: t('facebook.typeObservation') || 'Note' }
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

                                        {/* Animal Name with Unknown Toggle */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className="text-xs font-bold text-green-700">
                                                        {t('facebook.animalName') || 'Animal Name'}
                                                    </label>
                                                    <label className="flex items-center gap-1 cursor-pointer text-xs">
                                                        <span className="text-green-600">{t('common.unknown') || 'Unknown'}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setUnknownAnimal(!unknownAnimal);
                                                                if (!unknownAnimal) {
                                                                    setExtractedData({ ...extractedData, animalName: '' });
                                                                }
                                                            }}
                                                            className={`relative w-8 h-4 rounded-full transition-colors ${unknownAnimal ? 'bg-amber-500' : 'bg-stone-200'}`}
                                                        >
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${unknownAnimal ? 'translate-x-4' : 'translate-x-0'}`} />
                                                        </button>
                                                    </label>
                                                </div>
                                                <input
                                                    type="text"
                                                    disabled={unknownAnimal}
                                                    value={unknownAnimal ? '' : (extractedData.animalName || '')}
                                                    onChange={(e) => setExtractedData({ ...extractedData, animalName: e.target.value })}
                                                    className={`w-full px-3 py-1.5 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 ${unknownAnimal ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-white'}`}
                                                    placeholder={unknownAnimal ? (t('adoption.unknown_animal') || 'Unknown') : ''}
                                                />
                                            </div>

                                            {/* Species - improved layout */}
                                            <div>
                                                <label className="block text-xs font-bold text-green-700 mb-1">
                                                    {t('facebook.animalSpecies') || 'Species'}
                                                </label>
                                                {customSpecies ? (
                                                    <div className="flex gap-1">
                                                        <input
                                                            type="text"
                                                            value={extractedData.animalSpecies || ''}
                                                            onChange={(e) => setExtractedData({ ...extractedData, animalSpecies: e.target.value })}
                                                            className="min-w-0 flex-1 px-3 py-1.5 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                                            placeholder={t('adoption.species_other_placeholder') || 'Species...'}
                                                            autoFocus
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setCustomSpecies(false);
                                                                setExtractedData({ ...extractedData, animalSpecies: 'cat' });
                                                            }}
                                                            className="flex-shrink-0 px-2 py-1.5 border border-green-300 bg-green-50 text-green-700 text-xs font-medium rounded-lg hover:bg-green-100 transition-colors"
                                                            title={t('adoption.species_select_preset') || 'Select preset'}
                                                        >
                                                            ↩
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={extractedData.animalSpecies?.toLowerCase() || 'cat'}
                                                        onChange={(e) => {
                                                            if (e.target.value === '_other') {
                                                                setCustomSpecies(true);
                                                                setExtractedData({ ...extractedData, animalSpecies: '' });
                                                            } else {
                                                                setExtractedData({ ...extractedData, animalSpecies: e.target.value });
                                                            }
                                                        }}
                                                        className="w-full px-3 py-1.5 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                                    >
                                                        <option value="cat">{t('species.cat') || 'Cat'} 🐱</option>
                                                        <option value="dog">{t('species.dog') || 'Dog'} 🐶</option>
                                                        <option value="bird">{t('species.bird') || 'Bird'} 🐦</option>
                                                        <option value="_other">{t('species.other') || 'Other...'}</option>
                                                    </select>
                                                )}
                                            </div>
                                        </div>

                                        {/* Rating */}
                                        <div className="mt-3">
                                            <label className="block text-xs font-bold text-green-700 mb-1.5">
                                                {t('facebook.adoptionRating') || 'Rating'}
                                            </label>
                                            <StarRating
                                                value={extractedData.adoptionRating || 2}
                                                onChange={(r) => setExtractedData({ ...extractedData, adoptionRating: r })}
                                            />
                                            <p className="text-xs text-stone-400 mt-1">1 = {t('ratings.dangerous') || 'Concerning'}, 5 = {t('ratings.excellent') || 'Excellent'}</p>
                                        </div>

                                        {/* Adoption Date */}
                                        <div className="mt-3">
                                            <label className="block text-xs font-bold text-green-700 mb-1">
                                                {t('facebook.adoptionDate') || 'Adoption Date'}
                                            </label>
                                            <input
                                                type="date"
                                                value={extractedData.adoptionDate || new Date().toISOString().split('T')[0]}
                                                onChange={(e) => setExtractedData({ ...extractedData, adoptionDate: e.target.value })}
                                                className="w-full px-3 py-1.5 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                            />
                                        </div>

                                        <p className="text-xs text-green-600 mt-2">
                                            {t('facebook.adoptionNote') || 'A record will be created automatically.'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                {!showConfirmModal && (
                    <div className="flex items-center justify-between p-6 border-t border-stone-200 bg-stone-50 rounded-b-2xl">
                        {step === 1 && (
                            <>
                                {loading ? (
                                    /* Progress UI while scraper is working */
                                    <div className="flex flex-col w-full gap-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <svg className="animate-spin w-4 h-4 text-blue-600 flex-shrink-0" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                                <p className="text-sm font-medium text-stone-700 truncate">
                                                    {loadingStatus || 'Loading...'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-stone-500">
                                                    {Math.min(100, Math.round((elapsedSeconds / 120) * 100))}%
                                                </span>
                                                {elapsedSeconds >= 90 && (
                                                    <button
                                                        onClick={handleCancelScraper}
                                                        className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap flex-shrink-0"
                                                    >
                                                        {t('facebook.useBasicInstead') || 'Use Basic Method'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="w-full bg-stone-200 rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                                                style={{ width: `${Math.min(100, (elapsedSeconds / 120) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={handleClose}
                                            className="px-4 py-2 text-stone-600 hover:text-stone-900 font-medium"
                                        >
                                            {t('common.cancel') || 'Cancel'}
                                        </button>
                                        <button
                                            onClick={() => handleFetchPost()}
                                            disabled={!postUrl.trim()}
                                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-stone-300 disabled:cursor-not-allowed font-bold"
                                        >
                                            Fetch Post
                                        </button>
                                    </>
                                )}
                            </>
                        )}

                        {step === 2 && (
                            <>
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-4 py-2 text-stone-600 hover:text-stone-900 font-medium"
                                >
                                    ← Back
                                </button>
                                <button
                                    onClick={handleExtract}
                                    disabled={loading || (!editableText.trim() && manualImages.length === 0)}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-stone-300 disabled:cursor-not-allowed font-bold flex items-center gap-2"
                                >
                                    {loading && (
                                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    )}
                                    {loading ? 'Extracting...' : 'Extract with AI'}
                                </button>
                            </>
                        )}

                        {step === 3 && (
                            <>
                                <button
                                    onClick={() => setStep(2)}
                                    className="px-4 py-2 text-stone-600 hover:text-stone-900 font-medium"
                                >
                                    ← Back
                                </button>
                                <button
                                    onClick={handlePreSave}
                                    disabled={isSaving}
                                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold disabled:bg-stone-300"
                                >
                                    {isSaving ? 'Creating...' : (t('facebook.createAdopter') || 'Create Adopter Record')}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
}
