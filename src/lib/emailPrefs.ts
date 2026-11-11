/**
 * Read / merge-write of a user's «Avisos» email switches
 * (`user_profiles.email_prefs`, JSON, row key → boolean; src/domain/noticeRows.ts).
 * NOT a 'use server' module: it is shared by the settings actions, the email
 * twin and the unsubscribe route.
 *
 * `user_profiles.user_id` is the NextAuth `user.id`, not the email, so every
 * entry point resolves the id from the email first.
 */
import { eq, sql } from 'drizzle-orm';
import type { EmailLocale } from '@/lib/email';
import type { getDb } from '@/lib/db';
import { userProfiles, users } from '@/db/schema';
import { parseEmailPrefs, type EmailCategory, type EmailPrefs } from '@/domain/emailCategories';
import { parseNoticePrefs, withNoticePref, type NoticePrefs, type SwitchableRowKey } from '@/domain/noticeRows';

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
 * The recipient's account and «Avisos» switches: null when no `user` row has
 * this email (nobody to manage the switches or follow an unsubscribe link);
 * prefs are {} (the defaults) with no profile row or malformed JSON. One query.
 */
export async function getEmailRecipient(db: Db, email: string): Promise<{ prefs: NoticePrefs } | null> {
    const row = await rawPrefsRow(db, email);
    if (!row) return null;
    return { prefs: parseNoticePrefs(row.prefs ?? null) };
}

async function rawPrefsRow(db: Db, email: string): Promise<{ id: string; prefs: string | null } | null> {
    const [row] = await db.select({ id: users.id, prefs: userProfiles.emailPrefs })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return row ?? null;
}

/** The user's «Avisos» switches ({} = the defaults: no profile row, no user row, or malformed JSON). */
export async function getNoticePrefsForEmail(db: Db, email: string): Promise<NoticePrefs> {
    return (await getEmailRecipient(db, email))?.prefs ?? {};
}

/** Switch one «Avisos» row, keeping the others (migrated). Throws when the user row does not exist. */
export async function setNoticePrefForEmail(db: Db, email: string, key: SwitchableRowKey, enabled: boolean): Promise<void> {
    const row = await rawPrefsRow(db, email);
    if (!row) throw new Error('No user row for the email');
    const value = withNoticePref(row.prefs, key, enabled);
    await db.insert(userProfiles)
        .values({ userId: row.id, emailPrefs: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { emailPrefs: value } });
}

/** @deprecated The old category switches, for the settings section until «Avisos» replaces it. */
export async function getEmailPrefsForEmail(db: Db, email: string): Promise<EmailPrefs> {
    const row = await rawPrefsRow(db, email);
    return parseEmailPrefs(row?.prefs ?? null);
}

/** @deprecated Set one old category switch, keeping every other stored key. Throws when the user row does not exist. */
export async function setEmailPrefForEmail(db: Db, email: string, category: EmailCategory, enabled: boolean): Promise<void> {
    const row = await rawPrefsRow(db, email);
    if (!row) throw new Error('No user row for the email');
    let current: Record<string, unknown> = {};
    try {
        const parsed: unknown = row.prefs ? JSON.parse(row.prefs) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch { /* malformed JSON: start from {} (the defaults) */ }
    const value = JSON.stringify({ ...current, [category]: enabled });
    await db.insert(userProfiles)
        .values({ userId: row.id, emailPrefs: value })
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
