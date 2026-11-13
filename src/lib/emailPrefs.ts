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
import { parseNoticePrefs, withNoticePrefs, type NoticePrefs, type SwitchableRowKey } from '@/domain/noticeRows';
import { parseFollowupSettings, withEmailReminders } from '@/domain/followups';

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
export async function getEmailRecipient(db: Db, email: string): Promise<{ id: string; prefs: NoticePrefs } | null> {
    const row = await rawPrefsRow(db, email);
    if (!row) return null;
    return { id: row.id, prefs: parseNoticePrefs(row.prefs ?? null) };
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
    await setNoticePrefsForEmail(db, email, [key], enabled);
}

/** Switch several rows in one write (an old category's unsubscribe link). Throws when the user row does not exist. */
export async function setNoticePrefsForEmail(db: Db, email: string, keys: readonly SwitchableRowKey[], enabled: boolean): Promise<void> {
    const row = await rawPrefsRow(db, email);
    if (!row) throw new Error('No user row for the email');
    const value = withNoticePrefs(row.prefs, keys, enabled);
    await db.insert(userProfiles)
        .values({ userId: row.id, emailPrefs: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { emailPrefs: value } });
}

/**
 * «Toca un control de seguimiento»: `followup_settings.emailReminders`, the same
 * stored value «Seguimientos de adopción» shows. false with nothing stored.
 */
export async function getFollowupEmailForEmail(db: Db, email: string): Promise<boolean> {
    const [row] = await db.select({ settings: userProfiles.followupSettings })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    return parseFollowupSettings(row?.settings ?? null)?.emailReminders === true;
}

/** Switch it, keeping the schedule and messages. Throws when the user row does not exist. */
export async function setFollowupEmailForEmail(db: Db, email: string, enabled: boolean): Promise<void> {
    const [row] = await db.select({ id: users.id, settings: userProfiles.followupSettings })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    if (!row) throw new Error('No user row for the email');
    const next = withEmailReminders(parseFollowupSettings(row.settings ?? null), enabled);
    const value = next ? JSON.stringify(next) : null;
    await db.insert(userProfiles)
        .values({ userId: row.id, followupSettings: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { followupSettings: value } });
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
