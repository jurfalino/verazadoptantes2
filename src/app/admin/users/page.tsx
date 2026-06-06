'use client';

import { useEffect, useState, useMemo } from 'react';
import { formatDateTime } from '@/lib/dates';
import { getCountryByCode } from '@/config/countries';
import { useLanguage } from '@/context/LanguageContext';
import OrphanSubmissionsSection from '@/components/OrphanSubmissionsSection';

function CopyIdButton({ id, className = '' }: { id: string; className?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // ignore
        }
    };
    return (
        <button
            type="button"
            onClick={copy}
            title={id}
            className={`inline-flex items-center gap-1.5 font-mono text-xs text-stone-500 hover:text-stone-700 transition-colors ${className}`}
        >
            <span className="truncate max-w-[7ch]">{id.slice(0, 8)}…</span>
            {copied ? (
                <span className="text-green-600 shrink-0">✓</span>
            ) : (
                <svg className="w-3.5 h-3.5 shrink-0 text-stone-400 hover:text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            )}
        </button>
    );
}

interface OrgMembership {
    id: string;
    name: string;
    role: string | null;
}

interface UserProfile {
    id: string;
    name: string;
    /**
     * Google OAuth-provided display name, kept in sync on every sign-in
     * (v2.18.6). Rendered as a secondary line on the user row when it
     * differs from `name` so admins can see the discrepancy between a
     * customized display name and the underlying Google account.
     */
    google_name: string | null;
    email: string;
    image: string | null;
    role: string | null;
    notes: string | null;
    comms_opt_in: number;
    last_active_at: number | null;
    first_sign_in: number | null;
    country: string | null;
    province: string | null;
    city: string | null;
    timezone: string | null;
    terms_accepted_at: number | null;
    terms_version: number | null;
    adopters_count: number;
    records_count: number;
    edits_count: number;
    flags_count: number;
    orgMemberships: OrgMembership[];
}

/** Render a user's detected location as flag·province·city, with timezone in tooltip. */
function LocationCell({ user }: { user: UserProfile }) {
    if (!user.country && !user.province && !user.city) {
        return <span className="text-stone-300">—</span>;
    }
    const c = user.country ? getCountryByCode(user.country) : null;
    const flagAndCode = c ? `${c.flag} ${c.code}` : (user.country ?? '');
    const parts = [flagAndCode, user.province, user.city].filter(Boolean) as string[];
    return (
        <div className="text-xs text-stone-700 break-words" title={user.timezone || undefined}>
            <span className="break-all">{parts.join(' · ')}</span>
        </div>
    );
}

/** Render the four activity-count pills inline. */
function ActivityCell({ user }: { user: UserProfile }) {
    const { t } = useLanguage();
    const empty = !user.adopters_count && !user.records_count && !user.edits_count && !user.flags_count;
    if (empty) return <span className="text-stone-300 text-xs">—</span>;
    return (
        <div className="flex flex-wrap gap-1 text-[11px] font-medium">
            {user.adopters_count > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100" title={t('admin.stat_adopters_created')}>
                    👤 {user.adopters_count}
                </span>
            )}
            {user.records_count > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-stone-50 text-stone-600 border border-stone-100" title={t('admin.stat_records_added')}>
                    📋 {user.records_count}
                </span>
            )}
            {user.edits_count > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100" title={t('admin.stat_history_edits')}>
                    ✏️ {user.edits_count}
                </span>
            )}
            {user.flags_count > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100" title={t('admin.stat_flags_filed')}>
                    🚩 {user.flags_count}
                </span>
            )}
        </div>
    );
}

export default function AdminUsersPage() {
    const { t } = useLanguage();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ role: 'viewer', notes: '', commsOptIn: false });
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [countryFilter, setCountryFilter] = useState('');

    // Derive unique countries from user data for the filter dropdown
    const availableCountries = useMemo(() => {
        const codes = new Set<string>();
        users.forEach(u => { if (u.country) codes.add(u.country); });
        return Array.from(codes).sort().map(code => {
            const c = getCountryByCode(code);
            return { code, label: c ? `${c.flag} ${c.name}` : code };
        });
    }, [users]);

    useEffect(() => {
        fetch('/api/admin/users')
            .then(r => r.json() as Promise<{ users: UserProfile[] }>)
            .then(data => setUsers(data.users || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const startEdit = (user: UserProfile) => {
        setEditingId(user.id);
        setEditForm({
            role: user.role || 'viewer',
            notes: user.notes || '',
            commsOptIn: !!user.comms_opt_in,
        });
    };

    const saveProfile = async (userId: string) => {
        setSaving(true);
        try {
            await fetch('/api/admin/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, ...editForm }),
            });
            // Update local state
            setUsers(prev => prev.map(u => u.id === userId ? {
                ...u,
                role: editForm.role,
                notes: editForm.notes || null,
                comms_opt_in: editForm.commsOptIn ? 1 : 0,
            } : u));
            setEditingId(null);
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const deleteUser = async (userId: string, _userName: string) => {
        try {
            const res = await fetch('/api/admin/users', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            const data = await res.json() as { error?: string };
            if (!res.ok) {
                alert(data.error || 'Failed to delete user');
                return;
            }
            setUsers(prev => prev.filter(u => u.id !== userId));
            setDeletingId(null);
        } catch (e) {
            console.error(e);
            alert('Failed to delete user');
        }
    };

    const formatDate = (epoch: number | null) => {
        if (!epoch) return '—';
        return formatDateTime(epoch);
    };

    const filteredUsers = users.filter(u => {
        if (countryFilter && u.country !== countryFilter) return false;
        if (!filter) return true;
        const q = filter.toLowerCase();
        return u.name?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            (u.orgMemberships || []).some(o => o.name.toLowerCase().includes(q));
    });

    if (loading) return <div className="p-8 text-stone-500">Loading users...</div>;

    return (
        <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div>
                    <h2 className="text-2xl font-semibold text-stone-900">👥 User Registry</h2>
                    <p className="text-stone-500 text-sm mt-1">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    {availableCountries.length > 1 && (
                        <select
                            value={countryFilter}
                            onChange={e => setCountryFilter(e.target.value)}
                            className="px-2 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                        >
                            <option value="">All countries</option>
                            {availableCountries.map(c => (
                                <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                        </select>
                    )}
                    <input
                        type="text"
                        placeholder="Filter by name, email, org..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="px-3 py-2 border border-stone-200 rounded-lg text-sm flex-1 sm:w-52 focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                    />
                </div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-white rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-600 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="px-4 py-3 text-left">User</th>
                            <th className="px-4 py-3 text-left">Organizations</th>
                            <th className="px-4 py-3 text-left">Role</th>
                            <th className="px-4 py-3 text-left">Location</th>
                            <th className="px-4 py-3 text-left">Lifecycle</th>
                            <th className="px-4 py-3 text-left">Activity</th>
                            <th className="px-4 py-3 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                        {filteredUsers.map(user => (
                            <tr key={user.id} className="hover:bg-stone-50/50 transition-colors">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        {user.image ? (
                                            <img src={user.image} alt="" className="w-8 h-8 rounded-full" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 text-xs font-semibold">
                                                {(user.name || user.email || '?')[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-stone-900 truncate" title={user.name || 'Unknown'}>{user.name || 'Unknown'}</div>
                                            {/* Google OAuth name — surfaced only when it differs from the
                                                display name (v2.18.6). User customizes display name via
                                                /settings; google_name is refreshed from Google on every
                                                sign-in. Identical-value case is suppressed to avoid noise. */}
                                            {user.google_name && user.google_name !== user.name && (
                                                <div
                                                    className="text-xs text-stone-500 truncate flex items-center gap-1"
                                                    title={`Google account name: ${user.google_name}`}
                                                >
                                                    <span className="text-stone-400">Google:</span>
                                                    <span className="truncate">{user.google_name}</span>
                                                </div>
                                            )}
                                            <a href={`mailto:${user.email}`} className="text-xs text-blue-600 hover:underline break-all">
                                                {user.email}
                                            </a>
                                            <div className="mt-0.5">
                                                <CopyIdButton id={user.id} />
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    {(user.orgMemberships || []).length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                            {user.orgMemberships.map(o => (
                                                <a
                                                    key={o.id}
                                                    href={`/admin/organizations?highlight=${o.id}`}
                                                    title={`Manage ${o.name}${o.role ? ` (${o.role})` : ''}`}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 text-xs font-medium transition-colors"
                                                >
                                                    🏢 {o.name}
                                                </a>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-stone-300 text-xs">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    {editingId === user.id ? (
                                        <select
                                            value={editForm.role}
                                            onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                            className="px-2 py-1 border border-stone-200 rounded text-sm"
                                        >
                                            <option value="viewer">Viewer</option>
                                            <option value="contributor">Contributor</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    ) : (
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                            user.role === 'contributor' ? 'bg-blue-100 text-blue-700' :
                                                'bg-stone-100 text-stone-600'
                                            }`}>
                                            {user.role || 'viewer'}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 max-w-[180px]">
                                    <LocationCell user={user} />
                                </td>
                                <td className="px-4 py-3 text-stone-500 text-xs leading-snug">
                                    <div><span className="text-stone-400">First:</span> {formatDate(user.first_sign_in)}</div>
                                    <div><span className="text-stone-400">Active:</span> {formatDate(user.last_active_at)}</div>
                                </td>
                                <td className="px-4 py-3 max-w-[200px]">
                                    <ActivityCell user={user} />
                                </td>
                                <td className="px-4 py-3">
                                    {editingId === user.id ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => saveProfile(user.id)}
                                                disabled={saving}
                                                className="px-2 py-1 bg-stone-900 text-white text-xs rounded hover:bg-stone-800 disabled:opacity-50"
                                            >
                                                {saving ? '...' : 'Save'}
                                            </button>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="px-2 py-1 text-stone-500 text-xs hover:text-stone-700"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <a
                                                href={`/admin/audit?userId=${encodeURIComponent(user.email)}`}
                                                className="text-stone-500 hover:text-stone-700 text-xs underline underline-offset-2"
                                                title={`View audit log for ${user.email}`}
                                            >
                                                Audit
                                            </a>
                                            <button
                                                onClick={() => startEdit(user)}
                                                className="text-stone-500 hover:text-stone-700 text-xs underline underline-offset-2"
                                            >
                                                Edit
                                            </button>
                                            {deletingId === user.id ? (
                                                <>
                                                    <button
                                                        onClick={() => deleteUser(user.id, user.name || user.email)}
                                                        className="text-red-600 hover:text-red-800 text-xs font-semibold"
                                                    >
                                                        Confirm?
                                                    </button>
                                                    <button
                                                        onClick={() => setDeletingId(null)}
                                                        className="text-stone-500 hover:text-stone-600 text-xs"
                                                    >
                                                        No
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => setDeletingId(user.id)}
                                                    className="text-stone-300 hover:text-red-500 text-xs transition-colors"
                                                    title={t('admin.delete_user_title')}
                                                >
                                                    🗑️
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                                    {filter ? 'No users match your filter' : 'No users found'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
                {filteredUsers.map(user => (
                    <div key={user.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                        <div className="flex items-center gap-3 mb-3">
                            {user.image ? (
                                <img src={user.image} alt="" className="w-10 h-10 rounded-full" />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 text-sm font-semibold">
                                    {(user.name || user.email || '?')[0].toUpperCase()}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="font-medium text-stone-900 truncate">{user.name || 'Unknown'}</div>
                                {/* Mobile equivalent of the table-row Google-name reveal (v2.18.6). */}
                                {user.google_name && user.google_name !== user.name && (
                                    <div className="text-xs text-stone-500 truncate flex items-center gap-1" title={`Google account name: ${user.google_name}`}>
                                        <span className="text-stone-400">Google:</span>
                                        <span className="truncate">{user.google_name}</span>
                                    </div>
                                )}
                                <a href={`mailto:${user.email}`} className="text-xs text-blue-600 hover:underline truncate block">
                                    {user.email}
                                </a>
                            </div>
                            {editingId !== user.id && (
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                    user.role === 'contributor' ? 'bg-blue-100 text-blue-700' :
                                        'bg-stone-100 text-stone-600'
                                    }`}>
                                    {user.role || 'viewer'}
                                </span>
                            )}
                        </div>

                        {editingId === user.id ? (
                            <div className="space-y-3 bg-stone-50 rounded-lg p-3 mb-3">
                                <div>
                                    <label className="text-xs text-stone-500 font-medium block mb-1">Role</label>
                                    <select
                                        value={editForm.role}
                                        onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                        className="px-3 py-2 border border-stone-200 rounded-lg text-sm w-full"
                                    >
                                        <option value="viewer">Viewer</option>
                                        <option value="contributor">Contributor</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => saveProfile(user.id)}
                                        disabled={saving}
                                        className="flex-1 px-3 py-2 bg-stone-900 text-white text-xs font-semibold rounded-lg hover:bg-stone-800 disabled:opacity-50"
                                    >
                                        {saving ? '...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={() => setEditingId(null)}
                                        className="flex-1 px-3 py-2 text-stone-500 text-xs font-semibold bg-stone-100 rounded-lg hover:bg-stone-200"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-2 text-xs mb-2">
                                    <span className="text-stone-500">ID:</span>
                                    <CopyIdButton id={user.id} className="flex-1 min-w-0" />
                                </div>
                                {(user.orgMemberships || []).length > 0 && (
                                    <div className="mb-3">
                                        <span className="text-stone-500 text-xs block mb-1">Organizations</span>
                                        <div className="flex flex-wrap gap-1">
                                            {user.orgMemberships.map(o => (
                                                <a
                                                    key={o.id}
                                                    href={`/admin/organizations?highlight=${o.id}`}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-xs font-medium"
                                                >🏢 {o.name}</a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                    <div>
                                        <span className="text-stone-500">First: </span>
                                        <span className="text-stone-500">{formatDate(user.first_sign_in)}</span>
                                    </div>
                                    <div>
                                        <span className="text-stone-500">Active: </span>
                                        <span className="text-stone-500">{formatDate(user.last_active_at)}</span>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="text-stone-500">Location: </span>
                                        <LocationCell user={user} />
                                    </div>
                                    <div className="col-span-2">
                                        <span className="text-stone-500 block mb-1">Activity:</span>
                                        <ActivityCell user={user} />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <a
                                        href={`/admin/audit?userId=${encodeURIComponent(user.email)}`}
                                        className="flex-1 py-2 text-xs font-semibold text-stone-500 bg-stone-50 rounded-lg hover:bg-stone-100 text-center"
                                    >
                                        Audit
                                    </a>
                                    <button
                                        onClick={() => startEdit(user)}
                                        className="flex-1 py-2 text-xs font-semibold text-stone-500 bg-stone-50 rounded-lg hover:bg-stone-100"
                                    >
                                        Edit
                                    </button>
                                    {deletingId === user.id ? (
                                        <>
                                            <button
                                                onClick={() => deleteUser(user.id, user.name || user.email)}
                                                className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600"
                                            >
                                                Confirm Delete?
                                            </button>
                                            <button
                                                onClick={() => setDeletingId(null)}
                                                className="px-3 py-2 text-xs font-semibold text-stone-500 bg-stone-50 rounded-lg hover:bg-stone-100"
                                            >
                                                No
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setDeletingId(user.id)}
                                            className="px-3 py-2 text-xs text-stone-300 bg-stone-50 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors"
                                            title={t('admin.delete_user_title')}
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                ))}
                {filteredUsers.length === 0 && (
                    <div className="text-center py-8 text-stone-500 text-sm">
                        {filter ? 'No users match your filter' : 'No users found'}
                    </div>
                )}
            </div>

            <OrphanSubmissionsSection />
        </div>
    );
}
