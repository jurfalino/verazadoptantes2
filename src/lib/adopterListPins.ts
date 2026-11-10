/**
 * Mis adoptantes: the filters a person pinned onto the main screen
 * (user_profiles.adopter_list_pins, drizzle/0105). Read and written by the
 * session's own email only (src/app/actions/settings.ts).
 */
import { eq, sql } from 'drizzle-orm';
import { userProfiles, users } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { sanitizePins, type FilterKey } from '@/domain/adopterListView';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const emailMatches = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase().trim()}`;

/**
 * The pins, or the defaults when none were saved (no profile row, NULL, or unreadable JSON).
 * An email can have more than one user row (seen in the e2e seed): read the profile that holds pins.
 */
export async function getAdopterListPinsForEmail(db: Db, email: string): Promise<FilterKey[]> {
    const [row] = await db.select({ pins: userProfiles.adopterListPins })
        .from(users)
        .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .orderBy(sql`${userProfiles.adopterListPins} IS NULL`)
        .limit(1);
    if (!row?.pins) return sanitizePins(null);
    let parsed: unknown = null;
    try { parsed = JSON.parse(row.pins); } catch { parsed = null; /* unreadable → the defaults; the next save rewrites it */ }
    return sanitizePins(parsed);
}

/**
 * Store the pins (already sanitized) on the caller's existing profile row(s). Never INSERTs: a
 * profile row is created when the person accepts the terms, and creating one here (for the wrong
 * one of two user rows with the same email) left a terms-less profile that blocked every page with
 * the terms prompt (v2.58.48 CI). Throws when there's no profile row to update.
 */
export async function setAdopterListPinsForEmail(db: Db, email: string, pins: FilterKey[]): Promise<void> {
    const updated = await db.update(userProfiles)
        .set({ adopterListPins: JSON.stringify(pins) })
        .where(sql`${userProfiles.userId} IN (SELECT ${users.id} FROM ${users} WHERE lower(${users.email}) = ${email.toLowerCase().trim()})`)
        .returning({ userId: userProfiles.userId });
    if (updated.length === 0) throw new Error('No profile row for the email');
}
