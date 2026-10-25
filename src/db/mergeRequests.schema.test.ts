import { describe, it, expect } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; all: (...a: unknown[]) => Record<string, unknown>[]; run: (...a: unknown[]) => unknown } };

const columns = (sqlite: Sqlite, table: string) =>
    sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

describe('merge requests schema', () => {
    it('merge_requests defaults status to pending and stamps created_at', () => {
        const sqlite = migratedDb().sqlite as unknown as Sqlite;
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, requester_email) VALUES (?, ?, ?, ?)`)
            .run('mr1', 'a1', 'a2', 'r@example.com');
        const row = sqlite.prepare(`SELECT * FROM merge_requests WHERE id = ?`).get('mr1');
        expect(row?.status).toBe('pending');
        expect(row?.created_at).toBeTruthy();
        expect(row?.owner_email).toBeNull();
        expect(row?.candidate_id).toBeNull();
        expect(row?.flag_id).toBeNull();
    });

    it('adds user_profiles.email_prefs and notifications.emailed_at', () => {
        const sqlite = migratedDb().sqlite as unknown as Sqlite;
        expect(columns(sqlite, 'user_profiles')).toContain('email_prefs');
        expect(columns(sqlite, 'notifications')).toContain('emailed_at');
    });
});
