/**
 * «Compartir formulario» → «¿Para qué animal?» (Jon 2026-11-13, option B +
 * the list with search). Pure rules for the picker and for the public form
 * that a link with `&animal=` opens.
 */

/** One row of the picker: an animal of the rescuer's team that takes applications. */
export type ShareAnimal = {
    id: string;
    name: string | null;
    species: string | null;
    sex: string | null;
    color: string | null;
    /** Lead photo, as the home row and «Proponer un animal» pick it. */
    photo: string | null;
    /** When it was added (the record's date); null sorts last. */
    addedAtMs: number | null;
    /** Open applications for it. */
    candidates: number;
};

export type ShareSpecies = 'dog' | 'cat' | 'other';

const SPECIES: Record<string, ShareSpecies> = { perro: 'dog', dog: 'dog', gato: 'cat', cat: 'cat' };

export function shareSpeciesKey(species: string | null | undefined): ShareSpecies {
    return SPECIES[(species ?? '').trim().toLowerCase()] ?? 'other';
}

/** Lower-case, accents off — «Simbá» and «SIMBA» are the same search. */
function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The rows the search and the species buttons leave. The search matches the
 * name, the colour and the species word the rescuer reads on the row, so an
 * animal can be found without remembering its name.
 */
export function filterShareAnimals<T extends ShareAnimal>(
    animals: readonly T[],
    filter: { query: string; species: ShareSpecies | 'all' },
    speciesLabel: (k: ShareSpecies) => string,
): T[] {
    const q = fold(filter.query.trim());
    return animals.filter((a) => {
        const k = shareSpeciesKey(a.species);
        if (filter.species !== 'all' && k !== filter.species) return false;
        if (!q) return true;
        return fold(`${a.name ?? ''} ${a.color ?? ''} ${speciesLabel(k)}`).includes(q);
    });
}

/** The species buttons to offer: each species present once, dogs, cats, then others. */
export function shareSpeciesPresent(animals: readonly ShareAnimal[]): ShareSpecies[] {
    const seen = new Set(animals.map(a => shareSpeciesKey(a.species)));
    return (['dog', 'cat', 'other'] as const).filter(k => seen.has(k));
}

/** Newest first — the animal someone just asked about is usually one posted lately. */
export function sortShareAnimals<T extends ShareAnimal>(animals: readonly T[]): T[] {
    return [...animals].sort((x, y) => {
        if (x.addedAtMs !== y.addedAtMs) {
            if (x.addedAtMs === null) return 1;
            if (y.addedAtMs === null) return -1;
            return y.addedAtMs - x.addedAtMs;
        }
        return (x.name ?? '').localeCompare(y.name ?? '', 'es');
    });
}

/**
 * What the public form may show about the animal of a `&animal=` link: its
 * name, when the animal belongs to the link owner's team and still takes
 * applications (available, or in a foster home); its photo only while it is in
 * the public catalogue (`listed` NULL or 1), the same rule the public animal
 * page follows. Anything else — another team's animal (a forged link), an
 * adopted one, an adopter event — shows nothing, and the form stays generic.
 */
export function formAnimalForLink(
    row: { name: string | null; addedBy: string | null; recordType: string | null; adopterId: string | null; listed: number | null } | undefined,
    linkOwnerTeam: readonly string[],
): { name: string; publicPhoto: boolean } | null {
    if (!row) return null;
    const name = (row.name ?? '').trim();
    if (!name) return null;
    const takesApplications = (row.recordType === 'available' && !row.adopterId) || row.recordType === 'foster';
    if (!takesApplications) return null;
    const owner = (row.addedBy ?? '').trim().toLowerCase();
    if (!owner || !linkOwnerTeam.some(e => e.trim().toLowerCase() === owner)) return null;
    return { name, publicPhoto: (row.listed ?? 1) === 1 };
}
