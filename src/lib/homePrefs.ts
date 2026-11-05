/**
 * Read / merge-write of what the person hid on their homepage
 * (`user_profiles.home_prefs`, JSON). Same shape as src/lib/emailPrefs.ts:
 * `user_profiles.user_id` is the NextAuth `user.id`, resolved from the email.
 */
import { eq, sql } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { userProfiles, users } from '@/db/schema';
import { parseHomePrefs, type HomePrefs } from '@/domain/homePrefs';

type Db = Awaited<ReturnType<typeof getDb>>;

const emailMatches = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase().trim()}`;

/** The stored prefs ({} when none, no profile row, no user row, or malformed JSON). */
export async function getHomePrefsForEmail(db: Db, email: string): Promise<HomePrefs> {
    const [row] = await db.select({ prefs: userProfiles.homePrefs })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return parseHomePrefs(row?.prefs ?? null);
}

/** Merge `patch` into the stored prefs. Throws when the user row does not exist. */
export async function setHomePrefsForEmail(db: Db, email: string, patch: HomePrefs): Promise<void> {
    const [user] = await db.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    if (!user) throw new Error('No user row for the email');
    const value = JSON.stringify({ ...(await getHomePrefsForEmail(db, email)), ...patch });
    await db.insert(userProfiles)
        .values({ userId: user.id, homePrefs: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { homePrefs: value } });
}
