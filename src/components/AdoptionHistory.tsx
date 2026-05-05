'use client';

import { useState, useEffect, type ComponentType } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { deleteAdoption, getAdoptionImages } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { getRecordTypeIcon, getRecordTypeColors } from '@/lib/recordTypeColors';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { getSourceIcon, getSourceName } from '@/lib/sourceIcons';
import { formatShortDate, formatRelativeTime, maskEmail } from '@/lib/dates';
import { formatAge } from '@/lib/ageUtils';
import { isAdmin as isAdminEmail } from '@/config/admins-shared';
import { MediaLightbox, MediaThumbnail } from '@/components/ui/MediaLightbox';
import type { MediaItem } from '@/components/ui/MediaLightbox';

interface Adoption {
    id: string;
    animalName: string | null;
    status: string | null;
    rating: number | null;
    details: string | null;
    comments: string | null;
    date: Date | null;
    addedBy: string | null;

    recordType?: string;
    sourceUrl?: string | null;
    age?: string | null;
    estimatedBirthDate?: number | null;
    neutered?: number | null;
    sex?: string | null;
    color?: string | null;
    microchip?: string | null;
    images?: { id: string; url: string; caption?: string | null; mediaType?: 'image' | 'video' | null; thumbnailUrl?: string | null }[];
    verifiedAddress?: string | null;
    deliveredToHome?: boolean | number | null;
    species?: string | null;
}

interface AdoptionImage {
    id: string;
    url: string;
    caption?: string | null;
    mediaType?: 'image' | 'video' | null;
    thumbnailUrl?: string | null;
}

export default function AdoptionHistory({ adoptions: initialAdoptions, adopterId, currentUser, isAdmin = false, adopterAddress = '', userNameMap = {}, editFormComponent: EditComponent }: { adoptions: Adoption[], adopterId: string, currentUser: string, isAdmin?: boolean, adopterAddress?: string, userNameMap?: Record<string, string>, editFormComponent: ComponentType<{ adopterId: string; initialData: Adoption; onCancel: () => void; onSuccess: () => void; onDelete: () => void; currentUser?: string; adopterAddress?: string }> }) {
    const { t, locale } = useLanguage();
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
        if (!confirm(t('dialogs.confirm_delete_record'))) return;

        setDeletingId(adoptionId);
        try {
            await deleteAdoption(adoptionId, adopterId);
            router.refresh();
        } catch (error) {
            console.error('Failed to delete adoption:', error);
            toast.error(t('errors.generic'), t('errors.delete_record_failed'), extractErrorId(error));
        } finally {
            setDeletingId(null);
        }
    };

    if (initialAdoptions.length === 0) {
        return (
            <div className="py-6 text-center">
                <div className="text-3xl mb-2 opacity-60">📋</div>
                <p className="text-sm text-stone-500 font-medium">{t('adoption.no_activity') || 'No hay actividad registrada aún.'}</p>
                <p className="text-xs text-stone-400 mt-1">{t('adoption.no_activity_hint') || 'Registrá una adopción, solicitud o nota para comenzar.'}</p>
            </div>
        );
    }

    return (
        <>
            {/* Lightbox Modal */}
            <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />

            <div className="relative pb-6">
                {/* Vertical timeline connector */}
                <div className="absolute left-[7px] md:left-[15px] top-3 bottom-3 w-0.5 bg-gradient-to-b from-teal-300 via-violet-300 to-teal-300 rounded-full" />

                <div className="space-y-5">
                {initialAdoptions.map((adoption) => {
                    if (editingId === adoption.id) {
                        return (
                            <div key={adoption.id} id={`adoption-${adoption.id}`} className="relative ml-6 md:ml-10">
                                <EditComponent
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
                    const colors = getRecordTypeColors(recordType);
                    const species = adoption.species || '';
                    const speciesLabel = species ? (t(`species.${species.toLowerCase()}`) || species) : '';

                    // Build one-line summary: "{icon} {date} — {verb} {animal} ({species})"
                    const icon = getRecordTypeIcon(recordType);
                    const dateStr = adoption.date ? formatShortDate(new Date(adoption.date)) : '';
                    const relativeTime = adoption.date ? formatRelativeTime(new Date(adoption.date), 'es') : null;
                    const animalName = adoption.animalName || '';

                    let summary = '';
                    switch (recordType) {
                        case 'adoption':
                            summary = animalName
                                ? `${t('adoption.verb_adopted') || 'adopted'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_adopted') || 'adopted'} ${speciesLabel}`;
                            break;
                        case 'adoption_request':
                            summary = `${t('adoption.verb_requested') || 'requested adoption —'} ${speciesLabel || animalName}`.trim();
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

                    return (
                        <div key={adoption.id} id={`adoption-${adoption.id}`} className="relative">
                            {/* Timeline dot */}
                            <div className={`absolute left-0 md:left-1 top-5 w-[15px] h-[15px] md:w-[23px] md:h-[23px] rounded-full ${colors.dot} ring-2 md:ring-4 ${colors.ring} ring-offset-2 ring-offset-stone-50 z-10 shadow-sm`} />

                            {/* Card */}
                            <div
                                className={`ml-6 md:ml-10 rounded-2xl border ${colors.border} bg-white shadow-sm transition-all hover:shadow-md group ${canEdit ? 'cursor-pointer' : ''}`}
                                onClick={canEdit ? () => setEditingId(adoption.id) : undefined}
                                title={canEdit ? t('common.edit') : undefined}
                            >
                                <div className="p-3 md:p-4">
                                    {/* Header: icon badge (md+) + date + summary */}
                                    <div className="flex items-start gap-2">
                                        <div className={`hidden md:flex flex-shrink-0 w-8 h-8 rounded-lg ${colors.iconBg} items-center justify-center text-base shadow-sm mt-0.5`}>
                                            {icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-stone-800 leading-snug flex flex-wrap items-center gap-x-1.5">
                                                <span className="md:hidden">{icon} </span>{dateStr}{relativeTime && <span className="text-xs font-normal text-stone-400">({relativeTime})</span>}{dateStr ? ' — ' : ''}{summary}
                                                {adoption.rating != null && adoption.rating > 0 && (
                                                    <RatingBadge rating={adoption.rating} size="sm" />
                                                )}
                                                {canEdit && (
                                                    <span className="text-teal-600 md:opacity-0 md:group-hover:opacity-100 transition-opacity inline-flex items-center ml-0.5">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Animal details (sex, age, neutered, color, microchip) */}
                                    {(adoption.estimatedBirthDate || adoption.age || adoption.sex || adoption.color || adoption.microchip || adoption.neutered != null) && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {adoption.sex && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                                    {['male', 'macho'].includes(adoption.sex.toLowerCase()) ? '♂️' : ['female', 'hembra'].includes(adoption.sex.toLowerCase()) ? '♀️' : ''} {t(`adoption.sex_${adoption.sex.toLowerCase()}`) || adoption.sex}
                                                </span>
                                            )}
                                            {(adoption.estimatedBirthDate || adoption.age) && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                                    🎂 {adoption.estimatedBirthDate
                                                        ? formatAge(adoption.estimatedBirthDate, locale as 'es' | 'en')
                                                        : adoption.age}
                                                </span>
                                            )}
                                            {adoption.neutered === 1 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                    ✓ {t('adoption.neutered') || 'Neutered'}
                                                </span>
                                            )}
                                            {adoption.neutered === 0 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-500">
                                                    ✗ {t('adoption.neutered_no_label') || 'Not neutered'}
                                                </span>
                                            )}
                                            {adoption.color && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                                    🎨 {adoption.color}
                                                </span>
                                            )}
                                            {adoption.microchip && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                                                    💉 {adoption.microchip}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Verified Address badge — teal verification pill + truncated address */}
                                    {adoption.verifiedAddress && adoption.verifiedAddress.trim() !== '' && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-500/10 text-teal-600 border border-teal-500/20 flex-shrink-0">
                                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                                {t('flags.addr_verified') || 'Address'}
                                            </span>
                                            <span className="text-xs text-stone-500 truncate min-w-0" title={adoption.verifiedAddress}>{adoption.verifiedAddress}</span>
                                        </div>
                                    )}

                                    {/* Notes - consistent neutral color */}
                                    {adoption.details && (
                                        <p className="text-stone-600 text-xs mt-2.5 leading-relaxed bg-stone-50 border border-stone-100 p-2.5 rounded-lg">
                                            {adoption.details}
                                        </p>
                                    )}

                                    {/* Contract screenshot link (for adoptions) */}
                                    {adoption.comments && (() => {
                                        try {
                                            const parsed = JSON.parse(adoption.comments);
                                            if (parsed.contractScreenshot) {
                                                return (
                                                    <a
                                                        href={parsed.contractScreenshot}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 mt-2.5 p-2 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                                                        onClick={e => e.stopPropagation()}
                                                    >
                                                        <span className="text-sm">📋</span>
                                                        <span className="text-sm font-medium text-teal-700">{t('dashboard.view_signed_contract') || 'View Signed Contract'}</span>
                                                        <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                    </a>
                                                );
                                            }
                                        } catch { /* not JSON, ignore */ }
                                        return null;
                                    })()}

                                    {/* Form link (for adoption_requests) */}
                                    {recordType === 'adoption_request' && adoption.sourceUrl?.startsWith('form:') && (() => {
                                        const formSubmissionId = adoption.sourceUrl!.replace('form:', '');
                                        return (
                                            <a
                                                href={`/form-results/${formSubmissionId}`}
                                                className="flex items-center gap-2 mt-2.5 p-2 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <span className="text-sm">📝</span>
                                                <span className="text-sm font-medium text-teal-700">{t('adopter.form_view_responses') || 'Ver formulario completado'}</span>
                                                <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                        );
                                    })()}

                                    {/* Image Thumbnails */}
                                    {images.length > 0 && (
                                        <div className="mt-2.5 flex flex-wrap gap-2">
                                            {images.slice(0, 4).map((img) => (
                                                <MediaThumbnail
                                                    key={img.id}
                                                    item={{ url: img.url, caption: img.caption || undefined, mediaType: img.mediaType || undefined, thumbnailUrl: (img.thumbnailUrl && img.thumbnailUrl !== 'null') ? img.thumbnailUrl : undefined }}
                                                    onClick={() => setLightboxItem({ url: img.url, caption: img.caption || undefined, mediaType: img.mediaType || undefined, thumbnailUrl: (img.thumbnailUrl && img.thumbnailUrl !== 'null') ? img.thumbnailUrl : undefined })}
                                                    size="md"
                                                />
                                            ))}
                                            {images.length > 4 && (
                                                <div className="w-20 h-20 rounded-lg bg-stone-50 border border-stone-200 flex items-center justify-center text-stone-500 text-xs font-semibold">
                                                    +{images.length - 4}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Footer: date + onBehalfOf + source link + addedBy */}
                                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 font-medium">


                                        {adoption.sourceUrl && !adoption.sourceUrl.startsWith('form:') && (
                                            <a
                                                href={adoption.sourceUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-stone-500 hover:text-stone-600 transition-colors"
                                                title={getSourceName(adoption.sourceUrl)}
                                            >
                                                {getSourceIcon(adoption.sourceUrl, 'w-3.5 h-3.5')}
                                            </a>
                                        )}
                                        {adoption.addedBy && !isAdminEmail(adoption.addedBy) && adoption.addedBy !== currentUser && (
                                            <span>{t('common.added_by')} {userNameMap?.[adoption.addedBy] || maskEmail(adoption.addedBy)}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                </div>
            </div>
        </>
    );
}
