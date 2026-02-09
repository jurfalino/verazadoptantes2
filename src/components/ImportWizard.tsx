'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StarRating } from '@/components/StarRating';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useShowToast } from '@/components/ui/Toast';
import type { ExtractedAdopterData } from '@/lib/gemini';

interface PersonMatch {
    id: string;
    name: string;
    contactInfo?: string | null;
    sourceUrl?: string | null;
    thumbnail?: string | null;
    confidence: 'high' | 'medium' | 'low';
    matchReasons: string[];
}

type InputMode = 'url' | 'text' | 'image';

export default function ImportWizard() {
    const { t, locale } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const router = useRouter();
    const searchParams = useSearchParams();
    const toast = useShowToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Steps: 1=Input, 2=Content/Extract, 3=Review, 4=Confirm
    const [step, setStep] = useState(1);
    const [inputMode, setInputMode] = useState<InputMode>('url');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Input state
    const [inputUrl, setInputUrl] = useState('');
    const [inputText, setInputText] = useState('');
    const [manualImages, setManualImages] = useState<Array<{ data: string; mimeType: string; preview: string }>>([]);

    // Extracted/fetched state
    const [fetchedText, setFetchedText] = useState('');
    const [editableText, setEditableText] = useState('');
    const [fetchedImages, setFetchedImages] = useState<string[]>([]);
    const [selectedFetchedImages, setSelectedFetchedImages] = useState<Set<number>>(new Set());
    const [sourceUrl, setSourceUrl] = useState('');
    const [sourceType, setSourceType] = useState<string>('');

    // AI extraction state
    const [extractedData, setExtractedData] = useState<ExtractedAdopterData | null>(null);
    const [processedImages, setProcessedImages] = useState<Array<{ data: string; mimeType: string; originalUrl?: string }>>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [unknownAnimal, setUnknownAnimal] = useState(false);
    const [customSpecies, setCustomSpecies] = useState(false);

    // Save state
    const [isSaving, setIsSaving] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [duplicateAdopter, setDuplicateAdopter] = useState<any>(null);
    const [personMatch, setPersonMatch] = useState<PersonMatch | null>(null);
    const [expandedImage, setExpandedImage] = useState<string | null>(null);

    // Pre-fill from URL params (for Share Intent / Web Share Target)
    useEffect(() => {
        const sharedUrl = searchParams.get('shared_url') || searchParams.get('url');
        const sharedText = searchParams.get('shared_text') || searchParams.get('text');

        if (sharedUrl) {
            setInputUrl(sharedUrl);
            setInputMode('url');
            // Auto-fetch if URL is provided
            handleFetchUrl(sharedUrl);
        } else if (sharedText) {
            setInputText(sharedText);
            setInputMode('text');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFetchUrl = async (url?: string) => {
        const targetUrl = url || inputUrl;
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

    const handleTextSubmit = () => {
        if (!inputText.trim()) return;
        setFetchedText(inputText.trim());
        setEditableText(inputText.trim());
        setStep(2);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        for (const file of Array.from(files)) {
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
    };

    const removeImage = (index: number) => {
        setManualImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleImagesSubmit = () => {
        if (manualImages.length === 0) return;
        setStep(2);
    };

    // AI Extraction
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

            setExtractedData(result.data || null);
            setCustomSpecies(false);
            setUnknownAnimal(!result.data?.animalName);
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

    // Pre-save duplicate check
    const handlePreSave = async () => {
        setIsSaving(true);
        setDuplicateAdopter(null);
        setPersonMatch(null);

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
            } catch { /* continue */ }
        }

        // Check for person match
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
            } catch { /* continue */ }
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

            const payload = {
                name: extractedData.name,
                contactInfo: {
                    phones: extractedData.phones,
                    emails: extractedData.emails,
                    socialProfiles: extractedData.socialProfiles,
                    addresses: extractedData.addresses,
                },
                notes: extractedData.notes,
                sourceUrl,
                flags,
                images: processedImages.length > 0 ? processedImages : manualImages.map(img => ({ data: img.data, mimeType: img.mimeType })),
                adoption: extractedData.adoptionDetected && extractedData.adoptionConfidence !== 'low' ? {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || 'Unknown'),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'adoption',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0],
                } : undefined,
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
            const successMessage = extractedData.adoptionDetected && extractedData.adoptionConfidence !== 'low'
                ? 'Profile + adoption record created'
                : (extractedData.name || 'New Profile');

            toast.success('¡Adoptante Creado!', successMessage, {
                label: '→ Ver Perfil',
                href: `/adopter/${adopterId}`,
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
    const handleMerge = async () => {
        if (!extractedData || !personMatch) return;
        setIsSaving(true);

        try {
            const contactParts: string[] = [];
            if (extractedData.phones?.length) contactParts.push(`Phones: ${extractedData.phones.join(', ')}`);
            if (extractedData.emails?.length) contactParts.push(`Emails: ${extractedData.emails.join(', ')}`);
            if (extractedData.socialProfiles?.length) contactParts.push(`Socials: ${extractedData.socialProfiles.join(', ')}`);
            if (extractedData.addresses?.length) contactParts.push(`Address: ${extractedData.addresses.join(', ')}`);

            const payload = {
                sourceUrl,
                notes: extractedData.notes,
                contactInfo: contactParts.length > 0 ? contactParts.join('\n') : undefined,
                adoption: {
                    animalName: unknownAnimal ? '' : (extractedData.animalName || 'Unknown'),
                    species: extractedData.animalSpecies,
                    recordType: extractedData.recordType || 'observation',
                    rating: extractedData.adoptionRating || 2,
                    date: extractedData.adoptionDate || new Date().toISOString().split('T')[0],
                },
                images: processedImages.length > 0 ? processedImages : manualImages.map(img => ({ data: img.data, mimeType: img.mimeType })),
            };

            const response = await fetch(`/api/adopters/${personMatch.id}/add-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json() as { adoptionId?: string; adopterId?: string; adopterName?: string; error?: string };

            if (!response.ok) {
                throw new Error(result.error || 'Failed to add record');
            }

            const adopterId = result.adopterId || personMatch.id;
            const adopterName = result.adopterName || personMatch.name;

            toast.success('Record added to profile', adopterName, {
                label: '→ Ver Perfil',
                href: `/adopter/${adopterId}`,
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
                <h1 className="text-2xl font-bold text-stone-900">{t('import.title') || 'Import Content'}</h1>
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
                            <div className={`flex items-center gap-2 ${step >= i + 1 ? 'text-blue-600' : 'text-stone-400'}`}>
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${step >= i + 1 ? 'bg-blue-100' : 'bg-stone-100'}`}>
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
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    {error}
                    <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700">✕</button>
                </div>
            )}

            {/* === STEP 1: Input === */}
            {step === 1 && !showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-6">
                    {/* Input Mode Tabs */}
                    <div className="flex gap-2 p-1 bg-stone-100 rounded-xl">
                        {([
                            { key: 'url' as InputMode, label: t('import.tabUrl') || '🔗 URL', icon: '' },
                            { key: 'text' as InputMode, label: t('import.tabText') || '📝 Text', icon: '' },
                            { key: 'image' as InputMode, label: t('import.tabImages') || '📷 Images', icon: '' },
                        ]).map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setInputMode(tab.key)}
                                className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${inputMode === tab.key
                                    ? 'bg-white text-stone-900 shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* URL Input */}
                    {inputMode === 'url' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-stone-700 mb-2">
                                    {t('import.urlLabel') || 'Paste any URL'}
                                </label>
                                <input
                                    type="url"
                                    value={inputUrl}
                                    onChange={e => setInputUrl(e.target.value)}
                                    placeholder={t('import.urlPlaceholder') || 'https://facebook.com/... or any website'}
                                    className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                    autoFocus
                                />
                                <p className="text-xs text-stone-400 mt-1">
                                    {t('import.urlHint') || 'Works with Facebook posts, Instagram, news articles, or any web page'}
                                </p>
                            </div>
                            <button
                                onClick={() => handleFetchUrl()}
                                disabled={!inputUrl.trim() || loading}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <span className="animate-spin">⏳</span>
                                        {t('import.fetching') || 'Fetching content...'}
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        {t('import.fetchButton') || 'Fetch & Extract'}
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Text Input */}
                    {inputMode === 'text' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-stone-700 mb-2">
                                    {t('import.textLabel') || 'Paste text content'}
                                </label>
                                <textarea
                                    value={inputText}
                                    onChange={e => setInputText(e.target.value)}
                                    placeholder={t('import.textPlaceholder') || 'Paste the adoption announcement, WhatsApp message, or any text with adopter information...'}
                                    className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm min-h-[200px] resize-y"
                                    autoFocus
                                />
                            </div>
                            <button
                                onClick={handleTextSubmit}
                                disabled={!inputText.trim()}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('import.continueBtn') || 'Continue'} →
                            </button>
                        </div>
                    )}

                    {/* Image Input */}
                    {inputMode === 'image' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-stone-700 mb-2">
                                    {t('import.imageLabel') || 'Upload screenshots or photos'}
                                </label>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-stone-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                                >
                                    <svg className="w-10 h-10 mx-auto text-stone-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <p className="text-sm text-stone-500">{t('import.imageDropzone') || 'Click to upload images'}</p>
                                    <p className="text-xs text-stone-400 mt-1">{t('import.imageHint') || 'Screenshots of posts, chat messages, etc.'}</p>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageUpload}
                                    className="hidden"
                                />
                            </div>

                            {/* Image Previews */}
                            {manualImages.length > 0 && (
                                <div className="grid grid-cols-3 gap-2">
                                    {manualImages.map((img, i) => (
                                        <div key={i} className="relative group">
                                            <img src={img.preview} alt="" className="w-full h-24 object-cover rounded-lg" />
                                            <button
                                                onClick={() => removeImage(i)}
                                                className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button
                                onClick={handleImagesSubmit}
                                disabled={manualImages.length === 0}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('import.continueWithImages') || 'Continue with'} {manualImages.length} {manualImages.length !== 1 ? (t('import.images') || 'images') : (t('import.image') || 'image')} →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* === STEP 2: Content Review + Extract === */}
            {step === 2 && !showConfirmModal && (
                <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-stone-900">{t('import.reviewTitle') || 'Review Content'}</h3>

                    {/* Editable text */}
                    <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">
                            {t('import.extractedText') || 'Extracted Text'} {sourceUrl && <span className="text-stone-400">(from {new URL(sourceUrl).hostname})</span>}
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
                                                : 'bg-white/80 text-stone-400 border border-stone-300'
                                                }`}>
                                                {isSelected ? '✓' : ''}
                                            </div>
                                            {/* Expand button */}
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedImage(`/api/proxy-image?url=${encodeURIComponent(url)}`);
                                                }}
                                                className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer"
                                                title="Expand image"
                                            >
                                                ⤢
                                            </div>
                                        </button>
                                    );
                                })}
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
                            accept="image/*"
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
                                            className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
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

                    {/* Name */}
                    <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.name') || 'Name'}</label>
                        <input
                            value={extractedData.name || ''}
                            onChange={e => setExtractedData({ ...extractedData, name: e.target.value })}
                            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Contact Info */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.phones') || 'Phones'}</label>
                            <input
                                value={extractedData.phones?.join(', ') || ''}
                                onChange={e => setExtractedData({ ...extractedData, phones: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                placeholder={t('import.commaSeparated') || 'Comma separated'}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.emails') || 'Emails'}</label>
                            <input
                                value={extractedData.emails?.join(', ') || ''}
                                onChange={e => setExtractedData({ ...extractedData, emails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                placeholder={t('import.commaSeparated') || 'Comma separated'}
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">{t('import.notes') || 'Notes'}</label>
                        <textarea
                            value={extractedData.notes || ''}
                            onChange={e => setExtractedData({ ...extractedData, notes: e.target.value })}
                            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm min-h-[80px] resize-y focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Adoption Detection */}
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
                                />
                            </div>
                        </div>
                    )}

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
                                ? (t('import.duplicateWarning') || '⚠️ Duplicate Post Detected')
                                : personMatch
                                    ? (t('import.personMatchTitle') || 'Person Match Found')
                                    : (t('import.confirmCreate') || 'Create New Profile?')}
                        </h3>

                        <p className="text-stone-600 mb-4">
                            {duplicateAdopter
                                ? <>This URL was already imported. Existing profile: <a href={`/adopter/${duplicateAdopter.id}`} target="_blank" className="underline font-medium text-blue-600">{duplicateAdopter.name}</a></>
                                : personMatch
                                    ? (t('import.personMatchDesc') || 'A profile with similar information already exists')
                                    : <>You are about to create a new profile for <strong className="text-stone-900">{extractedData?.name || 'Unknown'}</strong>.</>
                            }
                        </p>

                        {/* Person Match Card */}
                        {personMatch && !duplicateAdopter && (
                            <div className="w-full bg-stone-50 border border-stone-200 rounded-xl p-4 mb-4 text-left">
                                <p className="font-semibold text-stone-900">{personMatch.name}</p>
                                {personMatch.matchReasons?.map((reason, i) => (
                                    <p key={i} className="text-xs text-stone-500">• {reason}</p>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2">
                        {duplicateAdopter ? (
                            <>
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
                        ) : personMatch ? (
                            <>
                                <button
                                    onClick={handleMerge}
                                    disabled={isSaving}
                                    className="py-2.5 px-4 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isSaving ? <><span className="animate-spin">⏳</span> {t('import.addingRecord') || 'Adding record...'}</> : <>{t('import.addToExisting') || 'Add Record to This Profile'}</>}
                                </button>
                                <button
                                    onClick={handleConfirmSave}
                                    disabled={isSaving}
                                    className="py-2.5 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {t('import.createNewAnyway') || 'Create New Profile Instead'}
                                </button>
                                <button
                                    onClick={() => { setPersonMatch(null); setShowConfirmModal(false); }}
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

            {/* Image Lightbox */}
            {expandedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setExpandedImage(null)}
                >
                    <button
                        onClick={() => setExpandedImage(null)}
                        className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full text-white text-xl flex items-center justify-center transition-colors"
                    >
                        ✕
                    </button>
                    <img
                        src={expandedImage}
                        alt=""
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
