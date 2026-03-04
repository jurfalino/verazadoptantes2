'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { StarRating } from '@/components/StarRating';
import { deleteAdoption, getAdoptionImages } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { getRecordTypeIcon } from '@/lib/recordTypeColors';
import { useShowToast } from '@/components/ui/Toast';
import { getSourceIcon, getSourceName } from '@/lib/sourceIcons';
import { formatShortDate } from '@/lib/dates';
import { isAdmin as isAdminEmail } from '@/config/admins-shared';
import { MediaLightbox, MediaThumbnail, isVideo } from '@/components/ui/MediaLightbox';
import type { MediaItem } from '@/components/ui/MediaLightbox';

import AdoptionForm from './AdoptionForm';



interface Adoption {
    id: string;
    animalName: string | null;
    status: string | null;
    rating: number | null;
    details: string | null;
    date: Date | null;
    addedBy: string | null;
    recordType?: string;
    sourceUrl?: string | null;
    images?: { id: string; url: string; caption?: string | null }[];
}

interface AdoptionImage {
    id: string;
    url: string;
    caption?: string | null;
}

export default function AdoptionHistory({ adoptions: initialAdoptions, adopterId, currentUser, isAdmin = false, adopterAddress = '' }: { adoptions: Adoption[], adopterId: string, currentUser: string, isAdmin?: boolean, adopterAddress?: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [_deletingId, setDeletingId] = useState<string | null>(null);
    const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
    const [adoptionImages, setAdoptionImages] = useState<Record<string, AdoptionImage[]>>({});

    // Check for editAdoption query param to auto-expand
    const editAdoptionParam = searchParams.get('editAdoption');
    const [editingId, setEditingId] = useState<string | null>(editAdoptionParam);

    // Fetch images for all adoptions on mount
    useEffect(() => {
        async function fetchAllImages() {
            const imageMap: Record<string, AdoptionImage[]> = {};
            await Promise.all(
                initialAdoptions.map(async (adoption) => {
                    try {
                        const images = await getAdoptionImages(adoption.id);
                        if (images.length > 0) {
                            imageMap[adoption.id] = images;
                        }
                    } catch (e) {
                        // Ignore errors for individual adoptions
                    }
                })
            );
            setAdoptionImages(imageMap);
        }
        fetchAllImages();
    }, [initialAdoptions]);

    // Scroll to and highlight the editing card if opened via URL param
    useEffect(() => {
        if (editAdoptionParam && editingId === editAdoptionParam) {
            // Scroll to the adoption card after a short delay to allow render
            setTimeout(() => {
                const element = document.getElementById(`adoption-${editAdoptionParam}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);

            // Clean up URL param to avoid re-expanding on refresh
            const url = new URL(window.location.href);
            url.searchParams.delete('editAdoption');
            window.history.replaceState({}, '', url.toString());
        }
    }, [editAdoptionParam, editingId]);

    const handleDelete = async (adoptionId: string) => {
        if (!confirm('Are you sure you want to delete this adoption record? This action cannot be undone.')) return;

        setDeletingId(adoptionId);
        try {
            await deleteAdoption(adoptionId, adopterId);
            router.refresh();
        } catch (error) {
            console.error('Failed to delete adoption:', error);
            toast.error('Error', 'Failed to delete adoption record.');
        } finally {
            setDeletingId(null);
        }
    };

    if (initialAdoptions.length === 0) return null;

    return (
        <>
            {/* Lightbox Modal */}
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />

            <div className="space-y-4 pb-6">
                {initialAdoptions.map((adoption) => {
                    if (editingId === adoption.id) {
                        return (
                            <div key={adoption.id} id={`adoption-${adoption.id}`}>
                                <AdoptionForm
                                    adopterId={adopterId}
                                    initialData={adoption}
                                    onCancel={() => setEditingId(null)}
                                    onSuccess={() => {
                                        setEditingId(null);
                                        router.refresh();
                                    }}
                                    onDelete={() => handleDelete(adoption.id)}
                                    currentUser={currentUser}
                                    adopterAddress={adopterAddress}
                                />
                            </div>
                        );
                    }

                    const canEdit = isAdmin || adoption.addedBy === currentUser;
                    const images = adoptionImages[adoption.id] || [];
                    const recordType = adoption.recordType || 'adoption';
                    const species = (adoption as any).species || '';
                    const speciesLabel = species ? (t(`species.${species.toLowerCase()}`) || species) : '';

                    // Build one-line summary: "{icon} {date} — {verb} {animal} ({species})"
                    const icon = getRecordTypeIcon(recordType);
                    const dateStr = adoption.date ? formatShortDate(new Date(adoption.date)) : '';
                    const animalName = adoption.animalName || '';

                    let summary = '';
                    switch (recordType) {
                        case 'adoption':
                            summary = animalName
                                ? `${t('adoption.verb_adopted') || 'adopted'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_adopted') || 'adopted'} ${speciesLabel}`;
                            break;
                        case 'adoption_request':
                            summary = `${t('adoption.verb_requested') || 'requested'} ${speciesLabel || animalName} ${t('adoption.word_adoption') ?? 'adoption'}`.trim();
                            break;
                        case 'observation':
                            summary = animalName
                                ? `${t('adoption.verb_noted') || 'noted about'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_noted') || 'noted about'} ${speciesLabel}`;
                            break;
                        case 'follow_up':
                            summary = animalName
                                ? `${t('adoption.verb_followed_up') || 'followed up on'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_followed_up') || 'followed up on'} ${speciesLabel}`;
                            break;
                        case 'returned_pet':
                            summary = animalName
                                ? `${t('adoption.verb_returned') || 'returned'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_returned') || 'returned'} ${speciesLabel}`;
                            break;
                        default:
                            summary = animalName || speciesLabel || recordType;
                    }

                    // Border-left color class based on record type
                    const borderLeftMap: Record<string, string> = {
                        adoption: 'border-l-emerald-400',
                        adoption_request: 'border-l-sky-400',
                        observation: 'border-l-amber-400',
                        follow_up: 'border-l-violet-400',
                        returned_pet: 'border-l-rose-400',
                    };
                    const borderLeftClass = borderLeftMap[recordType] || 'border-l-emerald-400';

                    return (
                        <div
                            key={adoption.id}
                            id={`adoption-${adoption.id}`}
                            className={`bg-white rounded-xl p-4 shadow-sm border border-stone-200 border-l-4 ${borderLeftClass} relative overflow-hidden transition-all hover:shadow-md group`}
                        >
                            {/* Whole card clickable for edit */}
                            {canEdit && (
                                <div
                                    className="absolute inset-0 cursor-pointer z-0"
                                    onClick={() => setEditingId(adoption.id)}
                                    title={t('common.edit')}
                                />
                            )}

                            <div className="relative z-10 pointer-events-none">
                                {/* Header: icon + date + summary + stars */}
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-semibold text-stone-800 leading-snug">
                                        {icon} {dateStr}{dateStr ? ' — ' : ''}{summary}
                                    </p>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {adoption.rating != null && adoption.rating > 0 && (
                                            <StarRating value={adoption.rating} size="sm" />
                                        )}
                                        {canEdit && (
                                            <span className="text-stone-400 text-xs font-medium underline opacity-0 group-hover:opacity-100 transition-opacity">
                                                {t('common.edit')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Notes - consistent neutral color */}
                                {adoption.details && (
                                    <p className="text-stone-800 text-sm mt-2.5 leading-relaxed bg-stone-100 p-2.5 rounded-lg">
                                        {adoption.details}
                                    </p>
                                )}

                                {/* Image Thumbnails */}
                                {images.length > 0 && (
                                    <div className="mt-2.5 flex flex-wrap gap-2 pointer-events-auto relative z-20">
                                        {images.slice(0, 4).map((img) => (
                                            <MediaThumbnail
                                                key={img.id}
                                                item={{ url: img.url, caption: img.caption || undefined, mediaType: (img as any).mediaType || undefined }}
                                                onClick={() => setLightboxItem({ url: img.url, caption: img.caption || undefined, mediaType: (img as any).mediaType || undefined })}
                                                size="md"
                                            />
                                        ))}
                                        {images.length > 4 && (
                                            <div className="w-20 h-20 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-center text-stone-500 text-xs font-bold">
                                                +{images.length - 4}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Footer: source link + addedBy */}
                                <div className="mt-2.5 flex items-center gap-2 text-xs text-stone-400 font-medium">
                                    {adoption.sourceUrl && (
                                        <a
                                            href={adoption.sourceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-stone-400 hover:text-stone-600 transition-colors pointer-events-auto"
                                            title={getSourceName(adoption.sourceUrl)}
                                        >
                                            {getSourceIcon(adoption.sourceUrl, 'w-3.5 h-3.5')}
                                        </a>
                                    )}
                                    {adoption.addedBy && !isAdminEmail(adoption.addedBy) && (
                                        <span>{t('common.added_by')} {adoption.addedBy}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
