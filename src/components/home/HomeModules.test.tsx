/**
 * Home cards «Mis adoptantes» / «Mis animales»: the create action is a
 * «+ Agregar» button next to the title, in every state (Jon 2026-11-09,
 * option E of https://claude.ai/artifact/EWSws3f98TZFN1LJvhjMnT). Before, the
 * bottom create button hid whenever the card had something pending, so a busy
 * rescuer had no way to add from the home.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';
import type { HomeAdoptersData, HomeAnimalsData } from '@/types/homeModules';

vi.mock('@/app/actions/homeModules', () => ({ getHomeModules: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('./HomeDuePanel', () => ({ default: () => null }));

import { AdoptersCard, AnimalsCard } from './HomeModules';

const get = (dict: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((cur, k) => (cur as Record<string, unknown> | undefined)?.[k], dict);
const t = (path: string): string => {
    const v = get(es, path);
    return typeof v === 'string' ? v : path;
};
const rel = () => 'hace 1 día';

const adopters = (pendingReview: number): HomeAdoptersData => ({ total: 4, pendingReview, firstPending: null, recent: [] });
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

    it('the import link still shows at the bottom when nothing is pending', () => {
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

describe('Mis animales summary — breaks only after «·»', () => {
    it('«5 disponibles · 278 adoptados» keeps each count with its word', () => {
        const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data: { ...animals(0), available: 5, adopted: 278 } }} t={t} />);
        const summary = html.match(/data-testid="home-animals-summary"[^>]*>([^<]*)</)?.[1];
        expect(summary).toBe('5\u00a0disponibles\u00a0· 278\u00a0adoptados');
    });
});

describe('the import link stands on its own now that no button sits above it (Jon 2026-11-09)', () => {
    it.each([
        ['es', es, 'Importar desde tus contactos'],
        ['en', en, 'Import from your contacts'],
        ['pt', pt, 'Importar dos seus contatos'],
    ])('%s', (_l, dict, label) => {
        expect(get(dict, 'homeModules.import_contacts')).toBe(label);
    });
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

describe('Mis adoptantes / Mis animales — same 4 slots, so side by side they are the same height (Jon 2026-11-09, options 1 + 4)', () => {
    const person = (i: number) => ({
        id: `p${i}`, name: `Persona ${i}`, thumbnail: null, avgRating: null,
        createdAt: 0, viaForm: false, creatorIsSelf: true, creatorName: null, groupName: null,
    });
    const people = (pendingReview: number, total = 10): HomeAdoptersData => ({ total, pendingReview, firstPending: null, recent: [1, 2, 3, 4].map(person) });
    const renderAdopters = (data: HomeAdoptersData, contacts: ReactNode = null) =>
        renderToStaticMarkup(<AdoptersCard section={{ ok: true, data }} contacts={contacts} t={t} rel={rel} />);
    const n = (html: string, id: string) => (html.match(new RegExp(`data-testid="${id}"`, 'g')) ?? []).length;

    it('nothing pending, no import link: 4 people', () => {
        expect(n(renderAdopters(people(0)), 'home-person-row')).toBe(4);
    });

    it('pending review: the amber row takes a slot — amber + 3 people', () => {
        const html = renderAdopters(people(5));
        expect(n(html, 'home-adopters-pending')).toBe(1);
        expect(n(html, 'home-person-row')).toBe(3);
    });

    it('import link shown: it takes a slot — 3 people + the link', () => {
        const html = renderAdopters(people(0), <span data-testid="contacts-slot" />);
        expect(n(html, 'home-person-row')).toBe(3);
        expect(n(html, 'contacts-slot')).toBe(1);
    });

    it('«Ver los N» only when people are left out', () => {
        expect(n(renderAdopters(people(0, 4)), 'home-adopters-more')).toBe(0);
        expect(n(renderAdopters(people(5, 4)), 'home-adopters-more')).toBe(1);
    });

    it('every person and animal row is one 56px slot on desktop', () => {
        const animal = (id: string): HomeAnimalsData['rows'][number] => ({
            id, name: id, photo: null, species: 'cat', status: 'available', personName: null, applicants: 0, due: null,
        } as HomeAnimalsData['rows'][number]);
        const animalsHtml = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data: { ...animals(0), total: 9, rows: ['a', 'b', 'c', 'd'].map(animal) } }} t={t} />);
        expect(n(animalsHtml, 'home-animal-row')).toBe(4);
        for (const html of [renderAdopters(people(0)), animalsHtml]) {
            const rows = html.match(/<a[^>]*data-testid="home-(person|animal)-row"[^>]*>/g) ?? [];
            expect(rows.length).toBe(4);
            for (const r of rows) expect(r).toContain('md:h-14');
        }
    });
});

describe('Mis animales — an animal with a check-up due opens «Para hacer ahora» over the home (Jon 2026-11-09, option C)', () => {
    const dueAnimal = {
        id: 'luna', name: 'Luna', photo: null, species: 'cat', status: 'adopted', personName: 'Ana', applicants: 0,
        due: { dueFollowups: 1, dueTop: { copyKey: 'checkin_6m', dueDate: Date.now() - 86400000 } },
    } as HomeAnimalsData['rows'][number];
    const data: HomeAnimalsData = { ...animals(1), rows: [dueAnimal] };

    it('with the panel available, the row is a button that opens a dialog — not a link to the animal page', () => {
        const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data }} t={t} onOpenDue={() => {}} />);
        const row = html.match(/<button[^>]*data-testid="home-animals-due"[^>]*>/)?.[0] ?? '';
        expect(row).toContain('aria-haspopup="dialog"');
        expect(row).toContain('md:h-14');
        expect(html).not.toContain('#next-action');
    });

    it('the row reads the same as before: name and the amber check-up line', () => {
        const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data }} t={t} onOpenDue={() => {}} />);
        const row = html.match(/<button[^>]*data-testid="home-animals-due"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
        expect(text(row)).toContain('Luna');
        expect(row).toContain('text-amber-700');
    });

    it('without it, the row still goes to the animal\'s «Para hacer ahora»', () => {
        const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data }} t={t} />);
        expect(anchor(html, 'home-animals-due')).toContain('href="/my-animals/luna#next-action"');
    });

    it('rows with nothing due stay links to the animal page', () => {
        const calm = { ...dueAnimal, id: 'sol', name: 'Sol', due: null } as HomeAnimalsData['rows'][number];
        const html = renderToStaticMarkup(<AnimalsCard section={{ ok: true, data: { ...data, rows: [dueAnimal, calm] } }} t={t} onOpenDue={() => {}} />);
        expect(anchor(html, 'home-animal-row')).toContain('href="/my-animals/sol"');
    });
});

describe('Mis adoptantes — the amber row names the first row that waits on you, and opens it over the home (Jon 2026-11-09, option A)', () => {
    const withFirst = (first: HomeAdoptersData['firstPending'], n = 65): HomeAdoptersData => ({ total: 10, pendingReview: n, firstPending: first, recent: [] });
    const render = (d: HomeAdoptersData, onOpenPending?: () => void) =>
        renderToStaticMarkup(<AdoptersCard section={{ ok: true, data: d }} contacts={null} t={t} rel={rel} onOpenPending={onOpenPending} />);
    const row = (html: string) => html.match(/<button[^>]*data-testid="home-adopters-pending"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

    it('a possible duplicate: «¿Es la misma persona? · 1 de N» over the two names, as «Pendientes de revisar» writes them', () => {
        const html = render(withFirst({ group: 'pair', names: ['Ana Gómez', 'Ana G. Gómez'], by: null }), () => {});
        expect(text(row(html))).toBe('¿Es la misma persona? · 1 de 65 Ana Gómez / Ana G. Gómez');
        expect(row(html)).toContain('aria-haspopup="dialog"');
        expect(html).not.toContain('href="/my-adopters#pendientes"');
    });

    it('a request from a teammate: «María te pide unir»', () => {
        expect(text(row(render(withFirst({ group: 'received', names: ['Marcos Díaz', 'Marcos A. Díaz'], by: 'María' }, 2), () => {}))))
            .toBe('María te pide unir · 1 de 2 Marcos Díaz / Marcos A. Díaz');
    });

    it('the same name twice reads «×2», as on the row it opens', () => {
        expect(text(row(render(withFirst({ group: 'pair', names: ['Luz', 'Luz '], by: null }), () => {})))).toContain('Luz ×2');
    });

    it('still one 44px slot on desktop', () => {
        expect(row(render(withFirst({ group: 'pair', names: ['A', 'B'], by: null }), () => {}))).toContain('md:h-11');
    });

    it('without the panel (or the first row unknown), the count links to the list, as before', () => {
        expect(anchor(render(withFirst(null)), 'home-adopters-pending')).toContain('href="/my-adopters#pendientes"');
        expect(anchor(render(withFirst({ group: 'pair', names: ['A', 'B'], by: null })), 'home-adopters-pending')).toContain('href="/my-adopters#pendientes"');
    });
});
