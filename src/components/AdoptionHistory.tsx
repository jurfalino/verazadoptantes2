'use client';

import { useState, useEffect, type ComponentType } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import { StarIcon } from '@/components/StarIcon';
import { getRatingColors } from '@/lib/ratingColors';
import { deleteAdoption, getAdoptionImages } from '@/app/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { getRecordTypeColors } from '@/lib/recordTypeColors';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { getSourceIcon, getSourceName } from '@/lib/sourceIcons';
import { formatShortDate, formatRelativeTime } from '@/lib/dates';
import { emailHandle } from '@/lib/userDisplay';
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

// Per-record-type left-stripe color. Tailwind sees these as literal strings so they survive purge.
const STRIPE_BY_TYPE: Record<string, string> = {
    adoption: 'border-l-teal-500',
    adoption_request: 'border-l-sky-500',
    observation: 'border-l-amber-500',
    follow_up: 'border-l-violet-500',
    returned_pet: 'border-l-rose-500',
    foster: 'border-l-indigo-500',
};

// Inline SVG record-type icons. Lucide-style strokes; inherit color from parent via currentColor
// so the surrounding badge's text color drives the icon hue.
function RecordTypeIcon({ type, className }: { type: string; className?: string }) {
    const cls = className || 'w-4 h-4';
    const common = {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
        className: cls,
    };
    switch (type) {
        case 'adoption':
            return (<svg {...common}><path d="M3 9.5L12 2l9 7.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2V9.5z" /></svg>);
        case 'adoption_request':
            return (<svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
        case 'observation':
            return (<svg {...common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);
        case 'follow_up':
            return (<svg {...common}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>);
        case 'returned_pet':
            return (<svg {...common}><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>);
        default:
            return (<svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>);
    }
}

export default function AdoptionHistory({ adoptions: initialAdoptions, adopterId, currentUser, isAdmin = false, adopterAddress = '', userNameMap = {}, editFormComponent: EditComponent }: { adoptions: Adoption[], adopterId: string, currentUser: string, isAdmin?: boolean, adopterAddress?: string, userNameMap?: Record<string, string>, editFormComponent: ComponentType<{ adopterId: string; initialData: Adoption; onCancel: () => void; onSuccess: () => void; onDelete: () => void; currentUser?: string; adopterAddress?: string; adopterAdoptions?: Adoption[] }> }) {
    const { t, locale } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [_deletingId, setDeletingId] = useState<string | null>(null);
    const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
    const [adoptionImages, setAdoptionImages] = useState<Record<string, AdoptionImage[]>>({});
    const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

    const toggleNote = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedNotes(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // G — Activity summary above the timeline
    const summaryCounts = initialAdoptions.reduce((acc, a) => {
        const rt = a.recordType || 'adoption';
        acc[rt] = (acc[rt] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const ratedAdoptions = initialAdoptions.filter(a => a.rating != null && Number(a.rating) > 0);
    const avgRating = ratedAdoptions.length > 0
        ? (ratedAdoptions.reduce((s, a) => s + Number(a.rating), 0) / ratedAdoptions.length)
        : null;

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

            {/* G — Activity summary: counts + avg rating */}
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                {summaryCounts.adoption > 0 && (
                    <span><strong className="text-teal-700">{summaryCounts.adoption}</strong> {t('stats.adoptions') || 'adopciones'}</span>
                )}
                {summaryCounts.adoption_request > 0 && (
                    <span><strong className="text-sky-700">{summaryCounts.adoption_request}</strong> {t('stats.requests') || 'solicitudes'}</span>
                )}
                {summaryCounts.observation > 0 && (
                    <span><strong className="text-amber-700">{summaryCounts.observation}</strong> {t('stats.observations') || 'observaciones'}</span>
                )}
                {summaryCounts.follow_up > 0 && (
                    <span><strong className="text-violet-700">{summaryCounts.follow_up}</strong> {t('stats.follow_ups') || 'seguimientos'}</span>
                )}
                {summaryCounts.returned_pet > 0 && (
                    <span><strong className="text-rose-700">{summaryCounts.returned_pet}</strong> {t('stats.returns') || 'devoluciones'}</span>
                )}
                {summaryCounts.foster > 0 && (
                    <span><strong className="text-indigo-700">{summaryCounts.foster}</strong> {t('stats.fosters') || 'tránsitos'}</span>
                )}
                {avgRating != null && (
                    <span className="ml-auto inline-flex items-center gap-1 font-semibold">
                        <StarIcon className={`w-3 h-3 ${getRatingColors(avgRating).text}`} />
                        <span>{avgRating.toFixed(1)}</span>
                        <span className="font-normal text-stone-500">{t('stats.rating_avg_short') || 'promedio'}</span>
                    </span>
                )}
            </div>

            <div id="adoption-history" className="relative pb-6 scroll-mt-4">
                {/* Vertical timeline connector — neutral; per-event color comes from dots and card stripe */}
                <div className="absolute left-[7px] md:left-[15px] top-3 bottom-3 w-0.5 bg-stone-200 rounded-full" />

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
                                    adopterAdoptions={initialAdoptions}
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
                        case 'foster':
                            summary = animalName
                                ? `${t('adoption.verb_fostered') || 'recibió en tránsito'} ${animalName}${speciesLabel ? ` (${speciesLabel})` : ''}`
                                : `${t('adoption.verb_fostered') || 'recibió en tránsito'} ${speciesLabel}`;
                            break;
                        default:
                            summary = animalName || speciesLabel || recordType;
                    }

                    return (
                        <div key={adoption.id} id={`adoption-${adoption.id}`} className="relative">
                            {/* Timeline beacon — record-type signal lives here (dot color + icon
                                inside, centered). Replaces the empty colored dot and the redundant
                                in-card icon badge that used to live in the header column. */}
                            <div
                                className={`absolute left-[-4px] md:left-[-3px] top-3 w-6 h-6 md:w-8 md:h-8 rounded-full ${colors.dot} text-white flex items-center justify-center ring-2 ${colors.ring} ring-offset-2 ring-offset-stone-50 z-10 shadow-sm`}
                                aria-hidden
                            >
                                <RecordTypeIcon type={recordType} className="w-3.5 h-3.5 md:w-4 md:h-4" />
                            </div>

                            {/* Card */}
                            <div
                                className={`relative ml-6 md:ml-10 rounded-2xl border ${colors.border} border-l-4 ${STRIPE_BY_TYPE[recordType] || STRIPE_BY_TYPE.adoption} bg-white shadow-sm transition-all hover:shadow-md group ${canEdit ? 'cursor-pointer' : ''}`}
                                onClick={canEdit ? () => setEditingId(adoption.id) : undefined}
                                title={canEdit ? t('common.edit') : undefined}
                            >
                                <div className="p-3 md:p-4">
                                    {/* A+B — 3-column header: Rating | Verb+Animal | Date */}
                                    <div className="flex items-start gap-2 md:gap-3">
                                        {/* Rating column — fixed-width slot creates vertical scan axis */}
                                        <div className="flex-shrink-0 w-12 md:w-14 pt-0.5 flex justify-center">
                                            {adoption.rating != null && adoption.rating > 0 ? (
                                                <RatingBadge rating={adoption.rating} size="sm" />
                                            ) : (
                                                <span className="text-stone-300 text-xs select-none" aria-hidden>—</span>
                                            )}
                                        </div>

                                        {/* Verb + animal — fluid middle. Record-type icon now lives in
                                            the timeline beacon to the left of the card; the verb leads
                                            the column directly. */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-stone-800 leading-snug">
                                                {summary}
                                                {/* Active-foster pill: foster records default to status='active' on
                                                    create; once the rescuer marks the foster ended (status='completed')
                                                    the pill goes away. Only relevant for foster type. */}
                                                {recordType === 'foster' && adoption.status === 'active' && (
                                                    <span className="ml-2 inline-flex items-center text-xs px-1.5 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700 align-middle">
                                                        {t('adoption.foster_active') || 'En curso'}
                                                    </span>
                                                )}
                                                {canEdit && (
                                                    <span className="text-teal-600 md:opacity-0 md:group-hover:opacity-100 transition-opacity inline-flex items-center ml-1.5 align-middle">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </span>
                                                )}
                                            </p>
                                        </div>

                                        {/* Date — right, muted; relative time on hover */}
                                        <div
                                            className="flex-shrink-0 text-xs text-stone-500 font-medium pt-1.5 whitespace-nowrap"
                                            title={relativeTime || undefined}
                                        >
                                            {dateStr}
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
                                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                                                    {t('adoption.neutered') || 'Neutered'}
                                                </span>
                                            )}
                                            {adoption.neutered === 0 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-500">
                                                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                    {t('adoption.neutered_no_label') || 'Not neutered'}
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

                                    {/* E — Notes: clamped to 2 lines with leer más toggle */}
                                    {adoption.details && (() => {
                                        const isExpanded = expandedNotes.has(adoption.id);
                                        const isLong = adoption.details.length > 120;
                                        return (
                                            <div className="mt-2.5 bg-stone-50 border border-stone-100 p-2.5 rounded-lg">
                                                <p className={`text-stone-600 text-xs leading-relaxed ${!isExpanded && isLong ? 'line-clamp-2' : ''}`}>
                                                    {adoption.details}
                                                </p>
                                                {isLong && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => toggleNote(adoption.id, e)}
                                                        className="mt-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                                                    >
                                                        {isExpanded ? (t('common.show_less') || 'leer menos') : (t('common.show_more') || 'leer más')}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}

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
                                                        <svg className="w-4 h-4 text-teal-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></svg>
                                                        <span className="text-sm font-medium text-teal-700">{t('dashboard.view_signed_contract') || 'View Signed Contract'}</span>
                                                        <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
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
                                                <svg className="w-4 h-4 text-teal-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
                                                <span className="text-sm font-medium text-teal-700">{t('adopter.form_view_responses') || 'Ver formulario completado'}</span>
                                                <svg className="w-3.5 h-3.5 ml-auto text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
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

                                    {/* F — Compact audit-trail footer: source link + creator. Both always visible (vetting requires audit at-a-glance). */}
                                    {(() => {
                                        const showSource = adoption.sourceUrl && !adoption.sourceUrl.startsWith('form:');
                                        const showAddedBy = adoption.addedBy && !isAdminEmail(adoption.addedBy) && adoption.addedBy !== currentUser;
                                        if (!showSource && !showAddedBy) return null;
                                        return (
                                            <div className="mt-2.5 pt-2 border-t border-stone-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                                                {showSource && (
                                                    <a
                                                        href={adoption.sourceUrl!}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title={getSourceName(adoption.sourceUrl!)}
                                                        className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-800 transition-colors"
                                                    >
                                                        {getSourceIcon(adoption.sourceUrl!, 'w-3.5 h-3.5')}
                                                        <span>{getSourceName(adoption.sourceUrl!)}</span>
                                                    </a>
                                                )}
                                                {showAddedBy && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                                        {t('common.added_by')} <strong className="font-medium text-stone-700 break-all">{userNameMap?.[adoption.addedBy!] || emailHandle(adoption.addedBy!)}</strong>
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })()}
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
