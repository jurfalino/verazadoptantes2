'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getCountryByCode, countries, type Country } from '@/config/countries';
import { getUserSettings, acceptTermsAndCountry, acceptTerms, getUserName, updateUserName } from '@/app/actions/settings';
import { CountrySelector } from '@/components/CountrySelector';
import { useRouter } from 'next/navigation';
import { CURRENT_TERMS_VERSION } from '@/config/constants';

interface CountryConfirmBannerProps {
    userEmail: string | null;
}

export function CountryConfirmBanner({ userEmail: serverEmail }: CountryConfirmBannerProps) {
    const { locale } = useLanguage();
    const router = useRouter();
    const [email, setEmail] = useState<string | null>(serverEmail);
    const [settings, setSettings] = useState<{
        country: string | null;
        countryConfirmed: boolean;
        termsVersion: number | null;
        province: string | null;
        provinceCode: string | null;
        city: string | null;
        timezone: string | null;
    } | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [showSelector, setShowSelector] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState('');
    const [userName, setUserName] = useState('');
    const [editingName, setEditingName] = useState(false);
    const [termsChecked, setTermsChecked] = useState(false);

    // Always resolve the email: prefer server prop, fallback to client-side fetch
    useEffect(() => {
        if (serverEmail) {
            setEmail(serverEmail);
            return;
        }
        // In local dev, auth() throws so serverEmail is always null.
        fetch('/api/auth/session')
            .then(r => r.json())
            .then((s: any) => {
                const fetchedEmail = s?.user?.email;
                if (fetchedEmail) {
                    setEmail(fetchedEmail);
                } else {
                    setLoaded(true);
                }
            })
            .catch(() => { setLoaded(true); });
    }, [serverEmail]);

    // Fetch settings + name from DB when we have an email
    useEffect(() => {
        if (!email) {
            setLoaded(true);
            return;
        }

        const storageKey = `country_confirmed_${email}`;
        setLoaded(false);

        Promise.all([getUserSettings(), getUserName()]).then(([s, name]) => {
            if (s) {
                setSettings(s);
                const termsUpToDate = (s.termsVersion ?? 0) >= CURRENT_TERMS_VERSION;
                // Use !!s.country (not countryConfirmed) — the migration reset
                // country_confirmed = 0 for all existing users, but their country
                // is still set. country presence = went through onboarding before.
                const hasCompletedOnboarding = s.countryConfirmed || !!s.country;
                if (hasCompletedOnboarding && termsUpToDate) {
                    localStorage.setItem(storageKey, '1');
                    setDismissed(true);
                } else {
                    localStorage.removeItem(storageKey);
                }
            } else {
                setSettings({ country: null, countryConfirmed: false, termsVersion: null, province: null, provinceCode: null, city: null, timezone: null });
            }
            if (name) setUserName(name);
            setLoaded(true);
        }).catch(err => {
            console.error('[CountryBanner] getUserSettings error:', err);
            setSettings({ country: null, countryConfirmed: false, termsVersion: null, province: null, provinceCode: null, city: null, timezone: null });
            setLoaded(true);
        });
    }, [email]);

    // Derive display mode.
    // Key insight: the migration reset country_confirmed = 0 for all existing users,
    // so we cannot use countryConfirmed to detect "new vs returning". Instead we use
    // settings.country: if a country is set, the user completed onboarding before.
    const needsTerms = !settings || (settings.termsVersion ?? 0) < CURRENT_TERMS_VERSION;
    const hasSetCountryBefore = !!settings && !!settings.country;
    const isNewUser     = !!settings && !settings.country;        // never been through onboarding
    const isTermsUpdate = hasSetCountryBefore && needsTerms;      // returning user, T&C changed
    const shouldShow = !!email && !dismissed && loaded && !!settings && (isNewUser || isTermsUpdate);

    // Lock body scroll while modal is visible
    useEffect(() => {
        if (shouldShow) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [shouldShow]);

    // --- ALL hooks above this line ---

    if (!shouldShow) return null;

    // ── Shared save handler for new-user onboarding ────────────────────────────
    const handleSaveCountry = async (code: string) => {
        if (!termsChecked) return;
        setSaving(true);
        setSaveError(false);
        try {
            if (userName.trim()) {
                await updateUserName(userName.trim());
            }
            const result = await acceptTermsAndCountry(code, CURRENT_TERMS_VERSION);
            if (!result.success) throw new Error('Save failed');
        } catch (err) {
            console.error('[CountryBanner] save error:', err);
            setSaving(false);
            setSaveError(true);
            return; // do NOT dismiss — user must retry
        }
        localStorage.setItem(`country_confirmed_${email}`, '1');
        setDismissed(true);
        setSaving(false);
        router.refresh();
    };

    // ── Save handler for returning users re-accepting updated terms ────────────
    const handleAcceptTermsUpdate = async () => {
        if (!termsChecked) return;
        setSaving(true);
        setSaveError(false);
        try {
            const result = await acceptTerms(CURRENT_TERMS_VERSION);
            if (!result.success) throw new Error('Save failed');
        } catch (err) {
            console.error('[CountryBanner] acceptTerms error:', err);
            setSaving(false);
            setSaveError(true);
            return;
        }
        localStorage.setItem(`country_confirmed_${email}`, '1');
        setDismissed(true);
        setSaving(false);
        router.refresh();
    };

    const quickCountries = countries.filter(c => ['AR', 'UY', 'CL', 'MX'].includes(c.code));
    const getName = (c: Country) => locale === 'es' ? c.nameEs : c.name;

    // Name editor section (shared between onboarding variants)
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

    // Terms checkbox (shared across all variants)
    const termsCheckbox = (
        <label className="flex items-start gap-3 cursor-pointer">
            <input
                type="checkbox"
                checked={termsChecked}
                onChange={e => setTermsChecked(e.target.checked)}
                aria-required="true"
                className="mt-0.5 w-4 h-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500 focus:ring-offset-0 cursor-pointer flex-shrink-0"
            />
            <span className="text-sm text-stone-600 dark:text-stone-300 leading-snug">
                {locale === 'es' ? 'Acepto los' : 'I accept the'}{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer"
                   className="text-teal-700 underline underline-offset-2 hover:text-teal-800"
                   onClick={e => e.stopPropagation()}>
                    {locale === 'es' ? 'Términos de Uso' : 'Terms of Use'}
                </a>{' '}
                {locale === 'es' ? 'y la' : 'and the'}{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer"
                   className="text-teal-700 underline underline-offset-2 hover:text-teal-800"
                   onClick={e => e.stopPropagation()}>
                    {locale === 'es' ? 'Política de Privacidad' : 'Privacy Policy'}
                </a>.
            </span>
        </label>
    );

    // Error + retry message
    const errorMessage = saveError && (
        <p className="text-xs text-red-600 dark:text-red-400 text-center mt-2">
            {locale === 'es'
                ? 'Hubo un error al guardar. Por favor intentá de nuevo.'
                : 'Something went wrong. Please try again.'}
        </p>
    );

    // Spinner for saving state
    const spinner = (
        <svg className="animate-spin w-4 h-4 inline mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
    );

    // ── CASE 0: Returning user — T&C updated ──────────────────────────────────
    if (isTermsUpdate) {
        return (
            <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-stone-800 rounded-2xl shadow-2xl max-w-sm w-full p-8 border border-stone-200 dark:border-stone-700">
                    <div className="text-center mb-6">
                        <span className="text-5xl block mb-4">📋</span>
                        <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100 tracking-tight">
                            {locale === 'es' ? 'Actualizamos nuestros Términos' : "We've updated our Terms"}
                        </h2>
                        <p className="text-stone-500 dark:text-stone-400 text-sm mt-2 leading-relaxed">
                            {locale === 'es'
                                ? 'Revisamos los Términos de Uso y la Política de Privacidad. Por favor léelos y aceptalos para continuar.'
                                : "We've revised our Terms of Use and Privacy Policy. Please review and accept them to continue."
                            }
                        </p>
                    </div>

                    <div className="mb-6">
                        {termsCheckbox}
                    </div>

                    <button
                        onClick={handleAcceptTermsUpdate}
                        disabled={saving || !termsChecked}
                        className="w-full px-4 py-3 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving ? <>{spinner}{locale === 'es' ? 'Guardando...' : 'Saving...'}</> : (
                            locale === 'es' ? 'Aceptar y continuar' : 'Accept and continue'
                        )}
                    </button>
                    {errorMessage}
                </div>
            </div>
        );
    }

    // ── CASE 1: New user — country auto-detected, confirm or change ───────────
    if (settings.country && !showSelector) {
        const country = getCountryByCode(settings.country);
        if (!country) return null;

        return (
            <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-stone-800 rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-8 border border-stone-200 dark:border-stone-700">
                    <div className="text-center mb-6">
                        <span className="text-5xl block mb-4">{country.flag}</span>
                        <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100 tracking-tight">
                            {locale === 'es' ? '¡Bienvenido!' : 'Welcome!'}
                        </h2>
                        <p className="text-stone-500 dark:text-stone-400 text-sm mt-2">
                            {locale === 'es'
                                ? 'Confirmá tu información para empezar.'
                                : 'Confirm your info to get started.'
                            }
                        </p>
                    </div>

                    {nameSection}

                    {/* T&C — before country confirm buttons */}
                    <div className="mb-5 pb-5 border-b border-stone-200 dark:border-stone-600">
                        {termsCheckbox}
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => handleSaveCountry(settings.country!)}
                            disabled={saving || !termsChecked}
                            className="w-full px-4 py-3 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {saving
                                ? <>{spinner}{locale === 'es' ? 'Guardando...' : 'Saving...'}</>
                                : (locale === 'es'
                                    ? `Sí, estoy en ${getName(country)}`
                                    : `Yes, I'm in ${getName(country)}`
                                )
                            }
                        </button>
                        <button
                            onClick={() => setShowSelector(true)}
                            className="w-full px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700/50 rounded-xl transition-colors"
                        >
                            {locale === 'es' ? 'No, elegir otro país' : 'No, choose a different country'}
                        </button>
                    </div>
                    {errorMessage}
                </div>
            </div>
        );
    }

    // ── CASE 2: New user — no country detected, or clicked "change" ───────────
    return (
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-stone-800 rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-8 border border-stone-200 dark:border-stone-700">
                <div className="text-center mb-6">
                    <span className="text-5xl block mb-4">🌎</span>
                    <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100 tracking-tight">
                        {locale === 'es' ? '¡Bienvenido!' : 'Welcome!'}
                    </h2>
                    <p className="text-stone-500 dark:text-stone-400 text-sm mt-2">
                        {locale === 'es'
                            ? 'Completá tu información para empezar.'
                            : 'Complete your info to get started.'
                        }
                    </p>
                </div>

                {nameSection}

                {/* T&C — BEFORE country picker so user accepts before selecting */}
                <div className="mb-5 pb-5 border-b border-stone-200 dark:border-stone-600">
                    {termsCheckbox}
                </div>

                <label className="block text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
                    {locale === 'es' ? 'Tu país' : 'Your country'}
                </label>

                {/* Quick-pick buttons — disabled until T&C accepted */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                    {quickCountries.map(c => (
                        <button
                            key={c.code}
                            onClick={() => handleSaveCountry(c.code)}
                            disabled={saving || !termsChecked}
                            className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-200 bg-stone-50 dark:bg-stone-700/50 border border-stone-200 dark:border-stone-600 hover:bg-teal-50 hover:border-teal-300 dark:hover:bg-teal-900/20 dark:hover:border-teal-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

                {/* Full country selector */}
                <CountrySelector
                    value={selectedCountry}
                    onChange={setSelectedCountry}
                />

                {selectedCountry && (
                    <button
                        onClick={() => handleSaveCountry(selectedCountry)}
                        disabled={saving || !termsChecked}
                        className="w-full mt-4 px-4 py-3 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving
                            ? <>{spinner}{locale === 'es' ? 'Guardando...' : 'Saving...'}</>
                            : (locale === 'es' ? 'Continuar' : 'Continue')
                        }
                    </button>
                )}
                {errorMessage}
            </div>
        </div>
    );
}
