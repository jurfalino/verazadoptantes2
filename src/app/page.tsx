'use client';

import SearchSection from '@/components/SearchSection';
export const runtime = 'edge';
import { useLanguage } from '@/context/LanguageContext';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import AdoptionWizard from '@/components/AdoptionWizard';
import ReportWizard from '@/components/ReportWizard';
import { ShieldPawIcon } from '@/components/Logo';
import packageJson from '../../package.json';
import { useEffect, useState } from 'react';
import InstallCTA from '@/components/InstallCTA';

export default function Home() {
  const { t } = useLanguage();
  const router = useRouter();
  const { data: session } = useSession();
  const { openLogin } = useAuthContext();
  const [contentImportEnabled, setContentImportEnabled] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Check feature flag on client side
  useEffect(() => {
    fetch('/api/admin/config')
      .then(res => res.json())
      .then((data) => {
        const cfg = data as { config?: Record<string, string> };
        if (cfg.config?.ENABLE_CONTENT_IMPORT === 'true') {
          setContentImportEnabled(true);
        }
      })
      .catch((e) => { console.error('[Homepage] Config fetch error:', e); });

    // Show guide for first-time users
    if (!localStorage.getItem('guide_dismissed')) {
      setShowGuide(true);
    }
  }, []);

  const dismissGuide = () => {
    setShowGuide(false);
    localStorage.setItem('guide_dismissed', '1');
  };

  const handleAuthNavigation = (url: string) => {
    // Check if user is logged in or anonymous
    const isAnon = document.cookie.includes('anon_user=true');
    if (!session?.user && !isAnon) {
      openLogin(url);
      return;
    }
    try {
      router.push(url);
      // Fallback if router fails
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
    <main className="min-h-screen bg-stone-50 py-12 px-4 relative">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="text-center mb-12">
          <ShieldPawIcon className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-4xl md:text-5xl font-extrabold text-stone-900 mb-4 tracking-tight">
            {t('home.title')}
          </h1>
          <p className="text-stone-600 text-lg max-w-xl mx-auto font-medium">
            {t('home.tagline')}
          </p>
        </header>

        {/* How it works — collapsible guide for first-time users */}
        {showGuide && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 relative">
            <button
              onClick={dismissGuide}
              className="absolute top-3 right-3 text-stone-400 hover:text-stone-600 transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ✕
            </button>
            <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-4 text-center">
              {t('home.how_title')}
            </h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl mb-1">🔍</div>
                <p className="font-bold text-stone-800 text-sm">{t('home.how_step1_title')}</p>
                <p className="text-stone-500 text-xs mt-0.5">{t('home.how_step1_desc')}</p>
              </div>
              <div>
                <div className="text-2xl mb-1">📤</div>
                <p className="font-bold text-stone-800 text-sm">{t('home.how_step2_title')}</p>
                <p className="text-stone-500 text-xs mt-0.5">{t('home.how_step2_desc')}</p>
              </div>
              <div>
                <div className="text-2xl mb-1">⭐</div>
                <p className="font-bold text-stone-800 text-sm">{t('home.how_step3_title')}</p>
                <p className="text-stone-500 text-xs mt-0.5">{t('home.how_step3_desc')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Facebook Import removed — unified Import Wizard handles all imports */}

        <SearchSection />

        {/* Action Cards — 3-column grid */}
        <div className={`grid gap-6 mt-12 ${contentImportEnabled ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          {/* Import from post — promoted to full card */}
          {contentImportEnabled && (
            <div
              data-testid="import-content-btn"
              className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-teal-200 transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer"
              onClick={() => handleAuthNavigation('/import')}
            >
              <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4 text-teal-700 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-stone-900 mb-1">{t('home.action_import_title')}</h3>
              <p className="text-stone-500 text-sm">{t('home.action_import_desc')}</p>
            </div>
          )}

          {/* Register Adoption */}
          <AdoptionWizard />

          {/* Report / Observation */}
          <ReportWizard />
        </div>
        {/* PWA Install CTA — shown to users who dismissed the floating banner */}
        <InstallCTA />

        <footer className="mt-10 text-center text-stone-400 text-sm space-y-2">
          {/* How it works toggle — for returning users who dismissed the guide */}
          {!showGuide && (
            <button
              onClick={() => setShowGuide(true)}
              className="text-stone-400 hover:text-stone-600 text-xs underline underline-offset-2 transition-colors"
            >
              {t('home.how_title')}
            </button>
          )}
          <div className="flex items-center justify-center gap-3 text-xs">
            <a href="/privacy" className="text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors">
              {t('legal.privacy')}
            </a>
            <span className="text-stone-300">·</span>
            <a href="/terms" className="text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors">
              {t('legal.terms')}
            </a>
            <span className="text-stone-300">·</span>
            <a href="mailto:privacidad@buenadoptante.com" className="text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors">
              {t('legal.contact')}
            </a>
          </div>
          <p>{t('home.footer')}</p>
          <p className="text-stone-300 text-xs">v{packageJson.version}</p>
        </footer>
      </div>
    </main>
  );
}
