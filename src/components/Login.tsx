'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

export default function Login() {
    const [loading, setLoading] = useState(false);
    const { t } = useLanguage();

    const handleGoogleLogin = async () => {
        setLoading(true);
        await signIn('google', { redirectTo: '/' });
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-semibold text-stone-800">{t('auth.welcome')}</h2>
                <p className="text-stone-500 text-sm max-w-xs mx-auto">
                    {t('auth.welcome_sub')}
                </p>
            </div>

            <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="flex items-center gap-3 px-6 py-3 bg-white border border-stone-200 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 transition-all w-full max-w-sm justify-center group"
            >
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                <span className="font-semibold text-stone-700 group-hover:text-stone-900">{t('auth.continue_google')}</span>
            </button>
        </div>
    );
}

