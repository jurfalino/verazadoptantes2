'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';
import { ThemeSelector } from '@/components/ThemeSelector';
import Link from 'next/link';

interface UserMenuProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
        isAdmin?: boolean;
    };
    /** Server-resolved admin flag (from layout auth()); use so Admin shows on first paint and on every route */
    isAdmin?: boolean;
}

export default function UserMenu({ user, isAdmin: isAdminFromServer }: UserMenuProps) {
    const { t, locale, setLocale } = useLanguage();
    const { openLogin } = useAuthContext();
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);
    const [animalsEnabled, setAnimalsEnabled] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    // Single source: server-passed isAdmin (layout) > user.isAdmin (session callback) > client session
    const userIsAdmin = isAdminFromServer ?? !!(user as { isAdmin?: boolean } | undefined)?.isAdmin ?? !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // Fetch feature flags
    useEffect(() => {
        if (!user) return;
        fetch('/api/admin/config')
            .then(res => res.json())
            .then((data) => {
                const cfg = data as { config?: Record<string, string> };
                if (cfg.config?.ENABLE_ANIMALS_FOR_ADOPTION === 'true') {
                    setAnimalsEnabled(true);
                }
            })
            .catch(() => { });
    }, [user]);

    const handleSignOut = async () => {
        await signOut({ redirectTo: '/' });
    };

    const toggleLanguage = () => {
        setLocale(locale === 'es' ? 'en' : 'es');
    };

    // Language toggle — always visible to all users
    const langToggle = (
        <button
            onClick={toggleLanguage}
            title={locale === 'es' ? 'Switch to English' : 'Cambiar a Español'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl hover:bg-stone-100 transition-colors text-sm font-medium text-stone-600"
            aria-label={locale === 'es' ? 'Switch to English' : 'Cambiar a Español'}
        >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
            {locale === 'es' ? 'ES' : 'EN'}
        </button>
    );

    if (!user) {
        return (
            <>
                {langToggle}
                <ThemeSelector />
                <button
                    onClick={() => openLogin()}
                    className="flex items-center gap-2 px-3 py-2 sm:px-4 text-sm font-semibold text-teal-900 bg-teal-200 hover:bg-teal-300 rounded-xl shadow-sm transition-all"
                >
                    <svg className="w-4 h-4 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    <span className="hidden sm:inline">{t('nav.sign_in') || 'Sign In'}</span>
                    <span className="sm:hidden text-xs">Log in</span>
                </button>
            </>
        );
    }

    return (
        <>
            {langToggle}
            <ThemeSelector />
            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-3 hover:bg-stone-50 p-1.5 rounded-xl transition-colors border border-transparent hover:border-stone-200 focus:outline-none"
                >
                    <div className="flex items-center gap-2">
                        {user.image ? (
                            <img
                                src={user.image}
                                className="w-9 h-9 rounded-full border border-teal-200 shadow-sm"
                                alt="Avatar"
                            />
                        ) : (
                            <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold border border-teal-200">
                                {user.name?.[0] || 'U'}
                            </div>
                        )}
                        <span className="text-sm font-semibold text-stone-700 hidden md:block">
                            {user.name}
                        </span>
                        <svg className={`w-4 h-4 text-stone-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </button>

                {/* Dropdown Menu */}
                {isOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-stone-200 py-1 z-50 animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-4 py-3 border-b border-stone-100">
                            <p className="text-sm font-semibold text-stone-900 truncate">{user.name}</p>
                            <p className="text-xs text-stone-500 truncate">{user.email}</p>
                        </div>

                        <div className="py-1">
                            <Link
                                href="/my-adopters"
                                className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                                {t('dashboard.my_adopters') || 'My Adopters'}
                            </Link>
                            {animalsEnabled && (
                                <Link
                                    href="/my-animals"
                                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <span className="text-base w-4 h-4 flex items-center justify-center">🐾</span>
                                    {t('dashboard.my_animals') || 'My Animals'}
                                </Link>
                            )}
                            <Link
                                href="/my-adoptions"
                                className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                                {t('dashboard.my_adoptions') || 'My Adoptions'}
                            </Link>
                            <Link
                                href="/settings"
                                className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <svg className="w-4 h-4 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                {t('settings.title') || 'Settings'}
                            </Link>
                        </div>

                        {userIsAdmin && (
                            <div className="border-t border-stone-100 py-1">
                                <Link
                                    href="/admin"
                                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-teal-700 hover:bg-teal-50 font-medium transition-colors"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <svg className="w-4 h-4 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    Admin
                                </Link>
                            </div>
                        )}

                        <div className="border-t border-stone-100 py-1">
                            <button
                                onClick={handleSignOut}
                                className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 font-medium transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                {t('nav.sign_out')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
