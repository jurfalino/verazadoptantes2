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
import type { HomeAdoptersData, HomeAnimalsData, HomePendingItem } from '@/types/homeModules';

vi.mock('@/app/actions/homeModules', () => ({ getHomeModules: vi.fn() }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('./HomeDuePanel', () => ({ default: () => null }));
vi.mock('@/components/PendingDedup', () => ({ default: () => null }));

import { AdoptersCard, AnimalsCard } from './HomeModules';

const get = (dict: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((cur, k) => (cur as Record<string, unknown> | undefined)?.[k], dict);
const t = (path: string): string => {
    const v = get(es, path);
    return typeof v === 'string' ? v : path;
};
const rel = () => 'hace 1 día';

const adopters = (pendingReview: number): HomeAdoptersData => ({ total: 4, pendingReview, pending: [], recent: [] });
const animals = (dueCount: number): HomeAnimalsData => ({ available: 1, adopted: 2, total: 3, dueCount, rows: [] });

/** A string as a literal inside a RegExp: every metacharacter escaped, backslash included (CodeQL js/incomplete-sanitization). */
const reLiteral = (v: string) => v.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
/** Every <a …> opening tag whose href is `href`. */
const linksTo = (html: string, href: string) => html.match(new RegExp(`<a[^>]*href="${reLiteral(href)}"[^>]*>`, 'g')) ?? [];
/** The markup of the anchor carrying data-testid=`id`, up to its closing tag. */
const anchor = (html: string, id: string) => html.match(new RegExp(`<a[^>]*data-testid="${reLiteral(id)}"[^>]*>[\\s\\S]*?</a>`))?.[0] ?? '';
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
    const people = (pendingReview: number, total = 10): HomeAdoptersData => ({ total, pendingReview, pending: [], recent: [1, 2, 3, 4].map(person) });
    const renderAdopters = (data: HomeAdoptersData, contacts: ReactNode = null) =>
        renderToStaticMarkup(<AdoptersCard section={{ ok: true, data }} contacts={contacts} t={t} rel={rel} />);
    const n = (html: string, id: string) => (html.match(new RegExp(`data-testid="${id}"`, 'g')) ?? []).length;

    it('nothing pending, no import link: 4 people', () => {
        expect(n(renderAdopters(people(0)), 'home-person-row')).toBe(4);
    });

    it('pending review the feed could not list: the «N más» amber row takes a slot — amber + 3 people', () => {
        const html = renderAdopters(people(5));
        expect(n(html, 'home-adopters-pending-more')).toBe(1);
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

describe('Mis adoptantes — each row that waits on you is its own row, like Mis animales\' due animals (Jon 2026-11-09, option b)', () => {
    const item = (i: number, over: Partial<HomePendingItem> = {}): HomePendingItem => ({
        group: 'pair', names: [`Ana ${i}`, `Ana G. ${i}`], ids: [`n${i}`, `e${i}`], by: null,
        summary: { same: ['phone', 'email'], diff: [], flagged: false }, ...over,
    });
    const person = (i: number) => ({ id: `p${i}`, name: `Persona ${i}`, thumbnail: null, avgRating: null, createdAt: 0, viaForm: false, creatorIsSelf: true, creatorName: null, groupName: null });
    const data = (items: HomePendingItem[], n: number): HomeAdoptersData => ({ total: 10, pendingReview: n, pending: items, recent: [1, 2, 3, 4].map(person) });
    const render = (d: HomeAdoptersData) =>
        renderToStaticMarkup(<AdoptersCard section={{ ok: true, data: d }} contacts={null} t={t} rel={rel} onOpenPending={() => {}} />);
    const rows = (html: string) => html.match(/<button[^>]*data-testid="home-adopters-pending"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const n = (html: string, id: string) => (html.match(new RegExp(`data-testid="${id}"`, 'g')) ?? []).length;

    it('one waiting: its row, then the 3 newest people', () => {
        const html = render(data([item(1)], 1));
        expect(rows(html)).toHaveLength(1);
        expect(n(html, 'home-person-row')).toBe(3);
        expect(n(html, 'home-adopters-pending-more')).toBe(0);
    });

    it('65 waiting: 3 rows + «62 más esperan tu respuesta», no people — as with 4+ due animals', () => {
        const html = render(data([1, 2, 3, 4].map(i => item(i)), 65));
        expect(rows(html)).toHaveLength(3);
        expect(n(html, 'home-person-row')).toBe(0);
        expect(text(html.match(/<a[^>]*data-testid="home-adopters-pending-more"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '')).toBe('62 más esperan tu respuesta');
    });

    it('a duplicate reads like the row in Mis adoptantes: names over «¿Es la misma persona? · Coinciden: …»', () => {
        const row = (rows(render(data([item(1)], 1)))[0] ?? '');
        expect(text(row)).toBe('Ana 1 / Ana G. 1 ¿Es la misma persona? · Coinciden: teléfono, email');
        expect(row).toContain('aria-haspopup="dialog"');
        expect(row).toContain('md:h-14');
    });

    it('a request: «María te pide unir»; your request declined: «Lucía no aceptó unir»; the same name twice: «×2»', () => {
        expect(text((rows(render(data([item(1, { group: 'received', by: 'María' })], 1)))[0] ?? ''))).toBe('Ana 1 / Ana G. 1 María te pide unir');
        expect(text((rows(render(data([item(1, { group: 'declined', by: 'Lucía' })], 1)))[0] ?? ''))).toBe('Ana 1 / Ana G. 1 Lucía no aceptó unir');
        expect(text(rows(render(data([item(1, { names: ['Luz', 'Luz '] })], 1)))[0] ?? '')).toContain('Luz ×2');
    });
});
