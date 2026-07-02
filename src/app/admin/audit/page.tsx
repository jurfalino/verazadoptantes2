'use client';

import { useEffect, useState } from 'react';
import { formatDateTimeFull } from '@/lib/dates';
import { useLanguage } from '@/context/LanguageContext';
import type { AuditSeverity, AuditSummary, AuditCategory } from '@/lib/auditRow';

/**
 * v2.19.5: full redesign.
 *
 * Before: a wide table with action chip + raw target UUID + device + IP,
 * and the actual "what happened" text hidden behind a per-row "▼ Details"
 * expand that printed the raw JSON. Useless for scanning.
 *
 * After: sentence rows. Each row is a one-line story — "Maria Pérez · 22:43 ·
 * 🔍 buscó \"juan gonzález\" · 3 resultados" — with adopter targets rendered
 * by name (linked), edit diffs surfaced inline, search queries visible
 * without a click. Severity tint on the left border. Device / IP / raw JSON
 * stay accessible as diagnostic side-info.
 *
 * Enrichment (actor name, adopter name, severity, per-locale AuditSummary)
 * happens server-side in `/api/admin/audit` — see `src/lib/auditRow.ts` for
 * the shared derivation helpers also used by `OrgActivityFeed`.
 */

interface EnrichedAuditEntry {
    id: string;
    user_id: string | null;
    user_email: string | null;
    action: string;
    target: string | null;
    details: string | null;
    device: string | null;
    is_pwa: number;
    ip_address: string | null;
    created_at: number;
    actorName: string;
    targetAdopterName: string | null;
    targetAdopterDeleted: boolean;
    severity: AuditSeverity;
    summaryEs: AuditSummary;
    summaryEn: AuditSummary;
}

const ACTION_ICON: Record<string, string> = {
    sign_in: '🔑', sign_out: '🚪',
    search: '🔍',
    profile_viewed: '👁',
    adopter_created: '➕', adopter_updated: '✏️', adopter_deleted: '🗑️',
    adopter_deletion_requested: '📋',
    adopter_appended: '📎',
    adopter_made_public: '🌐', adopter_made_private: '🔒',
    adopter_ownership_transferred: '↔️',
    adopter_country_backfilled: '🌎',
    adoption_created: '🐾', adoption_updated: '✏️', adoption_deleted: '🗑️',
    animal_for_adoption_deleted: '🗑️', animal_image_deleted: '🗑️',
    flag_created: '🚩',
    verification_added: '✅',
    image_uploaded: '📷', image_added: '📷', profile_picture_set: '🖼️',
    contact_entry_added: '➕', contact_entry_updated: '✏️', contact_entry_removed: '➖',
    pii_access_requested: '🔓', pii_access_approved: '✅', pii_access_denied: '⛔',
    pii_access_grant_revoked: '🔒',
    pii_known_info_unlocked: '🔓', pii_search_match_grant: '🔓',
    config_changed: '⚙️', admin_sql_query: '⚡',
    contact_entries_backfilled: '🛠️',
    user_name_updated: '👤', user_country_overridden: '🌎',
};

const SEVERITY_BORDER: Record<AuditSeverity, string> = {
    rose: 'border-l-4 border-rose-400',
    amber: 'border-l-4 border-amber-400',
    emerald: 'border-l-4 border-emerald-400',
    stone: 'border-l-4 border-stone-200',
};

const ACCENT_TONE: Record<NonNullable<AuditSummary['accent']>['tone'], string> = {
    rose: 'text-rose-700 font-medium',
    amber: 'text-amber-700 font-medium',
    emerald: 'text-emerald-700 font-medium',
    teal: 'text-teal-700 font-medium',
    stone: 'text-stone-600 font-mono text-xs',
};

const CATEGORY_CHIPS: Array<{ key: AuditCategory; emoji: string; label: { es: string; en: string } }> = [
    { key: 'all',         emoji: '📊', label: { es: 'Todos',       en: 'All' } },
    { key: 'edits',       emoji: '✏️', label: { es: 'Edits',       en: 'Edits' } },
    { key: 'searches',    emoji: '🔍', label: { es: 'Búsquedas',   en: 'Searches' } },
    { key: 'views',       emoji: '👁', label: { es: 'Vistas',      en: 'Views' } },
    { key: 'flags',       emoji: '🚩', label: { es: 'Reportes',    en: 'Flags' } },
    { key: 'deletions',   emoji: '🗑️', label: { es: 'Eliminados',  en: 'Deletions' } },
    { key: 'pii',         emoji: '🔓', label: { es: 'PII',         en: 'PII' } },
    { key: 'auth',        emoji: '🔑', label: { es: 'Auth',        en: 'Auth' } },
    { key: 'admin_ops',   emoji: '⚙️', label: { es: 'Admin',       en: 'Admin' } },
];

function parseDevice(device: string | null) {
    if (!device) return null;
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(device);
    const isChrome = /Chrome/i.test(device) && !/Edge/i.test(device);
    const isFirefox = /Firefox/i.test(device);
    const isSafari = /Safari/i.test(device) && !isChrome;
    const browser = isChrome ? 'Chrome' : isFirefox ? 'Firefox' : isSafari ? 'Safari' : 'Other';
    return { isMobile, browser };
}

function dateInputToEpoch(s: string, endOfDay = false): number {
    if (!s) return 0;
    const d = new Date(s + (endOfDay ? 'T23:59:59' : 'T00:00:00'));
    if (Number.isNaN(d.getTime())) return 0;
    return Math.floor(d.getTime() / 1000);
}

export default function AdminAuditPage() {
    const { locale, t } = useLanguage();
    const isEs = locale !== 'en';

    const [entries, setEntries] = useState<EnrichedAuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [actions, setActions] = useState<string[]>([]);
    const [filterAction, setFilterAction] = useState('');
    const [filterUser, setFilterUser] = useState('');
    const [category, setCategory] = useState<AuditCategory>('all');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [stats, setStats] = useState<{ totalRecords: number; oldest: number; newest: number } | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [retentionDays, setRetentionDays] = useState(1095);
    const [purging, setPurging] = useState(false);
    const [purgeResult, setPurgeResult] = useState<string | null>(null);

    const fetchAudit = async (p: number) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(p) });
            if (filterAction) params.set('action', filterAction);
            if (filterUser) params.set('userId', filterUser);
            if (category && category !== 'all') params.set('category', category);
            const fromTs = dateInputToEpoch(fromDate, false);
            const toTs = dateInputToEpoch(toDate, true);
            if (fromTs) params.set('from', String(fromTs));
            if (toTs) params.set('to', String(toTs));

            const res = await fetch(`/api/admin/audit?${params}`);
            const data = await res.json() as {
                entries: EnrichedAuditEntry[];
                totalPages: number;
                total: number;
                actions: string[];
                stats: { totalRecords: number; oldest: number; newest: number } | null;
            };
            setEntries(data.entries || []);
            setTotalPages(data.totalPages || 1);
            setTotal(data.total || 0);
            setActions(data.actions || []);
            setStats(data.stats || null);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // v2.19.73: initialize filters from the URL (?userId, ?action, ?category) so
    // the "audit" deep-link from /admin/users actually pre-filters. Before, the
    // query string was ignored and the page opened completely unfiltered.
    useEffect(() => {
        const sp = new URLSearchParams(window.location.search);
        const u = sp.get('userId'); if (u) setFilterUser(u);
        const a = sp.get('action'); if (a) setFilterAction(a);
        const c = sp.get('category'); if (c) setCategory(c as AuditCategory);
    }, []);

    useEffect(() => {
        fetchAudit(page);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, filterAction, filterUser, category, fromDate, toDate]);

    const handlePurge = async () => {
        if (!confirm(t('dialogs.confirm_delete_audit').replace('{days}', String(retentionDays)))) return;
        setPurging(true);
        setPurgeResult(null);
        try {
            const res = await fetch('/api/admin/audit', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ retentionDays }),
            });
            const data = await res.json() as { purged: number };
            setPurgeResult(`Purged ${data.purged} records`);
            fetchAudit(1);
            setPage(1);
        } catch {
            setPurgeResult('Purge failed');
        } finally {
            setPurging(false);
        }
    };

    const formatDate = (epoch: number) => formatDateTimeFull(epoch);

    const renderSummary = (entry: EnrichedAuditEntry) => {
        const s = isEs ? entry.summaryEs : entry.summaryEn;
        const adopterTarget = entry.targetAdopterName ? (
            entry.targetAdopterDeleted ? (
                <span className="text-stone-500 font-medium">
                    {isEs ? '(eliminado) ' : '(deleted) '}{entry.targetAdopterName}
                </span>
            ) : entry.target ? (
                <a href={`/adopter/${entry.target}`} className="font-semibold text-stone-800 hover:underline">
                    {entry.targetAdopterName}
                </a>
            ) : (
                <span className="font-semibold text-stone-800">{entry.targetAdopterName}</span>
            )
        ) : null;

        return (
            <span className="text-sm text-stone-800 flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium">{s.primary}</span>
                {s.accent && (
                    <span className={ACCENT_TONE[s.accent.tone]}>
                        {s.accent.text}
                    </span>
                )}
                {adopterTarget}
                {s.secondary && (
                    <span className="text-xs text-stone-500">· {s.secondary}</span>
                )}
            </span>
        );
    };

    const handleClearFilters = () => {
        setFilterAction(''); setFilterUser(''); setCategory('all');
        setFromDate(''); setToDate(''); setPage(1);
    };

    const anyFilterActive = filterAction || filterUser || category !== 'all' || fromDate || toDate;

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h2 className="text-2xl font-semibold text-stone-900">📋 {isEs ? 'Registro de auditoría' : 'Audit Log'}</h2>
                    <p className="text-stone-500 text-sm mt-1">
                        {total.toLocaleString()} {isEs ? 'eventos' : 'entries'}
                        {stats?.oldest ? ` · ${isEs ? 'Desde' : 'Since'} ${formatDate(stats.oldest)}` : ''}
                    </p>
                </div>
            </div>

            {/* Category chips */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {CATEGORY_CHIPS.map(c => {
                    const active = c.key === category;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            onClick={() => { setCategory(c.key); setPage(1); }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                active
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                        >
                            <span aria-hidden>{c.emoji}</span>
                            {isEs ? c.label.es : c.label.en}
                        </button>
                    );
                })}
            </div>

            {/* Detailed filters */}
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
                <select
                    value={filterAction}
                    onChange={e => { setFilterAction(e.target.value); setPage(1); }}
                    className="px-2.5 py-1.5 border border-stone-200 rounded-lg bg-white"
                >
                    <option value="">{isEs ? 'Toda acción' : 'Any action'}</option>
                    {actions.map(a => (
                        <option key={a} value={a}>{ACTION_ICON[a] || '📌'} {a}</option>
                    ))}
                </select>
                <input
                    type="text"
                    placeholder={isEs ? 'Email / ID del usuario...' : 'User email or id...'}
                    value={filterUser}
                    onChange={e => { setFilterUser(e.target.value); setPage(1); }}
                    className="px-2.5 py-1.5 border border-stone-200 rounded-lg w-full sm:w-56 focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                />
                <label className="text-stone-500">{isEs ? 'Desde' : 'From'}</label>
                <input
                    type="date"
                    value={fromDate}
                    onChange={e => { setFromDate(e.target.value); setPage(1); }}
                    className="px-2 py-1.5 border border-stone-200 rounded-lg"
                />
                <label className="text-stone-500">{isEs ? 'Hasta' : 'To'}</label>
                <input
                    type="date"
                    value={toDate}
                    onChange={e => { setToDate(e.target.value); setPage(1); }}
                    className="px-2 py-1.5 border border-stone-200 rounded-lg"
                />
                {anyFilterActive && (
                    <button onClick={handleClearFilters} className="text-stone-500 hover:text-stone-700 underline">
                        {isEs ? 'Limpiar' : 'Clear'}
                    </button>
                )}
            </div>

            {/* Rows */}
            {loading ? (
                <div className="p-8 text-center text-stone-500 text-sm">{isEs ? 'Cargando...' : 'Loading...'}</div>
            ) : entries.length === 0 ? (
                <div className="bg-white rounded-xl border border-stone-200 p-10 text-center text-stone-500 text-sm">
                    {isEs ? 'Sin coincidencias para este filtro.' : 'No matches for this filter.'}
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
                    {entries.map(entry => {
                        const device = parseDevice(entry.device);
                        const isExpanded = expandedId === entry.id;
                        const icon = ACTION_ICON[entry.action] || '📌';

                        return (
                            <article
                                key={entry.id}
                                className={`pl-3 pr-4 py-3 hover:bg-stone-50/60 transition-colors ${SEVERITY_BORDER[entry.severity]}`}
                            >
                                {/* Top line: actor + time + diagnostic side info */}
                                <div className="flex items-start justify-between gap-3 mb-1">
                                    <div className="flex items-baseline gap-2 min-w-0">
                                        <span className="text-sm font-semibold text-stone-800 truncate max-w-[14rem]" title={entry.user_email || ''}>
                                            {entry.actorName}
                                        </span>
                                        {entry.user_email && entry.actorName !== entry.user_email && (
                                            <span className="text-xs text-stone-400 truncate max-w-[14rem]">{entry.user_email}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-stone-400 flex-shrink-0">
                                        {device && (
                                            <span className="hidden sm:inline-flex items-center gap-0.5">
                                                {device.isMobile ? '📱' : '💻'} {device.browser}
                                                {entry.is_pwa ? <span className="ml-1 px-1 py-0.5 bg-teal-50 text-teal-600 rounded text-[9px] font-semibold">PWA</span> : null}
                                            </span>
                                        )}
                                        {entry.ip_address && (
                                            <a
                                                href={`https://ipinfo.io/${entry.ip_address}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hidden sm:inline text-stone-400 hover:text-stone-600 hover:underline font-mono"
                                                title={t('admin.view_geolocation_title') || 'IP info'}
                                            >
                                                {entry.ip_address}
                                            </a>
                                        )}
                                        <span className="whitespace-nowrap">{formatDate(entry.created_at)}</span>
                                        {entry.details && (
                                            <button
                                                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                                                className="text-stone-400 hover:text-stone-600 transition-colors"
                                                title={isEs ? 'Ver JSON crudo' : 'View raw JSON'}
                                            >
                                                {isExpanded ? '▾' : '▸'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Sentence row: icon + summary */}
                                <div className="flex items-start gap-2 leading-snug">
                                    <span className="flex-shrink-0 text-base" aria-hidden>{icon}</span>
                                    <div className="flex-1 min-w-0">
                                        {renderSummary(entry)}
                                    </div>
                                </div>

                                {/* Expanded raw JSON */}
                                {isExpanded && entry.details && (
                                    <pre className="mt-2 text-[11px] text-stone-600 whitespace-pre-wrap font-mono bg-stone-50 p-2.5 rounded-lg border border-stone-200 overflow-x-auto">
                                        {(() => {
                                            try { return JSON.stringify(JSON.parse(entry.details), null, 2); }
                                            catch { return entry.details; }
                                        })()}
                                    </pre>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {!loading && totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 px-1 text-xs">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                    >
                        ← {isEs ? 'Anterior' : 'Previous'}
                    </button>
                    <span className="text-stone-500">{isEs ? 'Página' : 'Page'} {page} / {totalPages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="px-3 py-1.5 text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                    >
                        {isEs ? 'Siguiente' : 'Next'} →
                    </button>
                </div>
            )}

            {/* Retention Settings */}
            <div className="mt-8 bg-white rounded-xl border border-stone-200 p-5">
                <h3 className="font-semibold text-stone-900 text-sm mb-3">🗄️ {isEs ? 'Retención de datos' : 'Data Retention'}</h3>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm text-stone-600">{isEs ? 'Conservar registros por' : 'Keep audit records for'}</label>
                    <input
                        type="number"
                        value={retentionDays}
                        onChange={e => setRetentionDays(parseInt(e.target.value) || 1095)}
                        min={30}
                        max={3650}
                        className="w-20 px-2 py-1 border border-stone-200 rounded text-sm text-center"
                    />
                    <label className="text-sm text-stone-600">{isEs ? 'días' : 'days'}</label>
                    <button
                        onClick={handlePurge}
                        disabled={purging}
                        className="px-3 py-1.5 bg-rose-500 text-white text-xs font-semibold rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                        {purging ? (isEs ? 'Purgando...' : 'Purging...') : (isEs ? 'Purgar antiguos' : 'Purge Old Records')}
                    </button>
                    {purgeResult && <span className="text-xs text-stone-500">{purgeResult}</span>}
                </div>
                <p className="text-xs text-stone-500 mt-2">
                    {isEs
                        ? 'Por defecto: 1095 días (3 años). Los registros más antiguos serán eliminados permanentemente.'
                        : 'Default: 1095 days (3 years). Records older than the retention period will be permanently deleted.'}
                </p>
            </div>
        </div>
    );
}
