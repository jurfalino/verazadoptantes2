'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

interface NotificationItem {
    id: string;
    type: string;
    title: string;
    body: string;
    url: string | null;
    icon: string;
    read: number;
    dismissed: number;
    createdAt: number | string | Date;
}

type FilterTab = 'all' | 'unread' | 'archived';

/**
 * Strip a leading emoji + whitespace from a notification title. Defensive
 * against legacy DB rows that prefix the title with an emoji already shown
 * separately as `item.icon`. Mirrors the helper in NotificationBell.tsx.
 * Idempotent.
 */
function stripLeadingEmoji(s: string): string {
    return s.replace(/^\p{Extended_Pictographic}\s*/u, '');
}

function timeAgo(date: Date, locale: string): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    const isEs = locale === 'es';
    if (diffMin < 1) return isEs ? 'ahora' : 'now';
    if (diffMin < 60) return isEs ? `hace ${diffMin} min` : `${diffMin}m ago`;
    if (diffHr < 24) return isEs ? `hace ${diffHr}h` : `${diffHr}h ago`;
    if (diffDays < 7) return isEs ? `hace ${diffDays}d` : `${diffDays}d ago`;
    return date.toLocaleDateString(locale === 'es' ? 'es-AR' : 'en-US', { month: 'short', day: 'numeric' });
}

const TYPE_LABELS: Record<string, { es: string; en: string; icon: string }> = {
    contract_result: { es: 'Contrato', en: 'Contract', icon: '📋' },
    form_submission: { es: 'Formulario', en: 'Form', icon: '📝' },
    system: { es: 'Sistema', en: 'System', icon: '⚙️' },
    pii_access_request: { es: 'Acceso a contacto', en: 'Contact access', icon: '🔒' },
    pii_access_approved: { es: 'Acceso aprobado', en: 'Access approved', icon: '✅' },
    pii_access_denied: { es: 'Acceso no aprobado', en: 'Access denied', icon: '🔒' },
    pii_access_revoked: { es: 'Acceso removido', en: 'Access removed', icon: '🔒' },
    contact_entry_added: { es: 'Dato de contacto agregado', en: 'Contact detail added', icon: '+' },
};

export default function NotificacionesPage() {
    const { data: session, status: sessionStatus } = useSession();
    const router = useRouter();
    const { t, locale } = useLanguage();

    const [items, setItems] = useState<NotificationItem[]>([]);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<FilterTab>('all');
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [types, setTypes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    const isEs = locale === 'es';

    const fetchPage = useCallback(async (pageNum: number, filterTab: FilterTab, type: string, append = false) => {
        if (!session?.user?.email) return;
        try {
            const params = new URLSearchParams({
                page: String(pageNum),
                filter: filterTab,
            });
            if (type) params.set('type', type);

            const res = await fetch(`/api/notifications?${params}`);
            if (!res.ok) return;

            const data = await res.json() as {
                items: NotificationItem[];
                total: number;
                hasMore: boolean;
                types: string[];
                unreadCount: number;
            };

            if (append) {
                setItems(prev => [...prev, ...data.items]);
            } else {
                setItems(data.items);
            }
            setTotal(data.total);
            setHasMore(data.hasMore);
            setTypes(data.types || []);
        } catch { /* silent */ }
    }, [session?.user?.email]);

    // Initial load
    useEffect(() => {
        if (sessionStatus === 'loading') return;
        if (!session?.user?.email) {
            router.push('/');
            return;
        }
        setLoading(true);
        fetchPage(1, filter, typeFilter).finally(() => setLoading(false));
    }, [session, sessionStatus, router, fetchPage, filter, typeFilter]);

    // Change filter → reset to page 1
    const handleFilterChange = (newFilter: FilterTab) => {
        setFilter(newFilter);
        setPage(1);
        setLoading(true);
        fetchPage(1, newFilter, typeFilter).finally(() => setLoading(false));
    };

    const handleTypeChange = (newType: string) => {
        setTypeFilter(newType);
        setPage(1);
        setLoading(true);
        fetchPage(1, filter, newType).finally(() => setLoading(false));
    };

    const handleLoadMore = async () => {
        const next = page + 1;
        setPage(next);
        setLoadingMore(true);
        await fetchPage(next, filter, typeFilter, true);
        setLoadingMore(false);
    };

    // Mark single notification as read
    const handleMarkRead = async (item: NotificationItem) => {
        if (item.read) return;
        setItems(prev => prev.map(n => n.id === item.id ? { ...n, read: 1 } : n));
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
        }).catch(() => { /* silent */ });
    };

    // Click notification → mark read + navigate
    const handleClick = (item: NotificationItem) => {
        handleMarkRead(item);
        if (item.url) router.push(item.url);
    };

    // Dismiss single
    const handleDismiss = async (e: React.MouseEvent, item: NotificationItem) => {
        e.stopPropagation();
        setItems(prev => prev.filter(n => n.id !== item.id));
        setTotal(prev => Math.max(0, prev - 1));
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dismiss: item.id }),
        }).catch(() => { /* silent */ });
    };

    // Mark all read
    const handleMarkAllRead = async () => {
        setItems(prev => prev.map(n => ({ ...n, read: 1 })));
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markAllRead: true }),
        }).catch(() => { /* silent */ });
    };

    // Dismiss all read
    const handleDismissAll = async () => {
        setItems(prev => prev.filter(n => !n.read));
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dismissAll: true }),
        }).then(() => {
            // Refresh to get accurate counts
            setPage(1);
            fetchPage(1, filter, typeFilter);
        }).catch(() => { /* silent */ });
    };

    const unreadCount = items.filter(n => !n.read).length;

    const filterTabs: { key: FilterTab; label: string }[] = [
        { key: 'all', label: t('notifications.all') },
        { key: 'unread', label: t('notifications.unread') },
        { key: 'archived', label: t('notifications.archived') },
    ];

    const getEmptyMessage = () => {
        if (filter === 'unread') return t('notifications.no_unread');
        if (filter === 'archived') return t('notifications.no_archived');
        return t('notifications.no_notifications');
    };

    const getEmptyIcon = () => {
        if (filter === 'unread') return '✅';
        if (filter === 'archived') return '📦';
        return '🔔';
    };

    if (sessionStatus === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-6 h-6 border-2 rounded-full animate-spin"
                    style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--brand)' }} />
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h1 style={{
                    fontSize: '1.5rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    🔔 {t('notifications.title')}
                    {total > 0 && (
                        <span style={{
                            fontSize: '0.8rem',
                            fontWeight: 500,
                            color: 'var(--text-muted)',
                            background: 'var(--surface-muted)',
                            padding: '2px 10px',
                            borderRadius: 20,
                        }}>
                            {total}
                        </span>
                    )}
                </h1>
                <div style={{ display: 'flex', gap: 8 }}>
                    {unreadCount > 0 && filter !== 'archived' && (
                        <button
                            onClick={handleMarkAllRead}
                            style={{
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                color: 'var(--brand)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '6px 12px',
                                borderRadius: 8,
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-muted)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                        >
                            {t('notifications.mark_all_read')}
                        </button>
                    )}
                    {filter !== 'archived' && items.some(n => n.read) && (
                        <button
                            onClick={handleDismissAll}
                            style={{
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                color: 'var(--text-muted)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '6px 12px',
                                borderRadius: 8,
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-muted)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                        >
                            {t('notifications.dismiss_all')}
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Tabs */}
            <div style={{
                display: 'flex',
                gap: 4,
                marginBottom: 16,
                background: 'var(--surface-muted)',
                borderRadius: 12,
                padding: 4,
            }}>
                {filterTabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => handleFilterChange(tab.key)}
                        style={{
                            flex: 1,
                            padding: '8px 16px',
                            borderRadius: 8,
                            border: 'none',
                            fontSize: '0.85rem',
                            fontWeight: filter === tab.key ? 600 : 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            background: filter === tab.key ? 'var(--surface-card)' : 'transparent',
                            color: filter === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                            boxShadow: filter === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Type Filter Pills */}
            {types.length > 1 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    <button
                        onClick={() => handleTypeChange('')}
                        style={{
                            padding: '4px 12px',
                            borderRadius: 20,
                            border: '1px solid var(--border-default)',
                            fontSize: '0.78rem',
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            background: !typeFilter ? 'var(--brand)' : 'var(--surface-card)',
                            color: !typeFilter ? '#fff' : 'var(--text-muted)',
                        }}
                    >
                        {t('notifications.all_types')}
                    </button>
                    {types.map(type => {
                        const label = TYPE_LABELS[type];
                        return (
                            <button
                                key={type}
                                onClick={() => handleTypeChange(typeFilter === type ? '' : type)}
                                style={{
                                    padding: '4px 12px',
                                    borderRadius: 20,
                                    border: '1px solid var(--border-default)',
                                    fontSize: '0.78rem',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    background: typeFilter === type ? 'var(--brand)' : 'var(--surface-card)',
                                    color: typeFilter === type ? '#fff' : 'var(--text-muted)',
                                }}
                            >
                                {label?.icon || '📋'} {isEs ? label?.es : label?.en || type}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                    <div className="w-6 h-6 border-2 rounded-full animate-spin"
                        style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--brand)' }} />
                </div>
            ) : items.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: '64px 24px',
                    background: 'var(--surface-card)',
                    borderRadius: 16,
                    border: '1px solid var(--border-default)',
                }}>
                    <p style={{ fontSize: '2rem', marginBottom: 8 }}>{getEmptyIcon()}</p>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                        {getEmptyMessage()}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {filter === 'unread'
                            ? (isEs ? 'No tenés notificaciones pendientes.' : 'You have no pending notifications.')
                            : filter === 'archived'
                                ? (isEs ? 'Las notificaciones archivadas aparecen acá.' : 'Dismissed notifications will appear here.')
                                : (isEs ? 'Las notificaciones nuevas aparecerán acá.' : 'New notifications will show up here.')}
                    </p>
                </div>
            ) : (
                <div style={{
                    background: 'var(--surface-card)',
                    borderRadius: 16,
                    border: '1px solid var(--border-default)',
                    overflow: 'hidden',
                }}>
                    {items.map((item, idx) => {
                        const createdDate = typeof item.createdAt === 'number'
                            ? new Date(item.createdAt * 1000)
                            : new Date(item.createdAt);

                        const typeLabel = TYPE_LABELS[item.type];

                        return (
                            <div
                                key={item.id}
                                onClick={() => handleClick(item)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter') handleClick(item); }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 12,
                                    padding: '14px 16px',
                                    cursor: item.url ? 'pointer' : 'default',
                                    transition: 'background 0.15s',
                                    borderBottom: idx < items.length - 1 ? '1px solid var(--border-default)' : 'none',
                                    borderLeft: !item.read ? '3px solid var(--brand)' : '3px solid transparent',
                                    background: !item.read ? 'var(--accent-subtle-bg)' : 'transparent',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-muted)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = !item.read ? 'var(--accent-subtle-bg)' : 'transparent'; }}
                            >
                                <span style={{ fontSize: '1.3rem', flexShrink: 0, marginTop: 2 }}>
                                    {item.icon}
                                </span>

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                        <p style={{
                                            fontSize: '0.9rem',
                                            fontWeight: !item.read ? 600 : 500,
                                            color: 'var(--text-primary)',
                                            lineHeight: 1.3,
                                        }}>
                                            {stripLeadingEmoji(item.title)}
                                        </p>
                                        {!item.read && (
                                            <span style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: 'var(--brand)',
                                                flexShrink: 0,
                                            }} />
                                        )}
                                    </div>
                                    <p style={{
                                        fontSize: '0.8rem',
                                        color: 'var(--text-muted)',
                                        lineHeight: 1.4,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}>
                                        {item.body}
                                    </p>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        marginTop: 6,
                                    }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                                            {timeAgo(createdDate, locale)}
                                        </span>
                                        {typeLabel && (
                                            <span style={{
                                                fontSize: '0.7rem',
                                                fontWeight: 500,
                                                padding: '1px 8px',
                                                borderRadius: 10,
                                                background: 'var(--surface-muted)',
                                                color: 'var(--text-muted)',
                                            }}>
                                                {isEs ? typeLabel.es : typeLabel.en}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                                    {!item.read && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleMarkRead(item); }}
                                            title={t('notifications.mark_read')}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: 6,
                                                borderRadius: 6,
                                                color: 'var(--text-muted)',
                                                fontSize: '0.85rem',
                                                transition: 'all 0.15s',
                                                lineHeight: 1,
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-muted)'; e.currentTarget.style.color = 'var(--brand)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                                        >
                                            ✓
                                        </button>
                                    )}
                                    {filter !== 'archived' && (
                                        <button
                                            onClick={(e) => handleDismiss(e, item)}
                                            title={t('notifications.dismiss')}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: 6,
                                                borderRadius: 6,
                                                color: 'var(--text-muted)',
                                                fontSize: '0.85rem',
                                                transition: 'all 0.15s',
                                                lineHeight: 1,
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-muted)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Load More + Count */}
            {items.length > 0 && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 16,
                    padding: '0 4px',
                }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                        {t('notifications.showing')} {items.length} {t('notifications.of_total')} {total}
                    </span>
                    {hasMore && (
                        <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            style={{
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: 'var(--brand)',
                                background: 'none',
                                border: '1px solid var(--brand)',
                                borderRadius: 10,
                                padding: '8px 20px',
                                cursor: loadingMore ? 'wait' : 'pointer',
                                transition: 'all 0.15s',
                                opacity: loadingMore ? 0.6 : 1,
                            }}
                        >
                            {loadingMore
                                ? (isEs ? 'Cargando...' : 'Loading...')
                                : t('notifications.load_more')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
