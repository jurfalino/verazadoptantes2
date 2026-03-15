'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getCountryByCode, countries, type Country } from '@/config/countries';
import { getUserSettings, updateUserCountry, getUserName, updateUserName } from '@/app/actions/settings';
import { CountrySelector } from '@/components/CountrySelector';
import { useRouter } from 'next/navigation';

interface CountryConfirmBannerProps {
    userEmail: string | null;
}

export function CountryConfirmBanner({ userEmail: serverEmail }: CountryConfirmBannerProps) {
    const { locale } = useLanguage();
    const router = useRouter();
    const [email, setEmail] = useState<string | null>(serverEmail);
    const [settings, setSettings] = useState<{ country: string | null; countryConfirmed: boolean } | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [showSelector, setShowSelector] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState('');
    const [userName, setUserName] = useState('');
    const [editingName, setEditingName] = useState(false);

    // Always resolve the email: prefer server prop, fallback to client-side fetch
    useEffect(() => {
        // If server already provided the email (production), use it immediately
        if (serverEmail) {
            setEmail(serverEmail);
            return;
        }
        // In local dev, auth() throws so serverEmail is always null.
        // Fetch session client-side instead.
        fetch('/api/auth/session')
            .then(r => r.json())
            .then((s: any) => {
                const fetchedEmail = s?.user?.email;
                if (fetchedEmail) {
                    setEmail(fetchedEmail);
                } else {
                    setLoaded(true); // Not signed in
                }
            })
            .catch(() => {
                setLoaded(true); // Fetch failed — mark as loaded so we don't hang
            });
    }, [serverEmail]);

    // Fetch country settings and user name when we have an email
    useEffect(() => {
        if (!email) {
            setLoaded(true);
            return;
        }

        // Check localStorage first
        const storageKey = `country_confirmed_${email}`;
        if (localStorage.getItem(storageKey) === '1') {
            setDismissed(true);
            setLoaded(true);
            return;
        }

        // Fetch settings + name from DB
        setLoaded(false);
        Promise.all([getUserSettings(), getUserName()]).then(([s, name]) => {
            if (s) {
                setSettings(s);
                if (s.countryConfirmed) {
                    localStorage.setItem(storageKey, '1');
                }
            } else {
                setSettings({ country: null, countryConfirmed: false });
            }
            if (name) setUserName(name);
            setLoaded(true);
        }).catch(err => {
            console.error('[CountryBanner] getUserSettings error:', err);
            setSettings({ country: null, countryConfirmed: false });
            setLoaded(true);
        });
    }, [email]);

    // Derive visibility
    const shouldShow = !!email && !dismissed && loaded && !!settings && !settings.countryConfirmed;

    // Lock body scroll while modal is visible
    useEffect(() => {
        if (shouldShow) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [shouldShow]);

    // --- ALL hooks above this line ---

    if (!shouldShow) {
        return null;
    }

    const handleSaveCountry = async (code: string) => {
        setSaving(true);
        try {
            // Save name if it was edited
            if (userName.trim()) {
                await updateUserName(userName.trim());
            }
            await updateUserCountry(code);
        } catch (err) {
            console.error('[CountryBanner] save error:', err);
        }
        // Always dismiss — don't depend on server action result
        localStorage.setItem(`country_confirmed_${email}`, '1');
        setDismissed(true);
        setSaving(false);
        router.refresh();
    };

    const quickCountries = countries.filter(c =>
        ['AR', 'UY', 'CL', 'MX'].includes(c.code)
    );

    const getName = (c: Country) => locale === 'es' ? c.nameEs : c.name;

    // Name editor section (shared between both modal variants)
    const nameSection = (
        <div className="mb-5 pb-5 border-b border-stone-200 dark:border-stone-600">
            <label className="block text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2">
                {locale === 'es' ? 'Tu nombre' : 'Your name'}
            </label>
            {editingName ? (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={userName}
                        onChange={e => setUserName(e.target.value)}
                        maxLength={100}
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={() => setEditingName(false)}
                        className="px-3 py-2 text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded-lg transition-colors"
                    >
                        {locale === 'es' ? 'Listo' : 'Done'}
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-700/50 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors text-left group"
                >
                    <span className="text-stone-800 dark:text-stone-200 font-medium truncate">
                        {userName || (locale === 'es' ? 'Sin nombre' : 'No name')}
                    </span>
                    <svg className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>
            )}
        </div>
    );

    // Case 1: Country detected — show confirm/change
    if (settings.country && !showSelector) {
        const country = getCountryByCode(settings.country);
        if (!country) return null;

        return (
            <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-stone-800 rounded-2xl shadow-2xl max-w-sm w-full p-8 border border-stone-200 dark:border-stone-700">
                    <div className="text-center mb-6">
                        <span className="text-5xl block mb-4">{country.flag}</span>
                        <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100 tracking-tight">
                            {locale === 'es' ? '¡Bienvenido!' : 'Welcome!'}
                        </h2>
                        <p className="text-stone-500 dark:text-stone-500 text-sm mt-2">
                            {locale === 'es'
                                ? 'Confirmá tu información para empezar.'
                                : 'Confirm your info to get started.'
                            }
                        </p>
                    </div>

                    {nameSection}

                    <div className="space-y-3">
                        <button
                            onClick={() => handleSaveCountry(settings.country!)}
                            disabled={saving}
                            className="w-full px-4 py-3 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50"
                        >
                            {saving ? '...' : (locale === 'es'
                                ? `Sí, estoy en ${getName(country)}`
                                : `Yes, I'm in ${getName(country)}`
                            )}
                        </button>
                        <button
                            onClick={() => setShowSelector(true)}
                            className="w-full px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/50 rounded-xl transition-colors"
                        >
                            {locale === 'es' ? 'No, elegir otro país' : 'No, choose a different country'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Case 2: No country detected, OR user clicked "change" from Case 1
    return (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-stone-800 rounded-2xl shadow-2xl max-w-sm w-full p-8 border border-stone-200 dark:border-stone-700">
                <div className="text-center mb-6">
                    <span className="text-5xl block mb-4">🌎</span>
                    <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100 tracking-tight">
                        {locale === 'es' ? '¡Bienvenido!' : 'Welcome!'}
                    </h2>
                    <p className="text-stone-500 dark:text-stone-500 text-sm mt-2">
                        {locale === 'es'
                            ? 'Confirmá tu información para empezar.'
                            : 'Confirm your info to get started.'
                        }
                    </p>
                </div>

                {nameSection}

                <label className="block text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
                    {locale === 'es' ? 'Tu país' : 'Your country'}
                </label>

                {/* Quick-pick buttons */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                    {quickCountries.map(c => (
                        <button
                            key={c.code}
                            onClick={() => handleSaveCountry(c.code)}
                            disabled={saving}
                            className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-200 bg-stone-50 dark:bg-stone-700/50 border border-stone-200 dark:border-stone-600 hover:bg-teal-50 hover:border-teal-300 dark:hover:bg-teal-900/20 dark:hover:border-teal-700 rounded-xl transition-colors disabled:opacity-50"
                        >
                            <span className="text-lg">{c.flag}</span>
                            {getName(c)}
                        </button>
                    ))}
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-stone-200 dark:bg-stone-600" />
                    <span className="text-xs text-stone-500 dark:text-stone-500 uppercase tracking-wider">
                        {locale === 'es' ? 'u otro país' : 'or another country'}
                    </span>
                    <div className="flex-1 h-px bg-stone-200 dark:bg-stone-600" />
                </div>

                {/* Full country selector dropdown */}
                <CountrySelector
                    value={selectedCountry}
                    onChange={setSelectedCountry}
                />

                {selectedCountry && (
                    <button
                        onClick={() => handleSaveCountry(selectedCountry)}
                        disabled={saving}
                        className="w-full mt-4 px-4 py-3 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50"
                    >
                        {saving ? '...' : (locale === 'es' ? 'Continuar' : 'Continue')}
                    </button>
                )}
            </div>
        </div>
    );
}
