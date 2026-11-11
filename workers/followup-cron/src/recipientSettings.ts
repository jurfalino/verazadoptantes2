/**
 * One recipient's check-up settings and animals scope, as the cron reads them.
 * Pure of the Worker's Env so it can be tested on real SQL.
 */
import { parseFollowupSettings, type FollowupSettings } from '../../../src/domain/followups';
import { parseAnimalsScope, type AnimalsScope } from '../../../src/domain/animalNotices';

/** The slice of D1 this needs (D1Database satisfies it). */
export interface FirstRowDb {
    prepare(query: string): { bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null> } };
}

export type RecipientSettings = { id: string | null; settings: FollowupSettings | null; scope: AnimalsScope };

/**
 * Two queries on purpose. The Worker deploys on its own workflow
 * (.github/workflows/followup-worker.yml), so it can run before migration 0107
 * adds `animals_scope`. The settings query uses only columns that predate it;
 * the scope is read on its own, and a failed scope read (that missing column,
 * or anything else) means 'team' and never touches the settings.
 */
export async function readRecipientSettings(
    db: FirstRowDb,
    email: string,
    warn: (fields: Record<string, unknown>) => void,
): Promise<RecipientSettings> {
    let id: string | null = null;
    let settings: FollowupSettings | null = null;
    try {
        const row = await db.prepare(
            `SELECT u.id AS id, up.followup_settings AS s FROM user u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.email = ? LIMIT 1`
        ).bind(email).first<{ id: string; s: string | null }>();
        id = row?.id ?? null;
        settings = parseFollowupSettings(row?.s);
    } catch (e) {
        warn({ warn: 'settings fallback', email, error: String(e) });
    }
    let scope: AnimalsScope = 'team';
    try {
        const row = await db.prepare(
            `SELECT up.animals_scope AS scope FROM user u JOIN user_profiles up ON up.user_id = u.id WHERE u.email = ? LIMIT 1`
        ).bind(email).first<{ scope: string | null }>();
        scope = parseAnimalsScope(row?.scope);
    } catch (e) {
        warn({ warn: 'animals scope fallback (whole team)', email, error: String(e) });
    }
    return { id, settings, scope };
}
