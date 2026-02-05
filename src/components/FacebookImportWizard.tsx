'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
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
    const { t } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState(1); // 1=URL, 2=Review fetched, 3=AI results
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Step 1: URL input
    const [postUrl, setPostUrl] = useState('');

    // Step 2: Fetched content (editable before AI extraction)
    const [fetchedData, setFetchedData] = useState<FetchedPostData | null>(null);
    const [editableText, setEditableText] = useState('');
    const [manualImages, setManualImages] = useState<Array<{ data: string; mimeType: string; preview: string }>>([]);

    // Step 3: AI extracted data
    const [extractedData, setExtractedData] = useState<ExtractedAdopterData | null>(null);

    const handleOpen = () => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }
        setIsOpen(true);
    };

    const handleClose = () => {
        setIsOpen(false);
        setStep(1);
        setPostUrl('');
        setFetchedData(null);
        setEditableText('');
        setManualImages([]);
        setExtractedData(null);
        setError(null);
        onClose?.();
    };

    // Step 1: Fetch post from URL
    const handleFetchPost = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/facebook/fetch-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: postUrl }),
            });

            const result = await response.json() as {
                success?: boolean;
                data?: FetchedPostData;
                error?: string;
                requiresManualInput?: boolean;
            };

            if (!response.ok || !result.success) {
                if (result.requiresManualInput) {
                    // Allow manual input as fallback
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
            setStep(2);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch post');
        } finally {
            setLoading(false);
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
                }),
            });

            const result = await response.json() as { success?: boolean; data?: ExtractedAdopterData; error?: string };

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Extraction failed');
            }

            setExtractedData(result.data || null);
            setStep(3);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to extract data');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateAdopter = () => {
        const params = new URLSearchParams();

        if (extractedData?.name) {
            params.set('name', extractedData.name);
        }
        if (extractedData?.phones && extractedData.phones.length > 0) {
            params.set('contactInfo', extractedData.phones.join(', '));
        }
        if (extractedData?.addresses && extractedData.addresses.length > 0) {
            params.set('addressInfo', extractedData.addresses.join('\n'));
        }
        if (extractedData?.notes) {
            params.set('notes', extractedData.notes);
        }

        router.push(`/adopter/create?${params.toString()}`);
        handleClose();
    };

    // Closed state - show button
    if (!isOpen) {
        return (
            <button
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

                {/* Content */}
                <div className="p-6 space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    {/* Step 1: URL Input */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-stone-700 mb-2">
                                    Facebook Post URL
                                </label>
                                <input
                                    type="url"
                                    value={postUrl}
                                    onChange={(e) => setPostUrl(e.target.value)}
                                    placeholder="https://www.facebook.com/groups/.../posts/..."
                                    className="w-full px-4 py-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <p className="text-xs text-stone-400 mt-2">
                                    ⚠️ Only works with public posts. Private posts require manual input.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Review Fetched Content */}
                    {step === 2 && (
                        <div className="space-y-6">
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
                                        {fetchedData.images.map((url, idx) => (
                                            <div key={idx} className="aspect-square">
                                                <img
                                                    src={url}
                                                    alt={`Post image ${idx + 1}`}
                                                    className="w-full h-full object-cover rounded-lg"
                                                />
                                            </div>
                                        ))}
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
                                    {t('facebook.extractedAddresses') || 'Addresses'}
                                </label>
                                <textarea
                                    value={extractedData.addresses?.join('\n') || ''}
                                    onChange={(e) => setExtractedData({ ...extractedData, addresses: e.target.value.split('\n').filter(Boolean) })}
                                    className="w-full h-20 px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                                    placeholder={t('facebook.noAddresses') || 'No addresses detected'}
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
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-stone-200 bg-stone-50 rounded-b-2xl">
                    {step === 1 && (
                        <>
                            <button
                                onClick={handleClose}
                                className="px-4 py-2 text-stone-600 hover:text-stone-900 font-medium"
                            >
                                {t('common.cancel') || 'Cancel'}
                            </button>
                            <button
                                onClick={handleFetchPost}
                                disabled={loading || !postUrl.trim()}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-stone-300 disabled:cursor-not-allowed font-bold flex items-center gap-2"
                            >
                                {loading && (
                                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                )}
                                {loading ? 'Fetching...' : 'Fetch Post'}
                            </button>
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
                                onClick={handleCreateAdopter}
                                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold"
                            >
                                {t('facebook.createAdopter') || 'Create Adopter Record'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
