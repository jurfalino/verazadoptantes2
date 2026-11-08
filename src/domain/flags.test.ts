/**
 * One alert rule everywhere (audit fix round 2, item 9): the profile header's.
 * The header draws ONE pill per kind of alert — «Inexacto» however many
 * inaccuracy reports there are, «Duplicado» only while a duplicate question is
 * open (a merged or kept-separate flag is history). Every count of a person's
 * alerts (household rows, match cards, «¿Es este perfil?», applicants) is the
 * number of those kinds, and a single kind is drawn as that kind's pill.
 */
import { describe, it, expect } from 'vitest';
import { buildFlags, DELIVERY_ADDRESS_COPY_PREFIX, openFlagKinds, openFlagKindsOfRows, profileVerifications, rescuerFlagKinds } from './flags';
import { KEPT_SEPARATE_FLAG_DETAILS_PREFIX } from './dedupPair';

const row = (o: { reason: string | null; targetAdopterId?: string | null; details?: string | null }) => ({ adopterId: 'a', ...o });

describe('buildFlags', () => {
    it('a duplicate flag counts only while open (as the profile header shows it)', () => {
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b' })], 0, []).duplicate).toBe(true);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b', details: 'Merged into b by x@example.com' })], 0, []).duplicate).toBe(false);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}req-1` })], 0, []).duplicate).toBe(false);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: null })], 0, []).duplicate).toBe(false);
    });
    it('inaccurate under either stored reason; verification marks; the system duplicate count', () => {
        const records = [{ identityVerified: 1, deliveredToHome: 1, verifiedAddress: 'Calle Falsa 123' }];
        const f = buildFlags([row({ reason: 'inaccurate' }), row({ reason: 'verified_identity' }), row({ reason: 'verified_address' })], 2, records);
        // Flags only — never the period alerts (Jon, 2026-11-07: a flag is not an alert).
        expect(f).toEqual({ inaccurate: true, duplicate: false, systemDuplicate: true, verified_identity: true, verified_address: true });
        expect(buildFlags([row({ reason: 'inaccurate_information' })], 0, []).inaccurate).toBe(true);
    });
    it('the verification badges come from profileVerifications (the records), not from a stored address mark', () => {
        // V1: a record where the ID was checked is enough — search cards used to miss it.
        expect(buildFlags([], 0, [{ identityVerified: 1 }]).verified_identity).toBe(true);
        // V2: saveAdoption's stored copy alone (the record un-ticked or deleted) shows nothing.
        expect(buildFlags([row({ reason: 'verified_address', details: `${DELIVERY_ADDRESS_COPY_PREFIX} Calle Falsa 123` })], 0, []).verified_address).toBe(false);
    });
});

/**
 * «Identidad Verificada» / «Dirección Verificada» — ONE rule for the profile
 * header, search cards, the applicants panel, /my-adopters and the API
 * (cards V1/V2): worked out from the person's records, so a badge follows
 * every edit and deletion of the record it stands on.
 */
describe('profileVerifications', () => {
    it('identity: any record where the ID was checked', () => {
        expect(profileVerifications([], [{ identityVerified: 0 }, { identityVerified: 1 }]).verified_identity).toBe(true);
        expect(profileVerifications([], [{ identityVerified: 0 }, { identityVerified: null }, {}]).verified_identity).toBe(false);
    });
    it('identity: a verification filed on the profile itself (the old manual button) still counts — it is its own basis', () => {
        expect(profileVerifications([row({ reason: 'verified_identity' })], []).verified_identity).toBe(true);
    });
    it('address: a record delivered home with the address it was delivered to', () => {
        expect(profileVerifications([], [{ deliveredToHome: 1, verifiedAddress: 'Calle Falsa 123' }]).verified_address).toBe(true);
    });
    it('address: gone when its basis is gone — delivery un-ticked, address cleared, or no record', () => {
        expect(profileVerifications([], [{ deliveredToHome: 0, verifiedAddress: 'Calle Falsa 123' }]).verified_address).toBe(false);
        expect(profileVerifications([], [{ deliveredToHome: 1, verifiedAddress: '   ' }]).verified_address).toBe(false);
        expect(profileVerifications([], [{ deliveredToHome: 1, verifiedAddress: null }]).verified_address).toBe(false);
        // The «verified_address» row saveAdoption stores is a copy of a record, never maintained: it is not a basis.
        expect(profileVerifications([row({ reason: 'verified_address', details: `${DELIVERY_ADDRESS_COPY_PREFIX} Calle Falsa 123` })], []).verified_address).toBe(false);
    });
    it('address: a verification filed on the profile by hand (the old «Verificar Dirección» button, a visit) still counts', () => {
        expect(profileVerifications([row({ reason: 'verified_address', details: 'Verified by user' })], []).verified_address).toBe(true);
        expect(profileVerifications([row({ reason: 'verified_address', details: null })], []).verified_address).toBe(true);
    });
});

describe('openFlagKinds', () => {
    it('one per kind, in the header order — never one per report', () => {
        expect(openFlagKindsOfRows([
            row({ reason: 'inaccurate_information' }),
            row({ reason: 'inaccurate' }),
            row({ reason: 'duplicate', targetAdopterId: 'b' }),
            row({ reason: 'duplicate', targetAdopterId: 'c' }),
        ])).toEqual(['inaccurate', 'duplicate']);
    });
    it('closed duplicates and verification marks are not alerts', () => {
        expect(openFlagKindsOfRows([
            row({ reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}household` }),
            row({ reason: 'verified_identity' }),
            row({ reason: 'verified_address' }),
        ])).toEqual([]);
        expect(openFlagKindsOfRows([])).toEqual([]);
    });
    it('from a result\'s flags (search, duplicate check): the same answer', () => {
        expect(openFlagKinds({ inaccurate: false, duplicate: true })).toEqual(['duplicate']);
        expect(openFlagKinds({ inaccurate: true, duplicate: true })).toEqual(['inaccurate', 'duplicate']);
        expect(openFlagKinds(null)).toEqual([]);
        const rows = [row({ reason: 'inaccurate' }), row({ reason: 'duplicate', targetAdopterId: 'b', details: 'Merged into b by x@example.com' })];
        expect(openFlagKinds(buildFlags(rows, 0, []))).toEqual(openFlagKindsOfRows(rows));
    });
});

describe('rescuerFlagKinds — which flags a rescuer-facing surface draws (Jon 2026-11-01)', () => {
    it('«Inexacto» is filtered, under either stored reason; «Duplicado» is kept', () => {
        expect(rescuerFlagKinds(openFlagKindsOfRows([row({ reason: 'inaccurate_information' }), row({ reason: 'duplicate', targetAdopterId: 'b' })]))).toEqual(['duplicate']);
        expect(rescuerFlagKinds(openFlagKindsOfRows([row({ reason: 'inaccurate' })]))).toEqual([]);
        expect(rescuerFlagKinds(['inaccurate'])).toEqual([]);
        expect(rescuerFlagKinds(['duplicate'])).toEqual(['duplicate']);
        expect(rescuerFlagKinds([])).toEqual([]);
    });
    it('the data keeps it: openFlagKinds (the admin UI, the public API) still lists «inaccurate»', () => {
        const kinds = openFlagKinds({ inaccurate: true, duplicate: true });
        expect(kinds).toEqual(['inaccurate', 'duplicate']);
        expect(rescuerFlagKinds(kinds)).toEqual(['duplicate']);
        expect(kinds).toEqual(['inaccurate', 'duplicate']); // not mutated
    });
});
