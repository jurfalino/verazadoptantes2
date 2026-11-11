'use client';

/**
 * Mis animales on the homepage, a row with applications to evaluate (spec
 * 2026-11-10 «Home — Mis animales», Q5 → B): tapping it opens the applicant
 * panel over the home — that animal's candidates, or the general ones
 * («Sin animal elegido») — at the first one to evaluate, the rest still there
 * to compare (panelOrder: por evaluar first). Built like HomeDuePanel: after an
 * outcome the card reloads (onChanged) and the panel moves to the next one to
 * evaluate, or closes when none is left.
 *
 * Mis animales opens the same panel from its cards and «Sin animal elegido»
 * (`returnLabel`: «← Volver» returns to the page), and at one application from a
 * bell notice's deep link (`applicationId`).
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
 * - `ok`: open at `applicationId` when it is listed (a bell notice's deep link), else at the first
 *   one to evaluate (else the first), the rest still there to compare;
 * - `empty`: everything was decided meanwhile (another tab, a teammate) — close quietly, the card re-reads;
 * - `stale`: an older tab (the page reloads itself) — close;
 * - `error`: say so, with the errorId.
 * Both loaders fail closed to [] after logging on the server, so a failed read also lands on `empty`.
 */
export async function readPanel(read: () => Promise<ApplicantSummary[]>, applicationId: string | null = null):
    Promise<{ kind: 'ok'; list: ApplicantSummary[]; index: number } | { kind: 'empty' } | { kind: 'stale' } | { kind: 'error'; errorId: string }> {
    try {
        const list = await read();
        if (list.length === 0) return { kind: 'empty' };
        const linked = applicationId ? list.findIndex(a => a.applicationId === applicationId) : -1;
        if (linked !== -1) return { kind: 'ok', list, index: linked };
        const first = nextToEvaluateIndex(list.map(a => a.status), -1);
        return { kind: 'ok', list, index: first === -1 ? 0 : first };
    } catch (e) {
        if (handledAsStale(e)) return { kind: 'stale' };
        return { kind: 'error', errorId: resolveErrorId(e, 'HomeApplicantsPanel') };
    }
}

export default function HomeApplicantsPanel({ target, onClose, onChanged, applicationId = null, returnLabel = false, testId = 'home-applicants-panel' }: {
    target: HomeApplicantsTarget;
    onClose: () => void;
    /** An outcome was recorded (or a contract sent): the card reloads. */
    onChanged: () => void;
    /** Open at this application (a bell notice's deep link on /my-animals). */
    applicationId?: string | null;
    /** Opened from a page (Mis animales): «← Volver» returns to it. */
    returnLabel?: boolean;
    testId?: string;
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
        void readPanel(read, applicationId).then((res) => {
            if (!current) return;
            if (res.kind === 'empty') { onChanged(); onClose(); return; }
            if (res.kind === 'stale') { onClose(); return; }
            setState(res);
        });
        return () => { current = false; };
    }, [read, applicationId, onClose, onChanged]);

    const onOutcome = useCallback(async () => {
        onChanged();
        const fresh = await read();
        return fresh.length > 0 ? fresh : null;
    }, [read, onChanged]);

    if (state.kind === 'ok') {
        return (
            <ApplicantDetailPanel
                testId={testId}
                returnLabel={returnLabel}
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
        <Modal title={title} onClose={onClose} testId={testId}>
            {state.kind === 'loading' && (
                <div aria-hidden="true" className="h-28 rounded-2xl bg-stone-100 animate-pulse" data-testid={`${testId}-loading`} />
            )}
            {state.kind === 'error' && (
                <p className="text-sm text-stone-600" data-testid={`${testId}-error`}>
                    {t('homeModules.load_failed')} <span className="text-xs text-stone-500">({t('homeModules.error_code')}: {state.errorId})</span>
                </p>
            )}
        </Modal>
    );
}
