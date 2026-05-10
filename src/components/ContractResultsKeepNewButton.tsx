'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { markContractKeepNew } from '@/app/actions/duplicates';

interface ContractResultsKeepNewButtonProps {
    orphanAdopterId: string;
}

export default function ContractResultsKeepNewButton({ orphanAdopterId }: ContractResultsKeepNewButtonProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const [navigating, setNavigating] = useState(false);

    const handleClick = async () => {
        setNavigating(true);
        // Fire-and-forget analytics — never block navigation on it.
        markContractKeepNew(orphanAdopterId).catch(() => { /* analytics-only, swallowed by the action itself */ });
        router.push(`/adopter/${orphanAdopterId}`);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={navigating}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-3 rounded-xl text-sm font-semibold bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 transition-colors disabled:opacity-60"
        >
            {t('contractResults.continue_with_new') || 'Continuar con el perfil nuevo'}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
        </button>
    );
}
