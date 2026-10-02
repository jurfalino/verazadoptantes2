import { describe, it, expect } from 'vitest';
import { activeViewAs, decideViewAsStart, isReadOnlySql, parseViewAsRequest, VIEW_AS_MAX_MS } from './viewAs';

const NOW = 1_800_000_000_000;
const claim = { userId: 'u-1', email: 'maria@example.org', name: 'María', image: null, startedAt: NOW - 1000 };

describe('activeViewAs', () => {
    it('returns a fresh claim', () => {
        expect(activeViewAs(claim, NOW)).toEqual(claim);
    });

    it('drops an expired claim, so a forgotten tab is the admin again', () => {
        expect(activeViewAs({ ...claim, startedAt: NOW - VIEW_AS_MAX_MS }, NOW)).toBeNull();
    });

    it('drops a claim from the future', () => {
        expect(activeViewAs({ ...claim, startedAt: NOW + 1 }, NOW)).toBeNull();
    });

    it('drops malformed claims', () => {
        expect(activeViewAs(undefined, NOW)).toBeNull();
        expect(activeViewAs('u-1', NOW)).toBeNull();
        expect(activeViewAs({ ...claim, email: '' }, NOW)).toBeNull();
        expect(activeViewAs({ ...claim, userId: 7 }, NOW)).toBeNull();
        expect(activeViewAs({ ...claim, startedAt: 'yesterday' }, NOW)).toBeNull();
    });
});

describe('parseViewAsRequest', () => {
    it('recognises start and stop', () => {
        expect(parseViewAsRequest({ viewAs: { userId: 'u-1' } })).toEqual({ kind: 'start', userId: 'u-1' });
        expect(parseViewAsRequest({ viewAs: null })).toEqual({ kind: 'stop' });
    });

    it('ignores anything else — other session updates must not touch the claim', () => {
        expect(parseViewAsRequest(undefined)).toEqual({ kind: 'none' });
        expect(parseViewAsRequest({ name: 'x' })).toEqual({ kind: 'none' });
        expect(parseViewAsRequest({ viewAs: { userId: '  ' } })).toEqual({ kind: 'none' });
        // An email is not accepted: the target is looked up by id, server side.
        expect(parseViewAsRequest({ viewAs: { email: 'maria@example.org' } })).toEqual({ kind: 'none' });
    });
});

describe('decideViewAsStart', () => {
    const target = { id: 'u-1', email: 'maria@example.org', isAdmin: false };

    it('lets an admin view as a regular user', () => {
        expect(decideViewAsStart({ actorEmail: 'admin@example.org', actorIsAdmin: true, target })).toEqual({ ok: true });
    });

    it('refuses a non-admin — anyone signed in can send the update', () => {
        expect(decideViewAsStart({ actorEmail: 'rescuer@example.org', actorIsAdmin: false, target })).toEqual({ ok: false, reason: 'not_admin' });
        expect(decideViewAsStart({ actorEmail: null, actorIsAdmin: true, target })).toEqual({ ok: false, reason: 'not_admin' });
    });

    it('refuses another admin, yourself and unknown users', () => {
        expect(decideViewAsStart({ actorEmail: 'admin@example.org', actorIsAdmin: true, target: { ...target, isAdmin: true } }))
            .toEqual({ ok: false, reason: 'target_is_admin' });
        expect(decideViewAsStart({ actorEmail: 'Maria@Example.org', actorIsAdmin: true, target }))
            .toEqual({ ok: false, reason: 'self' });
        expect(decideViewAsStart({ actorEmail: 'admin@example.org', actorIsAdmin: true, target: null }))
            .toEqual({ ok: false, reason: 'no_such_user' });
    });
});

describe('isReadOnlySql', () => {
    it('allows reads, including what drizzle emits', () => {
        expect(isReadOnlySql('select "id" from "adopters" where "id" = ?')).toBe(true);
        expect(isReadOnlySql('  SELECT COUNT(*) FROM audit_log')).toBe(true);
        expect(isReadOnlySql('/* lead */ select 1')).toBe(true);
        expect(isReadOnlySql('WITH x AS (SELECT 1) SELECT updated_at FROM x')).toBe(true);
        expect(isReadOnlySql('EXPLAIN QUERY PLAN SELECT 1')).toBe(true);
    });

    it('blocks every write form', () => {
        for (const sql of [
            'insert into "adopters" ("id") values (?)',
            'INSERT OR IGNORE INTO duplicate_tokens VALUES (?)',
            'REPLACE INTO app_config VALUES (?, ?)',
            'update "user_profiles" set "role" = ?',
            'DELETE FROM notifications WHERE id = ?',
            'WITH x AS (SELECT 1) DELETE FROM adopters WHERE id IN (SELECT * FROM x)',
            'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x',
            '-- select\nDELETE FROM t',
            'PRAGMA foreign_keys = OFF',
            'CREATE TABLE t (x)',
            'SELECT 1; DELETE FROM adopters',
            '',
        ]) {
            expect(isReadOnlySql(sql), sql).toBe(false);
        }
    });
});
