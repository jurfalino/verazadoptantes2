'use client';

import SearchSection from '@/components/SearchSection';
import QuickAccessStrip from '@/components/QuickAccessStrip';
import { useLanguage } from '@/context/LanguageContext';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import HomepageActionCard from '@/components/HomepageActionCard';
import ContactPickerLauncher from '@/components/ContactPickerLauncher';
import GoogleContactsPickerLauncher from '@/components/GoogleContactsPickerLauncher';
import { useEffect } from 'react';
import InstallCTA from '@/components/InstallCTA';
import SocialProofBanner from '@/components/SocialProofBanner';
import MilestoneBadge from '@/components/MilestoneBadge';
import ReferralBanner from '@/components/ReferralBanner';
import { useShowToast } from '@/components/ui/Toast';

/**
 * Client-side homepage logic. The outer `src/app/page.tsx` is now a server
 * component that fetches the public config server-side and passes it in as
 * `initialConfig` — so by the time HTML reaches the browser, the
 * flag-gated UI (Import card, MilestoneBadge, SocialProofBanner) is already
 * in its final shape. Previously this component owned a useEffect that
 * fetched `/api/config` after hydration, which delayed LCP by ~2s on
 * cold-start workers + slow networks (v2.14.9-13 fix).
 *
 * The remaining client work here is: auth-redirect handling (callbackUrl
 * URL param), wizard-card navigation, and toast notifications — all of
 * which legitimately need to run client-side.
 */
export default function HomeClient({ initialConfig }: { initialConfig: Record<string, string> }) {
    const { t, locale } = useLanguage();
    const router = useRouter();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    // Config is fully populated on first render — no more `useState({})` +
    // `useEffect(fetch)` pattern. Derived flags read directly off the prop.
    const appConfig = initialConfig;
    const contentImportEnabled = appConfig.ENABLE_CONTENT_IMPORT === 'true';
    const contactImportEnabled = appConfig.ENABLE_CONTACT_IMPORT === 'true';
    const googleContactsImportEnabled = appConfig.ENABLE_GOOGLE_CONTACTS_IMPORT === 'true';
    // True when ANY import path is on — drives whether the parent "Importar
    // perfil" card renders at all and whether the 3-card grid stays 3-col.
    const anyImportEnabled = contentImportEnabled || contactImportEnabled || googleContactsImportEnabled;

    // Auto-open LoginModal when redirected (session expired or auth required)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const callbackUrl = params.get('callbackUrl');
        const authRequired = params.get('authRequired');
        if (callbackUrl && !session?.user) {
            try {
                const url = new URL(callbackUrl, window.location.origin);
                const fullPath = url.pathname === '/' && url.search === ''
                    ? '/'
                    : url.pathname + url.search;
                openLogin(fullPath);
            } catch {
                openLogin(callbackUrl);
            }
            if (authRequired) {
                toast.info(
                    t('auth.auth_required_title'),
                    t('auth.auth_required_desc')
                );
            } else {
                toast.info(
                    t('auth.session_expired_title'),
                    t('auth.session_expired_desc')
                );
            }
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('callbackUrl');
            cleanUrl.searchParams.delete('error');
            cleanUrl.searchParams.delete('authRequired');
            window.history.replaceState({}, '', cleanUrl.toString());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAuthNavigation = (url: string) => {
        if (!session?.user) {
            openLogin(url);
            return;
        }
        try {
            router.push(url);
            setTimeout(() => {
                if (window.location.pathname === '/') {
                    window.location.href = url;
                }
            }, 500);
        } catch (e) {
            window.location.href = url;
        }
    };

    return (
        <main className="min-h-screen bg-stone-50 py-6 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-6">
                <h1 className="sr-only">{t('home.h1')}</h1>
                <div id="search-section">
                    <SearchSection locale={locale} showCardMetadata={appConfig.ENABLE_SEARCH_CARD_METADATA !== 'false'} />
                </div>

                {/* Social proof + milestone — below search for mobile-first.
                    MilestoneBadge gated by ENABLE_MILESTONE_BADGE (admin-toggleable, default ON). */}
                <SocialProofBanner config={appConfig} />
                {session?.user && appConfig.ENABLE_MILESTONE_BADGE !== 'false' && <MilestoneBadge />}

                {/* Action cards. Two modes:
                    – Default: 3-card peer-equal grid (or 2-col when no import path
                      is enabled). Order: Adoption · Report · Import-perfil.
                      The Import card hosts two sub-buttons ("Desde un post" +
                      "Desde contactos") so the 3-col grid stays intact and the
                      two import modalities sit under one mental model.
                    – ENABLE_CLEAN_HOMEPAGE: the two activity cards are hidden;
                      the surviving import affordance demotes to paired link-pills
                      below the search so search remains visually primary
                      (v2.16.0-16, two-pill variant in v2.16.0-33). */}
                {appConfig.ENABLE_CLEAN_HOMEPAGE === 'true' ? (
                    anyImportEnabled && (
                        <div id="action-cards" className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                            {contentImportEnabled && (
                                <button
                                    type="button"
                                    data-testid="import-content-btn"
                                    onClick={() => handleAuthNavigation('/import')}
                                    className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-teal-800 hover:underline underline-offset-4 decoration-teal-400 transition-colors px-3 py-1.5 rounded-full"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    <span>{t('home.action_import_post_secondary') || t('home.action_import_secondary') || t('home.action_import_title')}</span>
                                    <span aria-hidden="true">→</span>
                                </button>
                            )}
                            {/* Divider — render between any two adjacent enabled pills. */}
                            {contentImportEnabled && (contactImportEnabled || googleContactsImportEnabled) && (
                                <span aria-hidden="true" className="text-stone-300 hidden sm:inline">·</span>
                            )}
                            {contactImportEnabled && (
                                <ContactPickerLauncher
                                    testId="import-contacts-btn"
                                    onPicked={() => handleAuthNavigation('/import?contact_import=1')}
                                    className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-teal-800 hover:underline underline-offset-4 decoration-teal-400 transition-colors px-3 py-1.5 rounded-full"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    <span>{t('home.action_import_contacts_secondary')}</span>
                                    <span aria-hidden="true">→</span>
                                </ContactPickerLauncher>
                            )}
                            {contactImportEnabled && googleContactsImportEnabled && (
                                <span aria-hidden="true" className="text-stone-300 hidden sm:inline">·</span>
                            )}
                            {googleContactsImportEnabled && (
                                <GoogleContactsPickerLauncher
                                    testId="import-google-contacts-btn"
                                    onPicked={() => handleAuthNavigation('/import?contact_import=1')}
                                    className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-teal-800 hover:underline underline-offset-4 decoration-teal-400 transition-colors px-3 py-1.5 rounded-full"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9 4a3 3 0 100 6 3 3 0 000-6zm-4.5 9.5h9a4.5 4.5 0 00-9 0z" />
                                    </svg>
                                    <span>{t('home.action_import_google_contacts_secondary')}</span>
                                    <span aria-hidden="true">→</span>
                                </GoogleContactsPickerLauncher>
                            )}
                        </div>
                    )
                ) : (
                    <div id="action-cards" className={`grid gap-6 mt-6 ${anyImportEnabled ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                        {/* Register Adoption — typed entry-point. Picks adopter, then hands off to
                            AdoptionFormWizard via /adopter/<id>?newAdoption=adoption (or
                            /adopter/create?continueToAdoption=true&newAdoption=adoption). */}
                        <HomepageActionCard
                            recordType="adoption"
                            testId="adoption-wizard-btn"
                            palette="teal"
                            titleKey="home.action_register_title"
                            descKey="home.action_register_desc"
                            btnKey="home.action_register_btn"
                            icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />

                        {/* Observation / Note — same entry-point pattern, observation record type. */}
                        <HomepageActionCard
                            recordType="observation"
                            testId="report-wizard-btn"
                            palette="rose"
                            titleKey="home.action_report_title"
                            descKey="home.action_report_desc"
                            btnKey="home.action_report_btn"
                            icon="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />

                        {/* Import-perfil — last position; one parent card hosts
                            up to two source buttons ("Desde un post" + "Desde
                            contactos"). Card renders if EITHER source is on. */}
                        {anyImportEnabled && (
                            <div
                                data-testid="import-card"
                                className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-teal-200 transition-all text-center h-full flex flex-col items-center justify-center"
                            >
                                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4 text-teal-700">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-semibold text-stone-900 mb-1">{t('home.action_import_title')}</h2>
                                <p className="text-stone-500 text-sm mb-3">{t('home.action_import_desc')}</p>
                                <div className="flex flex-col gap-2 w-full max-w-[220px]">
                                    {contentImportEnabled && (
                                        <button
                                            type="button"
                                            data-testid="import-content-btn"
                                            onClick={() => handleAuthNavigation('/import')}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-200 text-teal-900 font-semibold rounded-xl hover:bg-teal-300 transition-colors shadow-sm text-sm"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                            </svg>
                                            <span>{t('home.action_import_post_btn')}</span>
                                        </button>
                                    )}
                                    {contactImportEnabled && (
                                        <ContactPickerLauncher
                                            testId="import-contacts-btn"
                                            onPicked={() => handleAuthNavigation('/import?contact_import=1')}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-50 text-teal-800 font-semibold rounded-xl hover:bg-teal-100 transition-colors border border-teal-200 text-sm"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            <span>{t('home.action_import_contacts_btn')}</span>
                                        </ContactPickerLauncher>
                                    )}
                                    {googleContactsImportEnabled && (
                                        <GoogleContactsPickerLauncher
                                            testId="import-google-contacts-btn"
                                            onPicked={() => handleAuthNavigation('/import?contact_import=1')}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-50 text-teal-800 font-semibold rounded-xl hover:bg-teal-100 transition-colors border border-teal-200 text-sm"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm9 4a3 3 0 100 6 3 3 0 000-6zm-4.5 9.5h9a4.5 4.5 0 00-9 0z" />
                                            </svg>
                                            <span>{t('home.action_import_google_contacts_btn')}</span>
                                        </GoogleContactsPickerLauncher>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Quick Access Dashboard Strip — moved below cards (v2.14.8-5).
                    Cards = create intent (primary); pills = navigate-to-existing-data
                    (secondary). Gated by ENABLE_QUICK_ACCESS_STRIP (default ON, admin
                    toggle); when OFF, the same counters are still surfaced inside
                    UserMenu so the data path doesn't disappear. */}
                {appConfig.ENABLE_QUICK_ACCESS_STRIP !== 'false' && <QuickAccessStrip />}

                {/* PWA Install CTA — shown to users who dismissed the floating banner */}
                <InstallCTA />

                {/* Referral banner — logged-in users only */}
                <ReferralBanner />
            </div>
        </main>
    );
}
