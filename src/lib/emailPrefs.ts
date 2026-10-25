/**
 * Read / merge-write of a user's email notification switches
 * (`user_profiles.email_prefs`, JSON). NOT a 'use server' module: it is shared
 * by the settings actions and the unsubscribe route.
 *
 * `user_profiles.user_id` is the NextAuth `user.id`, not the email, so every
 * entry point resolves the id from the email first.
 */
import { eq } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { userProfiles, users } from '@/db/schema';
import { parseEmailPrefs, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';

type Db = Awaited<ReturnType<typeof getDb>>;

async function userIdForEmail(db: Db, email: string): Promise<string | null> {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return row?.id ?? null;
}

/** The user's stored switches ({} when none, no profile row, or malformed JSON). */
export async function getEmailPrefsForEmail(db: Db, email: string): Promise<EmailPrefs> {
    const [row] = await db.select({ prefs: userProfiles.emailPrefs })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(users.email, email))
        .limit(1);
    return parseEmailPrefs(row?.prefs ?? null);
}

/** Set one switch, keeping the others. Throws when the user row does not exist. */
export async function setEmailPrefForEmail(db: Db, email: string, category: EmailCategory, enabled: boolean): Promise<void> {
    const userId = await userIdForEmail(db, email);
    if (!userId) throw new Error('No user row for the email');
    const current = await getEmailPrefsForEmail(db, email);
    const value = JSON.stringify({ ...current, [category]: enabled });
    await db.insert(userProfiles)
        .values({ userId, emailPrefs: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { emailPrefs: value } });
}
