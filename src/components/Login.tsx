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
                <h2 className="text-2xl font-bold text-gray-800">{t('auth.welcome')}</h2>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                    {t('auth.welcome_sub')}
                </p>
            </div>

            <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all w-full max-w-sm justify-center group"
            >
                <img src="https://authjs.dev/img/providers/google.svg" className="w-5 h-5" alt="Google" />
                <span className="font-semibold text-gray-700 group-hover:text-gray-900">{t('auth.continue_google')}</span>
            </button>
        </div>
    );
}

