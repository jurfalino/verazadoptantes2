'use client';

/**
 * The applicant panel over a page, two ways (spec 2026-11-10; Jon 2026-11-13):
 * - one animal's candidates (a «Mis animales» row on the home, or its card on /my-animals — `returnLabel`:
 *   «← Volver» returns to the page), at the first one to evaluate, the rest still there to compare
 *   (panelOrder: por evaluar first), or at one application from a bell notice's deep link (`applicationId`);
 * - one general form alone (`{ request }`: «Mis adoptantes», the home's request rows, and `requestHref`).
 * Built like HomeDuePanel: after an outcome the card reloads (onChanged) and the panel moves to the next one
 * to evaluate, or closes when none is left.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import ApplicantDetailPanel from '@/components/ApplicantDetailPanel';
import { getApplicantsForAnimal, type ApplicantSummary } from '@/app/actions/applicants';
import { getGeneralApplications } from '@/app/actions/applications';
import { nextToEvaluateIndex } from '@/domain/applications';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { applicantsOrThrow, type ApplicantsLoad } from '@/lib/applicantsLoad';

export { applicantsOrThrow };

/** What the panel opens: one animal's candidates, or one general form alone (Jon 2026-11-13). */
export type HomeApplicantsTarget = { animal: { id: string; name: string; sex: string | null } }
    | { request: string };

/** A stable React key per target (a new target remounts the panel). */
export function applicantsTargetKey(target: HomeApplicantsTarget): string {
    return 'request' in target ? `request:${target.request}` : target.animal.id;
}

/**
 * What an empty read says before the panel closes: a list emptied meanwhile closes quietly (the card re-reads);
 * one request opened from a link that no longer resolves — merged away, deleted, another team's — says so
 * instead of closing without a word (review M11).
 */
export function emptyNotice(request: string | null): string | null {
    return request ? 'evaluation.request_gone' : null;
}

type Loaded = { kind: 'loading' } | { kind: 'ok'; list: ApplicantSummary[]; index: number } | { kind: 'error'; errorId: string };

/**
 * One read of the list, and what it leads to:
 * - `ok`: open at `applicationId` when it is listed (a bell notice's deep link), else at the first
 *   one to evaluate (else the first), the rest still there to compare;
 * - `empty`: everything was decided meanwhile (another tab, a teammate) — close quietly, the card re-reads;
 * - `stale`: an older tab (the page reloads itself) — close;
 * - `error`: say so, with the errorId — the server's when a loader failed (it logged it), else the client's.
 * A refusal (signed out, not the team's) is an empty list; a failure never is.
 */
export async function readPanel(read: () => Promise<ApplicantsLoad>, applicationId: string | null = null):
    Promise<{ kind: 'ok'; list: ApplicantSummary[]; index: number } | { kind: 'empty' } | { kind: 'stale' } | { kind: 'error'; errorId: string }> {
    try {
        const res = await read();
        if (!res.ok) return { kind: 'error', errorId: res.errorId };
        const list = res.applicants;
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
    const toast = useShowToast();
    const [state, setState] = useState<Loaded>({ kind: 'loading' });
    const request = 'request' in target ? target.request : null;
    const animal = 'animal' in target ? target.animal : null;
    const animalId = animal?.id ?? null;

    // A refusal reads as an empty list; a failure carries the server's errorId (ApplicantsLoad).
    // One request: read alone (the same checks as the whole list, never the team's whole history — review I4).
    const read = useCallback(async (): Promise<ApplicantsLoad> => {
        if (animalId) return getApplicantsForAnimal(animalId);
        return getGeneralApplications(request ? { applicationId: request } : undefined);
    }, [animalId, request]);

    useEffect(() => {
        let current = true;
        void readPanel(read, request ?? applicationId).then((res) => {
            if (!current) return;
            if (res.kind === 'empty') {
                const notice = emptyNotice(request);
                if (notice) toast.info(t(notice));
                onChanged(); onClose(); return;
            }
            if (res.kind === 'stale') { onClose(); return; }
            setState(res);
        });
        return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t/toast: a language change must not re-read the list
    }, [read, request, applicationId, onClose, onChanged]);

    const onOutcome = useCallback(async () => {
        onChanged();
        // A failed re-read throws with its errorId: the panel toasts it rather than closing silently.
        const fresh = applicantsOrThrow(await read(), 'HomeApplicantsPanel: re-read');
        return fresh.length > 0 ? fresh : null;
    }, [read, onChanged]);

    if (state.kind === 'ok') {
        return (
            <ApplicantDetailPanel
                testId={testId}
                returnLabel={returnLabel}
                single={!!request}
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
