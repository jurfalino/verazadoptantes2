'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { CountrySelector } from '@/components/CountrySelector';
import { getUserSettings, updateUserCountry } from '@/app/actions/settings';
import { useShowToast } from '@/components/ui/Toast';

const themes = [
    { id: 'light', label: 'Claro', labelEn: 'Light', icon: '☀️', bg: '#fafaf9', fg: '#1c1917' },
    { id: 'apple', label: 'Gris', labelEn: 'Gray', icon: '🌫️', bg: '#d1d1d6', fg: '#1d1d1f' },
    { id: 'dark', label: 'Azul Noche', labelEn: 'Dark Night', icon: '🌙', bg: '#0a1628', fg: '#e0e7ff' },
] as const;

const languages = [
    { id: 'en' as const, label: 'English', flag: '🇺🇸' },
    { id: 'es' as const, label: 'Español', flag: '🇦🇷' },
];

export default function SettingsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { t, locale, setLocale } = useLanguage();
    const { theme, setTheme } = useTheme();
    const toast = useShowToast();

    const [country, setCountry] = useState('');
    const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
    const [savingCountry, setSavingCountry] = useState(false);
    const [loading, setLoading] = useState(true);

    // Redirect if not authenticated
    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/');
        }
    }, [status, router]);

    // Load settings
    useEffect(() => {
        if (status !== 'authenticated') return;
        getUserSettings().then(s => {
            if (s) {
                setCountry(s.country || '');
                setDetectedCountry(s.country);
            }
            setLoading(false);
        });
    }, [status]);

    const handleSaveCountry = async () => {
        if (!country) return;
        setSavingCountry(true);
        const result = await updateUserCountry(country);
        if (result.success) {
            localStorage.setItem(`country_confirmed_${session?.user?.email}`, '1');
            toast.success(t('settings.saved') || 'Saved!');
        } else {
            toast.error('Error');
        }
        setSavingCountry(false);
    };

    if (status === 'loading' || loading) {
        return (
            <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 bg-stone-200 dark:bg-stone-700 rounded w-1/3"></div>
                    <div className="h-32 bg-stone-200 dark:bg-stone-700 rounded-xl"></div>
                    <div className="h-32 bg-stone-200 dark:bg-stone-700 rounded-xl"></div>
                    <div className="h-32 bg-stone-200 dark:bg-stone-700 rounded-xl"></div>
                </div>
            </main>
        );
    }

    if (status === 'unauthenticated') return null;

    return (
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-8">
                {t('settings.title') || 'Settings'}
            </h1>

            <div className="space-y-8">
                {/* Country Section */}
                <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
                    <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200 mb-1">
                        🌍 {t('settings.country') || 'Country'}
                    </h2>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
                        {t('settings.country_description') || 'Your country determines which adopter records you see in search results.'}
                    </p>
                    <CountrySelector
                        value={country}
                        onChange={setCountry}
                        detectedCountry={detectedCountry}
                    />
                    <button
                        onClick={handleSaveCountry}
                        disabled={savingCountry || !country}
                        className="mt-4 px-6 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingCountry ? '...' : (t('settings.save') || 'Save')}
                    </button>
                </section>

                {/* Language Section */}
                <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
                    <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200 mb-4">
                        🗣️ {t('settings.language') || 'Language'}
                    </h2>
                    <div className="grid grid-cols-2 gap-3">
                        {languages.map(lang => (
                            <button
                                key={lang.id}
                                onClick={() => setLocale(lang.id)}
                                className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all
                                    ${locale === lang.id
                                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                                    }`}
                            >
                                <span className="text-2xl">{lang.flag}</span>
                                <div className="text-left">
                                    <span className={`text-sm font-bold ${locale === lang.id ? 'text-teal-700 dark:text-teal-300' : 'text-stone-700 dark:text-stone-300'}`}>
                                        {lang.label}
                                    </span>
                                </div>
                                {locale === lang.id && (
                                    <span className="ml-auto text-teal-500 text-lg">✓</span>
                                )}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Theme Section */}
                <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
                    <h2 className="text-lg font-bold text-stone-800 dark:text-stone-200 mb-4">
                        🎨 {t('settings.theme') || 'Theme'}
                    </h2>
                    <div className="grid grid-cols-3 gap-3">
                        {themes.map(t => (
                            <button
                                key={t.id}
                                onClick={() => setTheme(t.id)}
                                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all
                                    ${theme === t.id
                                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                                    }`}
                            >
                                <span
                                    className="w-10 h-10 rounded-full border-2 border-stone-300 dark:border-stone-600 flex-shrink-0"
                                    style={{ backgroundColor: t.bg }}
                                />
                                <span className={`text-xs font-bold ${theme === t.id ? 'text-teal-700 dark:text-teal-300' : 'text-stone-600 dark:text-stone-400'}`}>
                                    {locale === 'es' ? t.label : t.labelEn}
                                </span>
                                {theme === t.id && (
                                    <span className="text-teal-500 text-sm">✓</span>
                                )}
                            </button>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
