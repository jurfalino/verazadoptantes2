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
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { proposeNewAnimalHref } from '@/domain/applications';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { changeProposedAnimal, getProposalAnimals, proposeAnimal } from '@/app/actions/applications';
import type { ProposalAnimal } from '@/app/actions/_applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { firstName } from '@/lib/householdCopy';

/** The rows, then «Cargar otro animal»; with none, «Cargar un animal» (Jon 2026-11-13). */
export function ProposalAnimalList({ animals, anyAnimals, busyId, onPick, personName, applicationId }: {
    animals: readonly ProposalAnimal[];
    /** The team has animals that take applications, even if none fits this person. */
    anyAnimals: boolean;
    /** The animal being proposed right now (every row waits). */
    busyId: string | null;
    onPick: (animal: ProposalAnimal) => void;
    /** The person's first name, for «se lo proponés a {name}». */
    personName: string;
    /** «Agregar animal» proposes the new animal to this application on save. */
    applicationId: string;
}) {
    const { t } = useLanguage();
    const href = proposeNewAnimalHref(applicationId);
    if (animals.length === 0) {
        return (
            <div data-testid="propose-empty" className="space-y-4">
                <p className="text-sm text-stone-600">{t(anyAnimals ? 'evaluation.propose_empty_all_proposed' : 'evaluation.propose_empty_load').replace('{name}', personName)}</p>
                <Link href={href} data-testid="propose-load-animal" className={buttonClasses({ variant: 'primary', fullWidth: true })}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" /></svg>
                    {t('evaluation.propose_load_cta')}
                </Link>
            </div>
        );
    }
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
            <li>
                <Link href={href} data-testid="propose-load-animal" aria-disabled={busyId !== null}
                    className={`w-full text-left flex items-center gap-3 min-h-11 py-2 group ${busyId !== null ? 'pointer-events-none opacity-50' : ''}`}>
                    <span className="w-10 h-10 shrink-0 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" /></svg>
                    </span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-teal-700">{t('evaluation.propose_load_other')}</span>
                        <span className="block text-xs text-stone-500">{t('evaluation.propose_load_other_desc').replace('{name}', personName)}</span>
                    </span>
                </Link>
            </li>
        </ul>
    );
}

/** What the sheet does with proposeAnimal's answer. */
export function proposeOutcome(res: Awaited<ReturnType<typeof proposeAnimal>>, opts: { change?: boolean } = {}): 'done' | 'already_candidate' | 'same_person' | 'failed' | 'failed_reread' {
    if (res.ok || res.error === 'already_decided') return 'done';
    if (res.error === 'already_candidate') return 'already_candidate';
    if (res.error === 'same_person_unanswered') return 'same_person';
    // «Cambiar animal» moves two rows: after a failure the panel re-reads what is really saved (review M5).
    return opts.change ? 'failed_reread' : 'failed';
}

/**
 * «Agregar y proponer» (/my-animals/new): the animal is already saved, so —
 * unlike the sheet — a request decided meanwhile must not read as proposed.
 */
export function proposeNewOutcome(res: Awaited<ReturnType<typeof proposeAnimal>>): 'proposed' | 'decided' | 'same_person' | 'already_candidate' | 'failed' {
    if (res.ok) return 'proposed';
    if (res.error === 'already_decided') return 'decided';
    if (res.error === 'same_person_unanswered') return 'same_person';
    if (res.error === 'already_candidate') return 'already_candidate';
    return 'failed';
}

type Load = { state: 'loading' } | { state: 'ok'; animals: ProposalAnimal[]; anyAnimals: boolean } | { state: 'failed'; errorId: string | null };

export function ProposeAnimalSheet({ applicationId, personName, onClose, onDone, onSamePerson, change = false, fromAnimal = '' }: {
    applicationId: string;
    /** «Cambiar animal» (Jon 2026-11-13): `applicationId` is a general form already added to an animal; picking moves it. */
    change?: boolean;
    /** «Cambiar animal»: the animal it is in now (named when the move is refused). */
    fromAnimal?: string;
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
                if (res.ok) { setLoad({ state: 'ok', animals: res.animals, anyAnimals: res.anyAnimals }); return; }
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
            const res = change ? await changeProposedAnimal(applicationId, animal.id) : await proposeAnimal(applicationId, animal.id);
            if (!res.ok && res.error === 'already_acted') {
                // Something happened on the first animal's side meanwhile: it stays; the panel re-reads.
                toast.info(t('evaluation.undo_refused').replace('{animal}', fromAnimal).replace('{name}', name));
                onDone();
                return;
            }
            const next = proposeOutcome(res, { change });
            if (next === 'done') { onDone(); return; }
            if (next === 'same_person') { onSamePerson(); return; }
            if (next === 'already_candidate') {
                // Not an error: they already are one of that animal's candidates — pick another.
                toast.info(t('evaluation.propose_already').replace('{name}', name).replace('{animal}', animalName));
                return;
            }
            toast.error(t('errors.generic'), t('evaluation.propose_failed'), (!res.ok && res.errorId) || resolveErrorId(new Error(`proposeAnimal: ${res.ok ? 'unknown' : res.error}`), 'ProposeAnimalSheet'));
            if (next === 'failed_reread') onDone();
        } catch (e) {
            if (handledAsStale(e)) return;
            toast.error(t('errors.generic'), t('evaluation.propose_failed'), resolveErrorId(e, 'ProposeAnimalSheet'));
            // A throw mid-«Cambiar» may have moved either row: re-read rather than show the old animal.
            if (change) onDone();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Modal title={t('evaluation.propose_title').replace('{name}', name)} onClose={onClose} busy={busyId !== null} testId="propose-sheet">
            <p className="text-sm text-stone-600" data-testid="propose-note">{t('evaluation.propose_note').split('{name}').join(name)}</p>
            {load.state === 'loading' && <p className="text-sm text-stone-500" aria-busy="true">{t('common.loading')}</p>}
            {load.state === 'failed' && (
                <p className="text-sm text-stone-600" data-testid="propose-failed">
                    {t('evaluation.action_failed')}
                    {load.errorId && <span className="text-xs text-stone-500"> ({t('homeModules.error_code')}: {load.errorId})</span>}
                </p>
            )}
            {load.state === 'ok' && <ProposalAnimalList animals={load.animals} anyAnimals={load.anyAnimals} busyId={busyId} onPick={pick} personName={name} applicationId={applicationId} />}
        </Modal>
    );
}
