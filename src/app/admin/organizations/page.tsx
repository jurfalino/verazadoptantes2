'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDateTime, formatShortDate } from '@/lib/dates';

interface Organization {
    id: string;
    name: string;
    created_by: string;
    created_at: number | null;
    member_count: number;
    invite_count: number;
}

interface Member {
    id: string;
    user_email: string;
    role: string | null;
    joined_at: number | null;
}

interface Invite {
    id: string;
    created_by: string;
    expires_at: number | null;
    created_at: number | null;
}

interface OrgDetail {
    organization: Organization;
    members: Member[];
    invites: Invite[];
}

export default function AdminOrganizationsPage() {
    const searchParams = useSearchParams();
    const highlightId = searchParams.get('highlight');

    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(highlightId);
    const [details, setDetails] = useState<Record<string, OrgDetail>>({});
    const [detailLoading, setDetailLoading] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [transferringId, setTransferringId] = useState<string | null>(null);
    const [transferDraft, setTransferDraft] = useState('');

    useEffect(() => {
        fetch('/api/admin/organizations')
            .then(r => r.json() as Promise<{ organizations: Organization[] }>)
            .then(data => setOrgs(data.organizations || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!expandedId || details[expandedId]) return;
        setDetailLoading(expandedId);
        fetch(`/api/admin/organizations/${expandedId}`)
            .then(r => r.json() as Promise<OrgDetail>)
            .then(d => setDetails(prev => ({ ...prev, [expandedId]: d })))
            .catch(console.error)
            .finally(() => setDetailLoading(null));
    }, [expandedId, details]);

    const toggle = (id: string) => setExpandedId(prev => (prev === id ? null : id));

    const deleteOrg = async (id: string) => {
        try {
            const res = await fetch(`/api/admin/organizations?id=${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                alert(data.error || 'Failed to delete organization');
                return;
            }
            setOrgs(prev => prev.filter(o => o.id !== id));
            setConfirmDeleteId(null);
            setExpandedId(null);
        } catch (e) {
            console.error(e);
            alert('Failed to delete organization');
        }
    };

    const removeMember = async (orgId: string, memberId: string) => {
        try {
            const res = await fetch(`/api/admin/organizations/${orgId}?memberId=${memberId}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                alert(data.error || 'Failed to remove member');
                return;
            }
            // Update local state: drop the member, decrement count
            setDetails(prev => {
                const cur = prev[orgId];
                if (!cur) return prev;
                return { ...prev, [orgId]: { ...cur, members: cur.members.filter(m => m.id !== memberId) } };
            });
            setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, member_count: Math.max(0, o.member_count - 1) } : o));
        } catch (e) {
            console.error(e);
            alert('Failed to remove member');
        }
    };

    const patchOrg = async (id: string, body: { name?: string; createdBy?: string }) => {
        try {
            const res = await fetch(`/api/admin/organizations/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                alert(data.error || 'Failed to update organization');
                return;
            }
            setOrgs(prev => prev.map(o => o.id === id ? { ...o, ...(body.name ? { name: body.name } : {}), ...(body.createdBy ? { created_by: body.createdBy } : {}) } : o));
            setDetails(prev => {
                const cur = prev[id];
                if (!cur) return prev;
                return { ...prev, [id]: { ...cur, organization: { ...cur.organization, ...(body.name ? { name: body.name } : {}), ...(body.createdBy ? { created_by: body.createdBy } : {}) } } };
            });
            setRenamingId(null); setTransferringId(null);
            setRenameDraft(''); setTransferDraft('');
        } catch (e) {
            console.error(e);
            alert('Failed to update organization');
        }
    };

    if (loading) return <div className="p-8 text-stone-500">Loading organizations...</div>;

    const filtered = orgs.filter(o => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return o.name.toLowerCase().includes(q) || o.created_by.toLowerCase().includes(q);
    });

    return (
        <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div>
                    <h2 className="text-2xl font-semibold text-stone-900">🏢 Organizations</h2>
                    <p className="text-stone-500 text-sm mt-1">{orgs.length} organization{orgs.length !== 1 ? 's' : ''}</p>
                </div>
                <input
                    type="text"
                    placeholder="Filter by name or owner..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="px-3 py-2 border border-stone-200 rounded-lg text-sm sm:w-64 focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                />
            </div>

            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-600 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="px-4 py-3 text-left">Name</th>
                            <th className="px-4 py-3 text-left">Owner</th>
                            <th className="px-4 py-3 text-right">Members</th>
                            <th className="px-4 py-3 text-right">Invites</th>
                            <th className="px-4 py-3 text-left">Created</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                        {filtered.map(org => {
                            const isExpanded = expandedId === org.id;
                            const detail = details[org.id];
                            const isHighlighted = highlightId === org.id;
                            return (
                                <>
                                    <tr
                                        key={org.id}
                                        className={`cursor-pointer hover:bg-stone-50/50 transition-colors ${isHighlighted ? 'bg-amber-50/40' : ''}`}
                                        onClick={() => toggle(org.id)}
                                    >
                                        <td className="px-4 py-3 font-medium text-stone-900">
                                            <span className="inline-flex items-center gap-2">
                                                <span className={`text-xs text-stone-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                                {org.name}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <a href={`mailto:${org.created_by}`} className="text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>
                                                {org.created_by}
                                            </a>
                                        </td>
                                        <td className="px-4 py-3 text-right text-stone-700 font-medium">{org.member_count}</td>
                                        <td className="px-4 py-3 text-right text-stone-500">{org.invite_count}</td>
                                        <td className="px-4 py-3 text-stone-500 text-xs">{org.created_at ? formatShortDate(org.created_at) : '—'}</td>
                                        <td className="px-4 py-3 text-right">
                                            {confirmDeleteId === org.id ? (
                                                <span className="inline-flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => deleteOrg(org.id)}
                                                        className="text-red-600 hover:text-red-800 text-xs font-semibold"
                                                    >Confirm?</button>
                                                    <button
                                                        onClick={() => setConfirmDeleteId(null)}
                                                        className="text-stone-500 hover:text-stone-700 text-xs"
                                                    >No</button>
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={e => { e.stopPropagation(); setConfirmDeleteId(org.id); }}
                                                    className="text-stone-300 hover:text-red-500 text-xs"
                                                    title="Delete organization"
                                                >🗑️</button>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr key={`${org.id}-detail`}>
                                            <td colSpan={6} className="bg-stone-50/40 px-4 py-4">
                                                {detailLoading === org.id && !detail ? (
                                                    <div className="text-stone-500 text-sm">Loading details...</div>
                                                ) : detail ? (
                                                    <div className="space-y-4">
                                                        {/* Admin actions: rename + transfer */}
                                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                                            {renamingId === org.id ? (
                                                                <span className="inline-flex items-center gap-1">
                                                                    <input
                                                                        type="text"
                                                                        value={renameDraft}
                                                                        onChange={e => setRenameDraft(e.target.value)}
                                                                        placeholder="New name"
                                                                        className="px-2 py-1 border border-stone-200 rounded text-xs"
                                                                    />
                                                                    <button
                                                                        onClick={() => renameDraft.trim() && patchOrg(org.id, { name: renameDraft.trim() })}
                                                                        className="px-2 py-1 bg-stone-900 text-white rounded text-xs"
                                                                    >Save</button>
                                                                    <button
                                                                        onClick={() => { setRenamingId(null); setRenameDraft(''); }}
                                                                        className="px-2 py-1 text-stone-500"
                                                                    >Cancel</button>
                                                                </span>
                                                            ) : (
                                                                <button
                                                                    onClick={() => { setRenamingId(org.id); setRenameDraft(org.name); }}
                                                                    className="px-2 py-1 bg-white border border-stone-200 rounded hover:border-stone-300"
                                                                >Rename</button>
                                                            )}
                                                            {transferringId === org.id ? (
                                                                <span className="inline-flex items-center gap-1">
                                                                    <input
                                                                        type="email"
                                                                        value={transferDraft}
                                                                        onChange={e => setTransferDraft(e.target.value)}
                                                                        placeholder="new-owner@example.com"
                                                                        className="px-2 py-1 border border-stone-200 rounded text-xs w-56"
                                                                    />
                                                                    <button
                                                                        onClick={() => transferDraft.trim() && patchOrg(org.id, { createdBy: transferDraft.trim() })}
                                                                        className="px-2 py-1 bg-stone-900 text-white rounded text-xs"
                                                                    >Save</button>
                                                                    <button
                                                                        onClick={() => { setTransferringId(null); setTransferDraft(''); }}
                                                                        className="px-2 py-1 text-stone-500"
                                                                    >Cancel</button>
                                                                </span>
                                                            ) : (
                                                                <button
                                                                    onClick={() => { setTransferringId(org.id); setTransferDraft(org.created_by); }}
                                                                    className="px-2 py-1 bg-white border border-stone-200 rounded hover:border-stone-300"
                                                                >Transfer ownership</button>
                                                            )}
                                                        </div>

                                                        {/* Members */}
                                                        <div>
                                                            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">
                                                                Members ({detail.members.length})
                                                            </h4>
                                                            {detail.members.length === 0 ? (
                                                                <p className="text-stone-400 italic text-xs">No members yet.</p>
                                                            ) : (
                                                                <ul className="divide-y divide-stone-100 bg-white border border-stone-200 rounded-lg">
                                                                    {detail.members.map(m => (
                                                                        <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                                                                            <span className="font-mono text-stone-700">{m.user_email}</span>
                                                                            <span className="text-stone-500">{m.role || 'member'}</span>
                                                                            <span className="text-stone-400 text-[11px]">{m.joined_at ? formatDateTime(m.joined_at) : '—'}</span>
                                                                            <button
                                                                                onClick={() => removeMember(org.id, m.id)}
                                                                                className="text-stone-300 hover:text-red-500 text-xs"
                                                                                title="Remove member"
                                                                            >✕</button>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            )}
                                                        </div>

                                                        {/* Invites */}
                                                        <div>
                                                            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2">
                                                                Pending invites ({detail.invites.length})
                                                            </h4>
                                                            {detail.invites.length === 0 ? (
                                                                <p className="text-stone-400 italic text-xs">No pending invites.</p>
                                                            ) : (
                                                                <ul className="divide-y divide-stone-100 bg-white border border-stone-200 rounded-lg">
                                                                    {detail.invites.map(inv => (
                                                                        <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                                                                            <span className="text-stone-500">By {inv.created_by}</span>
                                                                            <span className="text-stone-400 text-[11px]">
                                                                                {inv.expires_at ? `Expires ${formatDateTime(inv.expires_at)}` : 'No expiry'}
                                                                            </span>
                                                                            <span className="font-mono text-stone-300 text-[10px]">{inv.id.slice(0, 8)}…</span>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-stone-500">
                                    {filter ? 'No organizations match your filter' : 'No organizations created yet.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
