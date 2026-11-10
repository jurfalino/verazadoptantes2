import { describe, it, expect } from 'vitest';
import {
    appliedCount, DEFAULT_PINS, matches, nameMatches, PIN_MAX, ratingLevel, sanitizePins, searchFromView, sortRows,
    viewFromSearch, type FilterKey, type ListRow,
} from './adopterListView';

const row = (over: Partial<ListRow> & { id?: string } = {}): ListRow & { id: string } => ({
    id: 'x', name: 'Ana', createdAt: 100, avgRating: null, source: 'manual', formCount: 0, fromPost: false, housemateChip: false, latestFormAt: null, ...over,
});
const sel = (...k: FilterKey[]) => new Set<FilterKey>(k);

describe('ratingLevel — the pill\'s word', () => {
    it('rounds like the pill: 2.49 → 2, 2.5 → 3; outside 1–5 is «Sin calificación»', () => {
        expect(ratingLevel(2.49)).toBe(2);
        expect(ratingLevel(2.5)).toBe(3);
        expect(ratingLevel(1)).toBe(1);
        expect(ratingLevel(null)).toBeNull();
        expect(ratingLevel(0)).toBeNull();
    });
});

describe('matches — OR within a group, AND across groups', () => {
    it('nothing selected: everyone', () => expect(matches(sel(), row())).toBe(true));
    it('formulario OR post', () => {
        expect(matches(sel('src:form', 'src:post'), row({ fromPost: true }))).toBe(true);
        expect(matches(sel('src:form', 'src:post'), row({ formCount: 2 }))).toBe(true);
        expect(matches(sel('src:form', 'src:post'), row())).toBe(false);
    });
    it('formulario AND 1★', () => {
        expect(matches(sel('src:form', 'rating:1'), row({ formCount: 1, avgRating: 1 }))).toBe(true);
        expect(matches(sel('src:form', 'rating:1'), row({ formCount: 1, avgRating: 3 }))).toBe(false);
    });
    it('«Sin calificar», imported, by hand, housemate alert', () => {
        expect(matches(sel('rating:none'), row({ avgRating: null }))).toBe(true);
        expect(matches(sel('src:imported'), row({ source: 'imported' }))).toBe(true);
        expect(matches(sel('src:manual'), row({ source: 'imported' }))).toBe(false);
        expect(matches(sel('src:api'), row({ source: 'api' }))).toBe(true);
        expect(matches(sel('src:contract'), row({ source: 'contract' }))).toBe(true);
        expect(matches(sel('src:api', 'src:contract'), row({ source: 'manual' }))).toBe(false);
        expect(matches(sel('alert:housemate'), row({ housemateChip: true }))).toBe(true);
    });
});

describe('nameMatches', () => {
    it('every word, any order, no accents or case', () => {
        expect(nameMatches('perez ana', 'Ana Pérez')).toBe(true);
        expect(nameMatches('ana gomez', 'Ana Pérez')).toBe(false);
        expect(nameMatches('  ', 'x')).toBe(true);
    });
});

describe('sortRows', () => {
    const rows = [row({ id: 'a', name: 'Bea', createdAt: 300, avgRating: 3 }), row({ id: 'b', name: 'ana', createdAt: 100, avgRating: null }), row({ id: 'c', name: 'Carla', createdAt: 200, avgRating: 1 })];
    const ids = (r: Array<{ id: string }>) => r.map(x => x.id);
    it('newest first by default; oldest; name A–Z / Z–A (no case)', () => {
        expect(ids(sortRows(rows, 'new', sel()))).toEqual(['a', 'c', 'b']);
        expect(ids(sortRows(rows, 'old', sel()))).toEqual(['b', 'c', 'a']);
        expect(ids(sortRows(rows, 'name', sel()))).toEqual(['b', 'a', 'c']);
        expect(ids(sortRows(rows, 'name_desc', sel()))).toEqual(['c', 'a', 'b']);
    });
    it('by rating, the unrated always last', () => {
        expect(ids(sortRows(rows, 'worst', sel()))).toEqual(['c', 'a', 'b']);
        expect(ids(sortRows(rows, 'best', sel()))).toEqual(['a', 'c', 'b']);
    });
    it('«Por formulario» alone, default order: newest form first (as the tab did)', () => {
        const f = [row({ id: 'old-form', createdAt: 900, formCount: 1, latestFormAt: 10 }), row({ id: 'new-form', createdAt: 1, formCount: 1, latestFormAt: 50 })];
        expect(ids(sortRows(f, 'new', sel('src:form')))).toEqual(['new-form', 'old-form']);
    });
    it('nameless profiles stay last both ways; «Por formulario» alone reverses by form date', () => {
        const n = [row({ id: 'none', name: '' }), row({ id: 'b', name: 'Bea' }), row({ id: 'a', name: 'Ana' })];
        expect(ids(sortRows(n, 'name', sel()))).toEqual(['a', 'b', 'none']);
        expect(ids(sortRows(n, 'name_desc', sel()))).toEqual(['b', 'a', 'none']);
        const f = [row({ id: 'x', createdAt: 1, formCount: 1, latestFormAt: 50 }), row({ id: 'y', createdAt: 900, formCount: 1, latestFormAt: 10 })];
        expect(ids(sortRows(f, 'old', sel('src:form')))).toEqual(['y', 'x']);
    });

    it('ISO strings and Dates sort like numbers (the API sends strings)', () => {
        const d = [row({ id: 's', createdAt: '2026-01-01T00:00:00Z' }), row({ id: 'n', createdAt: new Date('2026-06-01T00:00:00Z') })];
        expect(ids(sortRows(d, 'new', sel()))).toEqual(['n', 's']);
    });
});

describe('sanitizePins', () => {
    it('defaults: today\'s two tabs', () => expect(sanitizePins(null)).toEqual(DEFAULT_PINS));
    it('known keys only, no repeats, at most 4, in order', () => {
        expect(sanitizePins(['rating:1', 'nope', 'rating:1', 'src:form', 'src:post', 'alert:housemate', 'rating:5'])).toEqual(['rating:1', 'src:form', 'src:post', 'alert:housemate']);
        expect(PIN_MAX).toBe(4);
    });
    it('an empty list stays empty (someone unpinned everything)', () => expect(sanitizePins([])).toEqual([]));
});

describe('URL', () => {
    it('every source has a filter: a profile of each kind is caught by exactly one «Procedencia» option (or «Por formulario»)', async () => {
        const { FILTER_KEYS, holds } = await import('./adopterListView');
        const src = FILTER_KEYS.filter(k => k.startsWith('src:') && k !== 'src:post');
        for (const source of ['manual', 'imported', 'api', 'contract']) {
            expect(src.filter(k => holds(k, row({ source }))).length).toBe(1);
        }
        expect(holds('src:form', row({ source: 'form', formCount: 1 }))).toBe(true);
    });

    it('the old tab links still open the same view', () => {
        expect([...viewFromSearch('?filtro=posts').selected]).toEqual(['src:post']);
        expect([...viewFromSearch('?filtro=formularios').selected]).toEqual(['src:form']);
    });
    it('round-trips the whole view', () => {
        const v = { selected: sel('src:form', 'rating:1', 'rating:none', 'alert:housemate'), sort: 'worst' as const, q: 'ana' };
        const s = searchFromView(v);
        expect(s).toBe('?filtro=formularios&calificacion=1,sin&alerta=conviviente&orden=peor&q=ana');
        const back = viewFromSearch(s);
        expect([...back.selected].sort()).toEqual([...v.selected].sort());
        expect(back.sort).toBe('worst');
        expect(back.q).toBe('ana');
    });
    it('nothing applied, default order: a bare URL; garbage is ignored', () => {
        expect(searchFromView({ selected: sel(), sort: 'new', q: '' })).toBe('');
        expect(viewFromSearch('?orden=zzz&calificacion=9').sort).toBe('new');
        expect(viewFromSearch('?orden=zzz&calificacion=9').selected.size).toBe(0);
    });
    it('appliedCount: filters + the search; never the order', () => {
        expect(appliedCount({ selected: sel('rating:1'), sort: 'best', q: ' x ' })).toBe(2);
        expect(appliedCount({ selected: sel(), sort: 'best', q: '' })).toBe(0);
    });
});
