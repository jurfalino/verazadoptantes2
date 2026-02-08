'use client';
export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RatingBadge } from '@/components/RatingBadge';

interface AdopterFlags {
    inaccurate: boolean;
    duplicate: boolean;
    verified_identity: boolean;
    verified_address: boolean;
    tooManyAdoptions: { count: number; threshold: number; periodDays: number } | null;
    tooManyRequests: { count: number; threshold: number; periodDays: number } | null;
}

interface Adopter {
    id: string;
    name: string;
    contactInfo: string | null;
    status: string | null;
    createdAt: number | null;
    updatedAt: number | null;
    avgRating: number | null;
    thumbnail: string | null;
    flags: AdopterFlags;
    adoptionCount: number;
    requestCount: number;
    searchHits: number;
    profileViews: number;
}

// Format date as "Feb 4 '26" (3-letter month + day + year)
function formatShortDate(timestamp: number): string {
    const date = new Date(timestamp);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    return `${month} ${day} '${year}`;
}

// Flag badges component for displaying all flags
function FlagBadges({ flags, t }: { flags: AdopterFlags; t: (key: string) => string }) {
    const badges = [];

    if (flags.inaccurate) {
        badges.push(
            <span key="inaccurate" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-rose-100 text-rose-700">
                ⚠ {t('flags.inaccurate') || 'Inaccurate'}
            </span>
        );
    }
    if (flags.duplicate) {
        badges.push(
            <span key="duplicate" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-amber-100 text-amber-700">
                📄 {t('flags.duplicate') || 'Duplicate'}
            </span>
        );
    }
    if (flags.verified_identity) {
        badges.push(
            <span key="verified_id" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-emerald-100 text-emerald-700">
                ✓ Identidad
            </span>
        );
    }
    if (flags.verified_address) {
        badges.push(
            <span key="verified_addr" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-emerald-100 text-emerald-700">
                ✓ Direccion
            </span>
        );
    }
    if (flags.tooManyAdoptions) {
        badges.push(
            <span key="too_many_adoptions" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-orange-100 text-orange-700">
                ⚠ {flags.tooManyAdoptions.count} {t('stats.adoptions') || 'adoptions'}/{flags.tooManyAdoptions.periodDays}d
            </span>
        );
    }
    if (flags.tooManyRequests) {
        badges.push(
            <span key="too_many_requests" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-purple-100 text-purple-700">
                ⚠ {flags.tooManyRequests.count} {t('stats.requests') || 'requests'}/{flags.tooManyRequests.periodDays}d
            </span>
        );
    }

    if (badges.length === 0) {
        return <span className="text-xs text-stone-300">—</span>;
    }

    return <div className="flex flex-wrap gap-1">{badges}</div>;
}

export default function MyAdoptersPage() {
    const { t } = useLanguage();
    const [adopters, setAdopters] = useState<Adopter[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAdopters() {
            try {
                const res = await fetch('/api/my-adopters');
                if (res.ok) {
                    const data = await res.json() as Adopter[];
                    setAdopters(data);
                }
            } catch (e) {
                console.error('Failed to fetch adopters:', e);
            } finally {
                setLoading(false);
            }
        }
        fetchAdopters();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-stone-50 py-12 px-4 flex items-center justify-center">
                <div className="text-stone-500">{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-stone-50 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                            title={t('common.back') || 'Back'}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-stone-900">{t('dashboard.my_adopters')}</h1>
                        <span className="text-sm text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{adopters.length}</span>
                    </div>
                    <Link
                        href="/adopter/create"
                        className="px-4 py-2 bg-teal-500 text-white font-semibold rounded-lg hover:bg-teal-600 transition-colors shadow-sm text-sm"
                    >
                        {t('dashboard.add_new_adopter')}
                    </Link>
                </div>

                {adopters.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-14 h-14 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                        </div>
                        <h3 className="text-lg font-bold text-stone-900 mb-2">{t('dashboard.no_adopters_title')}</h3>
                        <p className="text-stone-500 mb-6 text-sm">{t('dashboard.no_adopters_desc')}</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table - Hidden on mobile */}
                        <div className="hidden md:block bg-white rounded-2xl overflow-hidden shadow-sm border border-stone-200">
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-stone-50 border-b border-stone-200 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                                <div className="col-span-4">{t('dashboard.table_adopter_name')}</div>
                                <div className="col-span-2 text-center">{t('dashboard.table_status')}</div>
                                <div className="col-span-2 text-center">{t('stats.profile_stats') ? 'Stats' : 'Stats'}</div>
                                <div className="col-span-2">{t('dashboard.table_flags')}</div>
                                <div className="col-span-2 text-right">{t('dashboard.table_dates') || 'Dates'}</div>
                            </div>

                            {/* Table Rows */}
                            <div className="divide-y divide-stone-100">
                                {adopters.map((adopter) => (
                                    <Link
                                        key={adopter.id}
                                        href={`/adopter/${adopter.id}?ref=my-adopters`}
                                        prefetch={false}
                                        className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-stone-50 transition-colors group items-center"
                                    >
                                        {/* Name + Thumbnail */}
                                        <div className="col-span-4 flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                                {adopter.thumbnail ? (
                                                    <img src={adopter.thumbnail} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-stone-400">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate text-sm">{adopter.name}</div>
                                                <div className="text-xs text-stone-400 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                            </div>
                                        </div>

                                        {/* Rating */}
                                        <div className="col-span-2 flex justify-center">
                                            <RatingBadge rating={adopter.avgRating !== null ? String(Math.round(adopter.avgRating)) : (adopter.status || '5')} size="sm" />
                                        </div>

                                        {/* Stats */}
                                        <div className="col-span-2 flex flex-wrap justify-center gap-x-2 gap-y-1 text-xs text-stone-500">
                                            <span>🔍 {adopter.searchHits}</span>
                                            <span>👁 {adopter.profileViews}</span>
                                            <span>📋 {adopter.requestCount}</span>
                                            <span>🏠 {adopter.adoptionCount}</span>
                                        </div>

                                        {/* Flags */}
                                        <div className="col-span-2">
                                            <FlagBadges flags={adopter.flags} t={t} />
                                        </div>

                                        {/* Dates - Both Created & Modified */}
                                        <div className="col-span-2 text-right text-xs text-stone-500">
                                            <div className="flex flex-col items-end gap-0.5">
                                                {adopter.updatedAt && (
                                                    <span title={t('dashboard.table_last_modified') || 'Modified'}>
                                                        ✏️ {formatShortDate(adopter.updatedAt)}
                                                    </span>
                                                )}
                                                {adopter.createdAt && (
                                                    <span className="text-stone-400" title={t('dashboard.table_date_added') || 'Created'}>
                                                        📅 {formatShortDate(adopter.createdAt)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* Mobile Cards - Hidden on desktop */}
                        <div className="md:hidden space-y-3">
                            {adopters.map((adopter) => (
                                <Link
                                    key={adopter.id}
                                    href={`/adopter/${adopter.id}?ref=my-adopters`}
                                    prefetch={false}
                                    className="block bg-white rounded-xl p-4 shadow-sm border border-stone-200 hover:border-teal-300 hover:shadow-md transition-all"
                                >
                                    {/* Top Row: Avatar + Name + Rating */}
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                            {adopter.thumbnail ? (
                                                <img src={adopter.thumbnail} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-400">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-stone-900 truncate">{adopter.name}</div>
                                            <div className="text-xs text-stone-400 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                        </div>
                                        <RatingBadge rating={adopter.avgRating !== null ? String(Math.round(adopter.avgRating)) : (adopter.status || '5')} size="sm" />
                                    </div>

                                    {/* Stats Row */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                                        <span>🔍 {adopter.searchHits} {t('stats.searches')}</span>
                                        <span>👁 {adopter.profileViews} {t('stats.views')}</span>
                                        <span>📋 {adopter.requestCount} {t('stats.requests')}</span>
                                        <span>🏠 {adopter.adoptionCount} {t('stats.adoptions')}</span>
                                        {/* Flags on mobile */}
                                        <div className="flex gap-1 ml-auto">
                                            <FlagBadges flags={adopter.flags} t={t} />
                                        </div>
                                    </div>

                                    {/* Dates Row - bottom right */}
                                    <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-stone-100 text-xs text-stone-400">
                                        {adopter.createdAt && (
                                            <span>📅 {formatShortDate(adopter.createdAt)}</span>
                                        )}
                                        {adopter.updatedAt && (
                                            <span>✏️ {formatShortDate(adopter.updatedAt)}</span>
                                        )}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
