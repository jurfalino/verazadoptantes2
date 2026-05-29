'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import AdopterPicker from '@/components/AdopterPicker';

type RecordType = 'adoption' | 'observation';

const PALETTE = {
    teal: {
        cardBorderHover: 'hover:border-teal-200',
        iconBg: 'bg-teal-100',
        iconText: 'text-teal-700',
        btnBg: 'bg-teal-200',
        btnText: 'text-teal-900',
        btnHover: 'hover:bg-teal-300',
        pickerAccent: 'teal' as const,
    },
    rose: {
        cardBorderHover: 'hover:border-rose-200',
        iconBg: 'bg-rose-100',
        iconText: 'text-rose-700',
        btnBg: 'bg-rose-200',
        btnText: 'text-rose-900',
        btnHover: 'hover:bg-rose-300',
        pickerAccent: 'rose' as const,
    },
};

/**
 * HomepageActionCard — typed entry-point card for the homepage.
 *
 * Replaces the previous `AdoptionWizard` / `ReportWizard` components, which
 * each owned their own two-step modal that deposited users into a *second*
 * wizard inside the adopter profile. The activity wizard
 * (`AdoptionFormWizard`) is now the canonical surface for creating any
 * record; this card's only job is to identify the adopter (or hand off to
 * `/adopter/create`) and route there with the right URL params so the
 * activity wizard opens pre-typed for the user's intent.
 */
export default function HomepageActionCard({
    recordType,
    titleKey,
    descKey,
    btnKey,
    testId,
    palette,
    icon,
}: {
    recordType: RecordType;
    titleKey: string;
    descKey: string;
    btnKey: string;
    testId: string;
    palette: keyof typeof PALETTE;
    /** Inline <path d="..."> for the card icon. */
    icon: string;
}) {
    const router = useRouter();
    const { t } = useLanguage();
    const { data: session, status: sessionStatus } = useSession();
    const { openLogin } = useAuthContext();
    const [pickerOpen, setPickerOpen] = useState(false);
    const p = PALETTE[palette];

    const handleStart = () => {
        if (sessionStatus === 'loading') return;
        if (!session?.user) {
            openLogin();
            return;
        }
        setPickerOpen(true);
    };

    const handleSelect = (adopter: { adopter: { id: string } }) => {
        setPickerOpen(false);
        router.push(`/adopter/${adopter.adopter.id}?newAdoption=${recordType}`);
    };

    const handleCreateNew = (searchText: string) => {
        setPickerOpen(false);
        const params = new URLSearchParams({
            continueToAdoption: 'true',
            newAdoption: recordType,
        });
        if (searchText) params.set('name', searchText);
        router.push(`/adopter/create?${params.toString()}`);
    };

    return (
        <>
            <div
                data-testid={testId}
                className={`bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md ${p.cardBorderHover} transition-all text-center group h-full flex flex-col items-center justify-center cursor-pointer`}
                onClick={handleStart}
            >
                <div className={`w-12 h-12 ${p.iconBg} rounded-full flex items-center justify-center mx-auto mb-4 ${p.iconText} group-hover:scale-110 transition-transform`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                    </svg>
                </div>
                <h2 className="text-xl font-semibold text-stone-900 mb-2">{t(titleKey)}</h2>
                <p className="text-stone-500 mb-4 text-sm">{t(descKey)}</p>
                <button
                    className={`inline-block px-6 py-2.5 ${p.btnBg} ${p.btnText} font-semibold rounded-xl ${p.btnHover} transition-colors shadow-sm`}
                >
                    {t(btnKey)}
                </button>
            </div>

            {pickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white p-6 rounded-2xl shadow-xl border border-stone-200 w-full max-w-2xl mx-auto max-h-[90svh] overflow-y-auto relative">
                        <button
                            onClick={() => setPickerOpen(false)}
                            className="absolute top-4 right-4 text-stone-500 hover:text-stone-700"
                            aria-label={t('common.close') || 'Close'}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <h2 className="text-2xl font-semibold text-stone-800 mb-2">
                            {t('wizard.who_is_adopter') || 'Who is the adopter?'}
                        </h2>
                        <p className="text-sm text-stone-500 mb-6">
                            {recordType === 'adoption'
                                ? (t('home.picker_subtitle_adoption') || 'Find the adopter to record the placement, or create a new record.')
                                : (t('home.picker_subtitle_observation') || 'Find the adopter you want to note, or create a new record.')}
                        </p>
                        <AdopterPicker
                            accent={p.pickerAccent}
                            onSelect={handleSelect}
                            onCreateNew={handleCreateNew}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
