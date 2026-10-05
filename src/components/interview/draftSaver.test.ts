import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reported, stale } = vi.hoisted(() => ({ reported: [] as unknown[], stale: { calls: 0 } }));
vi.mock('@/app/actions/interviews', () => ({ saveInterviewDraft: vi.fn() }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: (e: unknown) => { reported.push(e); return 'errid001'; } }));
// The real helper raises the "new version" notice (window); here we only need its verdict.
vi.mock('@/lib/errorMessage', () => ({
    handledAsStale: (e: unknown) => { const s = e instanceof Error && e.message.includes('DEPLOYMENT_SKEW'); if (s) stale.calls++; return s; },
}));

import { draftSaver } from './useInterviewAutosave';

const payload = JSON.stringify({ answers: {}, visited: [], custom: [], leadCandidateId: null });
beforeEach(() => { reported.length = 0; stale.calls = 0; });

describe('draftSaver', () => {
    it('a stale tab is fatal and quiet: no retry loop, no error report (the notice is the message)', async () => {
        const save = vi.fn(async () => { throw new Error('DEPLOYMENT_SKEW'); });
        expect(await draftSaver(save as never, () => 'i1')(payload)).toBe('fatal');
        expect(stale.calls).toBe(1);
        expect(reported).toEqual([]);
    });
    it('a network failure is reported and retried', async () => {
        const save = vi.fn(async () => { throw new Error('Failed to fetch'); });
        expect(await draftSaver(save as never, () => 'i1')(payload)).toBe('retry');
        expect(reported).toHaveLength(1);
    });
    it('server answers: ok, generic → retry, a refusal → fatal; no id yet → nothing to save', async () => {
        expect(await draftSaver(vi.fn(async () => ({ ok: true, updatedAt: 1 })) as never, () => 'i1')(payload)).toBe('ok');
        expect(await draftSaver(vi.fn(async () => ({ ok: false, error: 'generic' })) as never, () => 'i1')(payload)).toBe('retry');
        expect(await draftSaver(vi.fn(async () => ({ ok: false, error: 'invalid' })) as never, () => 'i1')(payload)).toBe('fatal');
        const save = vi.fn();
        expect(await draftSaver(save as never, () => null)(payload)).toBe('ok');
        expect(save).not.toHaveBeenCalled();
    });
});
