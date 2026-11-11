/** Jon 2026-11-11: deleting an animal with candidates warns first — the profiles stay, the applications are lost. */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const t = (path: string): string => {
    let cur: unknown = es;
    for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'string' ? cur : path;
};
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t, locale: 'es' }) }));

const { default: AnimalDeleteWarning } = await import('./AnimalDeleteWarning');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('AnimalDeleteWarning', () => {
    it('says how many candidates are lost, singular and plural, and that the profiles stay', () => {
        const one = text(renderToStaticMarkup(<AnimalDeleteWarning animalName="Luna" count={1} />));
        expect(one).toContain('Luna tiene 1 candidato por evaluar');
        expect(one).toContain('no se borra');
        const many = text(renderToStaticMarkup(<AnimalDeleteWarning animalName="Luna" count={3} />));
        expect(many).toContain('Luna tiene 3 candidatos por evaluar');
        expect(many).toContain('no se borran');
    });
    it('says the generic variant when the count is unknown (read failed), never zero', () => {
        const html = renderToStaticMarkup(<AnimalDeleteWarning animalName="Luna" count={null} />);
        expect(text(html)).toContain('Si eliminás a Luna, sus solicitudes abiertas se pierden');
        expect(html).toContain('data-testid="delete-animal-candidates"');
    });
    it('renders nothing when there are none', () => {
        expect(renderToStaticMarkup(<AnimalDeleteWarning animalName="Luna" count={0} />)).toBe('');
    });
    it('has the keys in es, en and pt', () => {
        for (const d of [es, en, pt]) {
            const e = d.evaluation as Record<string, string>;
            expect(e.delete_animal_candidates_one).toContain('{animal}');
            expect(e.delete_animal_candidates_many).toContain('{n}');
            expect(e.delete_animal_candidates_unknown).toContain('{animal}');
        }
    });
});
