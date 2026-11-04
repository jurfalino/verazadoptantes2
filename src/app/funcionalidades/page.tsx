'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext } from '@/context/AuthContext';
import { posthogTrack } from '@/lib/zaraz';
import { buttonClasses } from '@/components/ui/Button';

/**
 * Public "Funcionalidades" page: the product's main features, each shown
 * with a real phone-width screenshot. The adoption *process* lives in /guia;
 * this page is about what the tool does.
 *
 * Its main audience is a colleague a rescuer invited from the homepage's
 * WhatsApp referral banner (ReferralBanner shares this URL): anonymous, on a
 * phone, deciding in seconds. Trust comes straight after the hero, and each
 * feature has an "Abrir" link for everyone: search works without an account
 * (name searches only), the rest open sign-in and land on that feature.
 *
 * Screenshots come from `scripts/capture-feature-screenshots.mjs` (fictional
 * showcase data on a local DB) — re-run it when the UI changes instead of
 * hand-editing images. Copy lives in the `features.*` i18n namespace.
 *
 * Only theme-remapped classes are used (see globals.css), so the page reads
 * in both themes; the only motion is the hero phone's entrance.
 */

const SHOT_W = 780;  // 390px viewport @2x
const SHOT_H = 1688;

type Shot = { src: string; altKey: string };

type Feature = {
    key: string;
    icon: string;
    bullets: number;
    /** Two shots overlap: the first sits behind, the second in front. */
    shots: [Shot] | [Shot, Shot];
    /** Where the feature lives in the app. */
    href?: string;
    /** Usable without an account (search by name); otherwise "Abrir" signs in first. */
    open?: boolean;
};

const shot = (name: string, altKey: string): Shot => ({ src: `/images/features/shots/${name}.png`, altKey });

const FEATURES: Feature[] = [
    { key: 'search',    bullets: 3, href: '/', open: true, shots: [shot('profile', 'features.feat_search_profile_alt')],
      icon: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z' },
    { key: 'privacy',   bullets: 3, shots: [shot('privacy', 'features.feat_privacy_alt')],
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    { key: 'forms',     bullets: 3, href: '/my-animals', shots: [shot('contract', 'features.feat_forms_alt2'), shot('form-results', 'features.feat_forms_alt')],
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
    { key: 'custom',    bullets: 3, href: '/settings/adoption-docs', shots: [shot('custom-docs', 'features.feat_custom_alt')],
      icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
    { key: 'animals',   bullets: 3, href: '/my-animals', shots: [shot('animal-timeline', 'features.feat_animals_alt')],
      icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { key: 'followups', bullets: 3, href: '/notificaciones', shots: [shot('notifications', 'features.feat_followups_alt')],
      icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    { key: 'team',      bullets: 2, href: '/organizations', shots: [shot('team', 'features.feat_team_alt')],
      icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
];

const TRUST = [
    { key: 'free',    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
    { key: 'privacy', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { key: 'who',     icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', href: '/quienes-somos' },
] as const;

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

/**
 * Primary buttons: the button-matrix shape, but `.fx-primary` colours (see the
 * page <style>). The shared primary — white on bg-teal-600, remapped to
 * --btn-primary-bg — measures 3.74:1 in light and 2.49:1 in dark, under the
 * 4.5:1 AA minimum; #0f766e with white is 5.47:1 in both themes.
 */
const PRIMARY = `inline-flex items-center justify-center gap-2 rounded-xl font-bold py-3 px-6 text-sm min-h-[44px] transition-colors fx-primary ${FOCUS}`;

function Icon({ d, className = 'w-5 h-5' }: { d: string; className?: string }) {
    return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
        </svg>
    );
}

const CHECK = 'M5 13l4 4L19 7';
const CROSS = 'M6 18L18 6M6 6l12 12';

/** A screenshot in a plain phone outline, cropped to the top of the screen. */
function Phone({ src, alt, priority = false, className = '' }: { src: string; alt: string; priority?: boolean; className?: string }) {
    return (
        <div className={`rounded-[40px] bg-white border border-stone-200 p-2 shadow-xl ${className}`}>
            <div className="relative aspect-[390/720] rounded-[32px] overflow-hidden bg-stone-100">
                <Image
                    src={src}
                    alt={alt}
                    width={SHOT_W}
                    height={SHOT_H}
                    priority={priority}
                    // /_next/image on Pages re-serves the original uncached; the
                    // shots are already phone-sized, so serve the static file.
                    unoptimized
                    className="absolute inset-0 w-full h-full object-cover object-top"
                />
            </div>
        </div>
    );
}


export default function FuncionalidadesPage() {
    const { t, locale } = useLanguage();
    const { status } = useSession();
    const { openLogin } = useAuthContext();
    const signedIn = status === 'authenticated';
    // Sign-up prompts wait for the session check so signed-in users never
    // see them flash; anonymous visitors see them a beat after paint.
    const anonymous = status === 'unauthenticated';

    return (
        <main className="min-h-screen bg-stone-50">
            <style>{`
                .fx-primary { background-color: #0f766e; color: #fff; }
                .fx-primary:hover { background-color: #115e59; }
                .hero-phone { animation: heroPhoneIn 0.9s cubic-bezier(0.16,1,0.3,1) 0.15s both; }
                @keyframes heroPhoneIn { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: none; } }
                @media (prefers-reduced-motion: reduce) { .hero-phone { animation: none; } }
            `}</style>

            {/* ── Hero ───────────────────────────────────────────── */}
            <header className="max-w-6xl mx-auto px-4 pt-12 pb-16 md:pt-24 md:pb-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
                <div className="max-w-xl">
                    <h1 className="text-[2rem] leading-[1.1] md:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-stone-900">
                        {t('features.hero_title')}
                    </h1>
                    <p className="mt-6 text-base md:text-xl leading-relaxed text-stone-600">
                        {t('features.hero_subtitle')}
                    </p>
                </div>
                <div className="hero-phone mx-auto w-full max-w-[300px]">
                    <Phone src="/images/features/shots/search.png" alt={t('features.feat_search_alt')} priority />
                </div>
            </header>

            {/* ── Trust: answered before the features, not after ─── */}
            <section className="bg-white border-y border-stone-200">
                <ul className="max-w-5xl mx-auto px-4 py-10 md:py-12 grid gap-8 md:grid-cols-3">
                    {TRUST.map((item) => (
                        <li key={item.key} className="flex gap-4">
                            <span className="w-11 h-11 shrink-0 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 flex items-center justify-center">
                                <Icon d={item.icon} />
                            </span>
                            <div>
                                <p className="font-bold text-stone-900">{t(`features.trust_${item.key}_title`)}</p>
                                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                                    {t(`features.trust_${item.key}_desc`)}
                                    {'href' in item && (
                                        <>
                                            {' '}
                                            <Link href={item.href} className={`inline-block py-3 -my-3 font-semibold text-teal-900 underline underline-offset-2 rounded ${FOCUS}`}>
                                                {t('features.trust_who_link')}
                                            </Link>
                                        </>
                                    )}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            {/* ── Before / after ─────────────────────────────────── */}
            <section className="max-w-4xl mx-auto px-4 py-16 md:py-20">
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-stone-900 mb-8">
                    {t('features.pain_title')}
                </h2>
                <ul className="divide-y divide-stone-200 border-y border-stone-200">
                    {[1, 2, 3].map((n) => (
                        <li key={n} className="grid sm:grid-cols-2 gap-4 sm:gap-8 py-6">
                            <div className="flex gap-2">
                                <span className="mt-0.5 shrink-0 text-rose-600"><Icon d={CROSS} className="w-4 h-4" /></span>
                                <div>
                                    <p className="text-xs font-semibold text-stone-500 mb-1">{t('features.before_label')}</p>
                                    <p className="text-stone-600 leading-relaxed">{t(`features.pain${n}_before`)}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <span className="mt-0.5 shrink-0 text-teal-700"><Icon d={CHECK} className="w-4 h-4" /></span>
                                <div>
                                    <p className="text-xs font-semibold text-teal-900 mb-1">{t('features.after_label')}</p>
                                    <p className="font-semibold text-stone-900 leading-relaxed">{t(`features.pain${n}_after`)}</p>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            {/* ── Features ───────────────────────────────────────── */}
            <div className="bg-white border-y border-stone-200">
                <div className="max-w-6xl mx-auto px-4 py-16 md:py-24 space-y-24 md:space-y-32">
                    {FEATURES.map((feat, i) => {
                        const reversed = i % 2 === 1;
                        return (
                            <section key={feat.key} className="grid lg:grid-cols-2 gap-10 lg:gap-20 items-center">
                                <div className={`max-w-lg ${reversed ? 'lg:order-2 lg:justify-self-start' : 'lg:justify-self-end'}`}>
                                    <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 flex items-center justify-center mb-6">
                                        <Icon d={feat.icon} />
                                    </div>
                                    <h2 className="text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-tight leading-tight text-stone-900">
                                        {t(`features.feat_${feat.key}_title`)}
                                    </h2>
                                    <p className="mt-4 text-base md:text-lg leading-relaxed text-stone-600">
                                        {t(`features.feat_${feat.key}_desc`)}
                                    </p>
                                    <ul className="mt-6 space-y-4">
                                        {Array.from({ length: feat.bullets }, (_, b) => (
                                            <li key={b} className="flex gap-2 text-stone-800">
                                                <span className="mt-1 shrink-0 text-teal-700"><Icon d={CHECK} className="w-4 h-4" /></span>
                                                <span className="leading-relaxed">{t(`features.feat_${feat.key}_b${b + 1}`)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {feat.href && status !== 'loading' && (
                                        signedIn || feat.open ? (
                                            <Link
                                                href={feat.href}
                                                data-feature={feat.key}
                                                onClick={() => posthogTrack('features_feature_opened', { feature: feat.key, signed_in: signedIn })}
                                                className={`mt-6 ${buttonClasses({ variant: 'secondary', size: 'compact' })}`}
                                            >
                                                {t('features.open_feature')}
                                            </Link>
                                        ) : (
                                            <button
                                                type="button"
                                                data-feature={feat.key}
                                                onClick={() => {
                                                    posthogTrack('features_feature_opened', { feature: feat.key, signed_in: false });
                                                    openLogin(feat.href);
                                                }}
                                                className={`mt-6 ${buttonClasses({ variant: 'secondary', size: 'compact' })}`}
                                            >
                                                {t('features.open_feature')}
                                            </button>
                                        )
                                    )}
                                </div>

                                <div className={reversed ? 'lg:order-1' : ''}>
                                    {feat.shots.length === 2 ? (
                                        <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[400px] sm:pb-16">
                                            <Phone src={feat.shots[0].src} alt={t(feat.shots[0].altKey)} className="hidden sm:block w-[68%]" />
                                            <Phone src={feat.shots[1].src} alt={t(feat.shots[1].altKey)} className="w-full sm:absolute sm:right-0 sm:top-16 sm:w-[68%]" />
                                        </div>
                                    ) : (
                                        <Phone src={feat.shots[0].src} alt={t(feat.shots[0].altKey)} className="mx-auto w-full max-w-[300px]" />
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>

            {/* ── Closing ────────────────────────────────────────── */}
            <section className="max-w-2xl mx-auto px-4 py-20 md:py-24 text-center">
                {anonymous && (
                    <>
                        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-stone-900">
                            {t('features.final_cta')}
                        </h2>
                        <p className="mt-4 text-stone-600">{t('features.final_sub')}</p>
                        <button
                            type="button"
                            onClick={() => {
                                posthogTrack('features_signup_clicked');
                                openLogin('/');
                            }}
                            className={`mt-8 ${PRIMARY}`}
                        >
                            {t('features.final_button')}
                        </button>
                    </>
                )}
                <p className={`${anonymous ? 'mt-10' : ''} text-sm text-stone-600`}>
                    {t('features.guide_line')}{' '}
                    <Link
                        href={locale === 'en' ? '/guide' : '/guia'}
                        onClick={() => posthogTrack('features_guide_opened')}
                        className={`inline-block py-3 -my-3 font-semibold text-teal-900 underline underline-offset-2 rounded ${FOCUS}`}
                    >
                        {t('features.guide_link')}
                    </Link>
                </p>
            </section>
        </main>
    );
}
