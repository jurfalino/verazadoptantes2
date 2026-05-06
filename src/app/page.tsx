'use client';

import SearchSection from '@/components/SearchSection';
import QuickAccessStrip from '@/components/QuickAccessStrip';
export const runtime = 'edge';
import { useLanguage } from '@/context/LanguageContext';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import AdoptionWizard from '@/components/AdoptionWizard';
import ReportWizard from '@/components/ReportWizard';
import { useEffect, useState } from 'react';
import InstallCTA from '@/components/InstallCTA';
import SocialProofBanner from '@/components/SocialProofBanner';
import MilestoneBadge from '@/components/MilestoneBadge';
import ReferralBanner from '@/components/ReferralBanner';
import { useShowToast } from '@/components/ui/Toast';

export default function Home() {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { data: session } = useSession();
  const { openLogin } = useAuthContext();
  const toast = useShowToast();
  const [contentImportEnabled, setContentImportEnabled] = useState(false);
  const [appConfig, setAppConfig] = useState<Record<string, string>>({});

  // Check feature flag on client side
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then((data) => {
        const cfg = data as { config?: Record<string, string> };
        if (cfg.config) setAppConfig(cfg.config);
        if (cfg.config?.ENABLE_CONTENT_IMPORT === 'true') {
          setContentImportEnabled(true);
        }
      })
      .catch((e) => { console.error('[Homepage] Config fetch error:', e); });

  }, []);

  // Auto-open LoginModal when redirected (session expired or auth required)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackUrl = params.get('callbackUrl');
    const authRequired = params.get('authRequired');
    if (callbackUrl && !session?.user) {
      // Extract the pathname from the callbackUrl for redirect after login
      try {
        const url = new URL(callbackUrl, window.location.origin);
        // Ensure we preserve the search params (e.g. ?edit=123) and don't append a blank ?
        const fullPath = url.pathname === '/' && url.search === '' 
            ? '/' 
            : url.pathname + url.search;
        openLogin(fullPath);
      } catch {
        openLogin(callbackUrl);
      }
      // Show appropriate toast based on context
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
      // Clean up URL to remove auth params
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('callbackUrl');
      cleanUrl.searchParams.delete('error');
      cleanUrl.searchParams.delete('authRequired');
      window.history.replaceState({}, '', cleanUrl.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const handleAuthNavigation = (url: string) => {
    // Check if user is logged in
    if (!session?.user) {
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
    <main className="min-h-screen bg-stone-50 py-6 px-4 relative">
      <div className="max-w-3xl mx-auto space-y-6">
        <div id="search-section">
          <SearchSection locale={locale} showCardMetadata={appConfig.ENABLE_SEARCH_CARD_METADATA !== 'false'} />
        </div>

        {/* Social proof + milestone — below search for mobile-first */}
        <SocialProofBanner config={appConfig} />
        {session?.user && <MilestoneBadge />}
        
        {/* Quick Access Dashboard Strip */}
        <QuickAccessStrip />

        {/* Action Cards — 3-column grid */}
        <div id="action-cards" className={`grid gap-6 mt-6 ${contentImportEnabled ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
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
              <h3 className="text-lg font-semibold text-stone-900 mb-1">{t('home.action_import_title')}</h3>
              <p className="text-stone-500 text-sm mb-3">{t('home.action_import_desc')}</p>
              <span className="inline-block px-4 py-2 bg-teal-600 text-white rounded-xl font-semibold text-sm group-hover:bg-teal-700 transition-colors">{t('home.action_import_btn')}</span>
            </div>
          )}

          {/* Register Adoption */}
          <AdoptionWizard />

          {/* Report / Observation */}
          <ReportWizard />
        </div>

        {/* PWA Install CTA — shown to users who dismissed the floating banner */}
        <InstallCTA />

        {/* Referral banner — logged-in users only */}
        <ReferralBanner />

      </div>
    </main>
  );
}

