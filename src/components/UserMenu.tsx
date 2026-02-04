'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';
import Link from 'next/link';

interface UserMenuProps {
    user?: {
        name?: string | null;
        email?: string | null;
        image?: string | null;
    };
    isAnon: boolean;
}

export default function UserMenu({ user, isAnon }: UserMenuProps) {
    const { t } = useLanguage();
    const { openLogin } = useAuthContext();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

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

    const handleSignOut = async () => {
        if (isAnon) {
            // Clear the cookie
            document.cookie = "anon_user=; path=/; max-age=0";
            window.location.reload();
        } else {
            await signOut({ redirectTo: '/' });
        }
    };

    if (isAnon) {
        return (
            <div className="flex items-center gap-3">
                <span className="text-xs font-mono bg-emerald-50 text-emerald-600 px-2 py-1 rounded">
                    {t('nav.anon_mode')}
                </span>
                <button
                    onClick={handleSignOut}
                    className="text-xs text-rose-400 hover:text-rose-600 font-medium px-2 py-1 hover:bg-rose-50 rounded transition-colors"
                >
                    {t('nav.sign_out')}
                </button>
            </div>
        );
    }

    if (!user) {
        return (
            <button
                onClick={() => openLogin()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-teal-900 bg-teal-200 hover:bg-teal-300 rounded-xl shadow-sm transition-all"
            >
                {t('nav.sign_in') || 'Sign In'}
            </button>
        );
    }

    return (
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
                        <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold border border-teal-200">
                            {user.name?.[0] || 'U'}
                        </div>
                    )}
                    <span className="text-sm font-bold text-stone-700 hidden md:block">
                        {user.name}
                    </span>
                    <svg className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-stone-200 py-1 z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="px-4 py-3 border-b border-stone-100">
                        <p className="text-sm font-bold text-stone-900 truncate">{user.name}</p>
                        <p className="text-xs text-stone-500 truncate">{user.email}</p>
                    </div>

                    <div className="py-1">
                        <Link
                            href="/my-adopters"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <svg className="w-4 h-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                            My Adopters
                        </Link>
                        <Link
                            href="/my-adoptions"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-teal-700 font-medium transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <svg className="w-4 h-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            My Adoptions
                        </Link>
                    </div>

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
    );
}

