'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getOrgActivity, type OrgActivityEntry } from '@/app/actions/activity';

const ACTION_ICONS: Record<string, string> = {
    adopter_created: '➕',
    adopter_updated: '✏️',
    adoption_added: '🐾',
    adoption_updated: '🐾',
    image_uploaded: '📸',
    flag_created: '🚩',
    adopter_deleted: '🗑️',
    adopter_deletion_requested: '📋',
    verification_added: '✅',
};

function timeAgo(ts: number, isEs: boolean): string {
    const now = Date.now() / 1000;
    const diff = now - ts;
    const mins = Math.floor(diff / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (mins < 1) return isEs ? 'ahora' : 'now';
    if (mins < 60) return isEs ? `hace ${mins} min` : `${mins}m ago`;
    if (hrs < 24) return isEs ? `hace ${hrs}h` : `${hrs}h ago`;
    if (days < 7) return isEs ? `hace ${days}d` : `${days}d ago`;
    return new Date(ts * 1000).toLocaleDateString(isEs ? 'es-AR' : 'en-US', { month: 'short', day: 'numeric' });
}

export default function OrgActivityFeed() {
    const { locale, t } = useLanguage();
    const isEs = locale === 'es';
    const [entries, setEntries] = useState<OrgActivityEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        getOrgActivity(30).then(data => {
            setEntries(data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    if (loading) return null;
    if (entries.length === 0) return null;

    return (
        <div
            className="rounded-xl overflow-hidden shadow-sm mb-6"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
        >
            {/* Header */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center justify-between px-5 py-3 text-left transition-colors"
                style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-default)', background: 'var(--surface-muted)' }}
            >
                <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    📊 {t('organizations.activity_title')}
                    <span className="text-xs font-normal px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-subtle-bg)', color: 'var(--accent)' }}>
                        {entries.length}
                    </span>
                </span>
                <svg
                    className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                    style={{ color: 'var(--text-muted)' }}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Feed */}
            {!collapsed && (
                <div className="max-h-72 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-default)' }}>
                    {entries.map((entry) => {
                        const icon = ACTION_ICONS[entry.action] || '📌';
                        const actionLabel = t(`organizations.activity_${entry.action}`) || entry.action;
                        const userName = entry.userEmail.split('@')[0];

                        return (
                            <div
                                key={entry.id}
                                className="flex items-start gap-3 px-5 py-3 transition-colors"
                                style={{ borderColor: 'var(--border-default)' }}
                            >
                                <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                                        <span className="font-semibold">{userName}</span>{' '}
                                        {actionLabel}
                                    </p>
                                    {entry.target && (
                                        <a
                                            href={`/adopter/${entry.target}`}
                                            className="text-xs hover:underline mt-0.5 inline-block"
                                            style={{ color: 'var(--accent)' }}
                                        >
                                            {t('organizations.activity_view_profile')}
                                        </a>
                                    )}
                                </div>
                                <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>
                                    {timeAgo(entry.createdAt, isEs)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
