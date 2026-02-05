'use client';

import { useLanguage } from '@/context/LanguageContext';
import Link from 'next/link';

export function Logo() {
    const { t } = useLanguage();

    return (
        <Link href="/" className="font-bold text-xl text-teal-800 tracking-tight flex items-center gap-2">
            {t('home.title') || 'BuenAdoptante'}
        </Link>
    );
}
