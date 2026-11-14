/**
 * «Cargar un animal desde un post» (Jon 2026-11-14) — the pure rules.
 *
 * The AI reads an adoption post and returns one entry per animal it shows.
 * Nothing here trusts that output: every field is coerced to what the animal
 * form accepts, and anything the post did not state stays EMPTY — age, sex and
 * neutered status are never guessed. They are desired, never required (Jon
 * 2026-11-14, decision 1): the form nudges the rescuer when they are empty, the
 * catalogue rule stays name + species + photo.
 */

export type ImportedSex = '' | 'macho' | 'hembra';
export type ImportedNeutered = '' | '1' | '0';
export type AgeUnit = 'months' | 'years';

export interface ImportedAnimal {
    name: string;
    /** 'cat' | 'dog' | 'bird', or the species as written (the form's «Otro…»). Never empty. */
    species: string;
    sex: ImportedSex;
    neutered: ImportedNeutered;
    /** Digits only, '' when the post does not say. */
    ageValue: string;
    ageUnit: AgeUnit;
    color: string;
    details: string;
    /** Indexes into the post's photos that show THIS animal. */
    photos: number[];
}

export interface AnimalExtraction {
    animals: ImportedAnimal[];
    /** YYYY-MM-DD when the post shows its own date, else null. */
    postDate: string | null;
}

/** Posts shout names («ROCCO BUSCA FAMILIA»): an all-caps name reads as «Rocco». Mixed case is kept as written. */
export function displayName(name: string): string {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!/[A-ZÁÉÍÓÚÑÜ]/.test(n) || n !== n.toUpperCase()) return n;
    return n.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** More than this in one post is a catalogue page, not a litter — keep the first ones. */
export const MAX_ANIMALS_PER_POST = 12;

const str = (v: unknown, max = 2000): string =>
    typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';

const SPECIES_ALIASES: Record<string, string> = {
    cat: 'cat', gato: 'cat', gata: 'cat', gatito: 'cat', gatita: 'cat', felino: 'cat', gatos: 'cat',
    dog: 'dog', perro: 'dog', perra: 'dog', perrito: 'dog', perrita: 'dog', cachorro: 'dog', cachorra: 'dog', canino: 'dog', perros: 'dog',
    bird: 'bird', ave: 'bird', pajaro: 'bird', 'pájaro': 'bird', loro: 'bird',
};

/** 'cat' | 'dog' | 'bird' when recognised, the written species otherwise, '' when the post doesn't say (the rescuer picks). */
export function normalizeSpecies(v: unknown): string {
    const s = str(v, 40).toLowerCase();
    if (!s || s === 'null' || s === 'unknown' || s === 'other') return '';
    return SPECIES_ALIASES[s] ?? s;
}

export function normalizeSex(v: unknown): ImportedSex {
    const s = str(v, 20).toLowerCase();
    if (['macho', 'male', 'm'].includes(s)) return 'macho';
    if (['hembra', 'female', 'f'].includes(s)) return 'hembra';
    return '';
}

export function normalizeNeutered(v: unknown): ImportedNeutered {
    if (v === true || v === 1 || v === '1') return '1';
    if (v === false || v === 0 || v === '0') return '0';
    const s = str(v, 20).toLowerCase();
    if (['true', 'yes', 'si', 'sí'].includes(s)) return '1';
    if (['false', 'no'].includes(s)) return '0';
    return '';
}

/** A plausible age, or empty. Months stay months (a 2-month kitten); 24+ whole months read better as years. */
export function normalizeAge(value: unknown, unit: unknown): { ageValue: string; ageUnit: AgeUnit } {
    const u: AgeUnit = str(unit, 10).toLowerCase().startsWith('y') || str(unit, 10).toLowerCase().startsWith('a') ? 'years' : 'months';
    const n = typeof value === 'number' ? value : Number(str(value, 6).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return { ageValue: '', ageUnit: u };
    const months = u === 'years' ? n * 12 : n;
    if (months > 30 * 12) return { ageValue: '', ageUnit: u };
    if (u === 'months' && months >= 24 && months % 12 === 0) return { ageValue: String(months / 12), ageUnit: 'years' };
    // The age field takes whole numbers up to 99: «8 años y medio» is 8 years, not 102 months.
    if (u === 'years' && !Number.isInteger(n)) {
        return months < 24 ? { ageValue: String(Math.round(months)), ageUnit: 'months' } : { ageValue: String(Math.round(n)), ageUnit: 'years' };
    }
    if (u === 'months' && months > 99) return { ageValue: String(Math.round(months / 12)), ageUnit: 'years' };
    return { ageValue: String(Math.round(n)), ageUnit: u };
}

function normalizePhotos(v: unknown, photoCount: number): number[] {
    if (!Array.isArray(v)) return [];
    const out: number[] = [];
    for (const x of v) {
        const i = typeof x === 'number' ? x : Number(x);
        if (Number.isInteger(i) && i >= 0 && i < photoCount && !out.includes(i)) out.push(i);
    }
    return out;
}

/** A real calendar date in YYYY-MM-DD, not in the future. */
export function normalizePostDate(v: unknown, now: Date = new Date()): string | null {
    const s = str(v, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
    if (d.getTime() > now.getTime() + 36 * 3600 * 1000) return null;
    return s;
}

/**
 * The AI's JSON → what the form can show. `photoCount` is how many photos the
 * post had (in the order they were sent). With ONE animal, a post's photos are
 * all of it unless the AI singled some out — flyers it left out stay out.
 */
export function parseAnimalExtraction(raw: unknown, photoCount: number, now: Date = new Date()): AnimalExtraction {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const list = Array.isArray(obj.animals) ? obj.animals : [];
    const animals: ImportedAnimal[] = [];
    for (const item of list.slice(0, MAX_ANIMALS_PER_POST)) {
        if (!item || typeof item !== 'object') continue;
        const a = item as Record<string, unknown>;
        const age = normalizeAge(a.ageValue, a.ageUnit);
        animals.push({
            name: displayName(str(a.name, 80)),
            species: normalizeSpecies(a.species),
            sex: normalizeSex(a.sex),
            neutered: normalizeNeutered(a.neutered),
            ...age,
            color: str(a.color, 120),
            details: str(a.details, 2000),
            photos: normalizePhotos(a.photos, photoCount),
        });
    }
    const flyers = normalizePhotos(obj.notAnimalPhotos, photoCount);
    if (animals.length === 1 && animals[0].photos.length === 0) {
        animals[0].photos = Array.from({ length: photoCount }, (_, i) => i).filter(i => !flyers.includes(i));
    }
    return { animals, postDate: normalizePostDate(obj.postDate, now) };
}

export type NiceToHave = 'age' | 'sex' | 'neutered';

/** The desired-but-optional facts still empty — what the form nudges for. «—» counts as empty (decision 2). */
export function missingNiceToHave(a: { ageValue: string; sex: string; neutered: string }): NiceToHave[] {
    const out: NiceToHave[] = [];
    if (!a.ageValue) out.push('age');
    if (!a.sex) out.push('sex');
    if (a.neutered === '') out.push('neutered');
    return out;
}

/** Folded for comparison: case, accents and inner spacing don't make two animals different. */
export function animalNameKey(name: string | null | undefined): string {
    return (name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

/**
 * «¿Es el mismo Rocco que ya cargaste?» — same name AND same species. A
 * nameless or placeholder name ('gatito', 'perrita') never matches: those are
 * descriptions, not names, and would flag every kitten.
 */
export function isSameNamedAnimal(
    a: { name: string | null | undefined; species: string | null | undefined },
    b: { name: string | null | undefined; species: string | null | undefined },
): boolean {
    const ka = animalNameKey(a.name);
    if (!ka || ka in SPECIES_ALIASES || ka.length < 2) return false;
    return ka === animalNameKey(b.name) && normalizeSpecies(a.species) === normalizeSpecies(b.species);
}

/**
 * The day the post's age was true on. «2 años» in an August post means about
 * 2 years 3 months in November. Unknown → today. A date over 5 years old is
 * more likely misread than true, so it falls back to today too.
 */
export function ageReferenceDate(postDate: string | null, now: Date = new Date()): Date {
    if (!postDate) return now;
    const d = new Date(`${postDate}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d > now) return now;
    if (now.getTime() - d.getTime() > 5 * 365.25 * 24 * 3600 * 1000) return now;
    return d;
}

/**
 * «Sí: sumarle las fotos y los datos» (decision 4): what the post adds to an
 * animal already loaded. Only EMPTY fields are filled — never overwrites what
 * the rescuer already wrote. `loaded` is what the server last said for each
 * patched field (empty), so a teammate who filled it meanwhile wins
 * (src/domain/fieldCollab.ts).
 */
export function mergeIntoExisting(
    existing: { sex: string | null; neutered: number | null; color: string | null; microchip: string | null; details: string | null; estimatedBirthDate: number | null; sourceUrl: string | null },
    incoming: { sex: string; neutered: ImportedNeutered; color: string; microchip: string; details: string; estimatedBirthDate: Date | null; sourceUrl: string },
): { patch: Record<string, unknown>; loaded: Record<string, unknown> } {
    const patch: Record<string, unknown> = {};
    const loaded: Record<string, unknown> = {};
    const fill = (field: string, was: unknown, value: unknown) => {
        const empty = was === null || was === undefined || was === '';
        const has = value !== null && value !== undefined && value !== '';
        if (empty && has) { patch[field] = value; loaded[field] = was ?? null; }
    };
    fill('sex', existing.sex, incoming.sex);
    fill('neutered', existing.neutered, incoming.neutered === '' ? null : Number(incoming.neutered));
    fill('color', existing.color, incoming.color.trim());
    fill('microchip', existing.microchip, incoming.microchip.trim());
    fill('details', existing.details, incoming.details.trim());
    fill('estimatedBirthDate', existing.estimatedBirthDate, incoming.estimatedBirthDate);
    fill('sourceUrl', existing.sourceUrl, incoming.sourceUrl.trim());
    return { patch, loaded };
}

/**
 * A post link as a rescuer pastes it — «instagram.com/p/abc», with spaces,
 * with a trailing caption — as an http(s) URL, or '' when it isn't one. Only
 * this goes to the fetcher and into `animals.source_url` (the save rejects
 * anything that isn't an http URL).
 */
export function normalizePostLink(input: string): string {
    const first = input.trim().split(/\s+/)[0] ?? '';
    if (!first) return '';
    const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
    try {
        const u = new URL(withScheme);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
        return u.toString().slice(0, 2000);
    } catch {
        return '';
    }
}
