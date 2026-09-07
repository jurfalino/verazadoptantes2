/**
 * D1 access layer for email OTP codes — shared by the requestEmailOtp server
 * action (issuance + rate limiting) and the `email-otp` Credentials provider
 * in auth.config.ts (verification). All functions take the Drizzle instance
 * from getDb() so each caller resolves the DB once; getDb() itself handles
 * the Cloudflare-vs-local split, keeping ONE code path for both runtimes.
 *
 * Conditional updates (attempt increment, consume) rely on the driver's
 * changed-row count to stay atomic under concurrent verifies; the count
 * lives at `meta.changes` on D1 and `changes` on better-sqlite3, normalized
 * by changesOf().
 */

import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { emailOtpCodes } from '@/db/schema';
import { OTP_MAX_ATTEMPTS } from '@/lib/otp';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function changesOf(res: unknown): number {
    if (res && typeof res === 'object') {
        const r = res as { meta?: { changes?: number }; changes?: number };
        if (typeof r.meta?.changes === 'number') return r.meta.changes;
        if (typeof r.changes === 'number') return r.changes;
    }
    return 0;
}

export interface ActiveOtp {
    id: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
}

/** Newest unconsumed code for the email, expired or not (caller checks expiry). */
export async function findActiveOtp(db: Db, email: string): Promise<ActiveOtp | null> {
    const rows = await db
        .select({
            id: emailOtpCodes.id,
            codeHash: emailOtpCodes.codeHash,
            expiresAt: emailOtpCodes.expiresAt,
            attempts: emailOtpCodes.attempts,
        })
        .from(emailOtpCodes)
        .where(and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt)))
        .orderBy(desc(emailOtpCodes.createdAt))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Send timestamps for the email within the window, newest first. One query
 * serves both rate checks: [0] against the min-gap, length against the
 * hourly cap. Includes retired rows on purpose — replacing a code must not
 * reset the sender's budget.
 */
export async function recentSendTimes(db: Db, email: string, since: Date): Promise<Date[]> {
    const rows = await db
        .select({ createdAt: emailOtpCodes.createdAt })
        .from(emailOtpCodes)
        .where(and(eq(emailOtpCodes.email, email), gt(emailOtpCodes.createdAt, since)))
        .orderBy(desc(emailOtpCodes.createdAt));
    return rows.map((r: { createdAt: Date }) => r.createdAt);
}

export async function countRecentByIp(db: Db, ip: string, since: Date): Promise<number> {
    const rows = await db
        .select({ id: emailOtpCodes.id })
        .from(emailOtpCodes)
        .where(and(eq(emailOtpCodes.requestIp, ip), gt(emailOtpCodes.createdAt, since)));
    return rows.length;
}

/** Retire every outstanding code for the email (a new code replaces them all). */
export async function retireActiveOtps(db: Db, email: string, now: Date): Promise<void> {
    await db
        .update(emailOtpCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailOtpCodes.email, email), isNull(emailOtpCodes.consumedAt)));
}

/** Delete rows past their usefulness (rate-limit window + audit slack). */
export async function purgeOldOtps(db: Db, before: Date): Promise<void> {
    await db.delete(emailOtpCodes).where(lt(emailOtpCodes.createdAt, before));
}

export async function insertOtp(db: Db, row: {
    id: string;
    email: string;
    codeHash: string;
    createdAt: Date;
    expiresAt: Date;
    requestIp: string | null;
}): Promise<void> {
    await db.insert(emailOtpCodes).values(row);
}

/**
 * Count one verify attempt against the code. False when the attempt budget
 * is already spent — including under a concurrent-verify race, since the
 * `attempts < max` guard and the increment are one atomic UPDATE.
 */
export async function tryConsumeAttempt(db: Db, id: string): Promise<boolean> {
    const res = await db
        .update(emailOtpCodes)
        .set({ attempts: sql`${emailOtpCodes.attempts} + 1` })
        .where(and(eq(emailOtpCodes.id, id), lt(emailOtpCodes.attempts, OTP_MAX_ATTEMPTS)));
    return changesOf(res) > 0;
}

/** Retire a single code (attempt budget exhausted). */
export async function retireOtp(db: Db, id: string, now: Date): Promise<void> {
    await db
        .update(emailOtpCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailOtpCodes.id, id), isNull(emailOtpCodes.consumedAt)));
}

/**
 * Mark the code used. False when another request consumed it first —
 * the conditional WHERE makes a code strictly single-use.
 */
export async function consumeOtp(db: Db, id: string, now: Date): Promise<boolean> {
    const res = await db
        .update(emailOtpCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailOtpCodes.id, id), isNull(emailOtpCodes.consumedAt)));
    return changesOf(res) > 0;
}
