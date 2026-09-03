import { categorizeContactText, SOCIAL_PLATFORMS, type ContactEntry, type ContactEntryType, type SocialPlatform } from '@/lib/contactEntries';

/**
 * Turn a search query into safe prefill for the create-adopter form.
 *
 * Every "create new" entry point used to assume that whatever was not a phone
 * number was a name, and wrote it straight into `?name=`. But the search box
 * invites "Nombre, Teléfono ó Dirección", so searching
 * `Av. Rivadavia 4820, Caballito` and clicking create produced an adopter whose
 * NAME was a street — a permanent data defect that then matches badly in search
 * and duplicate detection for the life of the record.
 *
 * `categorizeContactText` already knows how to split a line into typed entries,
 * so the classification is reused rather than re-guessed. Anything it types as a
 * contact becomes a seeded contact chip; only genuinely name-shaped residue
 * becomes the name.
 */

/** Values a prefill may seed. Mirrors ContactEntryType. */
const PREFILL_TYPES: ReadonlySet<string> = new Set<ContactEntryType>([
    'phone', 'email', 'social', 'id', 'address', 'alias', 'other',
]);

/** Digits, an @, or a URL scheme mean this is not somebody's name. */
const NOT_NAME = /[\d@]|:\/\//;

/** Long enough to hold "María Fernanda Gutiérrez de Rodríguez", short enough to exclude prose. */
const MAX_NAME_LENGTH = 60;

export function looksLikeName(value: string | null | undefined): boolean {
    const v = (value || '').trim();
    if (!v || v.length > MAX_NAME_LENGTH) return false;
    return !NOT_NAME.test(v);
}

export interface CreatePrefill {
    /** Only set when the residue actually looks like a person's name. */
    name?: string;
    /** Typed contact values found in the query, to seed as chips. */
    contacts: ContactEntry[];
}

export function buildCreatePrefill(query: string | null | undefined): CreatePrefill {
    const q = (query || '').trim();
    if (!q) return { contacts: [] };

    const contacts: ContactEntry[] = [];
    const nameParts: string[] = [];

    for (const entry of categorizeContactText(q)) {
        if (entry.type === 'other') {
            // `other` is the classifier's catch-all for prose. Only the
            // name-shaped part of it may become a name; the rest is a note the
            // rescuer can retype, which is far cheaper than a record permanently
            // named after a street.
            if (looksLikeName(entry.value)) nameParts.push(entry.value.trim());
        } else {
            contacts.push(entry);
        }
    }

    const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
    return { ...(name ? { name } : {}), contacts };
}

/**
 * Write the prefill onto an existing param set, so each caller keeps its own
 * extra params (`continueToAdoption`, `animalId`, …).
 */
export function appendCreatePrefill(params: URLSearchParams, query: string | null | undefined): void {
    const { name, contacts } = buildCreatePrefill(query);
    if (name) params.set('name', name);
    if (contacts.length) {
        params.set('contacts', JSON.stringify(contacts.map(c => ({
            type: c.type,
            value: c.value,
            ...(c.platform ? { platform: c.platform } : {}),
        }))));
    }
}

/**
 * Read back what `appendCreatePrefill` wrote. The value arrives from a URL, so
 * it is treated as untrusted: parsed defensively, filtered to known types, and
 * bounded in both count and length.
 */
export function parseContactsParam(raw: string | null | undefined): Array<Omit<ContactEntry, 'id'>> {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .slice(0, 10)
            .filter((e): e is { type: string; value: string; platform?: string } =>
                !!e && typeof e === 'object'
                && typeof (e as { value?: unknown }).value === 'string'
                && (e as { value: string }).value.trim().length > 0
                && PREFILL_TYPES.has((e as { type?: string }).type ?? ''))
            .map(e => {
                const platform = SOCIAL_PLATFORMS.find(p => p.key === e.platform)?.key;
                return {
                    type: e.type as ContactEntryType,
                    value: e.value.trim().slice(0, 300),
                    ...(platform ? { platform: platform as SocialPlatform } : {}),
                };
            });
    } catch {
        return [];
    }
}
