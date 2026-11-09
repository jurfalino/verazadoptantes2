/**
 * Seed a rescuer's «Avisame de cambios hechos por:» choice in a migrated test
 * DB (src/test-utils/migratedDb.ts): the `user` row (if missing) and its
 * `user_profiles.profile_changes_from`. With no rows the choice reads as
 * 'outside' (the default). Test-only.
 */
type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown } };

export function chooseProfileChangesFrom(sqlite: unknown, email: string, from: 'outside' | 'team'): void {
    const db = sqlite as Sqlite;
    const existing = db.prepare('SELECT id FROM user WHERE lower(email) = lower(?)').get(email) as { id: string } | undefined;
    const userId = existing?.id ?? `u-${email}`;
    if (!existing) db.prepare('INSERT INTO user (id, email) VALUES (?, ?)').run(userId, email);
    db.prepare(`INSERT INTO user_profiles (user_id, profile_changes_from) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET profile_changes_from = excluded.profile_changes_from`).run(userId, from);
}
