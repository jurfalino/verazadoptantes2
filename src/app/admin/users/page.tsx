'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/dates';

interface UserProfile {
    id: string;
    name: string;
    email: string;
    image: string | null;
    organization: string | null;
    role: string | null;
    notes: string | null;
    comms_opt_in: number;
    last_active_at: number | null;
    first_sign_in: number | null;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ organization: '', role: 'viewer', notes: '', commsOptIn: false });
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('');

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
            organization: user.organization || '',
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
                organization: editForm.organization || null,
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

    const formatDate = (epoch: number | null) => {
        if (!epoch) return '—';
        return formatDateTime(epoch);
    };

    const filteredUsers = users.filter(u => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return u.name?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            u.organization?.toLowerCase().includes(q);
    });

    if (loading) return <div className="p-8 text-stone-500">Loading users...</div>;

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-stone-900">👥 User Registry</h2>
                    <p className="text-stone-500 text-sm mt-1">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
                </div>
                <input
                    type="text"
                    placeholder="Filter by name, email, org..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="px-3 py-2 border border-stone-200 rounded-lg text-sm w-64 focus:ring-2 focus:ring-stone-500/20 focus:border-stone-400 outline-none"
                />
            </div>

            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-600 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="px-4 py-3 text-left">User</th>
                            <th className="px-4 py-3 text-left">Organization</th>
                            <th className="px-4 py-3 text-left">Role</th>
                            <th className="px-4 py-3 text-left">First Sign In</th>
                            <th className="px-4 py-3 text-left">Last Active</th>
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
                                            <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 text-xs font-bold">
                                                {(user.name || user.email || '?')[0].toUpperCase()}
                                            </div>
                                        )}
                                        <div>
                                            <div className="font-medium text-stone-900">{user.name || 'Unknown'}</div>
                                            <a href={`mailto:${user.email}`} className="text-xs text-blue-600 hover:underline">
                                                {user.email}
                                            </a>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    {editingId === user.id ? (
                                        <input
                                            type="text"
                                            value={editForm.organization}
                                            onChange={e => setEditForm({ ...editForm, organization: e.target.value })}
                                            placeholder="Organization name"
                                            className="px-2 py-1 border border-stone-200 rounded text-sm w-full"
                                        />
                                    ) : (
                                        <span className="text-stone-600">{user.organization || '—'}</span>
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
                                <td className="px-4 py-3 text-stone-500 text-xs">
                                    {formatDate(user.first_sign_in)}
                                </td>
                                <td className="px-4 py-3 text-stone-500 text-xs">
                                    {formatDate(user.last_active_at)}
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
                                        <button
                                            onClick={() => startEdit(user)}
                                            className="text-stone-400 hover:text-stone-700 text-xs underline underline-offset-2"
                                        >
                                            Edit
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {filteredUsers.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                                    {filter ? 'No users match your filter' : 'No users found'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
