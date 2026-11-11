import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import type { ApplicationStatus } from '@/domain/applications';

const tFor = (dict: Record<string, unknown>) => (path: string): string => {
    let cur: unknown = dict;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
const t = tFor(es as unknown as Record<string, unknown>);
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));
vi.mock('@/context/TimezoneContext', () => ({ useDateFormat: () => ({ formatShortDate: () => '10 nov' }) }));

const { ApplicationOutcomeLine } = await import('./ApplicationStatusLine');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const LUNA = { name: 'Luna', sex: 'hembra' };
const render = (status: ApplicationStatus, animal: typeof LUNA | null = LUNA, outcomeAnimal: typeof LUNA | null = null) =>
    renderToStaticMarkup(<ApplicationOutcomeLine outcome={{ status, animal, outcomeAnimal }} />);

describe('ApplicationOutcomeLine (a «Solicitud» on the profile)', () => {
    it('closed, adopted by someone else', () => {
        const html = render({ kind: 'closed', reason: 'adopted_other' });
        expect(html).toContain('data-testid="record-outcome-line"');
        expect(text(html)).toBe('Cerrada: Luna fue adoptada por otra persona');
    });
    it('closed through the open link', () => {
        expect(text(render({ kind: 'closed', reason: 'adopted_open_link' }))).toBe('Cerrada: Luna fue adoptada');
    });
    it('declined shows the date, no rating', () => {
        expect(text(render({ kind: 'declined', at: 1 }))).toBe('No avanzó · 10 nov');
    });
    it('proposed / replaced / also applied / adopted', () => {
        expect(text(render({ kind: 'proposed' }, null, LUNA))).toBe('Propuesta para Luna');
        expect(text(render({ kind: 'replaced' }))).toBe('Reemplazada por un formulario más nuevo');
        expect(text(render({ kind: 'also_applied' }, null, LUNA))).toBe('También pidió a Luna');
        expect(text(render({ kind: 'adopted' }))).toBe('Adoptó a Luna');
    });
    it('an unseen animal reads «Sin nombre», never another team\'s name', () => {
        expect(text(render({ kind: 'closed', reason: 'adopted_other' }, null))).toContain('Sin nombre');
    });
    it('still open: no line', () => {
        expect(render({ kind: 'to_evaluate', note: null })).toBe('');
    });
});
