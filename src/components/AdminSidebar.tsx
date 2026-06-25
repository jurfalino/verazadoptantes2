'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

const NAV_ITEMS: Array<{ href: string; labelKey: string; icon: string; special?: boolean }> = [
    { href: '/admin', labelKey: 'nav_overview', icon: '📊' },
    { href: '/admin/flags', labelKey: 'nav_flagged', icon: '🚩' },
    { href: '/admin/duplicates', labelKey: 'nav_duplicates', icon: '🔍' },
    { href: '/admin/adopters', labelKey: 'nav_adopters_list', icon: '👤' },
    { href: '/admin/query', labelKey: 'nav_sql', icon: '⚡', special: true },
    { href: '/admin/config', labelKey: 'nav_config', icon: '⚙️' },
    { href: '/admin/walkthrough', labelKey: 'nav_walkthrough', icon: '🎯' },
    { href: '/admin/data-requests', labelKey: 'nav_data_requests', icon: '📬' },
    { href: '/admin/deleted', labelKey: 'nav_deleted', icon: '🗑️' },
    { href: '/admin/pii-requests', labelKey: 'nav_pii_requests', icon: '🔒' },
    { href: '/admin/notifications', labelKey: 'nav_communications', icon: '📡' },
    { href: '/admin/users', labelKey: 'nav_users', icon: '👥' },
    { href: '/admin/organizations', labelKey: 'nav_organizations', icon: '🏢' },
    { href: '/admin/audit', labelKey: 'nav_audit_log', icon: '📋' },
    { href: '/admin/blocked-logins', labelKey: 'nav_blocked_logins', icon: '🚫' },
    { href: '/admin/health', labelKey: 'nav_system_health', icon: '🩺' },
    { href: '/admin/data', labelKey: 'nav_data_migration', icon: '📦' },
    { href: '/admin/business-logic', labelKey: 'nav_business_logic', icon: '📖' },
];

export default function AdminSidebar() {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const { t } = useLanguage();

    const isActive = (href: string) => {
        if (href === '/admin') return pathname === '/admin';
        return pathname.startsWith(href);
    };

    return (
        <>
            {/* Mobile Header Bar */}
            <div className="lg:hidden fixed top-16 left-0 right-0 z-40 bg-stone-900 text-white flex items-center justify-between px-4 py-3 shadow-lg">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setOpen(true)}
                        className="p-1.5 rounded-lg hover:bg-stone-800 transition-colors"
                        aria-label={t('admin.open_menu')}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="font-semibold text-sm tracking-tight">{t('admin.console')}</span>
                </div>
                <Link href="/" className="text-xs text-stone-500 hover:text-white">{t('admin.nav_back_app_short')}</Link>
            </div>

            {/* Mobile overlay */}
            {open && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm mt-16"
                    onClick={() => setOpen(false)}
                />
            )}

            {/* Sidebar — desktop: always visible, mobile: slide-in drawer */}
            <aside className={`
                fixed top-16 left-0 z-50 h-[calc(100%-4rem)] w-64 bg-stone-900 text-stone-300 flex-shrink-0
                transition-transform duration-300 ease-in-out
                ${open ? 'translate-x-0' : '-translate-x-full'}
                lg:top-0 lg:h-full lg:translate-x-0 lg:static lg:z-auto
            `}>
                <div className="p-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold text-white tracking-tight">{t('admin.console')}</h1>
                        <p className="text-xs text-stone-500 mt-1">v1.8.0</p>
                    </div>
                    {/* Close button (mobile only) */}
                    <button
                        onClick={() => setOpen(false)}
                        className="lg:hidden p-1 rounded-lg hover:bg-stone-800 text-stone-500 hover:text-white"
                        aria-label={t('admin.close_menu')}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <nav className="mt-2 px-4 space-y-1">
                    {NAV_ITEMS.map(item => (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={`
                                block px-4 py-2.5 rounded-lg transition-colors text-sm
                                ${isActive(item.href)
                                    ? 'bg-stone-800 text-white font-medium'
                                    : 'hover:bg-stone-800 hover:text-white'
                                }
                                ${item.special ? 'text-amber-500/80 hover:text-amber-400' : ''}
                            `}
                        >
                            {item.icon} {t(`admin.${item.labelKey}`)}
                        </Link>
                    ))}

                    <div className="pt-6 mt-6 border-t border-stone-800 space-y-1">
                        {/* Keystatic CMS link removed in v2.14.9-19 — Keystatic
                            was never actually wired up to serve content (the
                            /guia and /funcionalidades pages read directly from
                            src/content/guide-data.ts, not from Keystatic's
                            .mdoc files). The admin UI bundled ~2.8 MiB into
                            the worker and pushed us over Cloudflare's 3 MiB
                            free-plan ceiling for nothing. */}
                        <Link
                            href="/"
                            className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors text-sm"
                        >
                            {t('admin.back_to_app')}
                        </Link>
                    </div>
                </nav>
            </aside>
        </>
    );
}
