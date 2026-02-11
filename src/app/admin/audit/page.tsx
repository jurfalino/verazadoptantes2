'use client';

import { useEffect, useState } from 'react';
import { formatDateTimeFull } from '@/lib/dates';

interface AuditEntry {
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
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    sign_in: { label: 'Sign In', icon: '🔑', color: 'bg-green-100 text-green-700' },
    sign_out: { label: 'Sign Out', icon: '🚪', color: 'bg-stone-100 text-stone-600' },
    search: { label: 'Search', icon: '🔍', color: 'bg-blue-100 text-blue-700' },
    adopter_created: { label: 'Adopter Created', icon: '➕', color: 'bg-emerald-100 text-emerald-700' },
    adopter_updated: { label: 'Adopter Updated', icon: '✏️', color: 'bg-amber-100 text-amber-700' },
    adopter_deleted: { label: 'Adopter Deleted', icon: '🗑️', color: 'bg-rose-100 text-rose-700' },
    adoption_created: { label: 'Adoption Created', icon: '🐾', color: 'bg-emerald-100 text-emerald-700' },
    adoption_updated: { label: 'Adoption Updated', icon: '✏️', color: 'bg-amber-100 text-amber-700' },
    adoption_deleted: { label: 'Adoption Deleted', icon: '🗑️', color: 'bg-rose-100 text-rose-700' },
    flag_created: { label: 'Flag Added', icon: '🚩', color: 'bg-orange-100 text-orange-700' },
    image_uploaded: { label: 'Image Uploaded', icon: '📷', color: 'bg-indigo-100 text-indigo-700' },
    config_changed: { label: 'Config Changed', icon: '⚙️', color: 'bg-purple-100 text-purple-700' },
};

export default function AdminAuditPage() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [actions, setActions] = useState<string[]>([]);
    const [filterAction, setFilterAction] = useState('');
    const [filterUser, setFilterUser] = useState('');
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

            const res = await fetch(`/api/admin/audit?${params}`);
            const data = await res.json() as { entries: AuditEntry[]; totalPages: number; total: number; actions: string[]; stats: { totalRecords: number; oldest: number; newest: number } | null };
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

    useEffect(() => {
        fetchAudit(page);
    }, [page, filterAction, filterUser]);

    const handlePurge = async () => {
        if (!confirm(`This will permanently delete audit records older than ${retentionDays} days. Continue?`)) return;
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
        } catch (e) {
            setPurgeResult('Purge failed');
        } finally {
            setPurging(false);
        }
    };

    const formatDate = (epoch: number) => {
        return formatDateTimeFull(epoch);
    };

    const parseDetails = (details: string | null): Record<string, unknown> | null => {
        if (!details) return null;
        try { return JSON.parse(details); } catch (e) { console.warn('[audit] Failed to parse details JSON', e); return null; }
    };

    const getActionDisplay = (action: string) => {
        const config = ACTION_LABELS[action];
        return config || { label: action, icon: '📌', color: 'bg-stone-100 text-stone-600' };
    };

    const getTargetUrl = (action: string, target: string | null, details: Record<string, unknown> | null): string | null => {
        if (!target) return null;
        // Adopter-level actions: target IS the adopter ID
        if (['adopter_created', 'adopter_updated', 'adopter_deleted', 'flag_created'].includes(action)) {
            return `/adopter/${target}`;
        }
        // Adoption-level actions: target is adoption ID, adopterId lives in details
        if (['adoption_created', 'adoption_updated', 'adoption_deleted'].includes(action)) {
            const adopterId = details?.adopterId as string | undefined;
            return adopterId ? `/adopter/${adopterId}` : null;
        }
        return null;
    };

    const parseDevice = (device: string | null) => {
        if (!device) return null;
        const isMobile = /Mobile|Android|iPhone|iPad/i.test(device);
        const isChrome = /Chrome/i.test(device) && !/Edge/i.test(device);
        const isFirefox = /Firefox/i.test(device);
        const isSafari = /Safari/i.test(device) && !isChrome;
        const browser = isChrome ? 'Chrome' : isFirefox ? 'Firefox' : isSafari ? 'Safari' : 'Other';
        return { isMobile, browser };
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-stone-900">📋 Audit Log</h2>
                    <p className="text-stone-500 text-sm mt-1">
                        {total.toLocaleString()} entries
                        {stats?.oldest ? ` · Since ${formatDate(stats.oldest)}` : ''}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mb-4">
                <select
                    value={filterAction}
                    onChange={e => { setFilterAction(e.target.value); setPage(1); }}
                    className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white"
                >
                    <option value="">All actions</option>
                    {actions.map(a => {
                        const config = getActionDisplay(a);
                        return <option key={a} value={a}>{config.icon} {config.label}</option>;
                    })}
                </select>
                <input
                    type="text"
                    placeholder="Filter by user ID or email..."
                    value={filterUser}
                    onChange={e => { setFilterUser(e.target.value); setPage(1); }}
                    className="px-3 py-2 border border-stone-200 rounded-lg text-sm w-64 focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                />
                {(filterAction || filterUser) && (
                    <button
                        onClick={() => { setFilterAction(''); setFilterUser(''); setPage(1); }}
                        className="text-xs text-stone-500 hover:text-stone-700 underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Entries */}
            {loading ? (
                <div className="p-8 text-center text-stone-400">Loading...</div>
            ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-stone-50 text-stone-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3 text-left">Time</th>
                                <th className="px-4 py-3 text-left">User</th>
                                <th className="px-4 py-3 text-left">Action</th>
                                <th className="px-4 py-3 text-left">Target</th>
                                <th className="px-4 py-3 text-left">Device</th>
                                <th className="px-4 py-3 text-left w-8"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {entries.map(entry => {
                                const actionDisplay = getActionDisplay(entry.action);
                                const device = parseDevice(entry.device);
                                const details = parseDetails(entry.details);
                                const isExpanded = expandedId === entry.id;
                                const targetUrl = getTargetUrl(entry.action, entry.target, details);

                                return (
                                    <tr key={entry.id} className="hover:bg-stone-50/50 transition-colors group">
                                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                                            {formatDate(entry.created_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                            {entry.user_email ? (
                                                <a href={`mailto:${entry.user_email}`} className="text-blue-600 hover:underline text-xs">
                                                    {entry.user_email}
                                                </a>
                                            ) : (
                                                <span className="text-stone-400 text-xs">anonymous</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${actionDisplay.color}`}>
                                                {actionDisplay.icon} {actionDisplay.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono truncate max-w-[200px]" title={entry.target || ''}>
                                            {targetUrl ? (
                                                <a href={targetUrl} className="text-blue-600 hover:underline">
                                                    {entry.target!.substring(0, 12)}…
                                                </a>
                                            ) : (
                                                <span className="text-stone-500">{entry.target ? entry.target.substring(0, 12) + '...' : '—'}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                                            {device && (
                                                <span className="flex items-center gap-1">
                                                    {device.isMobile ? '📱' : '💻'} {device.browser}
                                                    {entry.is_pwa ? <span className="ml-1 px-1 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">PWA</span> : null}
                                                </span>
                                            )}
                                            {!device && '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            {details && (
                                                <button
                                                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                                                    className="text-stone-300 hover:text-stone-600 transition-colors"
                                                >
                                                    {isExpanded ? '▾' : '▸'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {/* Expanded details row */}
                            {entries.map(entry => {
                                if (expandedId !== entry.id) return null;
                                const details = parseDetails(entry.details);
                                if (!details) return null;
                                return (
                                    <tr key={`${entry.id}-details`} className="bg-stone-50">
                                        <td colSpan={6} className="px-6 py-3">
                                            <pre className="text-xs text-stone-600 whitespace-pre-wrap font-mono bg-white p-3 rounded-lg border border-stone-200">
                                                {JSON.stringify(details, null, 2)}
                                            </pre>
                                        </td>
                                    </tr>
                                );
                            })}
                            {entries.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                                        No audit entries found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-stone-50">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="px-3 py-1 text-xs text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                            >
                                ← Previous
                            </button>
                            <span className="text-xs text-stone-500">Page {page} of {totalPages}</span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                className="px-3 py-1 text-xs text-stone-600 hover:text-stone-900 disabled:text-stone-300"
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Retention Settings */}
            <div className="mt-8 bg-white rounded-xl border border-stone-200 p-5">
                <h3 className="font-bold text-stone-900 text-sm mb-3">🗄️ Data Retention</h3>
                <div className="flex items-center gap-3">
                    <label className="text-sm text-stone-600">Keep audit records for</label>
                    <input
                        type="number"
                        value={retentionDays}
                        onChange={e => setRetentionDays(parseInt(e.target.value) || 1095)}
                        min={30}
                        max={3650}
                        className="w-20 px-2 py-1 border border-stone-200 rounded text-sm text-center"
                    />
                    <label className="text-sm text-stone-600">days</label>
                    <button
                        onClick={handlePurge}
                        disabled={purging}
                        className="ml-4 px-3 py-1.5 bg-rose-500 text-white text-xs font-semibold rounded-lg hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                        {purging ? 'Purging...' : 'Purge Old Records'}
                    </button>
                    {purgeResult && (
                        <span className="text-xs text-stone-500 ml-2">{purgeResult}</span>
                    )}
                </div>
                <p className="text-xs text-stone-400 mt-2">
                    Default: 1095 days (3 years). Records older than the retention period will be permanently deleted.
                </p>
            </div>
        </div>
    );
}
