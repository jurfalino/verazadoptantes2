'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveInterviewDraft } from '@/app/actions/interviews';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import type { DraftPatch } from '@/lib/interviews/validation';
import { AutosaveQueue, type AutosaveStatus, type SaveResult } from './autosaveQueue';

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
    const queue = useMemo(() => new AutosaveQueue(async (payload): Promise<SaveResult> => {
        const id = idRef.current;
        if (!id) return 'ok';
        try {
            const r = await saveFn(id, JSON.parse(payload) as DraftPatch);
            if (r.ok) return 'ok';
            return r.error === 'generic' ? 'retry' : 'fatal';
        } catch (e) {
            resolveErrorId(e, 'useInterviewAutosave.save');
            return 'retry';
        }
    }, opts.delayMs ?? 800, setStatus), [saveFn, opts.delayMs]);

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
