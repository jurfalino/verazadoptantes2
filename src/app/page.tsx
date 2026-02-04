'use client';

import SearchSection from '@/components/SearchSection';
// export const runtime = 'edge'; // Disabled for local dev (better-sqlite3 compatibility)
import { useLanguage } from '@/context/LanguageContext';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import AdoptionWizard from '@/components/AdoptionWizard';

export default function Home() {
  const { t } = useLanguage();
  const router = useRouter();
  const { data: session } = useSession();
  const { openLogin } = useAuthContext();

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
          <h1 className="text-4xl md:text-5xl font-extrabold text-stone-900 mb-4 tracking-tight">
            {t('home.title')}
          </h1>
          <p className="text-stone-600 text-lg max-w-xl mx-auto font-medium">
            {t('home.tagline')}
          </p>
        </header>

        <SearchSection />

        <div className="grid md:grid-cols-2 gap-6 mt-12">
          {/* Action 1: Register Adoption (Wizard) */}
          <AdoptionWizard />

          {/* Action 2: Report Bad Adopter */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md hover:border-rose-200 transition-all text-center group">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-700 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-bold text-stone-900 mb-2">{t('home.action_report_title')}</h3>
            <p className="text-stone-500 mb-4 text-sm">{t('home.action_report_desc')}</p>
            <button
              onClick={() => handleAuthNavigation('/adopter/create?intent=report')}
              className="inline-block px-6 py-2.5 bg-rose-200 text-rose-900 font-bold rounded-xl hover:bg-rose-300 transition-colors shadow-sm"
            >
              {t('home.action_report_btn')}
            </button>
          </div>
        </div>

        <footer className="mt-20 text-center text-stone-400 text-sm">
          <p>{t('home.footer')}</p>
        </footer>
      </div>
    </main>
  );
}
