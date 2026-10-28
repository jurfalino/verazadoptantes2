/**
 * One alert rule everywhere (audit fix round 2, item 9): the profile header's.
 * The header draws ONE pill per kind of alert — «Inexacto» however many
 * inaccuracy reports there are, «Duplicado» only while a duplicate question is
 * open (a merged or kept-separate flag is history). Every count of a person's
 * alerts (household rows, match cards, «¿Es este perfil?», applicants) is the
 * number of those kinds, and a single kind is drawn as that kind's pill.
 */
import { describe, it, expect } from 'vitest';
import { buildFlags, openAlertKinds, openAlertKindsOfRows } from './flags';
import { KEPT_SEPARATE_FLAG_DETAILS_PREFIX } from './dedupPair';

const row = (o: { reason: string | null; targetAdopterId?: string | null; details?: string | null }) => ({ adopterId: 'a', ...o });

describe('buildFlags', () => {
    it('a duplicate flag counts only while open (as the profile header shows it)', () => {
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b' })], 0).duplicate).toBe(true);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b', details: 'Merged into b by x@example.com' })], 0).duplicate).toBe(false);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}req-1` })], 0).duplicate).toBe(false);
        expect(buildFlags([row({ reason: 'duplicate', targetAdopterId: null })], 0).duplicate).toBe(false);
    });
    it('inaccurate under either stored reason; verification marks; the system duplicate count', () => {
        const f = buildFlags([row({ reason: 'inaccurate' }), row({ reason: 'verified_identity' }), row({ reason: 'verified_address' })], 2);
        expect(f).toMatchObject({ inaccurate: true, duplicate: false, systemDuplicate: true, verified_identity: true, verified_address: true, tooManyAdoptions: null, tooManyRequests: null });
        expect(buildFlags([row({ reason: 'inaccurate_information' })], 0).inaccurate).toBe(true);
    });
});

describe('openAlertKinds', () => {
    it('one per kind, in the header order — never one per report', () => {
        expect(openAlertKindsOfRows([
            row({ reason: 'inaccurate_information' }),
            row({ reason: 'inaccurate' }),
            row({ reason: 'duplicate', targetAdopterId: 'b' }),
            row({ reason: 'duplicate', targetAdopterId: 'c' }),
        ])).toEqual(['inaccurate', 'duplicate']);
    });
    it('closed duplicates and verification marks are not alerts', () => {
        expect(openAlertKindsOfRows([
            row({ reason: 'duplicate', targetAdopterId: 'b', details: `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}household` }),
            row({ reason: 'verified_identity' }),
            row({ reason: 'verified_address' }),
        ])).toEqual([]);
        expect(openAlertKindsOfRows([])).toEqual([]);
    });
    it('from a result\'s flags (search, duplicate check): the same answer', () => {
        expect(openAlertKinds({ inaccurate: false, duplicate: true })).toEqual(['duplicate']);
        expect(openAlertKinds({ inaccurate: true, duplicate: true })).toEqual(['inaccurate', 'duplicate']);
        expect(openAlertKinds(null)).toEqual([]);
        const rows = [row({ reason: 'inaccurate' }), row({ reason: 'duplicate', targetAdopterId: 'b', details: 'Merged into b by x@example.com' })];
        expect(openAlertKinds(buildFlags(rows, 0))).toEqual(openAlertKindsOfRows(rows));
    });
});
