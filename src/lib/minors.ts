/**
 * «Menor de edad» on the server (households as profiles, Task 3): a minor's
 * profile gets no adoption records, no alerts and no rating — those go on the
 * adults of the household. Every write path for records (insertRecord /
 * updateRecord, which saveAdoption, the API, forms and imports go through) and
 * alerts (flagAdopter) asks here. Plain server module, never an action.
 */
import { eq } from 'drizzle-orm';
import { adopters } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isMinor } from '@/domain/households';
import { PROFILE_IS_MINOR } from '@/domain/profileIdentity';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Thrown when a record, alert or rating would land on a minor's profile. The message starts with PROFILE_IS_MINOR. */
export class ProfileIsMinorError extends Error {
    readonly code = PROFILE_IS_MINOR;
    constructor(public adopterId: string) {
        super(`${PROFILE_IS_MINOR}: profile ${adopterId} is a minor — records, alerts and ratings go on the adults of the household`);
    }
}

/** Is this profile a minor right now? A missing profile is not. A failed read throws (the caller's write fails with it). */
export async function isMinorProfile(db: Db, adopterId: string, today: Date = new Date()): Promise<boolean> {
    const row = await db.select({ age: adopters.age, ageAsOf: adopters.ageAsOf, isMinor: adopters.isMinor })
        .from(adopters).where(eq(adopters.id, adopterId)).get() as { age: number | null; ageAsOf: string | null; isMinor: number | null } | undefined;
    return !!row && isMinor(row, today);
}

/** Refuse (ProfileIsMinorError, logged with `ctx`) when `adopterId` is a minor's profile. */
export async function assertNotMinor(db: Db, adopterId: string | null | undefined, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!adopterId) return;
    if (await isMinorProfile(db, adopterId)) {
        logger.info('assertNotMinor: refused — the profile is a minor', { ...ctx, adopterId });
        throw new ProfileIsMinorError(adopterId);
    }
}
