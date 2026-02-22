'use client';

import { useLanguage } from '@/context/LanguageContext';

interface DisclaimerBannerProps {
    adopterId: string;
    adopterName: string;
}

export default function ReportInaccuracyForm({ adopterId: _adopterId, adopterName: _adopterName }: DisclaimerBannerProps) {
    const { t } = useLanguage();

    return (
        <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5">
            <p className="text-stone-500 text-xs">
                ℹ️ {t('legal.disclaimer') || 'Information is provided by community users. BuenAdoptante does not verify its accuracy.'}
            </p>
        </div>
    );
}
