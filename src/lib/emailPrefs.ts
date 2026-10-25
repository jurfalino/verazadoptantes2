/**
 * Read / merge-write of a user's email notification switches
 * (`user_profiles.email_prefs`, JSON). NOT a 'use server' module: it is shared
 * by the settings actions and the unsubscribe route.
 *
 * `user_profiles.user_id` is the NextAuth `user.id`, not the email, so every
 * entry point resolves the id from the email first.
 */
import { eq, sql } from 'drizzle-orm';
import type { EmailLocale } from '@/lib/email';
import type { getDb } from '@/lib/db';
import { userProfiles, users } from '@/db/schema';
import { parseEmailPrefs, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * `user.email` keeps whatever case the sign-in provider gave it, while
 * notification recipients and unsubscribe links carry normalized emails:
 * match case-insensitively on both sides.
 */
const emailMatches = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase().trim()}`;

async function userIdForEmail(db: Db, email: string): Promise<string | null> {
    const [row] = await db.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    return row?.id ?? null;
}

/**
 * The recipient's account and switches: null when no `user` row has this
 * email (nobody to manage the switches or follow an unsubscribe link); prefs
 * are {} with no profile row or malformed JSON. One query.
 */
export async function getEmailRecipient(db: Db, email: string): Promise<{ prefs: EmailPrefs } | null> {
    const [row] = await db.select({ id: users.id, prefs: userProfiles.emailPrefs })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    if (!row) return null;
    return { prefs: parseEmailPrefs(row.prefs ?? null) };
}

/** The user's stored switches ({} when none, no profile row, no user row, or malformed JSON). */
export async function getEmailPrefsForEmail(db: Db, email: string): Promise<EmailPrefs> {
    return (await getEmailRecipient(db, email))?.prefs ?? {};
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

const LOCALES: readonly EmailLocale[] = ['es', 'en', 'pt'];

/** The language the person chose in the app; es when unknown (no user, no profile, no value). */
export async function getLocaleForEmail(db: Db, email: string): Promise<EmailLocale> {
    const [row] = await db.select({ locale: userProfiles.locale })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return LOCALES.find(l => l === row?.locale) ?? 'es';
}

/** Store the person's chosen language. Throws on an unknown value or when the user row does not exist. */
export async function setLocaleForEmail(db: Db, email: string, locale: EmailLocale): Promise<void> {
    if (!LOCALES.includes(locale)) throw new Error(`Invalid locale: ${String(locale)}`);
    const userId = await userIdForEmail(db, email);
    if (!userId) throw new Error('No user row for the email');
    await db.insert(userProfiles)
        .values({ userId, locale })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { locale } });
}
