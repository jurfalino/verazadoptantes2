'use client';

import SearchSection from '@/components/SearchSection';
export const runtime = 'edge';
import { useLanguage } from '@/context/LanguageContext';

export default function Home() {
  const { t } = useLanguage();

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

        <footer className="mt-20 text-center text-emerald-600/60 text-sm">
          <p>{t('home.footer')}</p>
        </footer>
      </div>
    </main>
  );
}
