'use client';

/**
 * «Proponer un animal» (spec 2026-11-10, decision 2): the team's animals that
 * can take applications, those matching the form's «Prefiere» first, each with
 * its candidates. Picking one makes the person a candidate of that animal and
 * ends the general application as «Propuesta para {animal}».
 *
 * Rows look like the home's animal rows (photo or species placeholder, name,
 * one line under it), each ≥44px.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { getProposalAnimals, proposeAnimal } from '@/app/actions/applications';
import type { ProposalAnimal } from '@/app/actions/_applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { firstName } from '@/lib/householdCopy';

/** The rows. */
export function ProposalAnimalList({ animals, busyId, onPick }: {
    animals: readonly ProposalAnimal[];
    /** The animal being proposed right now (every row waits). */
    busyId: string | null;
    onPick: (animal: ProposalAnimal) => void;
}) {
    const { t } = useLanguage();
    if (animals.length === 0) return <p className="text-sm text-stone-600" data-testid="propose-empty">{t('evaluation.propose_empty')}</p>;
    return (
        <ul className="divide-y divide-stone-200">
            {animals.map((a) => {
                const name = a.name || t('homeModules.unnamed_animal');
                const line = a.candidates === 0 ? t('evaluation.candidates_none')
                    : a.candidates === 1 ? t('evaluation.candidates_one')
                        : t('evaluation.candidates_many').replace('{n}', String(a.candidates));
                return (
                    <li key={a.id}>
                        <button
                            type="button"
                            onClick={() => onPick(a)}
                            disabled={busyId !== null}
                            data-testid={`propose-animal-${a.id}`}
                            className="w-full text-left flex items-center gap-3 min-h-11 py-2 group disabled:opacity-50 disabled:cursor-wait"
                        >
                            <span className="w-10 h-10 shrink-0 rounded-lg bg-stone-200 overflow-hidden flex items-center justify-center">
                                {a.photo
                                    ? <img src={a.photo} alt="" className="w-full h-full object-cover" />
                                    : <img src={`/placeholders/${a.species === 'cat' ? 'cat' : a.species === 'dog' ? 'dog' : 'paw'}.png`} alt="" className="w-7 h-7 object-contain opacity-60" />}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-semibold text-stone-900 group-hover:text-teal-700 [overflow-wrap:anywhere]">{name}</span>
                                <span className="block text-xs text-stone-500">{busyId === a.id ? t('common.processing') : line}</span>
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

/** What the sheet does with proposeAnimal's answer. */
export function proposeOutcome(res: Awaited<ReturnType<typeof proposeAnimal>>): 'done' | 'already_candidate' | 'same_person' | 'failed' {
    if (res.ok || res.error === 'already_decided') return 'done';
    if (res.error === 'already_candidate') return 'already_candidate';
    if (res.error === 'same_person_unanswered') return 'same_person';
    return 'failed';
}

type Load = { state: 'loading' } | { state: 'ok'; animals: ProposalAnimal[] } | { state: 'failed'; errorId: string | null };

export function ProposeAnimalSheet({ applicationId, personName, onClose, onDone, onSamePerson }: {
    applicationId: string;
    personName: string;
    onClose: () => void;
    /** «¿Es la misma persona?» still waits (a «No sé» withdrawn, or a new match, since the panel read): the panel closes the sheet and goes to the question. */
    onSamePerson: () => void;
    /** The proposal is recorded (or the application was already decided): the panel re-reads and moves on. */
    onDone: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const name = firstName(personName) || personName;
    const [load, setLoad] = useState<Load>({ state: 'loading' });
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        let current = true;
        getProposalAnimals(applicationId)
            .then((res) => {
                if (!current) return;
                if (res.ok) { setLoad({ state: 'ok', animals: res.animals }); return; }
                // Decided meanwhile (another tab): nothing to propose — the panel re-reads.
                if (res.error === 'already_decided') { onDone(); return; }
                setLoad({ state: 'failed', errorId: res.errorId ?? resolveErrorId(new Error(`getProposalAnimals: ${res.error}`), 'ProposeAnimalSheet') });
            })
            .catch((e) => {
                if (!current) return;
                setLoad({ state: 'failed', errorId: handledAsStale(e) ? null : resolveErrorId(e, 'ProposeAnimalSheet') });
            });
        return () => { current = false; };
        // `onDone` is the panel's handler; the list is read once per application.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applicationId]);

    const pick = async (animal: ProposalAnimal) => {
        if (busyId) return;
        setBusyId(animal.id);
        const animalName = animal.name || t('homeModules.unnamed_animal');
        try {
            const res = await proposeAnimal(applicationId, animal.id);
            const next = proposeOutcome(res);
            if (next === 'done') { onDone(); return; }
            if (next === 'same_person') { onSamePerson(); return; }
            if (next === 'already_candidate') {
                // Not an error: they already are one of that animal's candidates — pick another.
                toast.info(t('evaluation.propose_already').replace('{name}', name).replace('{animal}', animalName));
                return;
            }
            toast.error(t('errors.generic'), t('evaluation.propose_failed'), (!res.ok && res.errorId) || resolveErrorId(new Error(`proposeAnimal: ${res.ok ? 'unknown' : res.error}`), 'ProposeAnimalSheet'));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('evaluation.propose_failed'), resolveErrorId(e, 'ProposeAnimalSheet'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Modal title={t('evaluation.propose_title').replace('{name}', name)} onClose={onClose} busy={busyId !== null} testId="propose-sheet">
            {load.state === 'loading' && <p className="text-sm text-stone-500" aria-busy="true">{t('common.loading')}</p>}
            {load.state === 'failed' && (
                <p className="text-sm text-stone-600" data-testid="propose-failed">
                    {t('evaluation.action_failed')}
                    {load.errorId && <span className="text-xs text-stone-500"> ({t('homeModules.error_code')}: {load.errorId})</span>}
                </p>
            )}
            {load.state === 'ok' && <ProposalAnimalList animals={load.animals} busyId={busyId} onPick={pick} />}
        </Modal>
    );
}
