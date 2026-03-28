'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useShowToast } from '@/components/ui/Toast';
import { RatingBadge } from '@/components/RatingBadge';
import { formatShortDate } from '@/lib/dates';
import type { EnrichmentResult } from '@/app/actions/enrichAdopters';

// ── Types ────────────────────────────────────────────────────────────────

interface AdopterRow {
    id: string;
    name: string;
    contactInfo: string | null;
    country: string | null;
    addedBy: string | null;
    createdAt: Date | string | null;
    updatedAt: Date | string | null;
}

interface EnrichedAdopter {
    adopter: AdopterRow;
    enrichment: EnrichmentResult | null;
}

interface CountrySummary {
    code: string | null;
    count: number;
}

interface Props {
    adopters: EnrichedAdopter[];
    countries: CountrySummary[];
}

// ── Country helpers ──────────────────────────────────────────────────────

function countryFlag(code: string): string {
    if (code.length !== 2) return '🌍';
    const upper = code.toUpperCase();
    return String.fromCodePoint(
        ...upper.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
}

// Common Latin American + major countries for the dropdown
const COUNTRY_OPTIONS = [
    { code: 'AR', name: 'Argentina' },
    { code: 'BO', name: 'Bolivia' },
    { code: 'BR', name: 'Brasil' },
    { code: 'CL', name: 'Chile' },
    { code: 'CO', name: 'Colombia' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'MX', name: 'México' },
    { code: 'PA', name: 'Panamá' },
    { code: 'PE', name: 'Perú' },
    { code: 'PY', name: 'Paraguay' },
    { code: 'UY', name: 'Uruguay' },
    { code: 'VE', name: 'Venezuela' },
    { code: 'US', name: 'United States' },
    { code: 'ES', name: 'España' },
];

// ── Component ────────────────────────────────────────────────────────────

export default function AdminAdopterList({ adopters, countries }: Props) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [actionCountry, setActionCountry] = useState('');
    const router = useRouter();
    const toast = useShowToast();

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        if (selectedIds.size === adopters.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(adopters.map(a => a.adopter.id)));
        }
    }, [adopters, selectedIds.size]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setActionCountry('');
    }, []);

    // ── Mass action handler ──────────────────────────────────────────────

    const executeMassAction = useCallback(async (action: 'delete' | 'set_country', country?: string) => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        if (action === 'delete') {
            const confirmed = confirm(
                `Are you sure you want to permanently delete ${ids.length} adopter${ids.length > 1 ? 's' : ''} and all related data?\n\nThis cannot be undone.`
            );
            if (!confirmed) return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/admin/mass-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, adopterIds: ids, ...(country && { country }) }),
            });

            const data = await res.json() as { success: boolean; processedCount: number; errors?: string[] };

            if (data.success) {
                toast.success(
                    action === 'delete' ? 'Deleted' : 'Country Updated',
                    `${data.processedCount} record${data.processedCount > 1 ? 's' : ''} updated.`
                );
                clearSelection();
                router.refresh();
            } else {
                toast.error('Action Failed', data.errors?.join(', ') || 'Unknown error');
            }
        } catch (e) {
            console.error('Mass action error:', e);
            toast.error('Action Failed', 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    }, [selectedIds, clearSelection, router, toast]);

    // ── Render ───────────────────────────────────────────────────────────

    return (
        <>
            {/* Select All toggle */}
            <div className="flex items-center gap-3 mb-2">
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-stone-600">
                    <input
                        type="checkbox"
                        checked={selectedIds.size === adopters.length && adopters.length > 0}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                    Select all ({adopters.length})
                </label>
                {selectedIds.size > 0 && (
                    <span className="text-xs text-teal-700 font-medium">
                        {selectedIds.size} selected
                    </span>
                )}
            </div>

            {/* Card list */}
            <div className="space-y-3">
                {adopters.map(({ adopter, enrichment }) => {
                    const isSelected = selectedIds.has(adopter.id);
                    const avgRating = enrichment?.avgRating ?? null;
                    const stats = enrichment?.stats ?? { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
                    const flags = enrichment?.flags ?? {
                        inaccurate: false, duplicate: false, systemDuplicate: false,
                        verified_identity: false, verified_address: false,
                        tooManyAdoptions: null, tooManyRequests: null
                    };
                    const thumbnail = enrichment?.thumbnail ?? null;
                    const addedDate = adopter.createdAt ? formatShortDate(adopter.createdAt) : null;
                    const updatedDate = adopter.updatedAt ? formatShortDate(adopter.updatedAt) : null;


                    return (
                        <div
                            key={adopter.id}
                            className={`bg-white rounded-xl p-4 shadow-sm border transition-all ${
                                isSelected
                                    ? 'border-teal-400 ring-2 ring-teal-100 shadow-md'
                                    : 'border-stone-200 hover:border-teal-300 hover:shadow-md'
                            }`}
                        >
                            {/* Top Row: Checkbox + Avatar + Name/Contact + Country + Rating */}
                            <div className="flex items-center gap-3 mb-3">
                                {/* Checkbox */}
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelect(adopter.id)}
                                    className="w-4 h-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500 cursor-pointer flex-shrink-0"
                                />
                                {/* Thumbnail */}
                                <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                    {thumbnail ? (
                                        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-stone-500">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                        </div>
                                    )}
                                </div>
                                {/* Name + Contact + ID */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-stone-900 truncate">{adopter.name}</div>
                                    <div className="text-xs text-stone-500 truncate">
                                        {adopter.contactInfo || '-'}
                                    </div>
                                    <div className="text-xs text-stone-500 font-mono truncate">{adopter.id}</div>
                                </div>
                                {/* Country badge */}
                                {adopter.country && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">
                                        {countryFlag(adopter.country)} {adopter.country.toUpperCase()}
                                    </span>
                                )}
                                {/* Rating Badge */}
                                {avgRating !== null && (
                                    <RatingBadge rating={avgRating} size="sm" />
                                )}
                            </div>

                            {/* Stats Row */}
                            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                                <span>👁 {stats.profileViews} views</span>
                                <span>📋 {stats.requests} requests</span>
                                <span>🏠 {stats.adoptions} adoptions</span>
                                {/* Flags */}
                                <div className="flex flex-wrap gap-1 ml-auto">
                                    {flags.inaccurate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700">⚠ Inaccurate</span>
                                    )}
                                    {flags.duplicate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">📄 Duplicate</span>
                                    )}
                                    {flags.systemDuplicate && !flags.duplicate && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-stone-100 text-stone-500">🔗 Possible dup</span>
                                    )}
                                    {flags.verified_identity && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ Identity</span>
                                    )}
                                    {flags.verified_address && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ Address</span>
                                    )}
                                    {flags.tooManyAdoptions && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {flags.tooManyAdoptions.count} adoptions/{flags.tooManyAdoptions.periodDays}d</span>
                                    )}
                                    {flags.tooManyRequests && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {flags.tooManyRequests.count} requests/{flags.tooManyRequests.periodDays}d</span>
                                    )}
                                </div>
                            </div>

                            {/* Bottom Row: Dates + Added By + Actions */}
                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-stone-100">
                                <div className="flex gap-3 text-xs text-stone-500">
                                    {addedDate && <span>📅 {addedDate}</span>}
                                    {updatedDate && <span>✏️ {updatedDate}</span>}
                                    {adopter.addedBy && adopter.addedBy !== 'anonymous' && (
                                        <span className="text-stone-500">by {adopter.addedBy}</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Link
                                        href={`/adopter/${adopter.id}`}
                                        target="_blank"
                                        className="px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
                                    >
                                        Edit
                                    </Link>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Sticky Action Bar ─────────────────────────────────────────── */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-0 left-0 right-0 z-50 bg-stone-900 text-white shadow-2xl border-t border-stone-700">
                    <div className="max-w-6xl mx-auto flex items-center gap-4 px-6 py-4">
                        {/* Count */}
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-600 text-white text-sm font-semibold">
                            ✓ {selectedIds.size} selected
                        </span>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Set Country */}
                        <div className="flex items-center gap-2">
                            <select
                                value={actionCountry}
                                onChange={e => setActionCountry(e.target.value)}
                                disabled={loading}
                                className="px-3 py-2 rounded-xl bg-stone-800 text-white text-sm border border-stone-600 focus:ring-teal-500 focus:border-teal-500 disabled:opacity-50"
                            >
                                <option value="">Set Country…</option>
                                {COUNTRY_OPTIONS.map(c => (
                                    <option key={c.code} value={c.code}>
                                        {countryFlag(c.code)} {c.name} ({c.code})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => executeMassAction('set_country', actionCountry)}
                                disabled={loading || !actionCountry}
                                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Applying…' : 'Apply'}
                            </button>
                        </div>

                        {/* Divider */}
                        <div className="w-px h-8 bg-stone-600" />

                        {/* Delete */}
                        <button
                            onClick={() => executeMassAction('delete')}
                            disabled={loading}
                            className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Deleting…' : 'Delete'}
                        </button>

                        {/* Cancel */}
                        <button
                            onClick={clearSelection}
                            disabled={loading}
                            className="px-4 py-2 rounded-xl bg-stone-700 text-stone-300 text-sm font-semibold hover:bg-stone-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
