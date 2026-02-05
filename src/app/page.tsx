'use client';

import SearchSection from '@/components/SearchSection';
// export const runtime = 'edge'; // Disabled for local dev (better-sqlite3 compatibility)
import { useLanguage } from '@/context/LanguageContext';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import AdoptionWizard from '@/components/AdoptionWizard';
import ReportWizard from '@/components/ReportWizard';
import packageJson from '../../package.json';

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

          {/* Action 2: Report Bad Adopter (Wizard) */}
          <ReportWizard />
        </div>

        <footer className="mt-20 text-center text-stone-400 text-sm">
          <p>{t('home.footer')}</p>
          <p className="mt-1 text-stone-300 text-xs">v{packageJson.version}</p>
        </footer>
      </div>
    </main>
  );
}
