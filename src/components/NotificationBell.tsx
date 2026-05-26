'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
    createdAt: number | string | Date;
}

/**
 * Strip a leading emoji + whitespace from a notification title. Defensive against
 * legacy DB rows whose titles still include an emoji prefix that's now redundant
 * with the dedicated `icon` field rendered to the left of the title (v2.14.8-3).
 * Idempotent — applying it to an already-clean title is a no-op.
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

export default function NotificationBell() {
    const { data: session } = useSession();
    const router = useRouter();
    const { locale, t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [freshPulse, setFreshPulse] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef(0);

    const isAuthenticated = !!session?.user?.email;

    const POLL_INTERVAL_MS = 25_000; // Check for new notifications every 25s

    const fetchCount = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const res = await fetch(`/api/notifications?countOnly=true&_t=${Date.now()}`);
            if (!res.ok) return;
            const data = await res.json() as { unreadCount: number };
            const newCount = data.unreadCount || 0;

            if (newCount > prevCountRef.current) {
                setFreshPulse(true);
                setTimeout(() => setFreshPulse(false), 3000);
            }
            prevCountRef.current = newCount;
            setUnreadCount(newCount);
        } catch { /* silent */ }
    }, [isAuthenticated]);

    const fetchFullList = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const res = await fetch(`/api/notifications?_t=${Date.now()}`);
            if (!res.ok) return;
            const data = await res.json() as { items: NotificationItem[]; unreadCount: number };
            setItems(data.items || []);
            setUnreadCount(data.unreadCount ?? 0);
            prevCountRef.current = data.unreadCount ?? 0;
        } catch { /* silent */ }
    }, [isAuthenticated]);

    // Poll unread count regularly + refetch when tab becomes visible
    useEffect(() => {
        if (!isAuthenticated) return;
        fetchCount();
        const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') fetchCount();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [fetchCount, isAuthenticated]);

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch full list when dropdown opens; while open, refresh list periodically
    const handleToggle = async () => {
        const willOpen = !open;
        setOpen(willOpen);
        if (willOpen) {
            setLoading(true);
            await fetchFullList();
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open || !isAuthenticated) return;
        const interval = setInterval(fetchFullList, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [open, isAuthenticated, fetchFullList]);

    // Body scroll lock — only on mobile (below sm: where the dropdown renders
    // as a bottom sheet). Without this, swiping on the notifications list
    // bleeds through to page scroll, pushing the nav off-screen and leaving
    // the user looking at just the bottom of the panel.
    useEffect(() => {
        if (!open) return;
        if (typeof window === 'undefined') return;
        if (window.matchMedia('(min-width: 640px)').matches) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prevOverflow; };
    }, [open]);

    // Click a notification → mark read + navigate
    const handleClick = async (item: NotificationItem) => {
        if (!item.read) {
            // Optimistic update
            setItems(prev => prev.map(n => n.id === item.id ? { ...n, read: 1 } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
            prevCountRef.current = Math.max(0, prevCountRef.current - 1);
            fetch('/api/notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id }),
            }).catch(() => { /* silent */ });
        }
        setOpen(false);
        if (item.url) {
            router.push(item.url);
        }
    };

    // Mark all as read
    const handleMarkAllRead = async () => {
        setItems(prev => prev.map(n => ({ ...n, read: 1 })));
        setUnreadCount(0);
        prevCountRef.current = 0;
        setFreshPulse(false);
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markAllRead: true }),
        }).catch(() => { /* silent */ });
    };

    // Don't render for unauthenticated users (AFTER all hooks)
    if (!isAuthenticated) return null;

    const isEs = locale === 'es';

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={handleToggle}
                className="relative p-2 rounded-lg text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                aria-label={t('notifications.title')}
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>

                {/* Badge */}
                {unreadCount > 0 && (
                    <span
                        className={`absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-semibold text-white bg-red-500 rounded-full shadow-sm ${freshPulse ? 'animate-pulse' : ''
                            }`}
                    >
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Backdrop — mobile only. Catches taps outside the bottom sheet so
                dismissal is discoverable on touch (the mousedown click-outside
                handler is unreliable on mobile when the sheet covers most of
                the viewport). */}
            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/30 sm:hidden"
                    onClick={() => setOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Dropdown Panel — uses inline styles with CSS vars for theme safety.
                Mobile (default): bottom sheet pinned to the bottom edge.
                Desktop (sm: and up): popover anchored to the bell. */}
            {open && (
                <div
                    className="fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl sm:absolute sm:inset-auto sm:right-0 sm:top-auto sm:bottom-auto sm:mt-2 sm:max-h-none sm:w-96 sm:rounded-2xl shadow-2xl overflow-hidden z-50 flex flex-col"
                    style={{
                        background: 'var(--surface-card)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-default)',
                        backdropFilter: 'blur(20px)',
                        paddingBottom: 'env(safe-area-inset-bottom)',
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('notifications.title')}
                >
                    {/* Drag-handle bar — mobile-only visual affordance that this
                        is a dismissible sheet. Not functionally draggable; the
                        backdrop tap and the existing items provide dismissal. */}
                    <div className="sm:hidden flex justify-center pt-2 pb-1">
                        <div className="h-1.5 w-12 rounded-full" style={{ background: 'var(--border-default)' }} />
                    </div>

                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--surface-muted)' }}
                    >
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {t('notifications.title')}
                        </h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="text-xs font-medium transition-colors min-h-[44px] sm:min-h-0 px-2 -mr-2"
                                style={{ color: 'var(--brand)' }}
                            >
                                {isEs ? 'Marcar todo leído' : 'Mark all read'}
                            </button>
                        )}
                    </div>

                    {/* Items — `flex-1` so the list fills the available height
                        inside the bottom-sheet's `max-h-[85vh]` cap. Previously
                        a fixed `max-h-80` (320px) was nested inside the larger
                        sheet container, so the list never grew to use the
                        sheet's available vertical space. On desktop the
                        sm:max-h-80 keeps the popover's compact height. */}
                    <div className="flex-1 sm:flex-none sm:max-h-80 overflow-y-auto overscroll-contain">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <div
                                    className="w-5 h-5 border-2 rounded-full animate-spin"
                                    style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--brand)' }}
                                />
                            </div>
                        ) : items.length === 0 ? (
                            <div className="py-8 text-center">
                                <p className="text-2xl mb-1">🎉</p>
                                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                                    {isEs ? 'Sin notificaciones' : 'No notifications'}
                                </p>
                            </div>
                        ) : (
                            items.map((item) => {
                                const createdDate = typeof item.createdAt === 'number'
                                    ? new Date(item.createdAt * 1000)
                                    : new Date(item.createdAt);

                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleClick(item)}
                                        className="w-full text-left px-4 py-3 transition-colors"
                                        style={{
                                            borderBottom: '1px solid var(--border-default)',
                                            borderLeft: !item.read ? '3px solid var(--brand)' : '3px solid transparent',
                                            background: !item.read ? 'var(--accent-subtle-bg)' : 'transparent',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-muted)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = !item.read ? 'var(--accent-subtle-bg)' : 'transparent'; }}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <span className="text-lg flex-shrink-0 mt-0.5">{item.icon}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm leading-snug break-words ${!item.read ? 'font-semibold' : 'font-medium'}`} style={{ color: 'var(--text-primary)' }}>
                                                    {stripLeadingEmoji(item.title)}
                                                </p>
                                                <p className="text-xs leading-relaxed mt-0.5 line-clamp-2 break-words" style={{ color: 'var(--text-muted)' }}>
                                                    {item.body}
                                                </p>
                                                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                                                    {timeAgo(createdDate, locale)}
                                                </p>
                                            </div>
                                            {!item.read && (
                                                <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: 'var(--brand)' }} />
                                            )}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Footer — See all link */}
                    <a
                        href="/notificaciones"
                        onClick={(e) => { e.preventDefault(); setOpen(false); router.push('/notificaciones'); }}
                        className="block w-full text-center py-2.5 text-xs font-semibold transition-colors"
                        style={{
                            borderTop: '1px solid var(--border-default)',
                            color: 'var(--brand)',
                            textDecoration: 'none',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-muted)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        {isEs ? 'Ver todas →' : 'See all →'}
                    </a>
                </div>
            )}
        </div>
    );
}
