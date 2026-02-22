'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { getCountryByCode, countries } from '@/config/countries';
import { getUserSettings, updateUserCountry } from '@/app/actions/settings';
import { useRouter } from 'next/navigation';

export function CountryConfirmBanner() {
    const { data: session } = useSession();
    const { locale, t } = useLanguage();
    const router = useRouter();
    const [settings, setSettings] = useState<{ country: string | null; countryConfirmed: boolean } | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!session?.user) return;

        // Check localStorage first to avoid repeated DB calls
        const stored = localStorage.getItem('country_confirmed');
        if (stored === '1') {
            setDismissed(true);
            setLoaded(true);
            return;
        }

        getUserSettings().then(s => {
            if (s) setSettings(s);
            setLoaded(true);
        });
    }, [session]);

    // Don't show if: not logged in, already confirmed, dismissed, or still loading
    if (!session?.user || dismissed || !loaded || !settings || settings.countryConfirmed) {
        return null;
    }

    // Case 1: Country detected — show confirm/change banner
    if (settings.country) {
        const country = getCountryByCode(settings.country);
        if (!country) return null;

        const countryName = locale === 'es' ? country.nameEs : country.name;

        const handleConfirm = async () => {
            setSaving(true);
            const result = await updateUserCountry(settings.country!);
            if (result.success) {
                localStorage.setItem('country_confirmed', '1');
                setDismissed(true);
            }
            setSaving(false);
        };

        const handleChange = () => {
            router.push('/settings');
            setDismissed(true);
        };

        return (
            <div className="bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800">
                <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
                    <span className="text-sm text-teal-800 dark:text-teal-200 flex items-center gap-2">
                        <span className="text-lg">{country.flag}</span>
                        {locale === 'es'
                            ? `Detectamos que estás en ${countryName}. ¿Es correcto?`
                            : `We detected you're in ${countryName}. Is this correct?`
                        }
                    </span>
                    <div className="flex gap-2 flex-shrink-0">
                        <button
                            onClick={handleConfirm}
                            disabled={saving}
                            className="px-4 py-1.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {saving ? '...' : (locale === 'es' ? 'Sí, confirmar' : 'Yes, confirm')}
                        </button>
                        <button
                            onClick={handleChange}
                            className="px-4 py-1.5 text-sm font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-800/30 rounded-lg transition-colors"
                        >
                            {locale === 'es' ? 'Cambiar país' : 'Change country'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Case 2: No country detected — prompt user to select one
    const handleSelectCountry = async (code: string) => {
        setSaving(true);
        const result = await updateUserCountry(code);
        if (result.success) {
            localStorage.setItem('country_confirmed', '1');
            setDismissed(true);
        }
        setSaving(false);
    };

    const handleGoToSettings = () => {
        router.push('/settings');
        setDismissed(true);
    };

    // Show top 4 most common countries as quick-pick buttons, plus "Other"
    const quickCountries = countries.filter(c =>
        ['AR', 'UY', 'CL', 'MX'].includes(c.code)
    );

    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
                <span className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <span className="text-lg">🌎</span>
                    {locale === 'es'
                        ? '¿De qué país sos?'
                        : 'What country are you from?'
                    }
                </span>
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                    {quickCountries.map(c => (
                        <button
                            key={c.code}
                            onClick={() => handleSelectCountry(c.code)}
                            disabled={saving}
                            className="px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200 bg-white dark:bg-amber-800/30 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-800/50 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {c.flag} {locale === 'es' ? c.nameEs : c.name}
                        </button>
                    ))}
                    <button
                        onClick={handleGoToSettings}
                        className="px-3 py-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30 rounded-lg transition-colors underline underline-offset-2"
                    >
                        {locale === 'es' ? 'Otro país' : 'Other'}
                    </button>
                </div>
            </div>
        </div>
    );
}
