import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { ApplicantSummary } from '@/app/actions/applicants';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const { default: GeneralRequestsGroup, requestsToEvaluate } = await import('./GeneralRequestsGroup');

const req = (o: Partial<ApplicantSummary>): ApplicantSummary => ({
    applicationId: 'app-1', origin: 'form', status: { kind: 'to_evaluate', note: null }, askedAnimal: null, outcomeAnimal: null,
    submissionId: 's1', adopterId: 'p1', adopterName: 'Ana Pérez', adopterRating: null, appliedAt: Math.floor(Date.now() / 1000) - 7200,
    hasInvite: false, isSigned: false, flags: null, alertsChecked: true, housemateAlert: { lowRating: null, hasAlerts: false },
    adoptionCount: 0, requestCount: 0, intent: null, species: 'dog', lifeStage: 'puppy',
    submission: { email: null, phone: null, address: null, selfieUrl: null, photos: { protection: [], sleep: null }, latitude: null, longitude: null, household: null, answersJson: null },
    adopterContext: null, ...o,
} as ApplicantSummary);

describe('«Formularios generales» in «Pendientes de revisar» (Jon 2026-11-13)', () => {
    const list = [
        req({ applicationId: 'app-ana' }),
        req({ applicationId: 'app-martin', adopterName: 'Martín Ríos', origin: 'adopted_animal', askedAnimal: { id: 'toby', name: 'Toby', sex: 'macho' } }),
        req({ applicationId: 'app-done', adopterName: 'Lucía Gómez', status: { kind: 'proposed' } }),
    ];

    it('only the ones waiting: to evaluate, newest first', () => {
        expect(requestsToEvaluate(list).map(a => a.applicationId)).toEqual(['app-ana', 'app-martin']);
    });

    it('a form with no profile isn\'t listed nor counted — the same rule as the home card (review M7)', () => {
        expect(requestsToEvaluate([...list, req({ applicationId: 'app-sin-perfil', adopterId: null })]).map(a => a.applicationId)).toEqual(['app-ana', 'app-martin']);
    });

    it('a heading, one row per person with «Evaluar»; a request for an adopted animal says so', () => {
        const html = renderToStaticMarkup(<GeneralRequestsGroup requests={requestsToEvaluate(list)} onOpen={() => {}} t={t} locale="es" />);
        const out = text(html);
        expect(out).toContain(es.evaluation.requests_group);
        expect(out).toContain('Ana Pérez');
        expect(out).toContain('Formulario general ·');
        expect(out).toContain('Pidió a Toby (ya adoptado) ·');
        expect(out).not.toContain('Lucía Gómez');
        expect(html.split('data-testid="general-request-row"').length - 1).toBe(2);
        expect(html.split(es.evaluation.request_action).length - 1).toBe(2);
        expect(out).toContain('Prefiere:');
    });
});
