'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getCountryByCode, countries, type Country } from '@/config/countries';
import { getUserSettings, updateUserCountry } from '@/app/actions/settings';
import { CountrySelector } from '@/components/CountrySelector';
import { useRouter } from 'next/navigation';

interface CountryConfirmBannerProps {
    userEmail: string | null;
}

export function CountryConfirmBanner({ userEmail: serverEmail }: CountryConfirmBannerProps) {
    const { locale, t } = useLanguage();
    const router = useRouter();
    const [email, setEmail] = useState<string | null>(serverEmail);
    const [settings, setSettings] = useState<{ country: string | null; countryConfirmed: boolean } | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [showSelector, setShowSelector] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState('');

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

    // Fetch country settings when we have an email
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

        // Fetch settings from DB
        setLoaded(false);
        getUserSettings().then(s => {
            if (s) {
                setSettings(s);
                if (s.countryConfirmed) {
                    localStorage.setItem(storageKey, '1');
                }
            } else {
                setSettings({ country: null, countryConfirmed: false });
            }
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
            await updateUserCountry(code);
        } catch (err) {
            console.error('[CountryBanner] updateUserCountry error:', err);
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
                            {locale === 'es' ? 'Confirmá tu país' : 'Confirm your country'}
                        </h2>
                        <p className="text-stone-500 dark:text-stone-500 text-sm mt-2">
                            {locale === 'es'
                                ? `Detectamos que estás en ${getName(country)}. ¿Es correcto?`
                                : `We detected you're in ${getName(country)}. Is this correct?`
                            }
                        </p>
                        <p className="text-stone-500 dark:text-stone-500 text-xs mt-1.5">
                            {locale === 'es'
                                ? 'Tu país determina qué registros ves en las búsquedas.'
                                : 'Your country determines which records you see in searches.'
                            }
                        </p>
                    </div>

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
                        {locale === 'es' ? 'Seleccioná tu país' : 'Select your country'}
                    </h2>
                    <p className="text-stone-500 dark:text-stone-500 text-sm mt-2">
                        {locale === 'es'
                            ? 'Tu país determina qué registros de adoptantes ves en las búsquedas.'
                            : 'Your country determines which adopter records you see in searches.'
                        }
                    </p>
                </div>

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
