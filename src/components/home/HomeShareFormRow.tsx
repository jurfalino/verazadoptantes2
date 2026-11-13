'use client';

/**
 * «Compartir formulario» on the home, right under the search (Jon 2026-11-13,
 * option B — for a brand-new rescuer too, above «Para empezar»). It opens the
 * same window as /my-animals' button (ShareFormMenu), with «¿Para qué animal?».
 * The row reuses the home cards' title-row look and the words the window
 * already uses.
 */
import ShareFormMenu from '@/components/ShareFormMenu';
import { useLanguage } from '@/context/LanguageContext';

export default function HomeShareFormRow({ userId }: { userId: string }) {
    const { t } = useLanguage();
    return (
        <ShareFormMenu
            userId={userId}
            renderTrigger={(open) => (
                <button
                    type="button"
                    onClick={open}
                    data-testid="home-share-form"
                    className="w-full flex items-center gap-3 bg-white rounded-2xl border border-stone-200 px-4 py-3 shadow-sm min-h-11 text-left group hover:border-stone-300 transition-colors"
                >
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8" /></svg>
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-base font-bold text-stone-900 leading-tight group-hover:text-teal-700">{t('dashboard.share_form')}</span>
                        <span className="block text-sm text-stone-500 leading-snug">{t('dashboard.share_form_modal_hint')}</span>
                    </span>
                    <svg className="w-4 h-4 text-stone-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
            )}
        />
    );
}
