'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

// Grouped nav. `minRole` gates BOTH the moderator's filtered view (they see only
// 'moderator' items) and the admin's per-item marker (Mod pill vs 🔒). Sections
// whose items all get filtered out don't render. NOTE: this only drives the UI —
// actual access control for admin-only pages must be enforced server-side.
type NavItem = { href: string; labelKey: string; icon: string; minRole: 'moderator' | 'admin'; special?: boolean };
const SECTIONS: Array<{ titleKey: string; items: NavItem[] }> = [
    { titleKey: 'nav_sect_panel', items: [
        { href: '/admin', labelKey: 'nav_overview', icon: '📊', minRole: 'moderator' },
    ] },
    { titleKey: 'nav_sect_moderation', items: [
        { href: '/admin/data-quality', labelKey: 'nav_data_quality', icon: '🧹', minRole: 'moderator' },
        { href: '/admin/adopters', labelKey: 'nav_adopters_list', icon: '👤', minRole: 'moderator' },
        { href: '/admin/imports', labelKey: 'nav_imports', icon: '📥', minRole: 'moderator' },
        { href: '/admin/deleted', labelKey: 'nav_deleted', icon: '🗑️', minRole: 'moderator' },
    ] },
    { titleKey: 'nav_sect_requests', items: [
        { href: '/admin/data-requests', labelKey: 'nav_data_requests', icon: '📬', minRole: 'moderator' },
        { href: '/admin/pii-requests', labelKey: 'nav_pii_requests', icon: '🔒', minRole: 'moderator' },
    ] },
    { titleKey: 'nav_sect_admin', items: [
        { href: '/admin/users', labelKey: 'nav_users', icon: '👥', minRole: 'admin' },
        { href: '/admin/organizations', labelKey: 'nav_organizations', icon: '🏢', minRole: 'admin' },
        { href: '/admin/config', labelKey: 'nav_config', icon: '⚙️', minRole: 'admin' },
        { href: '/admin/notifications', labelKey: 'nav_communications', icon: '📡', minRole: 'admin' },
        { href: '/admin/walkthrough', labelKey: 'nav_walkthrough', icon: '🎯', minRole: 'admin' },
    ] },
    { titleKey: 'nav_sect_system', items: [
        { href: '/admin/audit', labelKey: 'nav_audit_log', icon: '📋', minRole: 'admin' },
        { href: '/admin/blocked-logins', labelKey: 'nav_blocked_logins', icon: '🚫', minRole: 'admin' },
        { href: '/admin/health', labelKey: 'nav_system_health', icon: '🩺', minRole: 'admin' },
        { href: '/admin/data', labelKey: 'nav_data_migration', icon: '📦', minRole: 'admin' },
        { href: '/admin/business-logic', labelKey: 'nav_business_logic', icon: '📖', minRole: 'admin' },
        { href: '/admin/query', labelKey: 'nav_sql', icon: '⚡', minRole: 'admin', special: true },
    ] },
];

export default function AdminSidebar({ isAdmin }: { isAdmin: boolean }) {
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
                lg:sticky lg:top-16 lg:self-start lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:translate-x-0 lg:z-auto
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
                <nav className="mt-2 px-4 space-y-4">
                    {SECTIONS.map(section => {
                        // Moderators see only 'moderator' items; admins see all. A section
                        // with nothing visible is dropped entirely.
                        const items = section.items.filter(i => isAdmin || i.minRole === 'moderator');
                        if (items.length === 0) return null;
                        return (
                            <div key={section.titleKey} className="space-y-1">
                                <div className="px-4 text-[10px] font-semibold uppercase tracking-wider text-stone-500">{t(`admin.${section.titleKey}`)}</div>
                                {items.map(item => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setOpen(false)}
                                        className={`
                                            flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm
                                            ${isActive(item.href)
                                                ? 'bg-stone-800 text-white font-medium'
                                                : 'hover:bg-stone-800 hover:text-white'
                                            }
                                            ${item.special ? 'text-amber-500/80 hover:text-amber-400' : ''}
                                        `}
                                    >
                                        <span className="min-w-0 truncate">{item.icon} {t(`admin.${item.labelKey}`)}</span>
                                        {/* Marker only in the admin view: which items a moderator also sees. */}
                                        {isAdmin && (item.minRole === 'moderator'
                                            ? <span className="flex-shrink-0 text-[9px] font-bold text-teal-300 bg-teal-500/15 border border-teal-500/30 rounded-full px-1.5 py-px" title={t('admin.nav_mod_accessible')}>Mod</span>
                                            : <span className="flex-shrink-0 text-stone-600 text-xs" title={t('admin.nav_admin_only')} aria-label={t('admin.nav_admin_only')}>🔒</span>)}
                                    </Link>
                                ))}
                            </div>
                        );
                    })}

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
