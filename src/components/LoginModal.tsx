'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';

export default function LoginModal() {
    const { isLoginOpen, closeLogin, redirectPath } = useAuthContext();
    const { t } = useLanguage();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isLoginOpen) return null;

    const handleGoogleLogin = async () => {
        setLoading(true);
        await signIn('google', { redirectTo: redirectPath || window.location.pathname });
    };

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        // Direct login (Credentials) - No magic link
        await signIn('credentials', { email, redirectTo: redirectPath || window.location.pathname });
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
                        className="flex items-center justify-center gap-3 px-6 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all w-full group"
                    >
                        <img src="https://authjs.dev/img/providers/google.svg" className="w-5 h-5" alt="Google" />
                        <span className="font-semibold text-gray-700 group-hover:text-gray-900">{t('auth.continue_google')}</span>
                    </button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">{t('auth.or')}</span></div>
                    </div>

                    {/* Email Login */}
                    <form onSubmit={handleEmailLogin} className="space-y-3">
                        <div>
                            <label htmlFor="email" className="sr-only">Email</label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all text-sm"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !email}
                            className="w-full py-3 px-4 bg-emerald-600 text-white font-bold rounded-xl shadow-md hover:bg-emerald-700 hover:shadow-lg transition-all disabled:opacity-70 disabled:shadow-none text-sm"
                        >
                            {loading ? t('auth.signing_in') || 'Signing in...' : t('auth.continue_email') || 'Continue with Email'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
