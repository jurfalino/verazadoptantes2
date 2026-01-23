'use client';

import { useState } from "react";
import { useLanguage } from '@/context/LanguageContext';

export function ImageGallery({ adopterId, initialImages, onUpload }: { adopterId: string, initialImages: any[], onUpload: (id: string, url: string, caption: string) => Promise<void> }) {
    const { t } = useLanguage();
    const [images, setImages] = useState(initialImages);
    const [uploading, setUploading] = useState(false);

    // Simplistic Base64 upload for MVP
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64 = reader.result as string;
            // In real app, upload to R2 here and get URL
            await onUpload(adopterId, base64, 'Uploaded Image');
            setImages([...images, { url: base64, caption: 'Uploaded Image', createdAt: new Date() }]);
            setUploading(false);
        };
        reader.readAsDataURL(file);
    };

    return (
        <div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {images.map((img, idx) => (
                    <div key={idx} className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative group">
                        <img src={img.url} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <p className="text-white text-xs truncate">{img.caption}</p>
                        </div>
                    </div>
                ))}

                <label className="aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                    <span className="text-2xl text-gray-400">+</span>
                    <span className="text-xs text-gray-500 mt-1">{uploading ? t('adopter.uploading') : t('adopter.upload_image')}</span>
                </label>
            </div>
            {images.length === 0 && (
                <p className="text-sm text-gray-400 italic text-center py-4">{t('adopter.no_images')}</p>
            )}
        </div>
    );
}
