'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';

export default function LoginModal() {
    const { isLoginOpen, closeLogin, redirectPath } = useAuthContext();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(false);

    if (!isLoginOpen) return null;

    const handleGoogleLogin = async () => {
        setLoading(true);
        await signIn('google', { redirectTo: redirectPath || window.location.pathname });
    };

    return (
        <div className="fixed inset-0 bg-emerald-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 relative border border-emerald-100">
                <button
                    onClick={closeLogin}
                    className="absolute top-4 right-4 text-emerald-900/40 hover:text-emerald-700 transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-emerald-900 tracking-tight">{t('auth.login_title') || 'Sign In'}</h2>
                    <p className="text-emerald-600/70 text-sm mt-2">{t('auth.login_desc') || 'Sign in to access advanced features.'}</p>
                </div>

                <div className="space-y-4">
                    {/* Google Login */}
                    <button
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        className="flex items-center justify-center gap-3 px-6 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all w-full group disabled:opacity-70"
                    >
                        <img src="https://authjs.dev/img/providers/google.svg" className="w-5 h-5" alt="Google" />
                        <span className="font-semibold text-gray-700 group-hover:text-gray-900">
                            {loading ? t('auth.signing_in') || 'Signing in...' : t('auth.continue_google')}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
