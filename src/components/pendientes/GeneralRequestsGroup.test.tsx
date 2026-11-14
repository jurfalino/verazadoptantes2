import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { GeneralRequestRow } from '@/lib/applicationCounts';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const { default: GeneralRequestsGroup } = await import('./GeneralRequestsGroup');

const req = (o: Partial<GeneralRequestRow>): GeneralRequestRow => ({
    applicationId: 'app-1', adopterId: 'p1', name: 'Ana Pérez', appliedAt: Math.floor(Date.now() / 1000) - 7200,
    species: 'dog', lifeStage: 'puppy', askedAnimal: null, ...o,
});

describe('«Formularios generales» in «Pendientes de revisar» (Jon 2026-11-13)', () => {
    const list = [
        req({ applicationId: 'app-ana' }),
        req({ applicationId: 'app-martin', name: 'Martín Ríos', askedAnimal: { name: 'Toby', sex: 'macho' } }),
    ];

    it('a heading, one row per person with «Evaluar»; a request for an adopted animal says so', () => {
        const html = renderToStaticMarkup(<GeneralRequestsGroup requests={list} onOpen={() => {}} t={t} locale="es" />);
        const out = text(html);
        expect(out).toContain(es.evaluation.requests_group);
        expect(out).toContain('Ana Pérez');
        expect(out).toContain('Formulario general ·');
        expect(out).toContain('Pidió a Toby (ya adoptado) ·');
        expect(html.split('data-testid="general-request-row"').length - 1).toBe(2);
        expect(html.split(es.evaluation.request_action).length - 1).toBe(2);
        expect(out).toContain('Prefiere:');
    });

    it('nothing waiting: no heading', () => {
        expect(renderToStaticMarkup(<GeneralRequestsGroup requests={[]} onOpen={() => {}} t={t} locale="es" />)).toBe('');
    });
});
