'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveInterviewDraft } from '@/app/actions/interviews';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import type { DraftPatch } from '@/lib/interviews/validation';
import { AutosaveQueue, type AutosaveStatus, type SaveResult } from './autosaveQueue';

/**
 * One autosave attempt as the queue sees it. A tab older than the running
 * deployment can never save until it reloads: that is 'fatal' (no retry
 * loop), and StaleDeployWatcher's "new version" notice is the message —
 * no error report per retry.
 */
export function draftSaver(saveFn: typeof saveInterviewDraft, getId: () => string | null) {
    return async (payload: string): Promise<SaveResult> => {
        const id = getId();
        if (!id) return 'ok';
        try {
            const r = await saveFn(id, JSON.parse(payload) as DraftPatch);
            if (r.ok) return 'ok';
            return r.error === 'generic' ? 'retry' : 'fatal';
        } catch (e) {
            if (handledAsStale(e)) return 'fatal';
            resolveErrorId(e, 'useInterviewAutosave.save');
            return 'retry';
        }
    };
}

export function useInterviewAutosave(opts: {
    interviewId: string | null;
    payload: DraftPatch;
    enabled: boolean;
    save?: typeof saveInterviewDraft;
    delayMs?: number;
}): { status: AutosaveStatus; flush: () => Promise<boolean> } {
    const [status, setStatus] = useState<AutosaveStatus>('idle');
    const idRef = useRef(opts.interviewId);
    idRef.current = opts.interviewId;
    const saveFn = opts.save ?? saveInterviewDraft;
    const queue = useMemo(() => new AutosaveQueue(draftSaver(saveFn, () => idRef.current), opts.delayMs ?? 800, setStatus), [saveFn, opts.delayMs]);

    const serialized = JSON.stringify(opts.payload);
    useEffect(() => { if (opts.enabled && opts.interviewId) queue.schedule(serialized); }, [serialized, opts.enabled, opts.interviewId, queue]);
    useEffect(() => () => queue.dispose(), [queue]);
    // Leaving the tab or closing it: best-effort flush.
    useEffect(() => {
        const onHide = () => { void queue.flush(); };
        const onVisibility = () => { if (document.visibilityState === 'hidden') void queue.flush(); };
        window.addEventListener('pagehide', onHide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onVisibility); };
    }, [queue]);

    // Stable identity: InterviewApp's flush-on-Next effect depends on it.
    const flush = useCallback(() => queue.flush(), [queue]);
    return { status, flush };
}
