'use client';
export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RatingBadge } from '@/components/RatingBadge';
import { formatShortDate } from '@/lib/dates';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import PendingDedup from '@/components/PendingDedup';

import type { AdopterFlags } from '@/types/adopter';

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
    formCount?: number;
    addedBy?: string | null;
    /** v2.14.10-20: enum-via-text — 'manual' | 'form' | 'contract' | 'imported'. */
    source?: string;
}

/**
 * Source attribution pill (v2.14.10-20). Lives inline next to the adopter
 * name on /my-adopters rows. Omitted for `source='manual'` (default; showing
 * "Manual" everywhere is noise). All Tailwind classes verified themed per
 * memory feedback_themed_colors_only.
 */
function SourcePill({ source, t }: { source?: string; t: (key: string) => string }) {
    if (!source || source === 'manual') return null;
    if (source === 'form') return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-teal-50 text-teal-700" title={t('myAdopters.source_form_full') || 'Created from form submission'}>
            📝 {t('myAdopters.source_form') || 'Form'}
        </span>
    );
    if (source === 'contract') return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-800" title={t('myAdopters.source_contract_full') || 'Created from signed contract'}>
            ✍️ {t('myAdopters.source_contract') || 'Contract'}
        </span>
    );
    if (source === 'imported') return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-stone-100 text-stone-600" title={t('myAdopters.source_imported_full') || 'Imported in bulk'}>
            📥 {t('myAdopters.source_imported') || 'Imported'}
        </span>
    );
    return null;
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
            <span key="verified_id" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-teal-100 text-teal-700">
                ✓ Identidad
            </span>
        );
    }
    if (flags.verified_address) {
        badges.push(
            <span key="verified_addr" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-teal-100 text-teal-700">
                ✓ Direccion
            </span>
        );
    }
    if (flags.tooManyAdoptions) {
        badges.push(
            <span key="too_many_adoptions" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-orange-100 text-orange-700">
                ⚠ {flags.tooManyAdoptions.count} {t('stats.adoptions') || 'adoptions'} in {flags.tooManyAdoptions.actualSpanDays || flags.tooManyAdoptions.periodDays}d
            </span>
        );
    }
    if (flags.tooManyRequests) {
        badges.push(
            <span key="too_many_requests" className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap bg-purple-100 text-purple-700">
                ⚠ {flags.tooManyRequests.count} {t('stats.requests') || 'requests'} in {flags.tooManyRequests.actualSpanDays || flags.tooManyRequests.periodDays}d
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
    const { data: session } = useSession();
    const toast = useShowToast();
    const currentEmail = session?.user?.email || '';
    const [adopters, setAdopters] = useState<Adopter[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // v2.14.10-20: unlinked form submissions don't exist anymore — Phase 1
        // auto-creates the adopter at submit time. The pending-dedup feed
        // (rendered by <PendingDedup />) replaces the old "Unlinked Forms"
        // section. Adopters fetch stays as-is.
        async function fetchData() {
            try {
                const adoptersRes = await fetch('/api/my-adopters');
                if (adoptersRes.ok) {
                    const data = await adoptersRes.json() as Adopter[];
                    const byId = new Map<string, Adopter>();
                    data.forEach((a) => { if (!byId.has(a.id)) byId.set(a.id, a); });
                    setAdopters(Array.from(byId.values()));
                } else {
                    const body = await adoptersRes.json().catch(() => ({})) as { error?: string; errorId?: string };
                    toast.error(t('errors.generic') || 'Error', body.error || 'Failed to load adopters.', body.errorId);
                }
            } catch (e) {
                toast.error(t('errors.generic') || 'Error', 'Failed to load data.', extractErrorId(e));
            } finally {
                setLoading(false);
            }
        }
        fetchData();
        // toast/t are stable for this page; intentional one-time fetch on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                            className="p-2 text-stone-500 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                            title={t('common.back') || 'Back'}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <h1 className="text-2xl font-semibold text-stone-900">{t('dashboard.my_adopters')}</h1>
                        <span className="text-sm text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">{adopters.length}</span>
                    </div>
                    <Link
                        href="/adopter/create"
                        className="px-4 py-2 bg-teal-700 text-white font-semibold rounded-lg hover:bg-teal-600 transition-colors shadow-sm text-sm"
                    >
                        {t('dashboard.add_new_adopter')}
                    </Link>
                </div>

                {/* Pending-dedup pairs (replaces the old "Unlinked Forms" section
                    that existed before Phase 1 auto-created adopters at submit time). */}
                <PendingDedup />

                {adopters.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center border border-stone-200 shadow-sm">
                        <div className="w-14 h-14 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-500">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                        </div>
                        <h3 className="text-lg font-semibold text-stone-900 mb-2">{t('dashboard.no_adopters_title')}</h3>
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
                                {adopters.map((adopter, i) => (
                                    <Link
                                        key={`adopter-${adopter.id}-${i}`}
                                        href={`/adopter/${adopter.id}?ref=my-adopters`}
                                        prefetch={false}
                                        className="grid grid-cols-12 gap-2 px-4 py-3 hover:bg-stone-50 transition-colors group items-center"
                                    >
                                        {/* Name + Thumbnail */}
                                        <div className="col-span-4 flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                                {adopter.thumbnail ? (
                                                    <img src={adopter.thumbnail} alt={`${adopter.name} profile photo`} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate text-sm">{adopter.name}</div>
                                                    <SourcePill source={adopter.source} t={t} />
                                                </div>
                                                <div className="text-xs text-stone-500 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                                {adopter.addedBy && adopter.addedBy !== currentEmail && (
                                                    <div className="text-[10px] text-indigo-500 font-medium mt-0.5 truncate">👤 {t('organizations.added_by').replace('{name}', adopter.addedBy)}</div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Rating */}
                                        <div className="col-span-2 flex justify-center">
                                            {adopter.avgRating !== null && <RatingBadge rating={adopter.avgRating} size="sm" label="short" />}
                                        </div>

                                        {/* Stats */}
                                        <div className="col-span-2 flex flex-wrap justify-center gap-x-2 gap-y-1 text-xs text-stone-500">
                                            <span>👁 {adopter.profileViews}</span>
                                            <span>📋 {adopter.requestCount}</span>
                                            <span>🏠 {adopter.adoptionCount}</span>
                                            {(adopter.formCount ?? 0) > 0 && (
                                                <span className="text-teal-600 font-medium" title={t('dashboard.forms_linked') || 'Forms filled'}>
                                                    📄 {adopter.formCount} {(adopter.formCount ?? 0) === 1 ? (t('dashboard.form_count_one') || 'form') : (t('dashboard.form_count') || 'forms')}
                                                </span>
                                            )}
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
                                                    <span className="text-stone-500" title={t('dashboard.table_date_added') || 'Created'}>
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
                            {adopters.map((adopter, i) => (
                                <Link
                                    key={`adopter-${adopter.id}-${i}`}
                                    href={`/adopter/${adopter.id}?ref=my-adopters`}
                                    prefetch={false}
                                    className="block bg-white rounded-xl p-4 shadow-sm border border-stone-200 hover:border-teal-300 hover:shadow-md transition-all"
                                >
                                    {/* Top Row: Avatar + Name + Rating */}
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                            {adopter.thumbnail ? (
                                                <img src={adopter.thumbnail} alt={`${adopter.name} profile photo`} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="font-semibold text-stone-900 truncate">{adopter.name}</div>
                                                <SourcePill source={adopter.source} t={t} />
                                            </div>
                                            <div className="text-xs text-stone-500 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                            {adopter.addedBy && adopter.addedBy !== currentEmail && (
                                                <div className="text-[10px] text-indigo-500 font-medium mt-0.5 truncate">👤 {t('organizations.added_by').replace('{name}', adopter.addedBy)}</div>
                                            )}
                                        </div>
                                        {adopter.avgRating !== null && <RatingBadge rating={adopter.avgRating} size="sm" label="short" />}
                                    </div>

                                    {/* Stats Row */}
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                                        <span>👁 {adopter.profileViews} {t('stats.views')}</span>
                                        <span>📋 {adopter.requestCount} {t('stats.requests')}</span>
                                        <span>🏠 {adopter.adoptionCount} {t('stats.adoptions')}</span>
                                        {(adopter.formCount ?? 0) > 0 && (
                                            <span className="text-teal-600 font-medium">
                                                📄 {adopter.formCount} {(adopter.formCount ?? 0) === 1 ? (t('dashboard.form_count_one') || 'form') : (t('dashboard.form_count') || 'forms')}
                                            </span>
                                        )}
                                        {/* Flags on mobile */}
                                        <div className="flex gap-1 ml-auto">
                                            <FlagBadges flags={adopter.flags} t={t} />
                                        </div>
                                    </div>

                                    {/* Dates Row - bottom right */}
                                    <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-stone-100 text-xs text-stone-500">
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
