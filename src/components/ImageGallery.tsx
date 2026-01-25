'use client';

import { useState } from "react";
import { useLanguage } from '@/context/LanguageContext';

export function ImageGallery({ adopterId, initialImages, onUpload }: { adopterId: string, initialImages: any[], onUpload: (id: string, url: string, caption: string) => Promise<void> }) {
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
            // Update local state to show the image immediately
            setImages([...images, { url: base64, caption: 'Uploaded Image', createdAt: new Date() }]);
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
                        <div className="absolute inset-0 bg-emerald-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <p className="text-white text-xs truncate font-medium">{img.caption}</p>
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
