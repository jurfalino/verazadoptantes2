'use client';
export const runtime = 'edge';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RatingBadge } from '@/components/RatingBadge';
import { RatingExplainer } from '@/components/RatingExplainer';
// formatShortDate dropped in v2.19.13 — the provenance cell uses relative
// time (timeAgo helper below) so absolute dates moved to tooltips.
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import PendingDedup from '@/components/PendingDedup';
import { AdopterName } from '@/components/AdopterName';
import { adopterDisplayName } from '@/lib/adopterDisplay';

import type { AdopterFlags } from '@/types/adopter';

interface Adopter {
    id: string;
    name: string;
    contactInfo: string | null;
    status: string | null;
    /** v2.19.14: Drizzle's `mode: 'timestamp'` columns return Date objects on
     *  the server but JSON-serialise to ISO strings on the wire, so the
     *  client receives strings. Earlier `number | null` typing was a lie
     *  that crashed prod via `date * 1000` / `.getTime()` on a string. */
    createdAt: number | string | null;
    updatedAt: number | string | null;
    avgRating: number | null;
    thumbnail: string | null;
    flags: AdopterFlags;
    adoptionCount: number;
    requestCount: number;
    searchHits: number;
    profileViews: number;
    formCount?: number;
    /** v2.19.10: signed contract_invitations.used_at IS NOT NULL count per adopter. */
    signedContractCount?: number;
    addedBy?: string | null;
    /** v2.19.6: resolved creator display name (user.name → email-prefix fallback).
     *  Null when the viewer is the creator — no need for a "by you" label. */
    creatorName?: string | null;
    /** v2.19.6: shared-org name with the viewer when possible, else creator's
     *  primary org, else null. Drives the "from {org}" subline. */
    creatorOrgName?: string | null;
    /** v2.19.13: true when the creator IS the viewing user. Drives self-vs-
     *  teammate chip color so a feed dominated by self-created rows doesn't
     *  read as a wall of teal pills. */
    creatorIsSelf?: boolean;
    /** v2.19.13: last-editor fields for the provenance cell. Null when the
     *  record has never been edited (saveAdopter not called post-create). */
    lastEditorName?: string | null;
    lastEditorOrgName?: string | null;
    lastEditedAt?: number | null;
    lastEditorIsSelf?: boolean;
    /** v2.14.10-20: enum-via-text — 'manual' | 'form' | 'contract' | 'imported'. */
    source?: string;
    /** v38: true when this adopter appears in a pending duplicate_candidates pair. */
    hasPendingDuplicate?: boolean;
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

/**
 * v2.19.13 provenance line — renders one lifecycle event ("Creado por X..."
 * or "Editado por Y...") as a single text row. Source pill renders inline
 * for `kind='created'` only (last-edit events don't change provenance).
 * Self-rows get a neutral stone chip; teammate-rows keep the teal chip so
 * the "this one's a teammate" semantic isn't washed out on a self-heavy
 * feed.
 */
function ProvenanceLine({
    kind, name, org, isSelf, sourceKind, date, t,
}: {
    kind: 'created' | 'edited';
    name: string | null | undefined;
    org: string | null | undefined;
    isSelf: boolean;
    sourceKind?: string;
    /** v2.19.14: accept string too — Drizzle Date columns serialise to ISO
     *  through NextResponse.json. `timeAgoSeconds` normalises all three. */
    date: number | Date | string | null | undefined;
    t: (key: string) => string;
}) {
    const isEs = true; // page already biases ES; tied to LanguageContext upstream if we ever surface EN here
    if (!name) {
        // Anonymous-sentinel or null fallthrough (kept consistent with
        // v2.19.8 unknown-creator UX — dash plus tooltip).
        if (kind === 'created') {
            return (
                <div className="flex items-center gap-1.5">
                    <span aria-hidden className="text-stone-400 flex-shrink-0">👤</span>
                    <span className="text-stone-300" title={t('myAdopters.created_by_unknown_hint') || 'Sin creador identificado'}>—</span>
                </div>
            );
        }
        return null;
    }
    const verb = kind === 'created'
        ? (t('dashboard.provenance_created_by') || 'Creado por')
        : (t('dashboard.provenance_edited_by') || 'Editado por');
    const chipClass = isSelf
        ? 'bg-stone-100 text-stone-600'    // your own org — factual, not a callout
        : 'bg-teal-50 text-teal-700';      // teammate's org — "this is a collaborator"
    const formatted = date ? timeAgo(date, isEs) : '';
    // v2.19.14 hotfix: same normalisation as timeAgo — date arrives as
    // string (ISO) for createdAt/updatedAt because Drizzle Date columns
    // round-trip through JSON.stringify. Avoid `date * 1000` which would
    // NaN out on a string and crash toISOString().
    const tooltipSec = timeAgoSeconds(date);
    const absoluteTooltip = tooltipSec ? new Date(tooltipSec * 1000).toISOString() : undefined;
    return (
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0">
            <span className="text-stone-500 flex-shrink-0">{verb}</span>
            <span className="font-medium text-stone-700 truncate max-w-[12rem]" title={name || undefined}>
                {name}
            </span>
            {org && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${chipClass} truncate max-w-[10rem]`} title={org}>
                    {org}
                </span>
            )}
            {kind === 'created' && sourceKind && sourceKind !== 'manual' && (
                <SourcePill source={sourceKind} t={t} />
            )}
            {formatted && (
                <span className="text-stone-400 flex-shrink-0 ml-auto" title={absoluteTooltip}>
                    {formatted}
                </span>
            )}
        </div>
    );
}

/**
 * v2.19.13 relative-time helper for the provenance cell. Compact strings —
 * "ahora", "hace 12 min", "hace 3 h", "hace 5 d", "hace 2 sem", "hace 4 mes",
 * "hace 1 año" — keep the cell at a glance and the tooltip carries the
 * absolute timestamp for precision.
 *
 * v2.19.14 PROD HOTFIX: input can also be a string. Drizzle columns with
 * `mode: 'timestamp'` return Date objects server-side, but
 * `NextResponse.json()` serialises Dates to ISO strings, so the client
 * receives `createdAt` / `updatedAt` as strings — not numbers, not Dates.
 * The Adopter interface previously typed these as `number | null` which
 * was the lie that crashed prod with "getTime is not a function". Now
 * we accept all three input shapes and normalise to seconds-epoch.
 */
function timeAgoSeconds(input: number | Date | string | null | undefined): number {
    if (input === null || input === undefined || input === '') return 0;
    if (typeof input === 'number') return input;
    if (input instanceof Date) return Math.floor(input.getTime() / 1000);
    // string: try ISO first, then epoch-as-string
    const isoMs = Date.parse(input);
    if (Number.isFinite(isoMs)) return Math.floor(isoMs / 1000);
    const asNum = Number(input);
    return Number.isFinite(asNum) ? asNum : 0;
}

function timeAgo(input: number | Date | string | null | undefined, isEs: boolean): string {
    const sec = timeAgoSeconds(input);
    if (!sec) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - sec);
    const mins = Math.floor(diff / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    if (mins < 1) return isEs ? 'ahora' : 'just now';
    if (mins < 60) return isEs ? `hace ${mins} min` : `${mins}m ago`;
    if (hrs < 24) return isEs ? `hace ${hrs} h` : `${hrs}h ago`;
    if (days < 7) return isEs ? `hace ${days} d` : `${days}d ago`;
    if (weeks < 5) return isEs ? `hace ${weeks} sem` : `${weeks}w ago`;
    if (months < 12) return isEs ? `hace ${months} mes` : `${months}mo ago`;
    return isEs ? `hace ${years} año${years === 1 ? '' : 's'}` : `${years}y ago`;
}

// Alert badges: warnings only. v39+: verified_identity / verified_address
// (positive signals) intentionally hidden from this column — the column now
// reads "Alertas" and should only carry concerns. Verifications live on the
// profile page; reviving them on the list belongs to a separate column if
// we ever want them visible there again.
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
                    that existed before Phase 1 auto-created adopters at submit time).
                    Anchor target for the per-row "🔍 Posible duplicado" pill (v38). */}
                <div id="pending-dedup" className="scroll-mt-20">
                    <PendingDedup />
                </div>

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
                            {/* Table Header. v2.19.13: Origin / Created-by /
                                Dates collapsed into one "Provenance" column that
                                renders the two lifecycle events (creation + last
                                edit) as sentence rows with the source pill inline
                                and relative timestamps. Name widens 3→4 cols to
                                fit the breathing room the previous layout owed it.
                                Rating cell keeps the v2.19.6 flag-badge stack. */}
                            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-stone-50 border-b border-stone-200 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                                <div className="col-span-4">{t('dashboard.table_adopter_name')}</div>
                                <div className="col-span-2 text-center">{t('dashboard.table_rating') || 'Calificación'}</div>
                                <div className="col-span-2">{t('dashboard.table_activity') || 'Actividad'}</div>
                                <div className="col-span-4">{t('dashboard.table_provenance') || 'Procedencia'}</div>
                            </div>

                            {/* Table Rows */}
                            <div className="divide-y divide-stone-100">
                                {adopters.map((adopter, i) => (
                                    <Link
                                        key={`adopter-${adopter.id}-${i}`}
                                        href={`/adopter/${adopter.id}?ref=my-adopters`}
                                        prefetch={false}
                                        // v2.19.13: pending-duplicate rows get an amber left-border
                                        // so the actionable row jumps out without sacrificing
                                        // any name-cell space. Matches the severity-tint pattern
                                        // OrgActivityFeed (v2.18.14) and /admin/audit (v2.19.5)
                                        // already use across the app.
                                        className={`grid grid-cols-12 gap-2 px-4 py-3 hover:bg-stone-50 transition-colors group items-center ${adopter.hasPendingDuplicate ? 'border-l-4 border-amber-400' : ''}`}
                                    >
                                        {/* Name + Thumbnail */}
                                        <div className="col-span-4 flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                                {adopter.thumbnail ? (
                                                    <img src={adopter.thumbnail} alt={`${adopterDisplayName(adopter, t('adopter.nameless'))} profile photo`} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <AdopterName adopter={adopter} className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate text-sm" title />
                                                    {adopter.hasPendingDuplicate && (
                                                        <a
                                                            href="#pending-dedup"
                                                            onClick={(e) => e.stopPropagation()}
                                                            title={t('myAdopters.row_pending_dup_tooltip') || 'Hay un posible duplicado pendiente de revisar arriba'}
                                                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap hover:bg-amber-100 flex-shrink-0"
                                                        >
                                                            🔍 {t('myAdopters.row_pending_dup') || 'Posible duplicado'}
                                                        </a>
                                                    )}
                                                </div>
                                                <div className="text-xs text-stone-500 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                                {/* Inline addedBy was moved to its own column in v2.19.6 —
                                                    keeps the Name cell focused on identity, lets the
                                                    Creado-por col carry the resolved name + org chip. */}
                                            </div>
                                        </div>

                                        {/* Calificación — avgRating from activity history (legacy `status` is deprecated).
                                            Flag badges stack underneath the rating badge in v2.19.6 so the
                                            severity signal and rating live together (a 5-star adopter with a
                                            density flag now reads in one glance instead of jumping to a
                                            separate column). Min-height pins both states to row height. */}
                                        <div className="col-span-2 flex flex-col items-center gap-1 min-h-[2rem]">
                                            {adopter.avgRating !== null ? (
                                                <RatingExplainer rating={adopter.avgRating}>
                                                    <RatingBadge rating={adopter.avgRating} size="sm" label="short" />
                                                </RatingExplainer>
                                            ) : (
                                                <span className="text-xs text-stone-300" title={t('myAdopters.rating_empty_hint') || 'Sin actividad calificada'}>—</span>
                                            )}
                                            <FlagBadges flags={adopter.flags} t={t} />
                                        </div>

                                        {/* Actividad — stacked stats with labels (v38). Each line has its own word
                                            so the column reads naturally instead of relying on emoji recall. */}
                                        <div className="col-span-2 text-xs text-stone-600 space-y-0.5">
                                            <div>👁 {adopter.profileViews} {adopter.profileViews === 1 ? (t('stats.view_one') || 'vista') : (t('stats.views') || 'vistas')}</div>
                                            <div>📋 {adopter.requestCount} {adopter.requestCount === 1 ? (t('stats.request_one') || 'pedido') : (t('stats.requests') || 'pedidos')}</div>
                                            <div>🏠 {adopter.adoptionCount} {adopter.adoptionCount === 1 ? (t('stats.adoption_one') || 'adopción') : (t('stats.adoptions') || 'adopciones')}</div>
                                            {(adopter.formCount ?? 0) > 0 && (
                                                <div className="text-teal-600 font-medium">
                                                    📄 {adopter.formCount} {(adopter.formCount ?? 0) === 1 ? (t('dashboard.form_count_one') || 'formulario') : (t('dashboard.form_count') || 'formularios')}
                                                </div>
                                            )}
                                            {(adopter.signedContractCount ?? 0) > 0 && (
                                                <div className="text-amber-700 font-medium">
                                                    ✍️ {adopter.signedContractCount} {(adopter.signedContractCount ?? 0) === 1 ? (t('dashboard.signed_contract_count_one') || 'contrato firmado') : (t('dashboard.signed_contract_count') || 'contratos firmados')}
                                                </div>
                                            )}
                                        </div>

                                        {/* Procedencia — v2.19.13. Two-event provenance cell:
                                            "Creado por X · Org · 📝 Pill · hace 3 meses" on top,
                                            "Editado por Y · Org · hace 2 días" below if ever edited.
                                            Replaces three separate columns (Origen, Creado-por,
                                            Dates). Self vs teammate chip color differs so a feed
                                            dominated by self-rows doesn't wall of teal: stone for
                                            "your org", teal for "teammate's org". */}
                                        <div className="col-span-4 text-xs text-stone-600 min-w-0 space-y-0.5">
                                            <ProvenanceLine
                                                kind="created"
                                                name={adopter.creatorName}
                                                org={adopter.creatorOrgName}
                                                isSelf={!!adopter.creatorIsSelf}
                                                sourceKind={adopter.source}
                                                date={adopter.createdAt}
                                                t={t}
                                            />
                                            {adopter.lastEditedAt && adopter.lastEditorName
                                                && (adopter.lastEditedAt - timeAgoSeconds(adopter.createdAt)) > 60 && (
                                                <ProvenanceLine
                                                    kind="edited"
                                                    name={adopter.lastEditorName}
                                                    org={adopter.lastEditorOrgName ?? null}
                                                    isSelf={!!adopter.lastEditorIsSelf}
                                                    date={adopter.lastEditedAt}
                                                    t={t}
                                                />
                                            )}
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
                                    // v2.19.13: amber left-border for pending-dup cards,
                                    // mirrors the desktop row treatment.
                                    className={`block bg-white rounded-xl p-4 shadow-sm border border-stone-200 hover:border-teal-300 hover:shadow-md transition-all ${adopter.hasPendingDuplicate ? 'border-l-4 border-l-amber-400' : ''}`}
                                >
                                    {/* Top Row: Avatar + Name + Rating */}
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                            {adopter.thumbnail ? (
                                                <img src={adopter.thumbnail} alt={`${adopterDisplayName(adopter, t('adopter.nameless'))} profile photo`} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                                <AdopterName adopter={adopter} className="font-semibold text-stone-900 truncate" title />
                                                {adopter.hasPendingDuplicate && (
                                                    <a
                                                        href="#pending-dedup"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title={t('myAdopters.row_pending_dup_tooltip') || 'Hay un posible duplicado pendiente de revisar arriba'}
                                                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap hover:bg-amber-100"
                                                    >
                                                        🔍 {t('myAdopters.row_pending_dup') || 'Posible duplicado'}
                                                    </a>
                                                )}
                                            </div>
                                            <div className="text-xs text-stone-500 truncate">{adopter.contactInfo || t('dashboard.no_contact')}</div>
                                            {/* v2.19.13: inline addedBy + bottom dates row from
                                                the mobile card are folded into the provenance lines
                                                at the bottom of the card. SourcePill no longer
                                                inline next to the name — it renders inside the
                                                "Creado por" provenance line where it belongs. */}
                                        </div>
                                        {adopter.avgRating !== null ? (
                                            <RatingExplainer rating={adopter.avgRating}>
                                                <RatingBadge rating={adopter.avgRating} size="sm" label="short" />
                                            </RatingExplainer>
                                        ) : (
                                            <span className="text-xs text-stone-300" title={t('myAdopters.rating_empty_hint') || 'Sin actividad calificada'}>—</span>
                                        )}
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
                                        {(adopter.signedContractCount ?? 0) > 0 && (
                                            <span className="text-amber-700 font-medium">
                                                ✍️ {adopter.signedContractCount} {(adopter.signedContractCount ?? 0) === 1 ? (t('dashboard.signed_contract_count_one') || 'contract') : (t('dashboard.signed_contract_count') || 'contracts')}
                                            </span>
                                        )}
                                        {/* Flags on mobile */}
                                        <div className="flex gap-1 ml-auto">
                                            <FlagBadges flags={adopter.flags} t={t} />
                                        </div>
                                    </div>

                                    {/* Provenance lines — same component as desktop. */}
                                    <div className="mt-2 pt-2 border-t border-stone-100 text-xs text-stone-600 space-y-0.5">
                                        <ProvenanceLine
                                            kind="created"
                                            name={adopter.creatorName}
                                            org={adopter.creatorOrgName}
                                            isSelf={!!adopter.creatorIsSelf}
                                            sourceKind={adopter.source}
                                            date={adopter.createdAt}
                                            t={t}
                                        />
                                        {adopter.lastEditedAt && adopter.lastEditorName
                                            && (adopter.lastEditedAt - timeAgoSeconds(adopter.createdAt)) > 60 && (
                                            <ProvenanceLine
                                                kind="edited"
                                                name={adopter.lastEditorName}
                                                org={adopter.lastEditorOrgName ?? null}
                                                isSelf={!!adopter.lastEditorIsSelf}
                                                date={adopter.lastEditedAt}
                                                t={t}
                                            />
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
