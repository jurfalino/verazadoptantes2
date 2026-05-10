'use client';
export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { RatingBadge } from '@/components/RatingBadge';
import { formatShortDate } from '@/lib/dates';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';

interface AdoptionImage {
    id: string;
    url: string;
    caption: string | null;
}

interface Adoption {
    id: string;
    animalName: string;
    species: string | null;
    adopterId: string | null;
    adopterName: string | null;
    date: number | null;
    rating: number | null;
    recordType: string | null;
    comments: string | null;
    images: AdoptionImage[];
    addedBy?: string | null;
}

function getContractUrl(comments: string | null | undefined): string | null {
    if (!comments) return null;
    try {
        const parsed = JSON.parse(comments) as { contractScreenshot?: string };
        return parsed?.contractScreenshot && typeof parsed.contractScreenshot === 'string' ? parsed.contractScreenshot : null;
    } catch {
        return null;
    }
}

const RECORD_TYPES = ['all', 'adoption', 'adoption_request', 'observation', 'follow_up', 'returned_pet'] as const;
type RecordTypeFilter = typeof RECORD_TYPES[number];

export default function MyAdoptionsPage() {
    const { t } = useLanguage();
    const { data: session } = useSession();
    const toast = useShowToast();
    const currentEmail = session?.user?.email || '';
    const searchParams = useSearchParams();
    // Default to the Adoption tab so the page matches the "Mis Adopciones" label
    // and the homepage chip count. Other record types remain reachable via tabs.
    // Fixed in v2.12.1-41.
    const filterParam = searchParams.get('filter') || 'adoption';
    const filter: RecordTypeFilter = RECORD_TYPES.includes(filterParam as RecordTypeFilter)
        ? (filterParam as RecordTypeFilter)
        : 'adoption';

    const [adoptions, setAdoptions] = useState<Adoption[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAdoptions() {
            try {
                const res = await fetch(`/api/my-adoptions?filter=${filter}`);
                if (res.ok) {
                    const data = await res.json() as Adoption[];
                    setAdoptions(data);
                } else {
                    const body = await res.json().catch(() => ({})) as { error?: string; errorId?: string };
                    toast.error(t('errors.generic') || 'Error', body.error || 'Failed to load adoptions.', body.errorId);
                }
            } catch (e) {
                toast.error(t('errors.generic') || 'Error', 'Failed to load adoptions.', extractErrorId(e));
            } finally {
                setLoading(false);
            }
        }
        fetchAdoptions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]);

    const getTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
            all: t('dashboard.filter_all') || 'All',
            adoption: t('adoption.type_adoption') || 'Adoption',
            adoption_request: t('adoption.type_adoption_request') || 'Request',
            observation: t('adoption.type_observation') || 'Observation',
            follow_up: t('adoption.type_follow_up') || 'Follow-up',
            returned_pet: t('adoption.type_returned_pet') || 'Returned',
        };
        return labels[type] || type;
    };

    const getTypeBadgeStyle = (type: string | null) => {
        switch (type) {
            case 'adoption':
                return 'bg-teal-100 text-teal-800';
            case 'adoption_request':
                return 'bg-blue-100 text-blue-800';
            case 'observation':
                return 'bg-purple-100 text-purple-800';
            case 'follow_up':
                return 'bg-amber-100 text-amber-800';
            case 'returned_pet':
                return 'bg-rose-100 text-rose-800';
            default:
                return 'bg-stone-100 text-stone-800';
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 py-12 px-4">
            <div className="max-w-6xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="text-stone-500 hover:text-stone-700 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">{t('dashboard.my_adoptions')}</h1>
                    </div>

                    <Link
                        href="/adopter/create"
                        className="px-5 py-2.5 bg-teal-200 text-teal-900 font-semibold rounded-xl hover:bg-teal-300 transition-colors shadow-sm whitespace-nowrap"
                    >
                        {t('dashboard.register_adoption')}
                    </Link>
                </div>

                {/* Type Filter Tabs - horizontal scroll on mobile, wrap on desktop */}
                <div className="bg-white p-1.5 rounded-xl border border-stone-200 mb-6 overflow-x-auto md:overflow-visible">
                    <div className="flex gap-1 md:flex-wrap min-w-0">
                        {RECORD_TYPES.map((type) => (
                            <Link
                                key={type}
                                href={`/my-adoptions?filter=${type}`}
                                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${filter === type
                                    ? 'bg-stone-800 text-white shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
                                    }`}
                            >
                                {getTypeLabel(type)}
                            </Link>
                        ))}
                    </div>
                </div>

                {adoptions.length === 0 ? (
                    <div className="bg-white rounded-3xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-500">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                        </div>
                        <h3 className="text-xl font-semibold text-stone-900 mb-2">{t('dashboard.no_adoptions_title')}</h3>
                        <p className="text-stone-500 mb-6">
                            {t('dashboard.no_records_for_filter') || 'No records found for this filter.'}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table - Hidden on mobile */}
                        <div className="hidden md:block bg-white rounded-2xl overflow-hidden shadow-sm border border-stone-200">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-stone-50 border-b border-stone-200 text-left">
                                        <th className="py-3 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">{t('dashboard.table_animal')}</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">{t('dashboard.table_type')}</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">{t('dashboard.table_adopter')}</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">{t('dashboard.table_date')}</th>
                                        <th className="py-3 px-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">{t('dashboard.table_rating')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {adoptions.map((adoption) => {
                                        const contractUrl = getContractUrl(adoption.comments);
                                        return (
                                        <tr key={adoption.id} className="hover:bg-stone-50/50 transition-colors group">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    {/* Thumbnails */}
                                                    {adoption.images && adoption.images.length > 0 && (
                                                        <div className="flex -space-x-2">
                                                            {adoption.images.slice(0, 3).map((img, idx) => (
                                                                <img
                                                                    key={img.id}
                                                                    src={img.url}
                                                                    alt={img.caption || 'Photo'}
                                                                    className="w-8 h-8 rounded-lg object-cover border-2 border-white shadow-sm"
                                                                    style={{ zIndex: 3 - idx }}
                                                                />
                                                            ))}
                                                            {adoption.images.length > 3 && (
                                                                <span className="w-8 h-8 rounded-lg bg-stone-200 border-2 border-white shadow-sm flex items-center justify-center text-xs font-semibold text-stone-600">
                                                                    +{adoption.images.length - 3}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div>
                                                        {adoption.adopterId ? (
                                                            <Link
                                                                href={`/adopter/${adoption.adopterId}?editAdoption=${adoption.id}`}
                                                                className="font-semibold text-stone-900 text-sm hover:text-teal-700 hover:underline transition-colors"
                                                            >
                                                                {adoption.animalName || t('adoption.unnamed') || 'Unnamed'}
                                                            </Link>
                                                        ) : (
                                                            <span className="font-semibold text-stone-900 text-sm">{adoption.animalName || t('adoption.unnamed') || 'Unnamed'}</span>
                                                        )}
                                                        <div className="text-xs text-stone-500 capitalize">{adoption.species || t('dashboard.unknown_species')}</div>
                                                        {adoption.addedBy && adoption.addedBy !== currentEmail && (
                                                            <div className="text-[10px] text-indigo-500 font-medium mt-0.5 truncate">👤 {t('organizations.added_by').replace('{name}', adoption.addedBy)}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getTypeBadgeStyle(adoption.recordType)}`}>
                                                    {getTypeLabel(adoption.recordType || 'adoption')}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {adoption.adopterId && adoption.adopterName ? (
                                                        <Link
                                                            href={`/adopter/${adoption.adopterId}`}
                                                            className="font-medium text-teal-700 hover:text-teal-900 hover:underline transition-colors text-sm"
                                                        >
                                                            {adoption.adopterName}
                                                        </Link>
                                                    ) : (
                                                        <span className="text-stone-500 italic text-sm">{t('dashboard.no_adopter') || '—'}</span>
                                                    )}
                                                    {contractUrl && (
                                                        <a
                                                            href={contractUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-2 rounded-lg bg-teal-50 px-2.5 py-2 text-xs font-medium text-teal-700 hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 min-h-[44px] md:min-h-0 md:py-1.5 transition-colors"
                                                            title={t('dashboard.view_signed_contract') || 'View signed contract'}
                                                        >
                                                            <span aria-hidden className="shrink-0">
                                                                <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                            </span>
                                                            <span>{t('dashboard.view_contract') || 'View contract'}</span>
                                                            <svg className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-stone-500 font-medium">
                                                {adoption.date ? formatShortDate(adoption.date) : t('dashboard.na')}
                                            </td>
                                            <td className="py-3 px-4">
                                                {adoption.rating && <RatingBadge rating={adoption.rating} size="sm" label="short" />}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards - Hidden on desktop */}
                        <div className="md:hidden space-y-3">
                            {adoptions.map((adoption) => {
                                const contractUrl = getContractUrl(adoption.comments);
                                return (
                                <div
                                    key={adoption.id}
                                    className="bg-white rounded-xl p-4 shadow-sm border border-stone-200"
                                >
                                    {/* Top Row: Image(s) + Animal Info + Rating */}
                                    <div className="flex items-start gap-3 mb-3">
                                        {/* Thumbnail or placeholder */}
                                        <div className="w-14 h-14 rounded-xl bg-stone-100 flex-shrink-0 overflow-hidden">
                                            {adoption.images && adoption.images.length > 0 ? (
                                                <img
                                                    src={adoption.images[0].url}
                                                    alt={adoption.images[0].caption || 'Photo'}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {adoption.adopterId ? (
                                                <Link
                                                    href={`/adopter/${adoption.adopterId}?editAdoption=${adoption.id}`}
                                                    className="font-semibold text-stone-900 hover:text-teal-700 transition-colors block"
                                                >
                                                    {adoption.animalName || t('adoption.unnamed') || 'Unnamed'}
                                                </Link>
                                            ) : (
                                                <span className="font-semibold text-stone-900">{adoption.animalName || t('adoption.unnamed') || 'Unnamed'}</span>
                                            )}
                                            <div className="text-xs text-stone-500 capitalize">{adoption.species || t('dashboard.unknown_species')}</div>
                                            {adoption.addedBy && adoption.addedBy !== currentEmail && (
                                                <div className="text-[10px] text-indigo-500 font-medium mt-0.5 truncate">👤 {t('organizations.added_by').replace('{name}', adoption.addedBy)}</div>
                                            )}
                                            {/* Type Badge */}
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${getTypeBadgeStyle(adoption.recordType)}`}>
                                                {getTypeLabel(adoption.recordType || 'adoption')}
                                            </span>
                                        </div>
                                        {adoption.rating && <RatingBadge rating={adoption.rating} size="sm" label="short" />}
                                    </div>

                                    {/* Info section - stacked on mobile to avoid cramped layout */}
                                    <div className="border-t border-stone-100 pt-3 space-y-3">
                                        {/* Row 1: Adopter name only */}
                                        <div className="text-xs text-stone-600">
                                            {adoption.adopterId && adoption.adopterName ? (
                                                <Link
                                                    href={`/adopter/${adoption.adopterId}`}
                                                    className="font-medium text-teal-700 hover:underline"
                                                >
                                                    👤 {adoption.adopterName}
                                                </Link>
                                            ) : (
                                                <span className="text-stone-500 italic">{t('dashboard.no_adopter') || '—'}</span>
                                            )}
                                        </div>
                                        {/* Row 2: Contract button (full width on narrow mobile) + Date */}
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            {contractUrl && (
                                                <a
                                                    href={contractUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-50 px-3 py-2.5 text-xs font-medium text-teal-700 hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 min-h-[44px] transition-colors w-full sm:w-auto"
                                                    title={t('dashboard.view_signed_contract') || 'View signed contract'}
                                                >
                                                    <svg className="w-4 h-4 shrink-0 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                    <span>{t('dashboard.view_contract') || 'View contract'}</span>
                                                    <svg className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                </a>
                                            )}
                                            <div className="text-xs text-stone-500 shrink-0">
                                                📅 {adoption.date ? formatShortDate(adoption.date) : t('dashboard.na')}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Additional images indicator */}
                                    {adoption.images && adoption.images.length > 1 && (
                                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-stone-100">
                                            <div className="flex -space-x-1">
                                                {adoption.images.slice(1, 4).map((img) => (
                                                    <img
                                                        key={img.id}
                                                        src={img.url}
                                                        alt={img.caption || `${adoption.animalName} photo`}
                                                        className="w-6 h-6 rounded-md object-cover border border-white"
                                                    />
                                                ))}
                                            </div>
                                            {adoption.images.length > 1 && (
                                                <span className="text-xs text-stone-500">+{adoption.images.length - 1} {t('common.photos') || 'photos'}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
