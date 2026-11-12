/**
 * The server side of the «¿Es la misma persona?» lock (src/domain/samePersonGate.ts):
 * how many possible duplicates of `adopterId` the viewer still has to answer
 * before giving them an animal. Reads the SAME pairs the evaluation panel shows
 * (loadOpenPairs, limit 20, no weak pairs), so the server never refuses over a
 * pair the panel doesn't offer. Only a profile a form created and still sits on
 * counts (formLinkKind 'new_profile'); any other profile is never locked.
 *
 * Not a 'use server' module. Throws on a D1 error: callers refuse and log.
 */
import { and, eq } from 'drizzle-orm';
import { formSubmissions } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { loadOpenPairs } from '@/lib/openPairs';
import { blockingPairCount } from '@/domain/samePersonGate';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function unansweredSamePersonPairs(db: Db, adopterId: string, viewer: string): Promise<number> {
    const created = await db.select({ id: formSubmissions.id }).from(formSubmissions)
        .where(and(eq(formSubmissions.autoAdopterId, adopterId), eq(formSubmissions.linkedAdopterId, adopterId)))
        .limit(1).get();
    if (!created) return 0;
    const pairs = await loadOpenPairs(db, adopterId, viewer, { limit: 20 });
    return blockingPairCount(pairs.map(p => ({ viewerMayAnswer: p.onViewerList, unsureBy: p.unsureBy ?? null })), true);
}
