import { describe, it, expect } from 'vitest';
import {
    canEditAdopterRecord,
    hashEntryValue,
    matchSearchEntries,
    resolveVisibility,
    maskContactEntries,
    maskAdopterContact,
    redactHistoryChanges,
    PII_MASK,
    MASKED_CONTACT_PLACEHOLDER,
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

    it('masks locked identifier entries and keeps notes', () => {
        const r = maskContactEntries(entries, vis({}));
        expect(r.maskedCount).toBe(2);
        expect(r.entries[0]).toEqual({ type: 'phone', value: PII_MASK, masked: true });
        expect(r.entries[1]).toEqual({ type: 'email', value: PII_MASK, masked: true });
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

    it('masks structured entries plus the address column', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789\nEmail: a@b.com', contactEntries: entriesJson, addressInfo: 'Calle 1' },
            vis({}),
        );
        expect(r.maskedFieldCount).toBe(3); // 2 entries + address
        expect(r.addressInfo).toBe(PII_MASK);
        const parsed = JSON.parse(r.contactEntries as string);
        expect(parsed.every((e: ContactEntry) => e.masked)).toBe(true);
        expect(r.contactInfo).not.toContain('1123456789');
    });

    it('masks a legacy blob (no structured entries) to the placeholder', () => {
        const r = maskAdopterContact(
            { contactInfo: 'Tel: 1123456789', contactEntries: null, addressInfo: null },
            vis({}),
        );
        expect(r.contactInfo).toBe(MASKED_CONTACT_PLACEHOLDER);
        expect(r.contactEntries).toBeNull();
        expect(r.maskedFieldCount).toBe(1);
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
        { type: 'other', value: 'Vive en zona sur' },
    ];

    it('matches a phone entry on a digit-substring query', () => {
        const m = matchSearchEntries(entries, '2345-6789');
        expect(m).toHaveLength(1);
        expect(m[0].entry.type).toBe('phone');
        expect(m[0].hash).toBe(hashEntryValue('phone', '11 2345-6789'));
    });

    it('does not match a phone on a query shorter than the digit minimum', () => {
        expect(matchSearchEntries(entries, '2345')).toHaveLength(0);
    });

    it('matches an email entry on an @-containing query', () => {
        const m = matchSearchEntries(entries, 'juan@gmail.com');
        expect(m).toHaveLength(1);
        expect(m[0].entry.type).toBe('email');
    });

    it('a name-token query never unlocks an email or any identifier', () => {
        // 'juan' is a substring of juan@gmail.com / @juanperez but is not
        // identifier-shaped — it must not produce a grant.
        expect(matchSearchEntries(entries, 'juan')).toHaveLength(0);
    });

    it('matches a social entry on an @handle query', () => {
        const m = matchSearchEntries(entries, '@juanperez');
        expect(m).toHaveLength(1);
        expect(m[0].entry.type).toBe('social');
    });

    it('never auto-unlocks id / address / other entries', () => {
        expect(matchSearchEntries(entries, '30123456')).toHaveLength(0);
        expect(matchSearchEntries(entries, 'zona sur')).toHaveLength(0);
    });

    it('returns nothing for an empty query', () => {
        expect(matchSearchEntries(entries, '   ')).toHaveLength(0);
    });
});
