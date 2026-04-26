'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { CountrySelector } from '@/components/CountrySelector';
import { getUserSettings, updateUserCountry, updateUserName } from '@/app/actions/settings';
import { useShowToast } from '@/components/ui/Toast';

export default function SettingsPage() {
    const { data: session, status } = useSession();
    const { t } = useLanguage();
    const toast = useShowToast();

    const [country, setCountry] = useState('');
    const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
    const [savingCountry, setSavingCountry] = useState(false);
    const [loading, setLoading] = useState(true);

    // Name state
    const [displayName, setDisplayName] = useState('');
    const [originalName, setOriginalName] = useState('');
    const [savingName, setSavingName] = useState(false);



    // Geo info (read-only, auto-detected)
    const [geoInfo, setGeoInfo] = useState<{ province: string | null; city: string | null; timezone: string | null }>({ province: null, city: null, timezone: null });

    // Load settings + name
    useEffect(() => {
        if (status !== 'authenticated') return;
        getUserSettings().then(s => {
            if (s) {
                setCountry(s.country || '');
                setDetectedCountry(s.country);
                setGeoInfo({ province: s.province, city: s.city, timezone: s.timezone });
                if (s.name) {
                    setDisplayName(s.name);
                    setOriginalName(s.name);
                }
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

    const handleSaveName = async () => {
        const trimmed = displayName.trim();
        if (!trimmed || trimmed === originalName) return;
        setSavingName(true);
        const result = await updateUserName(trimmed);
        if (result.success) {
            setOriginalName(trimmed);
            toast.success(t('settings.saved') || 'Saved!');
        } else {
            toast.error('Error');
        }
        setSavingName(false);
    };

    const nameHasChanged = displayName.trim() !== originalName && displayName.trim().length > 0;

    if (status === 'loading' || loading) {
        return (
            <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 bg-stone-200 dark:bg-stone-700 rounded w-1/3"></div>
                    <div className="h-32 bg-stone-200 dark:bg-stone-700 rounded-xl"></div>
                    <div className="h-32 bg-stone-200 dark:bg-stone-700 rounded-xl"></div>
                </div>
            </main>
        );
    }



    return (
        <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mb-8">
                {t('settings.title') || 'Settings'}
            </h1>

            <div className="space-y-8">
                {/* Name Section */}
                <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
                    <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-1">
                        👤 {t('settings.display_name') || 'Display Name'}
                    </h2>
                    <p className="text-sm text-stone-500 dark:text-stone-500 mb-4">
                        {t('settings.display_name_description') || 'This is the name others see when you add records.'}
                    </p>
                    <input
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        maxLength={100}
                        placeholder={t('settings.name_placeholder') || 'Your name'}
                        className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 dark:border-stone-600 bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                    />
                    <button
                        onClick={handleSaveName}
                        disabled={savingName || !nameHasChanged}
                        className="mt-4 px-6 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingName ? '...' : (t('settings.save') || 'Save')}
                    </button>
                </section>

                {/* Country Section */}
                <section className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
                    <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-1">
                        🌍 {t('settings.country') || 'Country'}
                    </h2>
                    <p className="text-sm text-stone-500 dark:text-stone-500 mb-4">
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
                        className="mt-4 px-6 py-2.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {savingCountry ? '...' : (t('settings.save') || 'Save')}
                    </button>

                    {/* Auto-detected geo info */}
                    {(geoInfo.province || geoInfo.city || geoInfo.timezone) && (
                        <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-700">
                            <h3 className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-3">
                                📍 {t('settings.detected_location') || 'Detected location'}
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {geoInfo.province && (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-700/50">
                                        <span className="text-stone-400 text-xs">🏛️</span>
                                        <div>
                                            <div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 uppercase">{t('settings.province') || 'Province'}</div>
                                            <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{geoInfo.province}</div>
                                        </div>
                                    </div>
                                )}
                                {geoInfo.city && (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-700/50">
                                        <span className="text-stone-400 text-xs">🏙️</span>
                                        <div>
                                            <div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 uppercase">{t('settings.city') || 'City'}</div>
                                            <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{geoInfo.city}</div>
                                        </div>
                                    </div>
                                )}
                                {geoInfo.timezone && (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-700/50">
                                        <span className="text-stone-400 text-xs">🕐</span>
                                        <div>
                                            <div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 uppercase">{t('settings.timezone') || 'Timezone'}</div>
                                            <div className="text-sm font-medium text-stone-700 dark:text-stone-200">{geoInfo.timezone}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
