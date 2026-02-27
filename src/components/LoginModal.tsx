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
                        <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                        <span className="font-semibold text-gray-700 group-hover:text-gray-900">
                            {loading ? t('auth.signing_in') || 'Signing in...' : t('auth.continue_google')}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
