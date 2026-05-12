'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import {
    getMyOrganizations,
    createOrganization,
    updateOrganizationName,
    leaveOrganization,
    getInviteLink,
    type Organization,
} from '@/app/actions/organizations';
import OrgActivityFeed from '@/components/OrgActivityFeed';


export default function OrganizationsPage() {
    const { data: _session, status } = useSession();
    const router = useRouter();
    const { t } = useLanguage();
    const toast = useShowToast();

    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);

    const loadOrgs = useCallback(async () => {
        try {
            const result = await getMyOrganizations();
            setOrgs(result);
        } catch {
            // not authenticated
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/?authRequired=1&callbackUrl=/organizations');
            return;
        }
        if (status === 'authenticated') {
            loadOrgs();
        }
    }, [status, router, loadOrgs]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        const result = await createOrganization(newName);
        setCreating(false);
        if (result.success) {
            toast.success(t('organizations.created_success'));
            setNewName('');
            setShowCreateForm(false);
            loadOrgs();
        } else {
            const msg = result.error === 'org_name_exists'
                ? t('organizations.error_name_exists')
                : (result.error || 'Error');
            toast.error(msg, undefined, result.errorId);
        }
    };

    if (status === 'loading' || loading) {
        return (
            <main className="container mx-auto px-4 py-16 text-center">
                <p className="text-stone-500">{t('common.loading')}</p>
            </main>
        );
    }

    const hasOrgs = orgs.length > 0;

    return (
        <main className="container mx-auto px-4 py-8 max-w-2xl">
            <h1 className="text-2xl font-bold text-stone-900 mb-6">
                🏢 {t('organizations.title')}
            </h1>

            {/* Explanatory collapsible banner */}
            <InfoBanner />

            {/* Team activity feed */}
            {hasOrgs && <OrgActivityFeed />}

            {/* Create new org — full form (empty state) or collapsible (has orgs) */}
            {!hasOrgs ? (
                <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6 shadow-sm">
                    <p className="text-sm text-stone-600 mb-3">{t('organizations.create_description')}</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder={t('organizations.name_placeholder')}
                            className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            maxLength={100}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        />
                        <button
                            onClick={handleCreate}
                            disabled={creating || !newName.trim()}
                            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                        >
                            {creating ? '...' : t('organizations.create')}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mb-6">
                    {!showCreateForm ? (
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-dashed transition-colors"
                            style={{ color: 'var(--accent)', borderColor: 'var(--border-accent)' }}
                        >
                            ＋ {t('organizations.create')}
                        </button>
                    ) : (
                        <div
                            className="rounded-xl border p-4 shadow-sm"
                            style={{ background: 'var(--surface-card)', borderColor: 'var(--border-default)' }}
                        >
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder={t('organizations.name_placeholder')}
                                    className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                                    maxLength={100}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreate();
                                        if (e.key === 'Escape') { setShowCreateForm(false); setNewName(''); }
                                    }}
                                />
                                <button
                                    onClick={handleCreate}
                                    disabled={creating || !newName.trim()}
                                    className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                                >
                                    {creating ? '...' : t('organizations.create')}
                                </button>
                                <button
                                    onClick={() => { setShowCreateForm(false); setNewName(''); }}
                                    className="px-3 py-2 text-sm rounded-lg transition-colors"
                                    style={{ color: 'var(--text-muted)' }}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Org list */}
            {!hasOrgs ? (
                <p className="text-sm text-stone-500 text-center py-8">{t('organizations.no_orgs')}</p>
            ) : (
                <div className="space-y-4">
                    {orgs.map((org) => (
                        <OrgCard key={org.id} org={org} onRefresh={loadOrgs} />
                    ))}
                </div>
            )}
        </main>
    );
}

function InfoBanner() {
    const { t } = useLanguage();
    const [dismissed, setDismissed] = useState(true); // start collapsed

    useEffect(() => {
        setDismissed(localStorage.getItem('org-banner-dismissed') === '1');
    }, []);

    const toggle = () => {
        const next = !dismissed;
        setDismissed(next);
        if (next) localStorage.setItem('org-banner-dismissed', '1');
        else localStorage.removeItem('org-banner-dismissed');
    };

    return (
        <div
            className="mb-6 rounded-xl overflow-hidden shadow-sm"
            style={{ backgroundColor: 'var(--accent-subtle-bg)', border: '1px solid var(--border-accent)' }}
        >
            <button
                onClick={toggle}
                className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors"
                style={{ color: 'var(--accent)' }}
            >
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--accent)' }}>
                    💡 {t('organizations.banner_title')}
                </span>
                <svg
                    className={`w-4 h-4 transition-transform ${dismissed ? '' : 'rotate-180'}`}
                    style={{ color: 'var(--accent)' }}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {!dismissed && (
                <div className="px-5 pb-4 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    <p>{t('organizations.banner_what')}</p>
                    <p>{t('organizations.banner_invite')}</p>
                    <p>{t('organizations.banner_records')}</p>
                </div>
            )}
        </div>
    );
}

function OrgCard({ org, onRefresh }: { org: Organization; onRefresh: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState(org.name);
    const [inviteUrl, setInviteUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [leaving, setLeaving] = useState(false);

    const isLastMember = org.members.length <= 1;

    const handleSaveName = async () => {
        if (!editName.trim() || editName.trim() === org.name) {
            setEditing(false);
            return;
        }
        const result = await updateOrganizationName(org.id, editName);
        if (result.success) {
            toast.success(t('organizations.name_updated'));
            setEditing(false);
            onRefresh();
        } else {
            const msg = result.error === 'org_name_exists'
                ? t('organizations.error_name_exists')
                : (result.error || 'Error');
            toast.error(msg, undefined, result.errorId);
        }
    };

    const handleInvite = async () => {
        const result = await getInviteLink(org.id);
        if (result.success && result.url) {
            setInviteUrl(result.url);
            // Try native share first
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: org.name,
                        text: t('organizations.invite_description'),
                        url: result.url,
                    });
                    return;
                } catch { /* user cancelled */ }
            }
        } else {
            toast.error(result.error || 'Error', undefined, result.errorId);
        }
    };

    const handleCopy = async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
        } catch {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = inviteUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleLeave = async () => {
        const msg = isLastMember ? t('organizations.delete_confirm') : t('organizations.leave_confirm');
        if (!confirm(msg)) return;

        setLeaving(true);
        const result = await leaveOrganization(org.id);
        setLeaving(false);

        if (result.success) {
            toast.success(result.deleted ? t('organizations.deleted_success') : t('organizations.left_success'));
            onRefresh();
        } else {
            toast.error(result.error || 'Error', undefined, result.errorId);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
                {editing ? (
                    <div className="flex gap-2 flex-1">
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 px-2 py-1 border border-stone-300 rounded text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                            maxLength={100}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveName();
                                if (e.key === 'Escape') setEditing(false);
                            }}
                        />
                        <button onClick={handleSaveName} className="text-sm text-teal-600 font-medium">
                            {t('common.save')}
                        </button>
                        <button onClick={() => setEditing(false)} className="text-sm text-stone-500">
                            {t('common.cancel')}
                        </button>
                    </div>
                ) : (
                    <>
                        <h2 className="text-lg font-semibold text-stone-900">{org.name}</h2>
                        <button
                            onClick={() => setEditing(true)}
                            className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
                            title={t('organizations.edit_name')}
                        >
                            ✏️
                        </button>
                    </>
                )}
            </div>

            {/* Members */}
            <div className="px-5 py-3">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
                    {t('organizations.members')} ({org.members.length})
                </h3>
                <ul className="space-y-1.5">
                    {org.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between text-sm">
                            <span className="text-stone-700">{m.displayName || m.userEmail}</span>
                            <span className="text-xs text-stone-400 px-2 py-0.5 bg-stone-50 rounded-full">
                                {m.role === 'owner' ? t('organizations.owner') : t('organizations.member')}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>


            {/* Invite link (if generated) */}
            {inviteUrl && (
                <div className="px-5 py-3 bg-teal-50 border-t border-teal-100">
                    <p className="text-xs text-teal-700 mb-2">{t('organizations.invite_description')}</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            readOnly
                            value={inviteUrl}
                            className="flex-1 px-2 py-1.5 bg-white border border-teal-200 rounded text-xs text-stone-600 font-mono"
                        />
                        <button
                            onClick={handleCopy}
                            className="px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700 transition-colors"
                        >
                            {copied ? '✓' : '📋'}
                        </button>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex justify-between items-center px-5 py-3 border-t border-stone-100 bg-stone-50">
                <button
                    onClick={handleInvite}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 font-medium transition-colors"
                >
                    📨 {t('organizations.invite')}
                </button>

                <button
                    onClick={handleLeave}
                    disabled={leaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 font-medium transition-colors disabled:opacity-50"
                >
                    {isLastMember ? `🗑️ ${t('organizations.delete')}` : `👋 ${t('organizations.leave')}`}
                </button>
            </div>
        </div>
    );
}
