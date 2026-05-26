import { describe, it, expect } from 'vitest';
import {
    canEditAdopterRecord,
    hashEntryValue,
    hashNameToken,
    matchSearchEntries,
    matchSearchNameTokens,
    renderName,
    resolveVisibility,
    maskContactEntries,
    maskAdopterContact,
    partialReveal,
    partialRevealAddressString,
    partialRevealName,
    redactHistoryChanges,
    isRealActorEmail,
    piiCooldownUntil,
    PII_MASK,
    PII_DENIAL_COOLDOWN_DAYS,
    type Visibility,
    type PiiGrantRow,
} from './piiAccess';
import type { ContactEntry } from './contactEntries';

/** Build a Visibility for masking tests without going through the resolver. */
function vis(partial: Partial<Visibility>): Visibility {
    return {
        tier: 'none',
        privileged: false,
        nothingMasked: false,
        hasAllContactGrant: false,
        unlockedEntryHashes: new Set(),
        unlockedNameTokenHashes: new Set(),
        ...partial,
    };
}

describe('canEditAdopterRecord', () => {
    it('allows any actor when gating is off (legacy behavior)', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: false,
            actorEmail: 'stranger@example.com',
            ownerEmail: 'owner@example.com',
            actorIsAdmin: false,
        })).toBe(true);
    });

    it('allows the record owner to edit when gating is on', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: 'owner@example.com',
            ownerEmail: 'owner@example.com',
            actorIsAdmin: false,
        })).toBe(true);
    });

    it('blocks a non-owner non-admin when gating is on', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: 'stranger@example.com',
            ownerEmail: 'owner@example.com',
            actorIsAdmin: false,
        })).toBe(false);
    });

    it('allows an admin to edit any record when gating is on', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: 'admin@example.com',
            ownerEmail: 'owner@example.com',
            actorIsAdmin: true,
        })).toBe(true);
    });

    it('blocks a non-admin from editing a record with no real owner', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: 'stranger@example.com',
            ownerEmail: 'anonymous',
            actorIsAdmin: false,
        })).toBe(false);
    });

    it('allows an admin to edit a record with no real owner', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: 'admin@example.com',
            ownerEmail: 'anonymous',
            actorIsAdmin: true,
        })).toBe(true);
    });

    it('blocks an unresolved actor (empty email) even if owner is also empty', () => {
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: '',
            ownerEmail: '',
            actorIsAdmin: false,
        })).toBe(false);
        expect(canEditAdopterRecord({
            gatingEnabled: true,
            actorEmail: null,
            ownerEmail: null,
            actorIsAdmin: false,
        })).toBe(false);
    });
});

describe('hashEntryValue', () => {
    it('is deterministic for the same input', () => {
        expect(hashEntryValue('email', 'a@b.com')).toBe(hashEntryValue('email', 'a@b.com'));
    });

    it('ignores phone formatting (normalized to digits)', () => {
        expect(hashEntryValue('phone', '11 2345-6789')).toBe(hashEntryValue('phone', '1123456789'));
    });

    it('ignores email case', () => {
        expect(hashEntryValue('email', 'A@B.com')).toBe(hashEntryValue('email', 'a@b.com'));
    });

    it('produces different hashes for different values', () => {
        expect(hashEntryValue('phone', '1123456789')).not.toBe(hashEntryValue('phone', '1199999999'));
    });
});

describe('resolveVisibility', () => {
    const base = { isAdmin: false, isEditor: false, grants: [] as PiiGrantRow[] };

    it('owner gets full visibility, nothing masked', () => {
        const v = resolveVisibility({ ...base, viewerEmail: 'o@x.com', ownerEmail: 'o@x.com' });
        expect(v.tier).toBe('full');
        expect(v.privileged).toBe(true);
        expect(v.nothingMasked).toBe(true);
    });

    it('admin and editor get full visibility', () => {
        expect(resolveVisibility({ ...base, viewerEmail: 'a@x.com', ownerEmail: 'o@x.com', isAdmin: true }).nothingMasked).toBe(true);
        expect(resolveVisibility({ ...base, viewerEmail: 'e@x.com', ownerEmail: 'o@x.com', isEditor: true }).nothingMasked).toBe(true);
    });

    it('authenticated non-privileged viewer with no grants gets tier none', () => {
        const v = resolveVisibility({ ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com' });
        expect(v.tier).toBe('none');
        expect(v.nothingMasked).toBe(false);
    });

    it('an all_contact grant unmasks everything (partial tier)', () => {
        const v = resolveVisibility({
            ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com',
            grants: [{ scope: 'all_contact', entryRef: null, revokedAt: null }],
        });
        expect(v.tier).toBe('partial');
        expect(v.hasAllContactGrant).toBe(true);
        expect(v.nothingMasked).toBe(true);
    });

    it('an entry grant unlocks only that entry hash', () => {
        const ref = hashEntryValue('phone', '1123456789');
        const v = resolveVisibility({
            ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com',
            grants: [{ scope: 'entry', entryRef: ref, revokedAt: null }],
        });
        expect(v.tier).toBe('partial');
        expect(v.nothingMasked).toBe(false);
        expect(v.unlockedEntryHashes.has(ref)).toBe(true);
    });

    it('ignores revoked grants', () => {
        const v = resolveVisibility({
            ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com',
            grants: [{ scope: 'all_contact', entryRef: null, revokedAt: new Date() }],
        });
        expect(v.nothingMasked).toBe(false);
        expect(v.tier).toBe('none');
    });

    it('a viewer with no email gets tier none', () => {
        expect(resolveVisibility({ ...base, viewerEmail: '', ownerEmail: 'o@x.com' }).tier).toBe('none');
    });
});

describe('partialReveal', () => {
    it('phone: keeps first 4 digits, masks the rest, preserves separators', () => {
        expect(partialReveal({ type: 'phone', value: '11 2345-6789' }).value).toBe('11 23••-••••');
        expect(partialReveal({ type: 'phone', value: '+54 9 11 2345-6789' }).value).toBe('+54 9 1• ••••-••••');
        expect(partialReveal({ type: 'phone', value: '1123456789' }).value).toBe('1123••••••');
    });

    it('email: keeps first char of local + full domain', () => {
        expect(partialReveal({ type: 'email', value: 'juan@gmail.com' }).value).toBe('j•••@gmail.com');
    });

    it('social: URL keeps domain prefix; bare @handle keeps the @', () => {
        expect(partialReveal({ type: 'social', value: 'https://instagram.com/juanperez' }).value).toBe('https://instagram.com/••••');
        expect(partialReveal({ type: 'social', value: 'instagram.com/juanperez' }).value).toBe('instagram.com/••••');
        expect(partialReveal({ type: 'social', value: '@juanperez' }).value).toBe('@••••');
    });

    it('address: keeps the last comma-separated locality, masks the street', () => {
        expect(partialReveal({ type: 'address', value: 'Corrientes 3444, CABA' }).value).toBe('•••••, CABA');
        expect(partialReveal({ type: 'address', value: 'Calle Falsa 123, Quilmes, Buenos Aires' }).value).toBe('•••••, Buenos Aires');
        expect(partialReveal({ type: 'address', value: 'Corrientes 3444' }).value).toBe('•••••••');
    });

    it('id: fully masked (the row label names the type)', () => {
        expect(partialReveal({ type: 'id', value: '30123456' }).value).toBe(PII_MASK);
    });

    it('other (notes): passed through unchanged, no `masked` flag', () => {
        const note: ContactEntry = { type: 'other', value: 'Vive en zona sur' };
        expect(partialReveal(note)).toEqual(note);
        expect(partialReveal(note).masked).toBeUndefined();
    });

    it('always sets masked: true on a partial-revealed identifier', () => {
        expect(partialReveal({ type: 'phone', value: '1234567' }).masked).toBe(true);
        expect(partialReveal({ type: 'email', value: 'a@b.com' }).masked).toBe(true);
        expect(partialReveal({ type: 'address', value: 'X, Y' }).masked).toBe(true);
        expect(partialReveal({ type: 'id', value: '12345' }).masked).toBe(true);
    });

    it('preserves the entry label on masked output', () => {
        const out = partialReveal({ type: 'id', value: '30123456', label: 'DNI' });
        expect(out.label).toBe('DNI');
    });
});

describe('partialRevealAddressString', () => {
    it('keeps the locality when there is a comma', () => {
        expect(partialRevealAddressString('Corrientes 3444, CABA')).toBe('•••••, CABA');
    });

    it('falls back to full mask when there is no comma', () => {
        expect(partialRevealAddressString('Corrientes 3444')).toBe('•••••••');
    });

    it('returns empty string for empty / whitespace input', () => {
        expect(partialRevealAddressString('')).toBe('');
        expect(partialRevealAddressString('   ')).toBe('');
    });
});

describe('partialRevealName', () => {
    it('reduces a multi-word name to initials', () => {
        expect(partialRevealName('Maria Gomez')).toBe('M G');
        expect(partialRevealName('Maria Jose Gomez')).toBe('M J G');
        expect(partialRevealName('  Maria   Gomez  ')).toBe('M G');
        expect(partialRevealName('Maria')).toBe('M');
    });

    it('returns empty for empty / null / undefined input', () => {
        expect(partialRevealName('')).toBe('');
        expect(partialRevealName(null)).toBe('');
        expect(partialRevealName(undefined)).toBe('');
    });
});

describe('hashNameToken', () => {
    it('is deterministic and accent-insensitive', () => {
        expect(hashNameToken('Maria')).toBe(hashNameToken('maria'));
        expect(hashNameToken('María')).toBe(hashNameToken('maria'));
        expect(hashNameToken(' MARÍA  ')).toBe(hashNameToken('maria'));
    });

    it('produces different hashes for different tokens', () => {
        expect(hashNameToken('Maria')).not.toBe(hashNameToken('Mario'));
    });
});

describe('matchSearchNameTokens', () => {
    it('returns the name tokens that appear (whole-word) in the query', () => {
        expect(matchSearchNameTokens('Maria Gomez', 'Maria 1123456789')).toEqual(['Maria']);
        expect(matchSearchNameTokens('Maria Jose Gomez', 'Jose Gomez')).toEqual(['Jose', 'Gomez']);
        expect(matchSearchNameTokens('Maria Gomez', 'Maria Gomez extra')).toEqual(['Maria', 'Gomez']);
    });

    it('is accent-insensitive on both sides', () => {
        expect(matchSearchNameTokens('María Gómez', 'maria gomez')).toEqual(['María', 'Gómez']);
        expect(matchSearchNameTokens('Maria Gomez', 'María Gómez')).toEqual(['Maria', 'Gomez']);
    });

    it('does not match on a partial-word substring (Mariano ≠ Maria)', () => {
        expect(matchSearchNameTokens('Maria Gomez', 'Mariano')).toEqual([]);
    });

    it('skips tokens shorter than 2 chars (so "M" / "a" never grant)', () => {
        expect(matchSearchNameTokens('M G', 'M G Z')).toEqual([]);
        expect(matchSearchNameTokens('Maria Gomez', 'm')).toEqual([]);
    });

    it('returns nothing for empty input', () => {
        expect(matchSearchNameTokens('', 'Maria')).toEqual([]);
        expect(matchSearchNameTokens('Maria', '')).toEqual([]);
        expect(matchSearchNameTokens(null, 'Maria')).toEqual([]);
    });
});

describe('renderName', () => {
    it('returns the original name for a privileged viewer', () => {
        expect(renderName('Maria Gomez', vis({ nothingMasked: true }))).toBe('Maria Gomez');
    });

    it('returns initials only with no grants and no query', () => {
        expect(renderName('Maria Gomez', vis({}))).toBe('M G');
        expect(renderName('Maria Jose Gomez', vis({}))).toBe('M J G');
    });

    it('reveals tokens carried in the current query (transient)', () => {
        expect(renderName('Maria Gomez', vis({}), 'Maria 1123456789')).toBe('Maria G');
        expect(renderName('Maria Gomez', vis({}), 'Maria Gomez')).toBe('Maria Gomez');
        // Whole-word match — "Mariano" does NOT reveal "Maria".
        expect(renderName('Maria Gomez', vis({}), 'Mariano')).toBe('M G');
    });

    it('reveals tokens covered by persistent name_token grants', () => {
        const v = vis({ unlockedNameTokenHashes: new Set([hashNameToken('Maria')]) });
        expect(renderName('Maria Gomez', v)).toBe('Maria G');
    });

    it('combines persistent grants with current-query reveals', () => {
        const v = vis({ unlockedNameTokenHashes: new Set([hashNameToken('Maria')]) });
        expect(renderName('Maria Jose Gomez', v, 'Gomez')).toBe('Maria J Gomez');
    });

    it('returns empty for empty / null / undefined input', () => {
        expect(renderName('', vis({}))).toBe('');
        expect(renderName(null, vis({}))).toBe('');
        expect(renderName(undefined, vis({}))).toBe('');
    });
});

describe('resolveVisibility — name_token grants', () => {
    const base = { isAdmin: false, isEditor: false, grants: [] as PiiGrantRow[] };

    it('populates unlockedNameTokenHashes from scope=name_token grants', () => {
        const h = hashNameToken('Maria');
        const v = resolveVisibility({
            ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com',
            grants: [{ scope: 'name_token', entryRef: h, revokedAt: null }],
        });
        expect(v.unlockedNameTokenHashes.has(h)).toBe(true);
        expect(v.tier).toBe('partial'); // name-token alone is enough to lift from 'none'
        expect(v.nothingMasked).toBe(false);
    });

    it('keeps the two grant sets separate (entry vs name_token)', () => {
        const eh = hashEntryValue('phone', '1123456789');
        const nh = hashNameToken('Maria');
        const v = resolveVisibility({
            ...base, viewerEmail: 's@x.com', ownerEmail: 'o@x.com',
            grants: [
                { scope: 'entry', entryRef: eh, revokedAt: null },
                { scope: 'name_token', entryRef: nh, revokedAt: null },
            ],
        });
        expect(v.unlockedEntryHashes.has(eh)).toBe(true);
        expect(v.unlockedNameTokenHashes.has(nh)).toBe(true);
        expect(v.unlockedEntryHashes.has(nh)).toBe(false);
        expect(v.unlockedNameTokenHashes.has(eh)).toBe(false);
    });
});

describe('maskContactEntries', () => {
    const entries: ContactEntry[] = [
        { type: 'phone', value: '1123456789' },
        { type: 'email', value: 'a@b.com' },
        { type: 'other', value: 'Llamar después de las 18h' },
    ];

    it('returns entries untouched when nothing is masked', () => {
        const r = maskContactEntries(entries, vis({ nothingMasked: true }));
        expect(r.maskedCount).toBe(0);
        expect(r.entries).toBe(entries);
    });

    it('partial-reveals locked identifier entries and keeps notes', () => {
        // Locked entries now get the partial-reveal shape (first 4 phone
        // digits, first char of email local) rather than a flat ••••••.
        const r = maskContactEntries(entries, vis({}));
        expect(r.maskedCount).toBe(2);
        expect(r.entries[0]).toEqual({ type: 'phone', value: '1123••••••', masked: true });
        expect(r.entries[1]).toEqual({ type: 'email', value: 'a•••@b.com', masked: true });
        expect(r.entries[2]).toEqual({ type: 'other', value: 'Llamar después de las 18h' });
    });

    it('keeps an entry whose hash is unlocked', () => {
        const r = maskContactEntries(entries, vis({
            unlockedEntryHashes: new Set([hashEntryValue('email', 'a@b.com')]),
        }));
        expect(r.maskedCount).toBe(1);
        expect(r.entries[0].masked).toBe(true);          // phone masked
        expect(r.entries[1]).toEqual({ type: 'email', value: 'a@b.com' }); // email unlocked
    });
});

describe('maskAdopterContact', () => {
    const entriesJson = JSON.stringify([
        { type: 'phone', value: '1123456789' },
        { type: 'email', value: 'a@b.com' },
    ]);

    it('leaves a privileged viewer unmasked with count 0', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789', contactEntries: entriesJson, addressInfo: 'Calle 1' },
            vis({ nothingMasked: true }),
        );
        expect(r.maskedFieldCount).toBe(0);
        expect(r.contactEntries).toBe(entriesJson);
        expect(r.addressInfo).toBe('Calle 1');
    });

    it('partial-reveals structured entries plus the address column', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789\nEmail: a@b.com', contactEntries: entriesJson, addressInfo: 'Calle 1' },
            vis({}),
        );
        expect(r.maskedFieldCount).toBe(3); // 2 entries + address
        // addressInfo runs through the address rule — no comma in "Calle 1"
        // so it falls back to the masked street form.
        expect(r.addressInfo).toBe('•••••••');
        const parsed = JSON.parse(r.contactEntries as string);
        expect(parsed.every((e: ContactEntry) => e.masked)).toBe(true);
        // Full phone digits are no longer in the derived blob, but the
        // partial-reveal prefix is.
        expect(r.contactInfo).not.toContain('1123456789');
        expect(r.contactInfo).toContain('1123');
    });

    it('partial-reveals a legacy blob by parsing → masking → re-deriving', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789', contactEntries: null, addressInfo: null },
            vis({}),
        );
        // Legacy rows now get the same partial-reveal: the parsed phone is
        // shown as 1123•••••• in the rebuilt blob — not the all-or-nothing
        // placeholder we used before.
        expect(r.contactInfo).toContain('1123');
        expect(r.contactInfo).not.toContain('1123456789');
        expect(r.contactEntries).toBeNull(); // legacy rows stay structurally legacy
        expect(r.maskedFieldCount).toBe(1);
    });

    it('falls back to the placeholder only when a legacy blob parses to nothing', () => {
        const r = maskAdopterContact(
            { contactInfo: 'just a random sentence with no identifiers', contactEntries: null, addressInfo: null },
            vis({}),
        );
        // The blob parses into an `other` (note) entry, which doesn't auto-mask.
        // No identifier → maskedCount 0 → blob re-derived from the unchanged
        // note → no placeholder is needed.
        expect(r.maskedFieldCount).toBe(0);
        // contactInfo carries the original prose (verbatim, since notes pass through).
        expect(r.contactInfo).toContain('random sentence');
    });

    it('keeps a search-unlocked entry visible', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789\nEmail: a@b.com', contactEntries: entriesJson, addressInfo: null },
            vis({ unlockedEntryHashes: new Set([hashEntryValue('phone', '1123456789')]) }),
        );
        expect(r.maskedFieldCount).toBe(1); // only the email
        const parsed = JSON.parse(r.contactEntries as string) as ContactEntry[];
        expect(parsed.find(e => e.type === 'phone')?.value).toBe('1123456789');
        expect(parsed.find(e => e.type === 'email')?.masked).toBe(true);
    });
});

describe('redactHistoryChanges', () => {
    it('returns changes untouched for a privileged viewer', () => {
        const json = JSON.stringify({ contactInfo: { from: 'a', to: 'b' } });
        expect(redactHistoryChanges(json, vis({ nothingMasked: true }))).toBe(json);
    });

    it('redacts a contact delta but keeps a name delta', () => {
        const json = JSON.stringify({ name: { from: 'Ana', to: 'Ana B' }, contactInfo: { from: 'old', to: 'new' } });
        const out = JSON.parse(redactHistoryChanges(json, vis({})) as string);
        expect(out.name).toEqual({ from: 'Ana', to: 'Ana B' });
        expect(out.contactInfo).toEqual({ from: PII_MASK, to: PII_MASK });
    });

    it('redacts contact fields inside an appended_from_create_flow blob', () => {
        const json = JSON.stringify({
            appended_from_create_flow: { appendedFields: { contactInfo: '1123456789', sourceUrl: 'http://x' } },
        });
        const out = JSON.parse(redactHistoryChanges(json, vis({})) as string);
        expect(out.appended_from_create_flow.appendedFields.contactInfo).toBe(PII_MASK);
        expect(out.appended_from_create_flow.appendedFields.sourceUrl).toBe('http://x');
    });

    it('handles null and unparseable input gracefully', () => {
        expect(redactHistoryChanges(null, vis({}))).toBeNull();
        expect(redactHistoryChanges('not json', vis({}))).toBe('not json');
    });
});

describe('matchSearchEntries', () => {
    const entries: ContactEntry[] = [
        { type: 'phone', value: '11 2345-6789' },
        { type: 'email', value: 'juan@gmail.com' },
        { type: 'social', value: '@juanperez' },
        { type: 'id', value: '30123456' },
        { type: 'address', value: 'Corrientes 3444' },
        { type: 'other', value: 'Vive en zona sur' },
    ];

    it('matches a phone entry on a digit-substring query', () => {
        const m = matchSearchEntries(entries, '2345-6789');
        expect(m.map(x => x.entry.type)).toEqual(['phone']);
        expect(m[0].hash).toBe(hashEntryValue('phone', '11 2345-6789'));
    });

    it('matches a phone via a digit run when the query carries other digits too (regression)', () => {
        // The earlier code concatenated every query digit into one string and
        // checked if the entry contained it — so "808080 Corrientes 3444"
        // (qDigits "8080803444", 10 digits) could never match an 8-digit phone.
        // The per-run path now matches "808080" against "80808080".
        const local: ContactEntry[] = [{ type: 'phone', value: '80808080' }];
        const m = matchSearchEntries(local, '808080 Corrientes 3444');
        expect(m.map(x => x.entry.type)).toContain('phone');
    });

    it('keeps matching a formatted phone via the concatenated digits', () => {
        const local: ContactEntry[] = [{ type: 'phone', value: '541123456789' }];
        const m = matchSearchEntries(local, '+54 11 2345-6789');
        expect(m.map(x => x.entry.type)).toContain('phone');
    });

    it('does not match a phone on a query shorter than the digit minimum', () => {
        expect(matchSearchEntries(entries, '2345')).toHaveLength(0);
    });

    it('matches an email entry on an @-containing query', () => {
        const m = matchSearchEntries(entries, 'juan@gmail.com');
        expect(m.map(x => x.entry.type)).toEqual(['email']);
    });

    it('a name-token query never unlocks an email or any identifier', () => {
        // 'juan' is a substring of juan@gmail.com / @juanperez but is not
        // identifier-shaped — no anchor, no matches.
        expect(matchSearchEntries(entries, 'juan')).toHaveLength(0);
    });

    it('matches a social entry on an @handle query', () => {
        const m = matchSearchEntries(entries, '@juanperez');
        expect(m.map(x => x.entry.type)).toEqual(['social']);
    });

    it('a full id alone anchors and unlocks the id (confidence-rule reshape)', () => {
        // Reshape: a full DNI is at least as specific as 6 phone digits;
        // it should anchor on its own.
        const m = matchSearchEntries(entries, '30123456');
        expect(m.map(x => x.entry.type)).toEqual(['id']);
    });

    it('a full id with formatting alone anchors (digits-only normalized)', () => {
        const m = matchSearchEntries(entries, '30.123.456');
        expect(m.map(x => x.entry.type)).toEqual(['id']);
    });

    it('a short id (< 6 digits) cannot anchor on its own', () => {
        const local: ContactEntry[] = [{ type: 'id', value: '12345' }];
        expect(matchSearchEntries(local, '12345')).toHaveLength(0);
    });

    it('a full street-plus-number address alone anchors (specific part)', () => {
        const m = matchSearchEntries(entries, 'Corrientes 3444');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('an address fragment (text-only, no number) alone does not anchor', () => {
        // "Corrientes" (without the number) is a loose fragment; no anchor,
        // no fan-grant. The fragment ride-along still works when something
        // else anchors the adopter — see the combined-query test below.
        expect(matchSearchEntries(entries, 'Corrientes')).toHaveLength(0);
        expect(matchSearchEntries(entries, 'zona sur')).toHaveLength(0);
    });

    it('a single loose address part (locality alone) does not anchor', () => {
        const local: ContactEntry[] = [{ type: 'address', value: 'Peru 999, San Isidro, 3680' }];
        expect(matchSearchEntries(local, 'San Isidro')).toHaveLength(0);
    });

    it('two loose address parts (locality + postal code) together anchor', () => {
        const local: ContactEntry[] = [{ type: 'address', value: 'Peru 999, San Isidro, 3680' }];
        const m = matchSearchEntries(local, 'San Isidro 3680');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('typo in a loose address part still anchors via Lev-1', () => {
        // "Sprigfield" vs "Springfield" — one deletion. Combined with the
        // postal code, two loose parts match → anchors.
        const local: ContactEntry[] = [{ type: 'address', value: 'Calle Falsa 123, Springfield, 5555' }];
        const m = matchSearchEntries(local, 'Sprigfield 5555');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('typo in a specific address part does not anchor (digit-confusion guard)', () => {
        // "Peru 998" must not unlock entry "Peru 999". Specific parts use
        // exact substring match — Lev-1 on a digit substitution would
        // collapse the difference between neighboring street numbers.
        const local: ContactEntry[] = [{ type: 'address', value: 'Peru 999, San Isidro, 3680' }];
        expect(matchSearchEntries(local, 'Peru 998')).toHaveLength(0);
    });

    it('structured address: exact substring of streetAndNumber anchors (no comma-tokenization)', () => {
        const local: ContactEntry[] = [{
            type: 'address',
            value: 'Peru 999, San Isidro',
            streetAndNumber: 'Peru 999',
            locality: 'San Isidro',
        }];
        const m = matchSearchEntries(local, 'Peru 999');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('structured address: locality-only query does NOT anchor (locality is non-gated)', () => {
        const local: ContactEntry[] = [{
            type: 'address',
            value: 'Peru 999, San Isidro',
            streetAndNumber: 'Peru 999',
            locality: 'San Isidro',
        }];
        expect(matchSearchEntries(local, 'San Isidro')).toHaveLength(0);
    });

    it('structured address: typo in streetAndNumber does NOT anchor (exact required)', () => {
        const local: ContactEntry[] = [{
            type: 'address',
            value: 'Peru 999, San Isidro',
            streetAndNumber: 'Peru 999',
            locality: 'San Isidro',
        }];
        expect(matchSearchEntries(local, 'Peru 998')).toHaveLength(0);
    });

    it('structured address: short streetAndNumber (< 5 chars) does not anchor', () => {
        const local: ContactEntry[] = [{
            type: 'address',
            value: 'Av 1, CABA',
            streetAndNumber: 'Av 1',
            locality: 'CABA',
        }];
        expect(matchSearchEntries(local, 'Av 1')).toHaveLength(0);
    });

    it('raw-paste address falls back to the comma-tokenized rule on `value`', () => {
        const local: ContactEntry[] = [{
            type: 'address',
            value: 'Peru 999, San Isidro, 3680',
            raw: 'Peru 999, San Isidro, 3680',
        }];
        const m = matchSearchEntries(local, 'Peru 999');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('apartment-style part (e.g. "5B") is loose, not specific', () => {
        // "5B" has a digit and a letter but fails min-letters (1 < 2) and
        // min-length (2 < 5) — treated as loose, can't anchor alone.
        const local: ContactEntry[] = [{ type: 'address', value: 'Av. Corrientes 3444, 5B, CABA' }];
        expect(matchSearchEntries(local, '5B')).toHaveLength(0);
        // The specific street-plus-number part still anchors when typed in full.
        const m = matchSearchEntries(local, 'Av. Corrientes 3444');
        expect(m.map(x => x.entry.type)).toEqual(['address']);
    });

    it('combined query (phone + address) unlocks the address when the phone anchors it', () => {
        // The user's reported case: the searcher demonstrably has BOTH the
        // phone digits AND the street + number → the address rides along.
        const m = matchSearchEntries(entries, '2345-6789 Corrientes 3444');
        const types = m.map(x => x.entry.type).sort();
        expect(types).toEqual(['address', 'phone']);
    });

    it('combined query (phone + id) unlocks the id when the phone anchors it', () => {
        const m = matchSearchEntries(entries, '2345-6789 30123456');
        const types = m.map(x => x.entry.type).sort();
        expect(types).toEqual(['id', 'phone']);
    });

    it('id matching is formatting-insensitive when anchored', () => {
        // Entry "30123456" should still unlock when the query writes it as "30.123.456".
        const m = matchSearchEntries(entries, '2345-6789 30.123.456');
        expect(m.map(x => x.entry.type)).toContain('id');
    });

    it('never auto-unlocks the `other` note type, even when anchored', () => {
        const m = matchSearchEntries(entries, '2345-6789 vive en zona sur');
        expect(m.map(x => x.entry.type)).not.toContain('other');
    });

    it('returns nothing for an empty query', () => {
        expect(matchSearchEntries(entries, '   ')).toHaveLength(0);
    });

    it('with anchorRequiredForSecondary: false, an address-only query unlocks the address', () => {
        // Profile-scoped verify path — no fan-grant concern, so a bare address
        // works without an identifier anchor.
        const m = matchSearchEntries(entries, 'Corrientes 3444', { anchorRequiredForSecondary: false });
        expect(m.map(x => x.entry.type)).toContain('address');
    });

    it('with anchorRequiredForSecondary: false, an id-only query unlocks the id', () => {
        const m = matchSearchEntries(entries, '30123456', { anchorRequiredForSecondary: false });
        expect(m.map(x => x.entry.type)).toContain('id');
    });

    it('with anchorRequiredForSecondary: false, `other` still never auto-unlocks', () => {
        expect(matchSearchEntries(entries, 'Vive en zona sur', { anchorRequiredForSecondary: false })).toHaveLength(0);
    });
});

describe('isRealActorEmail', () => {
    it('accepts a genuine user email', () => {
        expect(isRealActorEmail('rescuer@example.com')).toBe(true);
    });

    it('rejects sentinels and empty values', () => {
        for (const v of ['anonymous', 'unknown', 'system', 'form-submission', 'contract-submission', '', null, undefined]) {
            expect(isRealActorEmail(v)).toBe(false);
        }
    });
});

describe('piiCooldownUntil', () => {
    it('adds the cooldown window to a denial Date', () => {
        const denied = new Date('2026-05-01T00:00:00Z');
        const until = piiCooldownUntil(denied);
        const expectedDays = (until.getTime() - denied.getTime()) / 86_400_000;
        expect(expectedDays).toBe(PII_DENIAL_COOLDOWN_DAYS);
    });

    it('accepts an epoch-ms number', () => {
        const ms = Date.UTC(2026, 4, 1);
        expect(piiCooldownUntil(ms).getTime()).toBe(ms + PII_DENIAL_COOLDOWN_DAYS * 86_400_000);
    });
});
