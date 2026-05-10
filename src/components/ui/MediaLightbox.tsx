'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';

export interface MediaItem {
    url: string;
    caption?: string;
    mediaType?: 'image' | 'video'; // explicit type from DB
    thumbnailUrl?: string; // Video thumbnail URL
}

interface MediaLightboxProps {
    item: MediaItem | null;
    onClose: () => void;
    /** Optional header actions (e.g. "Change photo" button) rendered to the left of the close button.
     *  Caller is responsible for layout/styling of injected nodes. */
    actions?: ReactNode;
}

/**
 * Detect if a URL points to a video based on:
 * 1. Explicit mediaType field (from database)
 * 2. File extension fallback
 */
export function isVideo(item: MediaItem): boolean {
    if (item.mediaType === 'video') return true;
    if (item.mediaType === 'image') return false;
    // Fallback: extension-based detection
    const path = item.url.split('?')[0].toLowerCase();
    return /\.(mp4|webm|mov)$/.test(path);
}

/**
 * A shared, reusable media lightbox component.
 *
 * - Images: displayed directly via <img>
 * - Videos: fetched via proxy → blob URL → <video> playback
 * - Loading spinner while video is downloading
 * - Blob URL cleanup on close
 */
export function MediaLightbox({ item, onClose, actions }: MediaLightboxProps) {
    const { t } = useLanguage();
    const [videoLoading, setVideoLoading] = useState(false);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const itemIsVideo = item ? isVideo(item) : false;

    // Resolve video URL when item changes
    useEffect(() => {
        if (!item || !itemIsVideo) {
            setBlobUrl(null);
            setError(null);
            setVideoLoading(false);
            return;
        }

        // Data URLs and blob URLs can be used directly
        if (item.url.startsWith('data:') || item.url.startsWith('blob:')) {
            setBlobUrl(item.url);
            setVideoLoading(false);
            setError(null);
            return;
        }

        // R2 and external URLs: route through proxy to avoid CORS and to read from R2 binding
        setBlobUrl(`/api/proxy-image?url=${encodeURIComponent(item.url)}`);
        setVideoLoading(false);
        setError(null);
    }, [item, itemIsVideo]);

    // Cleanup blob URL
    const handleClose = useCallback(() => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        setError(null);
        setVideoLoading(false);
        onClose();
    }, [blobUrl, onClose]);

    // Keyboard close
    useEffect(() => {
        if (!item) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [item, handleClose]);

    if (!item && !videoLoading) return null;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={handleClose}
        >
            {/* Header: optional caller actions + close button */}
            <div className="absolute top-4 right-4 flex items-center gap-3 z-10" onClick={e => e.stopPropagation()}>
                {actions}
                <button
                    className="text-white text-3xl hover:text-stone-300"
                    onClick={handleClose}
                    aria-label={t('common.close')}
                >
                    ×
                </button>
            </div>

            {/* Content */}
            {videoLoading ? (
                <div className="flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                    <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="text-white/80 text-sm">Loading video…</span>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center gap-3 text-white/80" onClick={e => e.stopPropagation()}>
                    <span className="text-4xl">⚠️</span>
                    <span className="text-sm">{error}</span>
                </div>
            ) : itemIsVideo && blobUrl ? (
                <video
                    src={blobUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-w-full max-h-full rounded-lg"
                    onClick={e => e.stopPropagation()}
                />
            ) : item ? (
                <img
                    src={item.url}
                    alt={item.caption || 'Full size'}
                    className="max-w-full max-h-full object-contain rounded-lg"
                    onClick={e => e.stopPropagation()}
                />
            ) : null}
        </div>
    );
}

/**
 * Reusable media thumbnail component for consistent sizing across the app.
 * Standard size: 80×80px (w-20 h-20).
 */
export function MediaThumbnail({
    item,
    onClick,
    size = 'md',
}: {
    item: MediaItem;
    onClick: () => void;
    size?: 'sm' | 'md' | 'lg';
}) {
    const sizeClasses = {
        sm: 'w-14 h-14',
        md: 'w-20 h-20',
        lg: 'w-24 h-24',
    };

    const videoItem = isVideo(item);

    return (
        <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
            className={`relative group/thumb ${sizeClasses[size]} rounded-lg overflow-hidden border border-stone-200 hover:border-stone-400 transition-colors cursor-pointer pointer-events-auto flex-shrink-0`}
        >
            {videoItem ? (
                <>
                    {/* Video thumbnail or teal gradient fallback */}
                    {item.thumbnailUrl ? (
                        <img
                            src={item.thumbnailUrl.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(item.thumbnailUrl)}` : item.thumbnailUrl}
                            alt={item.caption || 'Video'}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                // Fallback to teal gradient on error
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-teal-600 to-teal-800" />
                    )}
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-7 h-7 rounded-full bg-black/40 flex items-center justify-center shadow">
                            <svg className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <img
                        src={item.url.includes('r2.dev') ? `/api/proxy-image?url=${encodeURIComponent(item.url)}` : item.url}
                        alt={item.caption || 'Photo'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                    {/* Magnify icon on hover */}
                    <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                        <svg className="w-4 h-4 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                    </div>
                </>
            )}
        </button>
    );
}
