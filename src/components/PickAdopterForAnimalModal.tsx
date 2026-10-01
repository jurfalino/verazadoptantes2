'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import AdopterPicker from '@/components/AdopterPicker';
import type { DiscoveryMatch } from '@/app/actions';
import { appendCreatePrefill } from '@/lib/createPrefill';
import AdoptionFormWizard from '@/components/AdoptionFormWizard';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { reportClientError } from '@/lib/clientErrorReporter';

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
    recordType?: 'adoption' | 'foster' | 'returned_pet';
    /** The signed-in user, forwarded to the wizard for audit stamping. */
    currentUser?: string;
    /** Skip the search entirely. A devolución is always about the animal's
     *  CURRENT holder, so there is nobody to look up. */
    presetAdopter?: { id: string; name: string } | null;
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
    animalId, animalName, open, onClose, recordType = 'adoption', currentUser, presetAdopter = null,
}: PickAdopterForAnimalModalProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [wizard, setWizard] = useState<{ adopterId: string; adopterName: string } | null>(null);
    /* The wizard's advisory context: the adopter's prior records (which drive
       the "too many adoptions lately" warnings — a vetting signal that matters
       most at exactly this moment), their average rating, and the rescuer's
       inventory, which the animal prefill is matched against. All four are
       EXISTING server actions, so this opens no new browser-callable door.
       Fails open to the wizard's own defaults. */
    const [ctx, setCtx] = useState<{ adoptions: unknown[]; avgRating: number | null; availableAnimals: unknown[] } | null>(null);

    // A preset adopter goes straight to the wizard; nothing to search for.
    useEffect(() => {
        if (open && presetAdopter && !wizard) {
            const params = new URLSearchParams(searchParams.toString());
            params.set('newAdoption', recordType);
            params.set('animalId', animalId);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            setWizard({ adopterId: presetAdopter.id, adopterName: presetAdopter.name });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, presetAdopter, wizard]);

    useEffect(() => {
        if (!wizard) { setCtx(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { getAdoptions, getAverageRating, getAvailableAnimals } = await import('@/app/actions');
                const [adoptions, avgRating, availableAnimals] = await Promise.all([
                    getAdoptions(wizard.adopterId).catch(() => []),
                    getAverageRating(wizard.adopterId).catch(() => null),
                    getAvailableAnimals().catch(() => []),
                ]);
                if (!cancelled) setCtx({ adoptions: adoptions ?? [], avgRating: avgRating ?? null, availableAnimals: availableAnimals ?? [] });
            } catch (e) {
                // Degraded, not fatal: the wizard still saves, it just loses the
                // density warnings and the inventory prefill. Reported, never swallowed.
                void reportClientError({
                    message: e instanceof Error ? e.message : String(e),
                    source: 'PickAdopterForAnimalModal.wizardContext',
                    extra: { adopterId: wizard.adopterId },
                });
                if (!cancelled) setCtx({ adoptions: [], avgRating: null, availableAnimals: [] });
            }
        })();
        return () => { cancelled = true; };
    }, [wizard]);

    const density = (type: 'adoption' | 'adoption_request', periodDays: number, threshold: number) => {
        if (!ctx) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = computeMaxDensityPeriod(ctx.adoptions as any, type, periodDays);
        return d.count < threshold ? null : { count: d.count, actualSpanDays: d.timeSpanDays, periodDays };
    };

    if (!open && !wizard) return null;

    const isFoster = recordType === 'foster';

    /* v2.56.109: the wizard opens HERE instead of on the adopter's page.
     *
     * Picking a person used to navigate to /adopter/<id>, which ended the task
     * somewhere else — the animal, its pending reminders and its timeline all
     * left behind, with nothing bringing the rescuer back. The wizard reads its
     * prefill from the URL, so rather than refactoring a 1,080-line form that
     * owns the app's most important write, the same params are set on the page
     * the user is already on and the wizard is mounted here. It already closes
     * and `router.refresh()`es instead of navigating, so finishing lands back
     * on the animal with the new placement showing.
     *
     * Creating a BRAND-NEW adopter still leaves: that is a full profile form,
     * not this one. */
    const handleSelectExisting = (adopter: DiscoveryMatch) => {
        const adopterId = adopter.adopterId;
        if (!adopterId) return;
        const params = new URLSearchParams(searchParams.toString());
        params.set('newAdoption', recordType);
        params.set('animalId', animalId);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        setWizard({ adopterId, adopterName: adopter.adopterName || adopter.adopter?.name || '' });
    };

    /** Drop the prefill params. Without this the wizard re-opens on the record
     *  that was just saved — it opens whenever `newAdoption` is in the URL, and
     *  it calls router.refresh() right after onClose — and Back or a reload
     *  would re-open it too. */
    const closeWizard = () => {
        const params = new URLSearchParams(searchParams.toString());
        for (const k of ['newAdoption', 'animalId', 'animalName', 'species', 'rating', 'details', 'date', 'followupKey', 'followupSubtype']) params.delete(k);
        const q = params.toString();
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
        setWizard(null);
        onClose();   // only now may the parent unmount us
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

    /* The wizard matches the animalId prefill against `availableAnimals` ONCE,
       as it mounts. Mounting it before the inventory arrives means matching
       against an empty list, and the animal is dropped silently — the adoption
       then saves with no animal at all. So hold the mount until the context is
       in hand. */
    /* The form reads BOTH its record type and its animal from the URL, once, at
       mount. `router.replace` is not synchronous, so mounting straight after it
       can read the OLD params — the type falls back to «adoption» and the animal
       is dropped. Wait for the URL to actually carry them, exactly as we wait
       for the inventory. */
    const paramsReady = searchParams.get('animalId') === animalId
        && searchParams.get('newAdoption') === recordType;

    if (wizard && (!ctx || !paramsReady)) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }} aria-busy="true">
                <div className="bg-white rounded-2xl border border-stone-200 shadow-xl px-6 py-5 flex items-center gap-3">
                    <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" aria-hidden />
                    <span className="text-sm font-semibold text-stone-600">{t('common.loading') || 'Cargando…'}</span>
                </div>
            </div>
        );
    }

    if (wizard) {
        return (
            <AdoptionFormWizard
                adopterId={wizard.adopterId}
                adopterName={wizard.adopterName}
                initialRecordType={recordType}
                avgRating={ctx?.avgRating ?? null}
                tooManyAdoptions={density('adoption', 90, 5)}
                tooManyRequests={density('adoption_request', 30, 3)}
                availableAnimals={ctx?.availableAnimals ?? []}
                adopterAdoptions={ctx?.adoptions ?? []}
                currentUser={currentUser}
                autoOpen
                onClose={closeWizard}
            />
        );
    }

    if (!open) return null;

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
