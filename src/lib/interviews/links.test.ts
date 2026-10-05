import { describe, it, expect } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { attachInterviewLinks } from './links';

describe('attachInterviewLinks', () => {
    it('marks completed-interview observations; answers link only for D7 viewers', async () => {
        const { db, sqlite } = migratedDb();
        sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, event_id) VALUES ('i1', 'ana@x.com', 'completed', 'standalone', 'ev1')`).run();
        sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, event_id) VALUES ('i2', 'ana@x.com', 'draft', 'standalone', 'ev2')`).run();
        const rows = [{ id: 'ev1', recordType: 'observation' }, { id: 'ev2', recordType: 'observation' }, { id: 'p1', recordType: 'adoption' }];

        const asStranger = await attachInterviewLinks(db, rows, { viewer: 'other@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false });
        expect(asStranger[0].interview).toEqual({ id: 'i1', canViewAnswers: false });
        expect(asStranger[1].interview).toBeUndefined();
        expect(asStranger[2].interview).toBeUndefined();

        const asOwner = await attachInterviewLinks(db, rows, { viewer: 'owner@x.com', ownerEmail: 'owner@x.com', viewerIsAdmin: false, viewerIsOrgMate: false });
        expect(asOwner[0].interview).toEqual({ id: 'i1', canViewAnswers: true });
    });
});
