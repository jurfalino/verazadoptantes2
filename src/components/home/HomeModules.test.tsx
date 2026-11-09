/**
 * Home cards «Mis adoptantes» / «Mis animales»: the create action is a
 * «+ Agregar» button next to the title, in every state (Jon 2026-11-09,
 * option E of https://claude.ai/artifact/EWSws3f98TZFN1LJvhjMnT). Before, the
 * bottom create button hid whenever the card had something pending, so a busy
 * rescuer had no way to add from the home.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';
import type { HomeAdoptersData, HomeAnimalsData } from '@/types/homeModules';

vi.mock('@/app/actions/homeModules', () => ({ getHomeModules: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));

import { AdoptersCard, AnimalsCard } from './HomeModules';

const get = (dict: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((cur, k) => (cur as Record<string, unknown> | undefined)?.[k], dict);
const t = (path: string): string => {
    const v = get(es, path);
    return typeof v === 'string' ? v : path;
};
const rel = () => 'hace 1 día';

const adopters = (pendingReview: number): HomeAdoptersData => ({ total: 4, pendingReview, recent: [] });
const animals = (dueCount: number): HomeAnimalsData => ({ available: 1, adopted: 2, total: 3, dueCount, rows: [] });

/** Every <a …> opening tag whose href is `href`. */
const linksTo = (html: string, href: string) => html.match(new RegExp(`<a[^>]*href="${href.replace(/[/?]/g, '\\$&')}"[^>]*>`, 'g')) ?? [];
/** The markup of the anchor carrying data-testid=`id`, up to its closing tag. */
const anchor = (html: string, id: string) => html.match(new RegExp(`<a[^>]*data-testid="${id}"[^>]*>[\\s\\S]*?</a>`))?.[0] ?? '';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('Mis adoptantes card — «+ Agregar» next to the title', () => {
    for (const pending of [0, 2]) {
        it(`${pending ? 'with' : 'without'} profiles pending review: one create link, the header button, labelled «Agregar»`, () => {
            const html = renderToStaticMarkup(<AdoptersCard section={{ ok: true, data: adopters(pending) }} contacts={null} t={t} rel={rel} />);
            expect(linksTo(html, '/adopter/create')).toHaveLength(1);
            const add = anchor(html, 'home-adopters-add');
            expect(add).toContain('href="/adopter/create"');
            expect(text(add)).toBe('Agregar');
            expect(add).toContain('aria-label="Agregar adoptante"');
        });
    }

    it('the add button sits beside the title link, never inside it (no nested links)', () => {
        const html = renderToStaticMarkup(<AdoptersCard section={{ ok: true, data: adopters(0) }} contacts={null} t={t} rel={rel} />);
        expect(anchor(html, 'home-adopters-header')).toContain('href="/my-adopters"');
        expect(anchor(html, 'home-adopters-header')).not.toContain('/adopter/create');
    });

    it('«o importá desde tus contactos» still shows at the bottom when nothing is pending', () => {
        const html = renderToStaticMarkup(<AdoptersCard section={{ ok: true, data: adopters(0) }} contacts={<span data-testid="contacts-slot" />} t={t} rel={rel} />);
        expect(html).toContain('data-testid="contacts-slot"');
    });

    it('a card that failed to load offers no add button (its error is the whole card)', () => {
        const html = renderToStaticMarkup(<AdoptersCard section={{ ok: false, errorId: 'abcd1234' }} contacts={null} t={t} rel={rel} />);
        expect(linksTo(html, '/adopter/create')).toHaveLength(0);
    });
});

describe('Mis animales card — «+ Agregar» next to the title', () => {
    for (const due of [0, 1]) {
        it(`${due ? 'with' : 'without'} a check-up due: one create link, the header button, labelled «Agregar»`, () => {
            const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data: animals(due) }} t={t} />);
            expect(linksTo(html, '/my-animals/new')).toHaveLength(1);
            const add = anchor(html, 'home-animals-add');
            expect(add).toContain('href="/my-animals/new"');
            expect(text(add)).toBe('Agregar');
            expect(add).toContain('aria-label="Agregar animal"');
        });
    }
});

describe('the list pages use the same sentence-case words', () => {
    it.each([
        ['es', es, '+ Agregar adoptante', 'Agregar animal', 'Agregar'],
        ['en', en, '+ Add adopter', 'Add animal', 'Add'],
        ['pt', pt, '+ Adicionar adotante', 'Adicionar animal', 'Adicionar'],
    ])('%s', (_l, dict, adopter, animal, add) => {
        expect(get(dict, 'dashboard.add_new_adopter')).toBe(adopter);
        expect(get(dict, 'dashboard.add_animal')).toBe(animal);
        expect(get(dict, 'homeModules.add')).toBe(add);
    });
});
