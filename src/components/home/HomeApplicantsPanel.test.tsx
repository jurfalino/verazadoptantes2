/**
 * The applicant panel over the home (spec 2026-11-10 «Home — Mis animales»):
 * what one read of the list leads to. An empty list means everything was
 * decided meanwhile (another tab, a teammate): the panel closes quietly and the
 * card re-reads — never «No pudimos cargar» with a made-up errorId.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ApplicantSummary } from '@/app/actions/applicants';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('@/app/actions/applicants', () => ({ getApplicantsForAnimal: vi.fn() }));
vi.mock('@/app/actions/applications', () => ({ getGeneralApplications: vi.fn() }));
vi.mock('@/components/ApplicantDetailPanel', () => ({ default: () => null }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn(() => 'err12345') }));
vi.mock('@/lib/errorMessage', () => ({ handledAsStale: (e: unknown) => e instanceof Error && e.message === 'stale deploy' }));

const { readPanel } = await import('./HomeApplicantsPanel');
const { resolveErrorId } = await import('@/lib/clientErrorReporter');

const app = (id: string, kind: ApplicantSummary['status']['kind']) =>
    ({ applicationId: id, status: kind === 'to_evaluate' ? { kind, note: null } : { kind } }) as unknown as ApplicantSummary;

describe('HomeApplicantsPanel — one read of the list', () => {
    it('an empty list (all decided meanwhile): «empty» — closes quietly, no errorId', async () => {
        expect(await readPanel(async () => [])).toEqual({ kind: 'empty' });
        expect(resolveErrorId).not.toHaveBeenCalled();
    });

    it('opens at the first one to evaluate; the decided ones stay to compare', async () => {
        const list = [app('a', 'contract_sent'), app('b', 'to_evaluate'), app('c', 'to_evaluate')];
        expect(await readPanel(async () => list)).toEqual({ kind: 'ok', list, index: 1 });
    });

    it('none left to evaluate: opens at the first', async () => {
        const list = [app('a', 'contract_sent')];
        expect(await readPanel(async () => list)).toEqual({ kind: 'ok', list, index: 0 });
    });

    it('an older tab: «stale» (the page reloads itself); any other failure: the errorId', async () => {
        expect(await readPanel(async () => { throw new Error('stale deploy'); })).toEqual({ kind: 'stale' });
        expect(await readPanel(async () => { throw new Error('boom'); })).toEqual({ kind: 'error', errorId: 'err12345' });
    });
});
