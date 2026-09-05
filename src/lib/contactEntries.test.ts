import { describe, it, expect } from 'vitest';
import {
    categorizeContactText,
    contactEntriesToBlob,
    parseBlobToContactEntries,
    buildContactEntries,
    deserializeContactEntries,
    mergeContactEntries,
    deriveStableLegacyId,
    deriveStreet,
    deriveLocality,
    retypeDraft,
    type ContactDraft,
    type ContactEntry,
} from './contactEntries';

function valuesOf(entries: ContactEntry[], type: ContactEntry['type']): string[] {
    return entries.filter(e => e.type === type).map(e => e.value);
}

describe('categorizeContactText', () => {
    it('categorizes a mixed multi-line paste into typed entries', () => {
        const entries = categorizeContactText(
            'Tel: 11 2345-6789\njuan@gmail.com\nIG @juanp\nDNI 30123456',
        );
        expect(valuesOf(entries, 'phone')).toEqual(['11 2345-6789']);
        expect(valuesOf(entries, 'email')).toEqual(['juan@gmail.com']);
        expect(valuesOf(entries, 'social')).toEqual(['@juanp']);
        expect(valuesOf(entries, 'id')).toEqual(['30123456']);
        expect(valuesOf(entries, 'other')).toEqual([]);
    });

    it('classifies an unlabeled number as phone (UI lets the user reclassify to id)', () => {
        const entries = categorizeContactText('Juan Perez 1123456789');
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'id')).toEqual([]);
    });

    it('keeps a note that shares a line with a phone as leftover prose', () => {
        const entries = categorizeContactText('11234567 hermano de Maria');
        expect(valuesOf(entries, 'phone')).toEqual(['11234567']);
        const other = valuesOf(entries, 'other');
        expect(other).toHaveLength(1);
        expect(other[0]).toContain('hermano de Maria');
    });

    it('keeps a pure-prose line verbatim', () => {
        const entries = categorizeContactText('preguntar por el en el kiosco');
        expect(valuesOf(entries, 'other')).toEqual(['preguntar por el en el kiosco']);
    });

    it('de-duplicates the same phone written with different separators', () => {
        const entries = categorizeContactText('11 2345-6789\n1123456789');
        expect(valuesOf(entries, 'phone')).toEqual(['11 2345-6789']);
    });

    it('preserves the phone formatting the user entered', () => {
        expect(valuesOf(categorizeContactText('+54 11 2345-6789'), 'phone')).toEqual(['+54 11 2345-6789']);
        expect(valuesOf(categorizeContactText('Tel: (011) 4567-8900'), 'phone')).toEqual(['(011) 4567-8900']);
    });

    it('returns an empty array for blank input', () => {
        expect(categorizeContactText('')).toEqual([]);
        expect(categorizeContactText(null)).toEqual([]);
        expect(categorizeContactText('   ')).toEqual([]);
    });
});

describe('contactEntriesToBlob', () => {
    it('writes one labeled line per typed entry', () => {
        const blob = contactEntriesToBlob([
            { type: 'phone', value: '1123456789' },
            { type: 'email', value: 'juan@gmail.com' },
            { type: 'id', value: '30123456', label: 'DNI' },
        ]);
        expect(blob).toContain('Tel: 1123456789');
        expect(blob).toContain('Email: juan@gmail.com');
        expect(blob).toContain('DNI: 30123456');
    });

    it('writes other entries verbatim with no prefix', () => {
        const blob = contactEntriesToBlob([{ type: 'other', value: 'ask at the kiosk' }]);
        expect(blob).toBe('ask at the kiosk');
    });

    it('returns an empty string for no entries', () => {
        expect(contactEntriesToBlob([])).toBe('');
    });
});

describe('legacy blob round-trip (lossless)', () => {
    it('preserves every prose line through parse then derive', () => {
        const blob = [
            'Documento: 30123456',
            'Email: juan@gmail.com',
            'Tel: 1123456789',
            'preguntar por el en el kiosco',
        ].join('\n');
        const roundTripped = contactEntriesToBlob(parseBlobToContactEntries(blob));
        expect(roundTripped).toContain('preguntar por el en el kiosco');
        expect(roundTripped).toContain('30123456');
        expect(roundTripped).toContain('juan@gmail.com');
        expect(roundTripped).toContain('1123456789');
    });

    it('does not drop a free-text-only legacy blob', () => {
        const blob = 'llamar despues de las 6\npreferentemente fin de semana';
        const roundTripped = contactEntriesToBlob(parseBlobToContactEntries(blob));
        expect(roundTripped).toContain('llamar despues de las 6');
        expect(roundTripped).toContain('preferentemente fin de semana');
    });
});

describe('buildContactEntries', () => {
    it('builds de-duplicated typed entries from structured parts', () => {
        const entries = buildContactEntries({
            phones: ['1123456789', '1123456789', ''],
            emails: ['a@b.com'],
            socials: ['@x'],
            ids: [{ value: '30123456', label: 'DNI' }],
            addresses: ['Calle Falsa 123'],
        });
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'email')).toEqual(['a@b.com']);
        expect(valuesOf(entries, 'social')).toEqual(['@x']);
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
        expect(entries.find(e => e.type === 'id')).toMatchObject({ type: 'id', value: '30123456', label: 'DNI' });
    });
});

/**
 * Regression (v2.53.0): the import wizard was migrated onto ContactEntriesSection,
 * which gates edit/delete on `entry.id` (renders the action buttons only when it is
 * set, and both startEdit/remove bail early without one). The producer functions
 * never assigned an id, so every EXTRACTED contact detail rendered read-only — it
 * could not be corrected or removed — while composer-added entries (which get a
 * crypto.randomUUID()) stayed editable. Ids must be stable, not random: the same
 * entry has to derive the same id on every call, or the per-entry update/remove
 * round-trip breaks the same way deriveStableLegacyId already documents.
 */
describe('every produced entry carries a stable id', () => {
    it('buildContactEntries assigns an id to every entry', () => {
        const entries = buildContactEntries({
            phones: ['1123456789'],
            emails: ['a@b.com'],
            socials: ['@x'],
            ids: [{ value: '30123456', label: 'DNI' }],
            addresses: ['Calle Falsa 123'],
        });
        expect(entries.length).toBeGreaterThan(0);
        for (const e of entries) expect(e.id, `${e.type}:${e.value} has no id`).toBeTruthy();
    });

    it('categorizeContactText assigns an id to every entry', () => {
        const entries = categorizeContactText('Tel: 1123456789\na@b.com\nCalle Falsa 123');
        expect(entries.length).toBeGreaterThan(0);
        for (const e of entries) expect(e.id, `${e.type}:${e.value} has no id`).toBeTruthy();
    });

    it('derives the SAME id for the same entry across separate calls', () => {
        const a = buildContactEntries({ phones: ['1123456789'] })[0];
        const b = buildContactEntries({ phones: ['1123456789'] })[0];
        expect(a.id).toBe(b.id);
        expect(a.id).toBe(deriveStableLegacyId('phone', '1123456789'));
    });

    /**
     * `dedupe` keys social entries on type|value|PLATFORM, so the same handle on
     * two networks legitimately survives as two entries — Gemini extracting
     * `@dario.fernandez` for both Instagram and Facebook is a real wizard case.
     * The id must therefore separate them too: ContactEntriesSection edits with
     * `entries.map(e => e.id === entry.id ? updated : e)` and deletes with
     * `filter(e => e.id !== entryId)`, so two entries sharing an id means editing
     * one silently rewrites both and deleting one removes both.
     */
    it('gives same-handle-different-network social entries distinct ids', () => {
        const entries = buildContactEntries({
            socials: [
                { value: '@dario.fernandez', platform: 'instagram' },
                { value: '@dario.fernandez', platform: 'facebook' },
            ],
        });
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
    });

    it('does not overwrite an id an entry already has', () => {
        const existing: ContactEntry[] = [{ id: 'real-uuid-1', type: 'phone', value: '1123456789' }];
        const merged = mergeContactEntries(existing, categorizeContactText('a@b.com'));
        expect(merged.find(e => e.value === '1123456789')?.id).toBe('real-uuid-1');
        for (const e of merged) expect(e.id).toBeTruthy();
    });
});

/**
 * Regression (v2.53.x): correcting a mis-extracted type used to commit the new
 * type straight to the parent and then CLOSE the edit form, which stranded the
 * rescuer outside the only place the new type's fields live — a re-filed phone
 * could not get its WhatsApp/Telegram toggles, and a re-filed social could not
 * get its network (whose absence then disabled Save). Keeping the transition a
 * pure draft→draft move is what lets the form stay open across the change.
 */
describe('retypeDraft', () => {
    const base: ContactDraft = { type: 'phone', value: '1123456789', streetAndNumber: '', locality: '', platform: null, apps: ['whatsapp'] };

    it('keeps the value — the label was wrong, not the data', () => {
        expect(retypeDraft(base, 'id').value).toBe('1123456789');
    });

    it('returns the same draft when the type has not changed', () => {
        expect(retypeDraft(base, 'phone')).toBe(base);
    });

    it('drops messaging apps when leaving phone', () => {
        expect(retypeDraft(base, 'id').apps).toEqual([]);
    });

    it('keeps messaging apps addressable when arriving at phone', () => {
        const asId: ContactDraft = { ...base, type: 'id', apps: [] };
        expect(retypeDraft(asId, 'phone').apps).toEqual([]);
        // the toggle is now reachable — the field exists rather than being undefined
        expect(retypeDraft(asId, 'phone')).toHaveProperty('apps');
    });

    it('auto-detects the network when retyping a profile URL to social', () => {
        const d: ContactDraft = { ...base, value: 'https://instagram.com/juan.perez' };
        expect(retypeDraft(d, 'social').platform).toBe('instagram');
    });

    it('leaves platform null for an undetectable social so the picker demands one', () => {
        const d: ContactDraft = { ...base, value: 'juan.perez.1985' };
        expect(retypeDraft(d, 'social').platform).toBeNull();
    });

    it('clears the platform when leaving social', () => {
        const social: ContactDraft = { ...base, type: 'social', platform: 'facebook', apps: [] };
        expect(retypeDraft(social, 'id').platform).toBeNull();
    });

    it('drops address parts when leaving address and preserves them when staying', () => {
        const addr: ContactDraft = { type: 'address', value: 'Calle Falsa 123, Quilmes', streetAndNumber: 'Calle Falsa 123', locality: 'Quilmes', platform: null, apps: [] };
        const asOther = retypeDraft(addr, 'id');
        expect(asOther.streetAndNumber).toBe('');
        expect(asOther.locality).toBe('');
        expect(retypeDraft(addr, 'address')).toBe(addr);
    });

    it('does not mutate the draft it was given', () => {
        const before = JSON.stringify(base);
        retypeDraft(base, 'social');
        expect(JSON.stringify(base)).toBe(before);
    });
});

describe('address entries', () => {
    it('writes an address entry to the blob under the Dirección label', () => {
        const blob = contactEntriesToBlob([{ type: 'address', value: 'Av. Siempre Viva 742' }]);
        expect(blob).toBe('Dirección: Av. Siempre Viva 742');
    });

    it('round-trips a stored address entry through deserialize', () => {
        const entries = deserializeContactEntries('[{"type":"address","value":"Av. Siempre Viva 742"}]');
        expect(entries).toMatchObject([{ type: 'address', value: 'Av. Siempre Viva 742' }]);
    });

    it('classifies a street-keyword-led line as address, keeping the street type', () => {
        const entries = categorizeContactText('Av. Corrientes 1234');
        expect(valuesOf(entries, 'address')).toEqual(['Av. Corrientes 1234']);
    });

    it('strips a leading address label from the stored value', () => {
        const entries = categorizeContactText('Dirección: Calle Falsa 123');
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
        expect(valuesOf(entries, 'other')).toEqual([]);
    });

    it('detects a "Dir" label written without a colon', () => {
        const entries = categorizeContactText('Dir Av Siempre Viva 742');
        expect(valuesOf(entries, 'address')).toEqual(['Av Siempre Viva 742']);
    });

    it('does not misclassify a word that merely starts with an address keyword', () => {
        const entries = categorizeContactText('Avísame cuando puedas');
        expect(valuesOf(entries, 'address')).toEqual([]);
        expect(valuesOf(entries, 'other')).toEqual(['Avísame cuando puedas']);
    });

    it('detects an address line pasted alongside a phone line', () => {
        const entries = categorizeContactText('Tel: 1123456789\nCalle Falsa 123');
        expect(valuesOf(entries, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(entries, 'address')).toEqual(['Calle Falsa 123']);
    });
});

describe('deserializeContactEntries', () => {
    it('parses valid stored JSON', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"123"}]');
        expect(entries).toMatchObject([{ type: 'phone', value: '123' }]);
    });

    it('returns an empty array for null, invalid JSON, or non-arrays', () => {
        expect(deserializeContactEntries(null)).toEqual([]);
        expect(deserializeContactEntries('not json')).toEqual([]);
        expect(deserializeContactEntries('{"type":"phone"}')).toEqual([]);
    });

    it('drops entries with an unknown type', () => {
        expect(deserializeContactEntries('[{"type":"bogus","value":"x"}]')).toEqual([]);
    });

    it('assigns an id to legacy entries that lack one', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"123"}]');
        expect(entries[0].id).toBeDefined();
        expect(typeof entries[0].id).toBe('string');
        expect(entries[0].id!.length).toBeGreaterThan(0);
    });

    it('preserves an existing id', () => {
        const entries = deserializeContactEntries('[{"id":"abc-123","type":"phone","value":"123"}]');
        expect(entries[0].id).toBe('abc-123');
    });

    it('assigns different ids to two legacy entries', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"1"},{"type":"phone","value":"2"}]');
        expect(entries[0].id).not.toBe(entries[1].id);
    });

    it('accepts alias type', () => {
        const entries = deserializeContactEntries('[{"type":"alias","value":"Juan Garcia"}]');
        expect(entries).toHaveLength(1);
        expect(entries[0].type).toBe('alias');
        expect(entries[0].value).toBe('Juan Garcia');
    });
});

describe('mergeContactEntries', () => {
    it('merges two lists, de-duplicating on the normalized value', () => {
        const merged = mergeContactEntries(
            [{ type: 'phone', value: '1123456789' }],
            [{ type: 'phone', value: '11 2345-6789' }, { type: 'email', value: 'a@b.com' }],
        );
        expect(valuesOf(merged, 'phone')).toEqual(['1123456789']);
        expect(valuesOf(merged, 'email')).toEqual(['a@b.com']);
    });

    it('preserves the older entry id when deduping', () => {
        const merged = mergeContactEntries(
            [{ id: 'older', type: 'phone', value: '1123456789' }],
            [{ id: 'newer', type: 'phone', value: '11 2345-6789' }],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].id).toBe('older');
    });
});

describe('alias contact entries', () => {
    it('writes an alias entry to the blob under the Otro nombre/identidad label', () => {
        const blob = contactEntriesToBlob([{ type: 'alias', value: 'Juan Garcia' }]);
        expect(blob).toContain('Otro nombre/identidad: Juan Garcia');
    });

    it('round-trips an alias entry through deserialize', () => {
        const entries = deserializeContactEntries('[{"type":"alias","value":"Juan Garcia"}]');
        expect(entries[0].type).toBe('alias');
        expect(entries[0].value).toBe('Juan Garcia');
    });

    it('deduplicates two aliases with the same normalized value', () => {
        const merged = mergeContactEntries(
            [{ type: 'alias', value: 'Juan Garcia' }],
            [{ type: 'alias', value: 'juan garcia' }],
        );
        expect(merged).toHaveLength(1);
    });

    it('keeps two distinct aliases as separate entries', () => {
        const merged = mergeContactEntries(
            [{ type: 'alias', value: 'Juan Garcia' }],
            [{ type: 'alias', value: 'Juan Pérez' }],
        );
        expect(merged).toHaveLength(2);
    });
});

// Pure-function coverage for the lazy legacy-row migration path used by
// addContactEntry, updateContactEntry, removeContactEntry, and the admin
// backfill. The server-side glue (DB read/write/auth) is exercised on
// staging; what's testable in isolation is the parse → assign IDs → merge
// chain, and that's exactly the regression class we care about (a parser
// bug here silently destroys real production data on migration).
describe('legacy contactInfo → structured contactEntries (lazy migration)', () => {
    function migrate(blob: string) {
        const parsed = parseBlobToContactEntries(blob);
        // Mirrors the id-assignment in addContactEntry's lazy branch, spread
        // order included: `{ id: <placeholder>, ...e }` means an id the entry
        // ALREADY carries wins over the placeholder. Since the parser now stamps
        // a deterministic id (see withStableId), that derived id is what survives
        // here — and in production — rather than the placeholder. Deterministic
        // beats random for exactly the reason deriveStableLegacyId documents.
        return parsed.map(e => ({ id: `id-${e.type}-${e.value}`, ...e }));
    }

    it('parses a labeled phone blob and every produced entry has an id', () => {
        const seeded = migrate('Teléfonos: +54 9 11 3161-7720');
        // At minimum one phone entry; the categorizer may also produce an
        // `other` residual from the label, which is fine — the load-bearing
        // claim is "phone is captured and id-assigned, not silently dropped."
        expect(seeded.length).toBeGreaterThan(0);
        const phones = seeded.filter(e => e.type === 'phone');
        expect(phones).toHaveLength(1);
        expect(phones[0].value).toContain('3161-7720');
        expect(seeded.every(e => !!e.id)).toBe(true);
    });

    it('parses a multi-line social+address blob into typed entries', () => {
        const seeded = migrate(
            'Redes sociales: https://www.facebook.com/Dario.Fernandez\nDirección: Jujuy 1842, Quilmes',
        );
        // Social and address both surface as their typed entries. The exact
        // value formatting (URL normalization, casing) is the categorizer's
        // call and tested elsewhere; here we just need the types present.
        expect(seeded.some(e => e.type === 'social')).toBe(true);
        expect(seeded.some(e => e.type === 'address')).toBe(true);
        expect(seeded.every(e => !!e.id)).toBe(true);
    });

    it('merging a new entry on top of the seeded legacy entries preserves both', () => {
        // The data-loss bug shape: pre-fix, the merge would have run against
        // an empty existing array (deserialize on NULL returns []) and the
        // saved row would be just the new entry, losing the legacy data.
        const seeded = migrate('Tel: 555-1234\nEmail: maria@example.com');
        const newEntry: ContactEntry = { id: 'new-1', type: 'phone', value: '555-9999' };
        const merged = mergeContactEntries(seeded, [newEntry]);
        // Original phone + email preserved, new phone added — three entries total.
        expect(merged).toHaveLength(3);
        expect(valuesOf(merged, 'phone')).toContain('555-9999');
        expect(valuesOf(merged, 'email')).toEqual(['maria@example.com']);
    });

    it('merging a duplicate of a seeded legacy entry keeps the original (dedup wins)', () => {
        const seeded = migrate('Tel: 555-1234');
        const newEntry: ContactEntry = { id: 'new-1', type: 'phone', value: '555-1234' };
        const merged = mergeContactEntries(seeded, [newEntry]);
        expect(merged).toHaveLength(1);
        // The original (seeded) entry wins per the older-entry-id rule — the
        // load-bearing claim is that the NEW entry's id does not replace it.
        expect(merged[0].id).not.toBe('new-1');
        expect(merged[0].id).toBe(deriveStableLegacyId('phone', '555-1234'));
    });
});

// v2.16.0-9 adds per-entry contributor attribution so a contributor can edit
// the entries they themselves added. The persistence shape and dedupe
// behavior have to honor `addedBy` symmetrically with `id`.
describe('per-entry addedBy attribution', () => {
    it('deserializeContactEntries preserves addedBy when present', () => {
        const entries = deserializeContactEntries(
            '[{"id":"a","type":"phone","value":"555-1234","addedBy":"alice@example.com"}]',
        );
        expect(entries[0].addedBy).toBe('alice@example.com');
    });

    it('deserializeContactEntries leaves addedBy undefined on legacy entries', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"555-1234"}]');
        expect(entries[0].addedBy).toBeUndefined();
    });

    it('mergeContactEntries keeps the older entry’s addedBy on value collision', () => {
        const merged = mergeContactEntries(
            [{ id: 'older', type: 'phone', value: '1123456789', addedBy: 'first@example.com' }],
            [{ id: 'newer', type: 'phone', value: '11 2345-6789', addedBy: 'second@example.com' }],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].addedBy).toBe('first@example.com');
    });
});

// v2.16.0-12 adds per-entry isPublic so import-time stamping marks entries
// that came from public social sources. Round-trip must survive serialize ⇄
// deserialize and the dedupe-keep-older rule has to be symmetric with id/addedBy.
describe('per-entry isPublic flag', () => {
    it('deserializeContactEntries preserves isPublic=true when present', () => {
        const entries = deserializeContactEntries(
            '[{"id":"a","type":"phone","value":"555-1234","isPublic":true}]',
        );
        expect(entries[0].isPublic).toBe(true);
    });

    it('deserializeContactEntries leaves isPublic undefined on legacy entries', () => {
        const entries = deserializeContactEntries('[{"type":"phone","value":"555-1234"}]');
        expect(entries[0].isPublic).toBeUndefined();
    });

    it('mergeContactEntries keeps the older entry’s isPublic on value collision', () => {
        const merged = mergeContactEntries(
            [{ id: 'older', type: 'phone', value: '1123456789', isPublic: true }],
            [{ id: 'newer', type: 'phone', value: '11 2345-6789' }],
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].isPublic).toBe(true);
    });
});

// v2.16.0-13 — the deterministic-id fix for legacy entries. The bug shape:
// deserialize was assigning a fresh crypto.randomUUID() to every entry that
// lacked an id, so the client's id never matched the server's id on
// update/remove → "Entry not found." Switching to a stable hash makes both
// sides agree and unblocks per-entry mutation on legacy rows.
describe('deterministic legacy id (v2.16.0-13)', () => {
    it('two deserializations of the same legacy JSON produce the same id', () => {
        const json = '[{"type":"address","value":"MAIPU 800/CABA"}]';
        const a = deserializeContactEntries(json);
        const b = deserializeContactEntries(json);
        expect(a[0].id).toBe(b[0].id);
        expect(a[0].id).toMatch(/^legacy-/);
    });

    it('legacy id changes when the value changes (rebuilt after a typo fix)', () => {
        const a = deserializeContactEntries('[{"type":"phone","value":"555-1234"}]');
        const b = deserializeContactEntries('[{"type":"phone","value":"555-9999"}]');
        expect(a[0].id).not.toBe(b[0].id);
    });

    it('persisted-id entries are unchanged (no legacy- prefix)', () => {
        const entries = deserializeContactEntries(
            '[{"id":"550e8400-e29b-41d4-a716-446655440000","type":"phone","value":"555-1234"}]',
        );
        expect(entries[0].id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('deriveStableLegacyId is normalization-stable (phone formatting variants → same id)', () => {
        // Phones normalize to digits only — so the same digit sequence with
        // different separators must derive the same id. (Different digit
        // sequences are correctly different numbers.)
        expect(deriveStableLegacyId('phone', '11 2345-6789'))
            .toBe(deriveStableLegacyId('phone', '11-2345.6789'));
        expect(deriveStableLegacyId('phone', '11 2345-6789'))
            .toBe(deriveStableLegacyId('phone', '1123456789'));
    });
});

describe('legacy address field derivation (v2.16.0-13)', () => {
    it('deriveStreet returns streetAndNumber when set (structured-shape passthrough)', () => {
        const entry: ContactEntry = { type: 'address', value: 'X, Y', streetAndNumber: 'X', locality: 'Y' };
        expect(deriveStreet(entry)).toBe('X');
    });

    it('deriveStreet splits on first comma when only value is present', () => {
        const entry: ContactEntry = { type: 'address', value: 'MAIPU 800, CABA' };
        expect(deriveStreet(entry)).toBe('MAIPU 800');
        expect(deriveLocality(entry)).toBe('CABA');
    });

    it('deriveStreet returns the whole value when no comma (the user-reported case)', () => {
        // "MAIPU 800/CABA" — no comma → can't split; surface the whole thing
        // in the street field rather than empty.
        const entry: ContactEntry = { type: 'address', value: 'MAIPU 800/CABA' };
        expect(deriveStreet(entry)).toBe('MAIPU 800/CABA');
        expect(deriveLocality(entry)).toBe('');
    });

    it('deriveLocality returns locality when set (structured passthrough)', () => {
        const entry: ContactEntry = { type: 'address', value: 'X, Y', streetAndNumber: 'X', locality: 'Y' };
        expect(deriveLocality(entry)).toBe('Y');
    });
});

// v2.16.0-14: social normalize strips the leading @ so '@handle' and
// 'handle' collapse to the same dedup key. Without this, contributing the
// bare handle of an existing '@handle' chip created a duplicate entry
// AND a grant against a different hash (so the original chip stayed
// masked).
describe('social handle normalization (v2.16.0-14)', () => {
    it('mergeContactEntries collapses @-prefixed and bare handles of the same value', () => {
        const merged = mergeContactEntries(
            [{ type: 'social', value: '@adriel_caminos_ortega' }],
            [{ type: 'social', value: 'adriel_caminos_ortega' }],
        );
        expect(merged).toHaveLength(1);
        // Older entry wins (existing dedup rule), keeping the user's
        // original @-prefixed display value.
        expect(merged[0].value).toBe('@adriel_caminos_ortega');
    });

    it('mergeContactEntries also collapses case differences', () => {
        const merged = mergeContactEntries(
            [{ type: 'social', value: '@Adriel' }],
            [{ type: 'social', value: 'adriel' }],
        );
        expect(merged).toHaveLength(1);
    });

    it('does not collapse a URL into a bare handle (different shapes)', () => {
        const merged = mergeContactEntries(
            [{ type: 'social', value: 'https://instagram.com/adriel' }],
            [{ type: 'social', value: '@adriel' }],
        );
        // URLs stay distinct from bare handles — they're different data shapes
        // (the URL embeds the platform). Dedup is value-equality only.
        expect(merged).toHaveLength(2);
    });
});

describe('address street/locality round-trip (regression: empty street)', () => {
    it('keeps an empty street empty on re-edit when only a city was entered', () => {
        // Repro: street empty, city "Buenos Aires". joinedAddressValue drops the
        // empty street so `value` has no comma; deserialize drops the empty street.
        // Before the fix, deriveStreet parsed `value` and put the city in street.
        const json = JSON.stringify([{ type: 'address', value: 'Buenos Aires', streetAndNumber: '', locality: 'Buenos Aires' }]);
        const [entry] = deserializeContactEntries(json);
        expect(deriveStreet(entry)).toBe('');
        expect(deriveLocality(entry)).toBe('Buenos Aires');
    });
    it('round-trips a full structured address', () => {
        const json = JSON.stringify([{ type: 'address', value: 'Cordoba 450, CABA', streetAndNumber: 'Cordoba 450', locality: 'CABA' }]);
        const [entry] = deserializeContactEntries(json);
        expect(deriveStreet(entry)).toBe('Cordoba 450');
        expect(deriveLocality(entry)).toBe('CABA');
    });
    it('street filled + empty city round-trips correctly', () => {
        const json = JSON.stringify([{ type: 'address', value: 'Cordoba 450', streetAndNumber: 'Cordoba 450', locality: '' }]);
        const [entry] = deserializeContactEntries(json);
        expect(deriveStreet(entry)).toBe('Cordoba 450');
        expect(deriveLocality(entry)).toBe('');
    });
    it('legacy single-value (comma) still splits into street + locality', () => {
        const [entry] = deserializeContactEntries(JSON.stringify([{ type: 'address', value: 'Cordoba 450, CABA' }]));
        expect(deriveStreet(entry)).toBe('Cordoba 450');
        expect(deriveLocality(entry)).toBe('CABA');
    });
});
