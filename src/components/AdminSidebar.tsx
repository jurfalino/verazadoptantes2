'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
    { href: '/admin', label: 'Overview', icon: '📊' },
    { href: '/admin/flags', label: 'Flagged Content', icon: '🚩' },
    { href: '/admin/duplicates', label: 'Duplicates', icon: '🔍' },
    { href: '/admin/adopters', label: 'Adopters List', icon: '👤' },
    { href: '/admin/query', label: 'SQL Runner', icon: '⚡', special: true },
    { href: '/admin/config', label: 'Configuration', icon: '⚙️' },
    { href: '/admin/data-requests', label: 'Data Requests', icon: '📬' },
    { href: '/admin/users', label: 'Users', icon: '👥' },
    { href: '/admin/audit', label: 'Audit Log', icon: '📋' },
    { href: '/admin/data', label: 'Data Migration', icon: '📦' },
];

export default function AdminSidebar() {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();

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
                        aria-label="Open menu"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="font-semibold text-sm tracking-tight">Admin Console</span>
                </div>
                <Link href="/" className="text-xs text-stone-500 hover:text-white">← App</Link>
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
                        <h1 className="text-xl font-semibold text-white tracking-tight">Admin Console</h1>
                        <p className="text-xs text-stone-500 mt-1">v1.8.0</p>
                    </div>
                    {/* Close button (mobile only) */}
                    <button
                        onClick={() => setOpen(false)}
                        className="lg:hidden p-1 rounded-lg hover:bg-stone-800 text-stone-500 hover:text-white"
                        aria-label="Close menu"
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
                            {item.icon} {item.label}
                        </Link>
                    ))}

                    <div className="pt-6 mt-6 border-t border-stone-800 space-y-1">
                        <Link
                            href="/keystatic"
                            target="_blank"
                            className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors text-sm text-teal-700/80 hover:text-teal-700"
                        >
                            ✏️ CMS Editor ↗
                        </Link>
                        <Link
                            href="/"
                            className="block px-4 py-2 rounded-lg hover:bg-stone-800 hover:text-white transition-colors text-sm"
                        >
                            ← Back to App
                        </Link>
                    </div>
                </nav>
            </aside>
        </>
    );
}
