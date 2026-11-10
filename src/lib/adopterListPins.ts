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

/** The pins, or the defaults when none were saved (no profile row, NULL, or unreadable JSON). */
export async function getAdopterListPinsForEmail(db: Db, email: string): Promise<FilterKey[]> {
    const [row] = await db.select({ pins: userProfiles.adopterListPins })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(emailMatches(email))
        .limit(1);
    if (!row?.pins) return sanitizePins(null);
    let parsed: unknown = null;
    try { parsed = JSON.parse(row.pins); } catch { parsed = null; /* unreadable → the defaults; the next save rewrites it */ }
    return sanitizePins(parsed);
}

/** Store the pins (already sanitized). Throws when the user row does not exist. */
export async function setAdopterListPinsForEmail(db: Db, email: string, pins: FilterKey[]): Promise<void> {
    const [row] = await db.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    if (!row) throw new Error('No user row for the email');
    const value = JSON.stringify(pins);
    await db.insert(userProfiles)
        .values({ userId: row.id, adopterListPins: value })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { adopterListPins: value } });
}
