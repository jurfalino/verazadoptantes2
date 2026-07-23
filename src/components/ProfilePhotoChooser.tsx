'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { setProfilePicture } from '@/app/actions';
import type { AdopterImage } from '@/types/adopter';

/** r2.dev-hosted images route through the proxy; everything else (data URLs,
 *  other CDNs) renders directly. Mirrors the pattern in AdopterForm/ImageGallery. */
function displaySrc(url: string): string {
    return url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
}

interface ProfilePhotoChooserProps {
    isOpen: boolean;
    onClose: () => void;
    /** Profile-level images (adoptionId IS NULL) — the same list AdopterForm holds. */
    images: AdopterImage[];
    adopterId: string;
    /** Triggers the parent's hidden file input for the upload path. */
    onUploadNew: () => void;
}

/**
 * Lets an authenticated user set one of the profile's existing photos as the
 * avatar — the gap that previously forced every avatar click into the file
 * picker. Reuses the `setProfilePicture` server action (no new backend). On a
 * successful set we reload so the avatar + "Profile" badge update everywhere,
 * matching the current avatar-upload flow.
 *
 * The parent decides whether to open this at all: if there's nothing to choose
 * from (0 photos, or the only photo is already the avatar) it opens the file
 * picker directly instead, so this component always has a real choice to offer.
 */
export default function ProfilePhotoChooser({ isOpen, onClose, images, adopterId, onUploadNew }: ProfilePhotoChooserProps) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [settingId, setSettingId] = useState<string | null>(null);

    // Close on Escape.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Only real, persisted images are selectable (temp/optimistic rows can't be set).
    const selectable = images.filter((img) => img.id && !img.id.startsWith('temp-'));

    const handleSelect = async (imageId: string, isCurrent: boolean) => {
        if (isCurrent || settingId) return;
        setSettingId(imageId);
        try {
            await setProfilePicture(adopterId, imageId);
            toast.success('✓', t('adopter.upload_success') || 'Profile photo updated.');
            // Reload so the server-rendered avatar + badge reflect the new pick.
            window.location.reload();
        } catch (err) {
            toast.error(t('errors.generic'), t('adopter.set_profile_pic_failed') || 'Could not set the profile photo.', extractErrorId(err));
            setSettingId(null);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('adopter.choose_profile_photo') || 'Choose a profile photo'}
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-stone-200 p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-stone-900">
                        {t('adopter.choose_profile_photo') || 'Choose a profile photo'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close') || 'Close'}
                        className="p-1.5 -m-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100 transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-2.5 max-h-[60vh] overflow-y-auto">
                    {selectable.map((img) => {
                        const isCurrent = img.isProfilePicture === 1;
                        const busy = settingId === img.id;
                        return (
                            <button
                                key={img.id}
                                type="button"
                                onClick={() => handleSelect(img.id!, isCurrent)}
                                disabled={isCurrent || !!settingId}
                                aria-current={isCurrent || undefined}
                                title={isCurrent ? (t('adopter.current_profile_photo') || 'Current photo') : (t('adopter.set_as_profile') || 'Set as profile picture')}
                                className={`relative aspect-square rounded-xl overflow-hidden ring-2 transition-all focus:outline-none focus:ring-teal-500 ${
                                    isCurrent ? 'ring-teal-500 cursor-default' : 'ring-transparent hover:ring-teal-400 disabled:opacity-60'
                                }`}
                            >
                                <img src={displaySrc(img.url)} alt="" className="w-full h-full object-cover" />
                                {isCurrent && (
                                    <span className="absolute inset-0 bg-teal-700/25 flex items-center justify-center">
                                        <span className="w-6 h-6 rounded-full bg-teal-700 text-white flex items-center justify-center shadow">
                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M5 13l4 4L19 7" />
                                            </svg>
                                        </span>
                                    </span>
                                )}
                                {busy && (
                                    <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                        <svg className="w-5 h-5 text-teal-700 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                                            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                        </svg>
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    {/* Upload-new tile — always last, triggers the parent's file input. */}
                    <button
                        type="button"
                        onClick={() => { onClose(); onUploadNew(); }}
                        disabled={!!settingId}
                        className="aspect-square rounded-xl border-2 border-dashed border-stone-300 text-stone-500 hover:border-teal-400 hover:text-teal-700 transition-colors flex flex-col items-center justify-center gap-1 disabled:opacity-60"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        <span className="text-[11px] font-medium leading-tight text-center px-1">
                            {t('adopter.upload_new_photo') || 'Upload new photo'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
