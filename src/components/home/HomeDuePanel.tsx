'use client';

/**
 * Mis animales on the homepage, an animal with a check-up due (Jon 2026-11-09,
 * option C): tapping it opens the animal page's «Para hacer ahora» over the
 * home — the same block (DueNowBlock), so WhatsApp and «Registrar» work as
 * there, for every due slot, without leaving the home. «Ver la ficha» is
 * still one tap away.
 *
 * One dialog at a time: «Registrar» swaps this panel for the same
 * «Agregar evento» dialog the animal page opens; after a save the card's data
 * reloads (onChanged) and the panel comes back with what is still due — or
 * stays closed when nothing is.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Modal } from '@/components/ui/Modal';
import DueNowBlock from '@/components/DueNowBlock';
import AddAnimalEventModal from '@/components/AddAnimalEventModal';
import { getAnimalProfile, type AnimalProfileData, type ProjectedSlot } from '@/app/actions/animalTimeline';
import { adopterDisplayName } from '@/lib/adopterDisplay';
import { interpolate } from '@/lib/interpolate';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

type Loaded = { kind: 'loading' } | { kind: 'ok'; profile: AnimalProfileData } | { kind: 'error'; errorId: string };

export default function HomeDuePanel({ animalId, animalName, onClose, onChanged }: {
    animalId: string;
    /** The card's name for the title while the animal loads. */
    animalName: string;
    onClose: () => void;
    /** A slot was registered: the card reloads. */
    onChanged: () => void;
}) {
    const { t } = useLanguage();
    const [state, setState] = useState<Loaded>({ kind: 'loading' });
    const [registering, setRegistering] = useState<ProjectedSlot | null>(null);

    const load = useCallback(async (): Promise<AnimalProfileData | null> => {
        try {
            const profile = await getAnimalProfile(animalId);
            if (!profile) {
                // Gone, or no longer the viewer's to act on: say so, with the errorId, and keep the way to the page.
                const errorId = resolveErrorId(new Error(`HomeDuePanel: no profile for animal ${animalId}`), 'HomeDuePanel');
                setState({ kind: 'error', errorId });
                return null;
            }
            setState({ kind: 'ok', profile });
            return profile;
        } catch (e) {
            if (handledAsStale(e)) { onClose(); return null; }
            setState({ kind: 'error', errorId: resolveErrorId(e, 'HomeDuePanel') });
            return null;
        }
    }, [animalId, onClose]);

    useEffect(() => { void load(); }, [load]);

    const profile = state.kind === 'ok' ? state.profile : null;
    const placement = profile?.activePlacement ?? null;
    const due = profile ? profile.projected.filter(s => s.status === 'due') : [];
    const name = profile?.animal.name || animalName;

    if (registering && profile) {
        return (
            <AddAnimalEventModal
                animal={{ id: profile.animal.id, name: profile.animal.name }}
                activePlacement={placement}
                open
                onClose={() => setRegistering(null)}
                onSaved={async () => {
                    onChanged();
                    // Never show the slot just registered while the fresh data loads: it would invite a second save.
                    setState({ kind: 'loading' });
                    const fresh = await load();
                    if (!fresh || fresh.projected.every(s => s.status !== 'due')) onClose();
                }}
                initialType={registering.subtype === 'adaptation' ? 'follow_up' : registering.subtype === 'neuter' ? 'neuter' : 'vaccination'}
                initialFollowupKey={registering.key}
                initialSubtype={registering.subtype}
            />
        );
    }

    const fem = profile ? ['hembra', 'female', 'Hembra'].includes(profile.animal.sex || '') : false;
    const where = placement
        ? `${placement.recordType === 'adoption'
            ? ((fem ? t('animalProfile.status_adopted_f') : t('animalProfile.status_adopted_m')) || 'Adoptado por')
            : (t('dashboard.in_foster_with') || 'En tránsito con')} ${adopterDisplayName({ name: placement.adopterName }, t('adopter.nameless'))}`
        : null;

    return (
        <Modal title={name} onClose={onClose} testId="home-due-panel">
            {where && <p className="-mt-3 text-sm text-stone-500 [overflow-wrap:anywhere]">{where}</p>}
            {state.kind === 'loading' && (
                <div aria-hidden="true" className="h-28 rounded-2xl bg-stone-100 animate-pulse" data-testid="home-due-panel-loading" />
            )}
            {state.kind === 'error' && (
                <p className="text-sm text-stone-600" data-testid="home-due-panel-error">
                    {t('homeModules.due_panel_failed')} <span className="text-xs text-stone-500">({t('homeModules.error_code')}: {state.errorId})</span>
                </p>
            )}
            {profile && (
                <DueNowBlock slots={due} placementId={placement?.id} onRegister={setRegistering} />
            )}
            <Link href={`/my-animals/${encodeURIComponent(animalId)}`} data-testid="home-due-panel-page"
                className="flex items-center justify-between gap-2 min-h-11 text-sm font-semibold text-teal-700 hover:underline underline-offset-4">
                <span className="[overflow-wrap:anywhere]">{interpolate(t('homeModules.see_animal_page'), { name })}</span>
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
        </Modal>
    );
}
