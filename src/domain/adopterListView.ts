/**
 * Mis adoptantes — how the list is filtered, sorted and written in the URL
 * (Jon 2026-11-10, option E of the my-adopters-sort-filter prototype):
 *
 * - Every filter lives in ONE place, the «Filtros» panel; a person can pin up
 *   to PIN_MAX of them onto the main screen as quick buttons. Today's two tabs
 *   («Por formulario», «Desde un post») are the default pins.
 * - Within a group the choices widen the list (formulario OR post); across
 *   groups they narrow it (formulario AND 1★).
 * - Sorting: the column headers on a computer, a menu on a phone; same options.
 * - The URL carries the whole view, so Back, shared links and the homepage
 *   cards («?filtro=posts») open it as they left it.
 *
 * Pure: the page fetches, these decide.
 */
export type FilterGroup = 'src' | 'rating' | 'alert';

export type FilterKey =
    | 'src:form' | 'src:post' | 'src:imported' | 'src:api' | 'src:contract' | 'src:manual'
    | 'rating:1' | 'rating:2' | 'rating:3' | 'rating:4' | 'rating:5' | 'rating:none'
    | 'alert:housemate';

/** In the panel's order: Procedencia, Calificación, Alertas. */
export const FILTER_KEYS: readonly FilterKey[] = [
    // Every way a profile arrives (adopters.source: manual | imported | api | contract | form — the
    // last one is inside «Por formulario», which also counts forms joined to an existing profile).
    'src:form', 'src:post', 'src:imported', 'src:api', 'src:contract', 'src:manual',
    'rating:1', 'rating:2', 'rating:3', 'rating:4', 'rating:5', 'rating:none',
    'alert:housemate',
];

export const PIN_MAX = 4;
/** Today's two tabs, so nothing a person used disappears from the screen. */
export const DEFAULT_PINS: readonly FilterKey[] = ['src:form', 'src:post'];

export const groupOf = (k: FilterKey): FilterGroup => k.slice(0, k.indexOf(':')) as FilterGroup;

const isFilterKey = (v: unknown): v is FilterKey => typeof v === 'string' && (FILTER_KEYS as readonly string[]).includes(v);

/** Pins as stored or sent: known keys only, no repeats, at most PIN_MAX, in the order given. Null/garbage → the defaults. */
export function sanitizePins(input: unknown): FilterKey[] {
    if (!Array.isArray(input)) return [...DEFAULT_PINS];
    const out: FilterKey[] = [];
    for (const v of input) if (isFilterKey(v) && !out.includes(v) && out.length < PIN_MAX) out.push(v);
    return out;
}

/** What the list needs from a row. */
export interface ListRow {
    name: string | null;
    createdAt: number | string | Date | null;
    avgRating: number | null;
    source?: string | null;
    formCount?: number;
    fromPost?: boolean;
    /** «Conviviente con …» shows on the row (MyAdoptersFlagBadges hasHousemateChip). */
    housemateChip?: boolean;
    /** Newest form, epoch seconds — «Por formulario» lists newest form first by default. */
    latestFormAt?: number | null;
}

/** The rating word the row's pill shows (RatingBadge / getRatingLabelKey rounding); null = «Sin calificación». */
export function ratingLevel(avg: number | null | undefined): 1 | 2 | 3 | 4 | 5 | null {
    const n = Number(avg);
    if (avg == null || !Number.isFinite(n) || n < 1 || n > 5) return null;
    // The same rounding as the pill's word (getRatingLabelKey): 2.49 is 2★, 2.5 is 3★.
    return Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;
}

/** Whether one filter holds for a row. */
export function holds(k: FilterKey, r: ListRow): boolean {
    switch (k) {
        // Everyone who filled a form — also people whose form joined a profile they already had.
        case 'src:form': return (r.formCount ?? 0) > 0;
        case 'src:post': return !!r.fromPost;
        case 'src:imported': return r.source === 'imported';
        case 'src:api': return r.source === 'api';
        case 'src:contract': return r.source === 'contract';
        case 'src:manual': return (r.source ?? 'manual') === 'manual';
        case 'rating:none': return ratingLevel(r.avgRating) === null;
        case 'alert:housemate': return !!r.housemateChip;
        default: return ratingLevel(r.avgRating) === Number(k.slice('rating:'.length));
    }
}

/** OR within a group, AND across groups; nothing selected = everyone. */
export function matches(selected: ReadonlySet<FilterKey>, r: ListRow): boolean {
    const byGroup = new Map<FilterGroup, FilterKey[]>();
    for (const k of selected) byGroup.set(groupOf(k), [...(byGroup.get(groupOf(k)) ?? []), k]);
    for (const keys of byGroup.values()) if (!keys.some(k => holds(k, r))) return false;
    return true;
}

/** The name search: every word typed appears in the name, ignoring case and accents. */
export function nameMatches(q: string, name: string | null | undefined): boolean {
    const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const n = fold(name ?? '');
    return words.every(w => n.includes(w));
}

/** One collator for every comparison (localeCompare builds one per call — thousands per sort). */
const NAME_ORDER = new Intl.Collator('es', { sensitivity: 'base' });

export type SortKey = 'new' | 'old' | 'name' | 'name_desc' | 'worst' | 'best';
export const SORT_KEYS: readonly SortKey[] = ['new', 'old', 'name', 'name_desc', 'worst', 'best'];
export const DEFAULT_SORT: SortKey = 'new';

const secondsOf = (v: ListRow['createdAt']): number => {
    if (v == null) return 0;
    if (v instanceof Date) return v.getTime() / 1000;
    if (typeof v === 'number') return v > 1e12 ? v / 1000 : v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t / 1000 : 0;
};

/**
 * The list in the chosen order. Ties keep the incoming order (stable sort), and
 * people with no rating (and, by name, nameless profiles) always go last.
 * With «Por formulario» alone, the dates are the forms' — newest form first by
 * default, what that tab always did; reversed, oldest form first.
 */
export function sortRows<R extends ListRow>(rows: readonly R[], sort: SortKey, selected: ReadonlySet<FilterKey>): R[] {
    // A–Z and Z–A both keep nameless profiles («Sin nombre») at the end, not first.
    const nameless = (r: R) => !(r.name ?? '').trim();
    const byName = (a: R, b: R) => NAME_ORDER.compare(a.name ?? '', b.name ?? '');
    const byNameKeepNamelessLast = (dir: 1 | -1) => (a: R, b: R) =>
        nameless(a) !== nameless(b) ? (nameless(a) ? 1 : -1) : dir * byName(a, b);
    // «Por formulario» alone: the date columns read the newest FORM (what that tab always did), both ways.
    const formsOnly = selected.has('src:form') && selected.size === 1;
    const rated = (r: R) => (ratingLevel(r.avgRating) === null ? null : Number(r.avgRating));
    const cmp: Record<SortKey, (a: R, b: R) => number> = {
        new: formsOnly
            ? (a, b) => (b.latestFormAt ?? 0) - (a.latestFormAt ?? 0)
            : (a, b) => secondsOf(b.createdAt) - secondsOf(a.createdAt),
        old: formsOnly
            ? (a, b) => (a.latestFormAt ?? 0) - (b.latestFormAt ?? 0)
            : (a, b) => secondsOf(a.createdAt) - secondsOf(b.createdAt),
        name: byNameKeepNamelessLast(1),
        name_desc: byNameKeepNamelessLast(-1),
        worst: (a, b) => (rated(a) ?? Infinity) - (rated(b) ?? Infinity),
        best: (a, b) => {
            const x = rated(a), y = rated(b);
            if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
            return y - x;
        },
    };
    return [...rows].sort(cmp[sort]);
}

// ── URL ────────────────────────────────────────────────────────────────────
// ?filtro=formularios,posts,importados,api,contrato,a-mano   (filtro=formularios / posts: the old tabs' links)
// ?calificacion=1,2,sin   ?alerta=conviviente   ?orden=viejos|nombre|nombre-za|peor|mejor   ?q=texto

const URL_VALUE: Record<FilterKey, [param: string, value: string]> = {
    'src:form': ['filtro', 'formularios'], 'src:post': ['filtro', 'posts'],
    'src:imported': ['filtro', 'importados'], 'src:api': ['filtro', 'api'], 'src:contract': ['filtro', 'contrato'],
    'src:manual': ['filtro', 'a-mano'],
    'rating:1': ['calificacion', '1'], 'rating:2': ['calificacion', '2'], 'rating:3': ['calificacion', '3'],
    'rating:4': ['calificacion', '4'], 'rating:5': ['calificacion', '5'], 'rating:none': ['calificacion', 'sin'],
    'alert:housemate': ['alerta', 'conviviente'],
};
const SORT_URL: Record<SortKey, string> = { new: '', old: 'viejos', name: 'nombre', name_desc: 'nombre-za', worst: 'peor', best: 'mejor' };

export interface ListView { selected: Set<FilterKey>; sort: SortKey; q: string }

export function viewFromSearch(search: string): ListView {
    const p = new URLSearchParams(search);
    const selected = new Set<FilterKey>();
    for (const k of FILTER_KEYS) {
        const [param, value] = URL_VALUE[k];
        if ((p.get(param) ?? '').split(',').includes(value)) selected.add(k);
    }
    const orden = p.get('orden') ?? '';
    const sort = (SORT_KEYS.find(s => SORT_URL[s] === orden && orden !== '') ?? DEFAULT_SORT);
    return { selected, sort, q: (p.get('q') ?? '').slice(0, 100) };
}

export function searchFromView(v: ListView): string {
    const params: Record<string, string[]> = {};
    for (const k of FILTER_KEYS) if (v.selected.has(k)) (params[URL_VALUE[k][0]] ||= []).push(URL_VALUE[k][1]);
    const p = new URLSearchParams();
    for (const [param, values] of Object.entries(params)) p.set(param, values.join(','));
    if (v.sort !== DEFAULT_SORT) p.set('orden', SORT_URL[v.sort]);
    if (v.q.trim()) p.set('q', v.q.trim());
    const s = p.toString().replace(/%2C/g, ',');
    return s ? `?${s}` : '';
}

/** Applied = anything that narrows the list (filters or the search). The order isn't a filter. */
export const appliedCount = (v: ListView): number => v.selected.size + (v.q.trim() ? 1 : 0);
