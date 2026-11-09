/**
 * Who hears about a change to a profile, per each recipient's «Avisame de
 * cambios hechos por:» choice (src/domain/teamChangeAudience.ts). Every sender
 * of a «Cambios en tus perfiles» notice passes its recipients through
 * `keepChangeRecipients` — one rule for all of them, bell and email alike.
 *
 * Failures lean to an extra notice, never a missed one: a team lookup that
 * fails counts as "not a teammate" (isOrgMate fails closed), and a choice that
 * can't be read counts as «… y mi equipo». Both are logged.
 *
 * NOT a 'use server' module.
 */
import { eq, sql } from 'drizzle-orm';
import { userProfiles, users } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isOrgMate } from '@/lib/orgMembership';
import { hearsChange, parseProfileChangesFrom, type ProfileChangesFrom } from '@/domain/teamChangeAudience';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const emailMatches = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase().trim()}`;

/** The stored choice ('outside' when none, no profile row or no user row). */
export async function getProfileChangesFromForEmail(db: Db, email: string): Promise<ProfileChangesFrom> {
    const [row] = await db.select({ from: userProfiles.profileChangesFrom })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return parseProfileChangesFrom(row?.from ?? null);
}

/** Store the choice. Throws when the user row does not exist. */
export async function setProfileChangesFromForEmail(db: Db, email: string, from: ProfileChangesFrom): Promise<void> {
    const [row] = await db.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    if (!row) throw new Error('No user row for the email');
    await db.insert(userProfiles)
        .values({ userId: row.id, profileChangesFrom: from })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { profileChangesFrom: from } });
}

export interface AudienceDeps {
    isTeammate: (recipient: string, actor: string) => Promise<boolean>;
    fromOf: (recipient: string) => Promise<ProfileChangesFrom>;
}

const defaultDeps = (): AudienceDeps => ({
    isTeammate: (recipient, actor) => isOrgMate(recipient, actor),
    fromOf: async (recipient) => {
        const db = await getDb();
        if (!db) throw new Error('No database');
        return getProfileChangesFromForEmail(db, recipient);
    },
});

/**
 * The recipients (in order, once each) who hear about `actor`'s change: never
 * the actor; a teammate of the actor only if they chose «… y mi equipo».
 * `ctx` is re-emitted on the log lines (op, adopterId, …).
 */
export async function keepChangeRecipients(
    recipients: Iterable<string>,
    actor: string,
    ctx: Record<string, unknown>,
    deps: AudienceDeps = defaultDeps(),
): Promise<string[]> {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const r of recipients) {
        const k = r.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        list.push(r);
    }
    const kept = await Promise.all(list.map(async (recipient) => {
        if (recipient.trim().toLowerCase() === actor.trim().toLowerCase()) return false;
        const actorIsTeammate = await deps.isTeammate(recipient, actor);
        if (!actorIsTeammate) return true;
        let from: ProfileChangesFrom;
        try {
            from = await deps.fromOf(recipient);
        } catch (e) {
            logger.warn('keepChangeRecipients: choice unreadable, teammate told', { ...ctx, actor, error: e instanceof Error ? e.message : String(e) });
            from = 'team';
        }
        return hearsChange({ recipient, actor, actorIsTeammate, from });
    }));
    const out = list.filter((_, i) => kept[i]);
    if (out.length < list.length) {
        logger.info('keepChangeRecipients: some recipients skipped', { ...ctx, actor, recipients: list.length, kept: out.length });
    }
    return out;
}
