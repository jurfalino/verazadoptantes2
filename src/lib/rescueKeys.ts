/**
 * Which rescue each rescuer belongs to, for "pide adoptar demasiado seguido"
 * (src/domain/requestDensity.ts): organization members share one key.
 * Server-only (reads org_members). One indexed lookup per distinct rescuer,
 * fanned out — D1 can't bind an array to IN.
 */
import { eq } from 'drizzle-orm';
import { orgMembers } from '@/db/schema';
import { logger } from '@/lib/logger';
import { groupRescues, knownRescuer } from '@/domain/requestDensity';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export async function loadRescueKeys(db: Db, addedBy: Array<string | null | undefined>, op: string): Promise<Map<string, string>> {
    const emails = Array.from(new Set(addedBy.map(knownRescuer).filter((e): e is string => !!e)));
    const orgsByEmail = new Map<string, string[]>();
    await Promise.all(emails.map(async email => {
        const rows = await db.select({ orgId: orgMembers.orgId }).from(orgMembers).where(eq(orgMembers.userEmail, email)).all()
            .catch((e: unknown) => {
                // Degraded, not wrong in the dangerous direction: without its
                // organization this rescuer counts as a rescue of its own.
                logger.warn(`${op}: org lookup for the request count failed`, { error: e instanceof Error ? e.message : String(e) });
                return [];
            });
        orgsByEmail.set(email, (rows as Array<{ orgId: string }>).map(r => r.orgId));
    }));
    return groupRescues(orgsByEmail);
}

/** Records with their `rescueKey` set (unknown rescuers get none). */
export function withRescueKeys<T extends { addedBy?: string | null }>(records: T[], keys: Map<string, string>): Array<T & { rescueKey: string | null }> {
    return records.map(r => {
        const e = knownRescuer(r.addedBy);
        return { ...r, rescueKey: e ? keys.get(e) ?? `user:${e}` : null };
    });
}
