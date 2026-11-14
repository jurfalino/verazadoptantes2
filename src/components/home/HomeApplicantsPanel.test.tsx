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

const { readPanel, emptyNotice } = await import('./HomeApplicantsPanel');
const { resolveErrorId } = await import('@/lib/clientErrorReporter');

const app = (id: string, kind: ApplicantSummary['status']['kind']) =>
    ({ applicationId: id, status: kind === 'to_evaluate' ? { kind, note: null } : { kind } }) as unknown as ApplicantSummary;

describe('HomeApplicantsPanel — one read of the list', () => {
    it('an empty list (all decided meanwhile): «empty» — closes quietly, no errorId', async () => {
        expect(await readPanel(async () => ({ ok: true, applicants: [] }))).toEqual({ kind: 'empty' });
        expect(resolveErrorId).not.toHaveBeenCalled();
    });

    it('opens at the first one to evaluate; the decided ones stay to compare', async () => {
        const list = [app('a', 'contract_sent'), app('b', 'to_evaluate'), app('c', 'to_evaluate')];
        expect(await readPanel(async () => ({ ok: true, applicants: list }))).toEqual({ kind: 'ok', list, index: 1 });
    });

    it('none left to evaluate: opens at the first', async () => {
        const list = [app('a', 'contract_sent')];
        expect(await readPanel(async () => ({ ok: true, applicants: list }))).toEqual({ kind: 'ok', list, index: 0 });
    });

    it('a deep link (a bell notice) opens at that application, decided or not; gone → the first to evaluate', async () => {
        const list = [app('a', 'to_evaluate'), app('b', 'declined'), app('c', 'to_evaluate')];
        expect(await readPanel(async () => ({ ok: true, applicants: list }), 'c')).toEqual({ kind: 'ok', list, index: 2 });
        expect(await readPanel(async () => ({ ok: true, applicants: list }), 'b')).toEqual({ kind: 'ok', list, index: 1 });
        expect(await readPanel(async () => ({ ok: true, applicants: list }), 'gone')).toEqual({ kind: 'ok', list, index: 0 });
    });

    it('a loader failure (D1 down): «error» with the SERVER\'s errorId — never a silent close (final review M7)', async () => {
        vi.mocked(resolveErrorId).mockClear();
        expect(await readPanel(async () => ({ ok: false, errorId: 'abcd1234' }))).toEqual({ kind: 'error', errorId: 'abcd1234' });
        expect(resolveErrorId).not.toHaveBeenCalled();
    });

    it('after an outcome, a failed re-read throws with the errorId (the panel toasts it) instead of closing silently', async () => {
        const { applicantsOrThrow } = await import('./HomeApplicantsPanel');
        expect(applicantsOrThrow({ ok: true, applicants: [] }, 'x')).toEqual([]);
        expect(() => applicantsOrThrow({ ok: false, errorId: 'abcd1234' }, 'getApplicantsForAnimal')).toThrow('(Error ID: abcd1234)');
    });

    it('an older tab: «stale» (the page reloads itself); any other failure: the errorId', async () => {
        expect(await readPanel(async () => { throw new Error('stale deploy'); })).toEqual({ kind: 'stale' });
        expect(await readPanel(async () => { throw new Error('boom'); })).toEqual({ kind: 'error', errorId: 'err12345' });
    });
});

describe('a request link that no longer resolves (review M11)', () => {
    it('one request opened alone and gone: says so; a list emptied meanwhile still closes quietly', () => {
        expect(emptyNotice('app-1')).toBe('evaluation.request_gone');
        expect(emptyNotice(null)).toBeNull();
    });
});
