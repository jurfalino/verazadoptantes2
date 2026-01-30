'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useSearchParams } from 'next/navigation';

export default function Login() {
    const [loading, setLoading] = useState(false);
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const enableAnon = searchParams.get('enable_anon') === 'true';

    const handleGoogleLogin = async () => {
        setLoading(true);
        await signIn('google', { redirectTo: '/' });
    };

    const handleSkip = async () => {
        // Set a cookie for anonymous tracking
        document.cookie = "anon_user=true; path=/; max-age=31536000"; // 1 year
        window.location.reload();
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

            {enableAnon && (
                <>
                    <div className="relative w-full max-w-sm">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-gray-50 px-2 text-gray-500">{t('auth.or')}</span></div>
                    </div>

                    <button
                        onClick={handleSkip}
                        className="text-sm text-gray-400 hover:text-gray-600 font-medium underline decoration-gray-300 underline-offset-4"
                    >
                        {t('auth.skip_anon')}
                    </button>

                    <p className="text-xs text-gray-400 max-w-xs text-center">
                        {t('auth.anon_disclaimer')}
                    </p>
                </>
            )}
        </div>
    );
}
