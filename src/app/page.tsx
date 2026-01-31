'use client';

import SearchSection from '@/components/SearchSection';
export const runtime = 'edge';
import { useLanguage } from '@/context/LanguageContext';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';

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
    <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-emerald-900 mb-4">
            {t('home.title')}
          </h1>
          <p className="text-emerald-900/70 text-lg max-w-xl mx-auto font-medium">
            {t('home.tagline')}
          </p>
        </header>

        <SearchSection />

        <div className="grid md:grid-cols-2 gap-6 mt-12">
          {/* Action 1: Register Adoption */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 hover:shadow-md transition-all text-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-900 mb-2">{t('home.action_register_title')}</h3>
            <p className="text-emerald-600/70 mb-4 text-sm">{t('home.action_register_desc')}</p>
            <button
              onClick={() => handleAuthNavigation('/adopter/create')}
              className="inline-block px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-colors"
            >
              {t('home.action_register_btn')}
            </button>
          </div>

          {/* Action 2: Report Bad Adopter */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 hover:shadow-md transition-all text-center">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-900 mb-2">{t('home.action_report_title')}</h3>
            <p className="text-emerald-600/70 mb-4 text-sm">{t('home.action_report_desc')}</p>
            <button
              onClick={() => handleAuthNavigation('/adopter/create?intent=report')}
              className="inline-block px-4 py-2 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors"
            >
              {t('home.action_report_btn')}
            </button>
          </div>
        </div>

        <footer className="mt-20 text-center text-emerald-600/60 text-sm">
          <p>{t('home.footer')}</p>
        </footer>
      </div>
    </main>
  );
}
