'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import AdopterPicker from '@/components/AdopterPicker';
import type { DiscoveryMatch } from '@/app/actions';
import { appendCreatePrefill } from '@/lib/createPrefill';

interface PickAdopterForAnimalModalProps {
    animalId: string;
    animalName: string;
    open: boolean;
    onClose: () => void;
    /**
     * Which record the wizard should pre-select. 'adoption' (default) records a
     * permanent adoption; 'foster' moves an in-transit animal to another foster
     * home. Both go through the wizard on the picked adopter's profile.
     */
    recordType?: 'adoption' | 'foster';
}

/**
 * v2.19.0 — "Record adoption" entry point from /my-animals.
 *
 * Two-step UX without leaving the picker shell:
 *  1. User searches via AdopterPicker (debounced findAdopters discovery search)
 *  2. Branch by pick:
 *     - Existing adopter selected → close modal + route to
 *       /adopter/<id>?newAdoption=adoption&animalId=<animal.id>
 *       (the wizard auto-opens with adopter + animal pre-selected — see the
 *       v2.19.0 animalId URL plumbing in AdoptionFormWizard)
 *     - "+ Crear nuevo adoptante" → route to
 *       /adopter/create?continueToAdoption=true&newAdoption=adoption&animalId=<id>
 *       The existing AdopterForm post-create redirect forwards animalId to
 *       the new profile, where the wizard fires the same way.
 *
 * No save happens here; this is purely navigation + adopter selection. All
 * the adoption-form validation, drafts, contract follow-ups, etc. live in
 * the existing wizard on the adopter profile — that's where the user lands.
 */
export default function PickAdopterForAnimalModal({
    animalId, animalName, open, onClose, recordType = 'adoption',
}: PickAdopterForAnimalModalProps) {
    const { t } = useLanguage();
    const router = useRouter();

    if (!open) return null;

    const isFoster = recordType === 'foster';

    const handleSelectExisting = (adopter: DiscoveryMatch) => {
        const adopterId = adopter.adopterId;
        if (!adopterId) return;
        const params = new URLSearchParams({
            newAdoption: recordType,
            animalId,
        });
        // Close before pushing so the overlay doesn't briefly stack on top of
        // the destination page during the route transition.
        onClose();
        router.push(`/adopter/${adopterId}?${params.toString()}`);
    };

    const handleCreateNew = (searchText: string) => {
        const params = new URLSearchParams({
            continueToAdoption: 'true',
            newAdoption: recordType,
            animalId,
        });
        // Forward whatever the user typed, classified into the right field —
        // a phone or an address must not land in the name (see lib/createPrefill).
        appendCreatePrefill(params, searchText);
        onClose();
        router.push(`/adopter/create?${params.toString()}`);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'var(--overlay-bg)' }}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={(isFoster ? t('myAnimals.pick_foster_title') : t('myAnimals.pick_adopter_title')) || 'Buscar adoptante'}
        >
            <div
                className="rounded-2xl shadow-xl w-full max-w-lg max-h-[90svh] overflow-hidden flex flex-col"
                style={{ background: 'var(--surface-card)' }}
                onClick={e => e.stopPropagation()}
            >
                <header className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-base font-bold text-stone-800">
                                {(isFoster ? t('myAnimals.pick_foster_title') : t('myAnimals.pick_adopter_title')) || 'Registrar adopción'}
                            </h2>
                            <p className="text-xs text-stone-500 mt-0.5 truncate">
                                {(t('myAnimals.pick_adopter_for') || 'Para {name}')
                                    .replace('{name}', animalName || (t('common.animal') || 'el animal'))}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t('common.close') || 'Cerrar'}
                            className="flex-shrink-0 -mt-1 -mr-1 p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </header>

                <div className="px-5 py-4 overflow-y-auto flex-1">
                    <AdopterPicker
                        onSelect={handleSelectExisting}
                        onCreateNew={handleCreateNew}
                        accent="teal"
                    />
                </div>
            </div>
        </div>
    );
}
