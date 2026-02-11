'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { StarRating } from '@/components/StarRating';
import { deleteAdoption, getAdoptionImages } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { getRecordTypeColors } from '@/lib/recordTypeColors';
import { useShowToast } from '@/components/ui/Toast';
import { getSourceIcon, getSourceName } from '@/lib/sourceIcons';
import { formatShortDate } from '@/lib/dates';
import { isAdmin as isAdminEmail } from '@/config/admins-shared';

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

export default function AdoptionHistory({ adoptions: initialAdoptions, onEdit, adopterId, currentUser, isAdmin = false, adopterAddress = '' }: { adoptions: Adoption[], onEdit: (adoption: Adoption) => void, adopterId: string, currentUser: string, isAdmin?: boolean, adopterAddress?: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
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
            {lightboxImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setLightboxImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white text-3xl hover:text-gray-300"
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

                    const isNegative = adoption.status === 'returned' || adoption.status === 'failed';
                    const canEdit = isAdmin || adoption.addedBy === currentUser;
                    const images = adoptionImages[adoption.id] || [];

                    return (
                        <div
                            key={adoption.id}
                            id={`adoption-${adoption.id}`}
                            className="bg-white rounded-xl p-5 shadow-sm border border-emerald-100 relative overflow-hidden transition-all hover:shadow-md group"
                        >
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${isNegative ? 'bg-rose-400' : 'bg-emerald-400'}`} />

                            {/* Whole card clickable for edit */}
                            {canEdit && (
                                <div
                                    className="absolute inset-0 cursor-pointer z-0"
                                    onClick={() => setEditingId(adoption.id)}
                                    title={t('common.edit')}
                                />
                            )}

                            <div className="relative z-10 pointer-events-none">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-base text-emerald-950">{adoption.animalName}</h4>
                                            {(adoption as any).species && (() => {
                                                const raw = (adoption as any).species.toLowerCase();
                                                const label = t(`species.${raw}`) || (adoption as any).species;
                                                return (
                                                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                                        {label}
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        {(() => {
                                            const typeColors = getRecordTypeColors(adoption.recordType || 'adoption');
                                            return (
                                                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full mt-1 ${typeColors.bg} ${typeColors.text}`}>
                                                    {t('adoption.record_types.' + (adoption.recordType || 'adoption'))}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {adoption.rating && (
                                            <StarRating value={adoption.rating} size="sm" />
                                        )}

                                        {/* Action Link - visible on hover (pointer-events-auto needed since parent is pointer-events-none) */}
                                        {canEdit && (
                                            <span className="text-emerald-600/60 text-xs font-medium underline opacity-0 group-hover:opacity-100 transition-opacity">
                                                {t('common.edit')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {adoption.details && (
                                    <p className="text-emerald-800/80 text-sm mt-3 leading-relaxed bg-emerald-50/50 p-3 rounded-lg border border-emerald-100/50">
                                        {adoption.details}
                                    </p>
                                )}

                                {/* Adoption Images */}
                                {images.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2 pointer-events-auto">
                                        {images.slice(0, 4).map((img) => (
                                            <button
                                                key={img.id}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setLightboxImage(img.url);
                                                }}
                                                className="relative group/img"
                                            >
                                                <img
                                                    src={img.url}
                                                    alt={img.caption || 'Adoption photo'}
                                                    className="w-14 h-14 object-cover rounded-lg border border-emerald-200 hover:border-emerald-400 transition-colors"
                                                />
                                                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                                                    <svg className="w-4 h-4 text-white opacity-0 group-hover/img:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                                    </svg>
                                                </div>
                                            </button>
                                        ))}
                                        {images.length > 4 && (
                                            <div className="w-14 h-14 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 text-xs font-bold">
                                                +{images.length - 4}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-3 flex items-center justify-between text-xs font-medium">
                                    <span className="text-emerald-500">
                                        {adoption.date ? formatShortDate(new Date(adoption.date)) : t('adoption.date_unknown')}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {/* Source URL link */}
                                        {adoption.sourceUrl && (
                                            <a
                                                href={adoption.sourceUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-emerald-500 hover:text-emerald-600 transition-colors"
                                                title={getSourceName(adoption.sourceUrl)}
                                            >
                                                {getSourceIcon(adoption.sourceUrl, 'w-3.5 h-3.5')}
                                            </a>
                                        )}
                                        {/* Added by - hide admin emails */}
                                        {adoption.addedBy && !isAdminEmail(adoption.addedBy) && (
                                            <span className="text-emerald-400 bg-emerald-50/50 px-2 py-0.5 rounded-full border border-emerald-100/30">
                                                {t('common.added_by')} {adoption.addedBy}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
