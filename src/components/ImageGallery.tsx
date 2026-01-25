'use client';

import { useState } from "react";
import { useLanguage } from '@/context/LanguageContext';

export function ImageGallery({ adopterId, initialImages, onUpload, currentUser }: { adopterId: string, initialImages: any[], onUpload: (id: string, url: string, caption: string) => Promise<void>, currentUser: string }) {
    const { t } = useLanguage();
    const [images, setImages] = useState(initialImages);
    const [uploading, setUploading] = useState(false);

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
            await onUpload(adopterId, base64, 'Uploaded Image');
            // Optimistic update with prepend and ownership
            setImages([{
                url: base64,
                caption: 'Uploaded Image',
                createdAt: new Date(),
                addedBy: currentUser,
                id: 'temp-' + Date.now()
            }, ...images]);
        } catch (error) {
            console.error('Image upload failed:', error);
            alert('Failed to upload image. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {images.map((img, idx) => (
                    <div key={idx} className="aspect-square bg-emerald-50 rounded-xl overflow-hidden relative group border border-emerald-100/50">
                        <img src={img.url} className="w-full h-full object-cover" />

                        {/* Delete Button - Top Right - Direct Child */}
                        {(img.id && (img.addedBy === currentUser || ((!img.addedBy || img.addedBy === 'anonymous') && currentUser === 'Anon: Guest'))) && (
                            <button
                                onClick={async (e) => {
                                    e.preventDefault();
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
                                className="absolute top-0 right-0 m-3 p-2 bg-white/90 hover:bg-white text-rose-600 rounded-xl shadow-md z-50 transition-all hover:scale-105 backdrop-blur-sm"
                                title={t('common.delete')}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                        )}

                        {/* Caption - Bottom Overlay */}
                        <div className="absolute inset-x-0 bottom-0 p-3 pt-10 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-10 flex items-end">
                            <p className="text-white text-xs truncate font-medium">
                                {img.addedBy ? (
                                    <span className="flex items-center gap-1">
                                        <span className="opacity-75 font-normal">{t('common.added_by')}</span>
                                        <span>{img.addedBy.replace('User: ', '')}</span>
                                    </span>
                                ) : img.caption}
                            </p>
                        </div>
                    </div>
                ))}

                <label className="aspect-square bg-emerald-50/50 border-2 border-dashed border-emerald-200/60 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 transition-all group">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                    <span className="text-3xl text-emerald-300 group-hover:text-emerald-500 transition-colors">+</span>
                    <span className="text-xs text-emerald-600/70 group-hover:text-emerald-700 font-bold mt-1 uppercase tracking-wide">{uploading ? t('adopter.uploading') : t('adopter.upload_image')}</span>
                </label>
            </div>

        </div>
    );
}
