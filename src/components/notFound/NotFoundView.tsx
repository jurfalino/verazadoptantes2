'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { DogAtePage, CatKnockedPage } from './illustrations';

export type NotFoundVariant = 'dog' | 'cat';

export default function NotFoundView({ variant }: { variant: NotFoundVariant }) {
    const { t } = useLanguage();
    const goBack = () => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign('/');
    };
    return (
        <main
            data-testid="not-found-page"
            data-variant={variant}
            className="min-h-[calc(100vh-4rem)] bg-stone-50 px-4 py-16 flex flex-col items-center text-center gap-4"
        >
            {variant === 'dog' ? <DogAtePage /> : <CatKnockedPage />}
            <h1 className="text-xl font-extrabold tracking-tight text-stone-900 break-words max-w-sm">
                {t(`notFound.${variant}_title`)}
            </h1>
            <p className="text-sm font-medium text-stone-500 max-w-xs">{t(`notFound.${variant}_body`)}</p>
            <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
                <Link
                    href="/"
                    className="min-h-11 flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold bg-teal-700 text-white shadow-sm transition-all duration-200 hover:-translate-y-px"
                >
                    {t('notFound.home')}
                </Link>
                <button
                    type="button"
                    onClick={goBack}
                    className="min-h-11 rounded-xl px-6 py-3 text-sm font-bold bg-teal-50 text-teal-700 border border-teal-200 transition-all duration-200"
                >
                    {t('notFound.back')}
                </button>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{t('notFound.code')}</span>
        </main>
    );
}
