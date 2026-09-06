'use client';

/**
 * v2.55.15 (animal-timeline PR2): ONE share door per animal.
 *
 * The card/action rows used to show two separate compact triggers (form +
 * contract). This sheet collapses them into a single «Compartir» button that
 * opens the canonical centered modal with option rows, each row being the
 * EXISTING ShareFormMenu / ShareMenu trigger (their own modals stack on top) —
 * nothing is rebuilt, only re-housed.
 */

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import ShareFormMenu from '@/components/ShareFormMenu';
import ShareMenu from '@/components/ShareMenu';

export default function AnimalShareSheet({ userId, animalId, animalName, adopted = false, compact = false }: {
    userId: string;
    animalId: string;
    animalName: string;
    /** Post-adoption the contract row reads resend/receipt instead of the token pitch. */
    adopted?: boolean;
    compact?: boolean;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                data-testid={`share-sheet-${animalId}`}
                className={compact
                    ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors'
                    : 'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-50 text-teal-700 border border-teal-100 hover:border-teal-400 transition-colors'}
                aria-haspopup="dialog"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 5.5L12 2l3.5 3.5M12 2v13M5 9.5H4V22h16V9.5h-1" /></svg>
                {t('animalProfile.share') || 'Compartir'}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setOpen(false)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-4"
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('animalProfile.share_title') || 'Compartir'}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-bold text-stone-900 mb-1">{t('animalProfile.share_title') || 'Compartir'}</h3>
                        <p className="text-xs text-stone-500 mb-3">
                            {adopted
                                ? (t('animalProfile.share_hint_adopted') || 'Reenviá el contrato o guardá la constancia firmada.')
                                : (t('animalProfile.share_hint') || 'El formulario suma personas interesadas; el contrato se firma con quien elijas.')}
                        </p>
                        {/* The row triggers stay mounted while their own modals stack on
                            top — closing this sheet here would unmount them and their
                            modals with them. Closing the inner modal lands back here. */}
                        <div className="flex flex-col gap-2">
                            <ShareFormMenu userId={userId} animalId={animalId} animalName={animalName} />
                            <ShareMenu contractUrl={`/contract/${animalId}`} animalName={animalName} />
                        </div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="mt-3 w-full px-4 py-2 rounded-xl text-sm font-semibold text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
                        >
                            {t('common.close') || 'Cerrar'}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
