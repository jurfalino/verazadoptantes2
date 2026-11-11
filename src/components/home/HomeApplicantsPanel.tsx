'use client';

/**
 * Mis animales on the homepage, a row with applications to evaluate (spec
 * 2026-11-10 «Home — Mis animales», Q5 → B): tapping it opens the applicant
 * panel over the home — that animal's candidates, or the general ones
 * («Sin animal elegido») — at the first one to evaluate, the rest still there
 * to compare (panelOrder: por evaluar first). Built like HomeDuePanel: after an
 * outcome the card reloads (onChanged) and the panel moves to the next one to
 * evaluate, or closes when none is left.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Modal } from '@/components/ui/Modal';
import ApplicantDetailPanel from '@/components/ApplicantDetailPanel';
import { getApplicantsForAnimal, type ApplicantSummary } from '@/app/actions/applicants';
import { getGeneralApplications } from '@/app/actions/applications';
import { nextToEvaluateIndex } from '@/domain/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';

/** Which list the row opens: one animal's candidates, or the general applications. */
export type HomeApplicantsTarget = { animal: { id: string; name: string; sex: string | null } } | 'general';

type Loaded = { kind: 'loading' } | { kind: 'ok'; list: ApplicantSummary[]; index: number } | { kind: 'error'; errorId: string };

/**
 * One read of the list, and what it leads to:
 * - `ok`: open at the first one to evaluate (else the first), the rest still there to compare;
 * - `empty`: everything was decided meanwhile (another tab, a teammate) — close quietly, the card re-reads;
 * - `stale`: an older tab (the page reloads itself) — close;
 * - `error`: say so, with the errorId.
 * Both loaders fail closed to [] after logging on the server, so a failed read also lands on `empty`.
 */
export async function readPanel(read: () => Promise<ApplicantSummary[]>):
    Promise<{ kind: 'ok'; list: ApplicantSummary[]; index: number } | { kind: 'empty' } | { kind: 'stale' } | { kind: 'error'; errorId: string }> {
    try {
        const list = await read();
        if (list.length === 0) return { kind: 'empty' };
        const first = nextToEvaluateIndex(list.map(a => a.status), -1);
        return { kind: 'ok', list, index: first === -1 ? 0 : first };
    } catch (e) {
        if (handledAsStale(e)) return { kind: 'stale' };
        return { kind: 'error', errorId: resolveErrorId(e, 'HomeApplicantsPanel') };
    }
}

export default function HomeApplicantsPanel({ target, onClose, onChanged }: {
    target: HomeApplicantsTarget;
    onClose: () => void;
    /** An outcome was recorded (or a contract sent): the card reloads. */
    onChanged: () => void;
}) {
    const { t } = useLanguage();
    const [state, setState] = useState<Loaded>({ kind: 'loading' });
    const animal = target === 'general' ? null : target.animal;
    const animalId = animal?.id ?? null;

    // Both reads fail closed to [] (logged on the server).
    const read = useCallback(
        () => (animalId ? getApplicantsForAnimal(animalId) : getGeneralApplications()),
        [animalId],
    );

    useEffect(() => {
        let current = true;
        void readPanel(read).then((res) => {
            if (!current) return;
            if (res.kind === 'empty') { onChanged(); onClose(); return; }
            if (res.kind === 'stale') { onClose(); return; }
            setState(res);
        });
        return () => { current = false; };
    }, [read, onClose, onChanged]);

    const onOutcome = useCallback(async () => {
        onChanged();
        const fresh = await read();
        return fresh.length > 0 ? fresh : null;
    }, [read, onChanged]);

    if (state.kind === 'ok') {
        return (
            <ApplicantDetailPanel
                testId="home-applicants-panel"
                applicants={state.list}
                initialIndex={state.index}
                animal={animal}
                onClose={onClose}
                onOutcome={onOutcome}
                onContractIssued={onChanged}
            />
        );
    }

    const title = animal ? animal.name : t('evaluation.general_title');
    return (
        <Modal title={title} onClose={onClose} testId="home-applicants-panel">
            {state.kind === 'loading' && (
                <div aria-hidden="true" className="h-28 rounded-2xl bg-stone-100 animate-pulse" data-testid="home-applicants-panel-loading" />
            )}
            {state.kind === 'error' && (
                <p className="text-sm text-stone-600" data-testid="home-applicants-panel-error">
                    {t('homeModules.load_failed')} <span className="text-xs text-stone-500">({t('homeModules.error_code')}: {state.errorId})</span>
                </p>
            )}
        </Modal>
    );
}
