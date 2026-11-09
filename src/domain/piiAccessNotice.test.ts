import { describe, it, expect } from 'vitest';
import { piiAccessNotice, type AccessRequestFact, type AccessGrantFact } from './piiAccessNotice';

const VIEWER = 'viewer@example.com';
const OWNER = 'owner@example.com';

const req = (p: Partial<AccessRequestFact>): AccessRequestFact => ({
    status: 'pending', createdAt: 1000, resolvedAt: null, resolutionNote: null, ...p,
});
const grant = (p: Partial<AccessGrantFact>): AccessGrantFact => ({
    id: 'g1', scope: 'all_contact', origin: 'request', createdAt: 2000, revokedAt: null, revokedByEmail: null, ...p,
});
const notice = (requests: AccessRequestFact[], grants: AccessGrantFact[] = [], viewerEmail = VIEWER) =>
    piiAccessNotice({ viewerEmail, requests, grants });

describe('piiAccessNotice — denial', () => {
    it('no requests → nothing', () => {
        expect(notice([])).toEqual({ denial: null, accessRevokedAt: null, accessRevokedBy: null });
    });

    it('a denial with a note shows the note (trimmed)', () => {
        expect(notice([req({ status: 'denied', resolvedAt: 2000, resolutionNote: '  Solo Córdoba. ' })]).denial)
            .toEqual({ note: 'Solo Córdoba.' });
    });

    it('a denial with no note (or only spaces) still says it was not approved', () => {
        expect(notice([req({ status: 'denied', resolvedAt: 2000 })]).denial).toEqual({ note: null });
        expect(notice([req({ status: 'denied', resolvedAt: 2000, resolutionNote: '   ' })]).denial).toEqual({ note: null });
    });

    it('stays after the 14-day wait (no time limit)', () => {
        const longAgo = 1;
        expect(notice([req({ status: 'denied', createdAt: 0, resolvedAt: longAgo })]).denial).toEqual({ note: null });
    });

    it('uses the latest DECIDED request by resolvedAt, not the newest-created denial', () => {
        // Denial created later but resolved EARLIER than the approval → no note.
        const r = notice([
            req({ status: 'denied', createdAt: 1500, resolvedAt: 1600, resolutionNote: 'no' }),
            req({ status: 'approved', createdAt: 1000, resolvedAt: 3000 }),
        ]);
        expect(r.denial).toBeNull();
    });

    it('a denial resolved after an approval shows', () => {
        const r = notice([
            req({ status: 'approved', createdAt: 1000, resolvedAt: 1100 }),
            req({ status: 'denied', createdAt: 1200, resolvedAt: 1300, resolutionNote: 'otra vez no' }),
        ]);
        expect(r.denial).toEqual({ note: 'otra vez no' });
    });

    it('a tie on resolvedAt is decided for the approval (never a coin-flip «no»)', () => {
        const r = notice([
            req({ status: 'denied', createdAt: 1000, resolvedAt: 2000 }),
            req({ status: 'approved', createdAt: 1000, resolvedAt: 2000 }),
        ]);
        expect(r.denial).toBeNull();
    });

    it('a newer pending request hides the denial', () => {
        const r = notice([
            req({ status: 'denied', createdAt: 1000, resolvedAt: 2000, resolutionNote: 'no' }),
            req({ status: 'pending', createdAt: 3000 }),
        ]);
        expect(r.denial).toBeNull();
    });
});

describe('piiAccessNotice — «El responsable quitó tu acceso»', () => {
    it('owner revoking a profile-wide grant → the revoke date', () => {
        const r = notice(
            [req({ status: 'approved', createdAt: 1000, resolvedAt: 2000 })],
            [grant({ createdAt: 2000, revokedAt: 5000, revokedByEmail: OWNER })],
        );
        expect(r).toEqual({ denial: null, accessRevokedAt: 5000, accessRevokedBy: OWNER });
    });

    it('denial → approved → revoked: no denial note, the revoke line shows', () => {
        const r = notice(
            [
                req({ status: 'denied', createdAt: 100, resolvedAt: 200, resolutionNote: 'todavía no' }),
                req({ status: 'approved', createdAt: 1000, resolvedAt: 2000 }),
            ],
            [grant({ createdAt: 2000, revokedAt: 5000, revokedByEmail: OWNER })],
        );
        expect(r).toEqual({ denial: null, accessRevokedAt: 5000, accessRevokedBy: OWNER });
    });

    it('a live profile-wide grant → no line', () => {
        const r = notice([], [
            grant({ id: 'old', createdAt: 1000, revokedAt: 2000, revokedByEmail: OWNER }),
            grant({ id: 'new', createdAt: 1500, revokedAt: null }),
        ]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('TRAP: a contributor taking back their own contacts (entry, contribution, self) never shows', () => {
        const r = notice([], [grant({ scope: 'entry', origin: 'contribution', createdAt: 1000, revokedAt: 2000, revokedByEmail: VIEWER })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a self-revoke of a profile-wide grant never shows (case-insensitive)', () => {
        const r = notice([], [grant({ createdAt: 1000, revokedAt: 2000, revokedByEmail: ' Viewer@Example.com ' })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('the owner revoking an ENTRY grant (e.g. removing the contact) is not «quitó tu acceso»', () => {
        const r = notice([], [grant({ scope: 'entry', origin: 'search_match', createdAt: 1000, revokedAt: 2000, revokedByEmail: OWNER })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a revoke with no revoker recorded → no line', () => {
        const r = notice([], [grant({ createdAt: 1000, revokedAt: 2000, revokedByEmail: null })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a merge undo taking back the access the merge gave → no line', () => {
        const r = notice([], [grant({ origin: 'merge', createdAt: 1000, revokedAt: 2000, revokedByEmail: OWNER })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a household-conversion undo taking back its copied grant → no line', () => {
        const r = notice([], [grant({ id: 'hcg:host1:g9:p2', origin: 'request', createdAt: 1000, revokedAt: 2000, revokedByEmail: OWNER })]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a newer pending request hides the line', () => {
        const r = notice(
            [req({ status: 'approved', createdAt: 1000, resolvedAt: 2000 }), req({ status: 'pending', createdAt: 6000 })],
            [grant({ createdAt: 2000, revokedAt: 5000, revokedByEmail: OWNER })],
        );
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a newer request that was denied hides the line and shows the denial instead', () => {
        const r = notice(
            [
                req({ status: 'approved', createdAt: 1000, resolvedAt: 2000 }),
                req({ status: 'denied', createdAt: 6000, resolvedAt: 7000, resolutionNote: 'no' }),
            ],
            [grant({ createdAt: 2000, revokedAt: 5000, revokedByEmail: OWNER })],
        );
        expect(r).toEqual({ denial: { note: 'no' }, accessRevokedAt: null, accessRevokedBy: null });
    });

    it('a later self-revoke of a contribution is the latest event → the older owner revoke is no longer shown', () => {
        const r = notice([], [
            grant({ id: 'g1', createdAt: 1000, revokedAt: 2000, revokedByEmail: OWNER }),
            grant({ id: 'g2', scope: 'entry', origin: 'contribution', createdAt: 2500, revokedAt: 3000, revokedByEmail: VIEWER }),
        ]);
        expect(r.accessRevokedAt).toBeNull();
    });

    it('a tie between the revoke and another event hides the line', () => {
        const r = notice([req({ status: 'denied', createdAt: 100, resolvedAt: 5000 })], [grant({ createdAt: 1000, revokedAt: 5000, revokedByEmail: OWNER })]);
        expect(r.accessRevokedAt).toBeNull();
    });
});
