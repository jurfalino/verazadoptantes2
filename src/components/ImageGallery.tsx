'use client';

import { useState } from "react";
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { setProfilePicture } from '@/app/actions';

interface ImageItem {
    id?: string;
    url: string;
    caption?: string;
    addedBy?: string;
    isProfilePicture?: number;
}

export function ImageGallery({ adopterId, initialImages, onUpload, currentUser, isAdmin = false }: { adopterId: string, initialImages: ImageItem[], onUpload: (id: string, url: string, caption: string) => Promise<void | { id?: string }>, currentUser: string, isAdmin?: boolean }) {
    const { t } = useLanguage();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const [images, setImages] = useState<ImageItem[]>(initialImages);
    const [uploading, setUploading] = useState(false);
    const [settingProfile, setSettingProfile] = useState<string | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    // Helper to compress image before upload
    const compressImage = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Create canvas to resize image
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Calculate new dimensions (max 1200px on longest side)
                    const maxSize = 1200;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxSize) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to base64 with compression (0.8 quality)
                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                    resolve(base64);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    };

    // Simplistic Base64 upload for MVP
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        setUploading(true);
        try {
            // Compress image before uploading
            const base64 = await compressImage(file);
            // onUpload should return { id } from saveImage
            const result = await onUpload(adopterId, base64, 'Uploaded Image');
            // Use the real ID from server, or a temp fallback
            const newImageId = (result as { id?: string })?.id || 'temp-' + Date.now();
            // Optimistic update with prepend and ownership
            setImages([{
                url: base64,
                caption: 'Uploaded Image',
                addedBy: currentUser,
                id: newImageId,
                isProfilePicture: 0
            }, ...images]);
        } catch (error) {
            console.error('Image upload failed:', error);
            alert('Failed to upload image. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const handleSetProfilePicture = async (imageId: string) => {
        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin();
            return;
        }

        setSettingProfile(imageId);
        try {
            await setProfilePicture(adopterId, imageId);
            // Update local state
            setImages(images.map(img => ({
                ...img,
                isProfilePicture: img.id === imageId ? 1 : 0
            })));
        } catch (err) {
            console.error('Failed to set profile picture:', err);
            alert('Failed to set profile picture');
        } finally {
            setSettingProfile(null);
        }
    };

    return (
        <>
            {/* Lightbox Modal */}
            {lightboxImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setLightboxImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white text-3xl hover:text-gray-300 z-10"
                        onClick={() => setLightboxImage(null)}
                    >
                        ×
                    </button>
                    <img
                        src={lightboxImage}
                        alt="Full size"
                        className="max-w-full max-h-full object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    {images.map((img, idx) => (
                        <div
                            key={idx}
                            className={`aspect-square bg-emerald-50 rounded-xl overflow-hidden relative group border-2 ${img.isProfilePicture ? 'border-teal-400 ring-2 ring-teal-200' : 'border-emerald-100/50'
                                }`}
                        >
                            <img
                                src={img.url}
                                className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setLightboxImage(img.url)}
                            />

                            {/* Profile Picture Badge - Top Left */}
                            {img.isProfilePicture ? (
                                <div className="absolute top-0 left-0 m-2 px-2 py-1 bg-teal-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                                    {t('adopter.profile_picture') || 'Profile'}
                                </div>
                            ) : (
                                /* Set as Profile Button - Top Left - Show on Hover */
                                img.id && !img.id.startsWith('temp-') && (
                                    <button
                                        onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (img.id) await handleSetProfilePicture(img.id);
                                        }}
                                        disabled={settingProfile === img.id}
                                        className="absolute top-0 left-0 m-2 px-2 py-1 bg-white/90 hover:bg-teal-500 hover:text-white text-teal-700 text-xs font-bold rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 backdrop-blur-sm"
                                        title={t('adopter.set_as_profile') || 'Set as Profile Picture'}
                                    >
                                        {settingProfile === img.id ? (
                                            <span className="animate-pulse">...</span>
                                        ) : (
                                            <>
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                                                {t('adopter.set_profile') || 'Set Profile'}
                                            </>
                                        )}
                                    </button>
                                )
                            )}

                            {/* Delete Button - Top Right */}
                            {(img.id && (isAdmin || img.addedBy === currentUser)) && (
                                <button
                                    onClick={async (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const isAnon = document.cookie.includes('anon_user=true');
                                        if (!session?.user && !isAnon) {
                                            openLogin();
                                            return;
                                        }

                                        if (!confirm(t('common.delete') + '?')) return;
                                        try {
                                            const { deleteImage } = await import('@/app/actions');
                                            if (img.id) {
                                                await deleteImage(img.id, adopterId);
                                                setImages(images.filter(i => i.id !== img.id));
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            alert('Failed to delete');
                                        }
                                    }}
                                    className="absolute top-0 right-0 m-2 p-2 bg-white/90 hover:bg-white text-rose-600 rounded-xl shadow-md z-10 transition-all hover:scale-105 backdrop-blur-sm opacity-0 group-hover:opacity-100"
                                    title={t('common.delete')}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            )}

                            {/* Zoom indicator on hover */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none flex items-center justify-center">
                                <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-70 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                </svg>
                            </div>

                            {/* Caption - Bottom Overlay */}
                            <div className="absolute inset-x-0 bottom-0 p-3 pt-10 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-10 flex items-end">
                                <p className="text-white text-xs truncate font-medium">
                                    {img.addedBy ? (
                                        <span className="flex items-center gap-1">
                                            <span className="opacity-75 font-normal">{t('common.added_by')}</span>
                                            <span>{img.addedBy}</span>
                                        </span>
                                    ) : img.caption}
                                </p>
                            </div>
                        </div>
                    ))}

                    <label
                        onClick={(e) => {
                            const isAnon = document.cookie.includes('anon_user=true');
                            if (!session?.user && !isAnon) {
                                e.preventDefault();
                                openLogin();
                            }
                        }}
                        className="aspect-square bg-emerald-50/50 border-2 border-dashed border-emerald-200/60 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 transition-all group">
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                        <span className="text-3xl text-emerald-300 group-hover:text-emerald-500 transition-colors">+</span>
                        <span className="text-xs text-emerald-600/70 group-hover:text-emerald-700 font-bold mt-1 uppercase tracking-wide">{uploading ? t('adopter.uploading') : t('adopter.upload_image')}</span>
                    </label>
                </div>

            </div>
        </>
    );
}
