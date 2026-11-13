/**
 * Read / write of «Formularios, contratos y controles de:»
 * (`user_profiles.animals_scope`, src/domain/animalNotices.ts). NOT a
 * 'use server' module.
 *
 * `user_profiles.user_id` is the NextAuth `user.id`, so every entry point
 * resolves it from the email first.
 */
import { eq, sql } from 'drizzle-orm';
import { userProfiles, users } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { parseAnimalsScope, type AnimalsScope } from '@/domain/animalNotices';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const emailMatches = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase().trim()}`;

/** The stored choice ('team' when none, no profile row or no user row). */
export async function getAnimalsScopeForEmail(db: Db, email: string): Promise<AnimalsScope> {
    const [row] = await db.select({ scope: userProfiles.animalsScope })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return parseAnimalsScope(row?.scope ?? null);
}

/** Store the choice. Throws when the user row does not exist. */
export async function setAnimalsScopeForEmail(db: Db, email: string, scope: AnimalsScope): Promise<void> {
    const [row] = await db.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    if (!row) throw new Error('No user row for the email');
    await db.insert(userProfiles)
        .values({ userId: row.id, animalsScope: scope })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { animalsScope: scope } });
}
