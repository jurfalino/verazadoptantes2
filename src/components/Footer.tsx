'use client';

import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import packageJson from '../../package.json';

/**
 * Site footer rendered globally inside the root layout. Hides itself on
 * pages that should not show the public-facing footer:
 *   - /admin/* and /keystatic/*  (internal tooling)
 *   - /health                    (status dashboard with its own footer)
 *   - /contract/* and /contract-results/*  (PetShield contract surfaces; the
 *     standalone contract-app on its own subdomain doesn't share this layout,
 *     but the in-app routes mirror that experience and stay footer-less.)
 *
 * Everything else on buenadoptante.org (homepage, adopter profile, my-*,
 * organizations, settings, guia, funcionalidades, privacy, terms, invite,
 * form-results, etc.) gets the footer so privacy/terms/contact links and the
 * version string are reachable from every page.
 */
const HIDDEN_PREFIXES = ['/admin', '/keystatic', '/health', '/contract', '/contract-results'];

export default function Footer() {
    const pathname = usePathname();
    const { t, locale } = useLanguage();

    if (pathname && HIDDEN_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
        return null;
    }

    return (
        <footer className="mt-10 mb-6 px-4 text-center text-stone-500 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
                <a href={locale === 'en' ? '/guide' : '/guia'} className="text-stone-500 hover:text-stone-600 underline underline-offset-2 transition-colors">
                    {t('home.hero_guide')}
                </a>
                <span className="text-stone-300">·</span>
                <a href="/funcionalidades" className="text-stone-500 hover:text-stone-600 underline underline-offset-2 transition-colors">
                    {t('home.hero_features')}
                </a>
                <span className="text-stone-300">·</span>
                <a href="/privacy" className="text-stone-500 hover:text-stone-600 underline underline-offset-2 transition-colors">
                    {t('legal.privacy')}
                </a>
                <span className="text-stone-300">·</span>
                <a href="/terms" className="text-stone-500 hover:text-stone-600 underline underline-offset-2 transition-colors">
                    {t('legal.terms')}
                </a>
                <span className="text-stone-300">·</span>
                <a href="mailto:privacidad@buenadoptante.com" className="text-stone-500 hover:text-stone-600 underline underline-offset-2 transition-colors">
                    {t('legal.contact')}
                </a>
            </div>
            <p>{t('home.footer')}</p>
            <p className="text-stone-500 text-xs">v{packageJson.version}</p>
        </footer>
    );
}
