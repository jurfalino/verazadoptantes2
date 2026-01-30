'use client';

import { signOut } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';

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

    const handleSignOut = async () => {
        if (isAnon) {
            // Clear the cookie
            document.cookie = "anon_user=; path=/; max-age=0";
            window.location.reload();
        } else {
            await signOut({ redirectTo: '/' });
        }
    };

    return (
        <div className="flex items-center gap-4">
            {user ? (
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        {user.image && (
                            <img
                                src={user.image}
                                className="w-8 h-8 rounded-full border border-emerald-200"
                                alt="Avatar"
                            />
                        )}
                        <span className="text-sm font-medium text-emerald-900 hidden md:block">
                            {user.name}
                        </span>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="text-xs text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 hover:bg-emerald-50 rounded transition-colors"
                    >
                        {t('nav.sign_out')}
                    </button>
                </div>
            ) : isAnon ? (
                <div className="flex items-center gap-3">
                    <span className="text-xs font-mono bg-emerald-50 text-emerald-600 px-2 py-1 rounded">
                        {t('nav.anon_mode')}
                    </span>
                    <button
                        onClick={handleSignOut}
                        className="text-xs text-red-400 hover:text-red-600 font-medium px-2 py-1 hover:bg-red-50 rounded transition-colors"
                    >
                        {t('nav.sign_out')}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
