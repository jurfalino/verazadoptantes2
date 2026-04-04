'use client';

import { useLanguage } from '@/context/LanguageContext';

interface DisclaimerBannerProps {
    adopterId: string;
    adopterName: string;
}

export default function ReportInaccuracyForm({ adopterId: _adopterId, adopterName: _adopterName }: DisclaimerBannerProps) {
    const { t } = useLanguage();

    return (
        <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 mt-1">
            <p className="text-stone-500 text-[11px] leading-relaxed">
                ℹ️ {t('legal.disclaimer') || 'Community-contributed data · not independently verified'}
            </p>
        </div>
    );
}
