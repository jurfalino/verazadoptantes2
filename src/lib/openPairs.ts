import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { adopters, duplicateCandidates, mergeRequests, pairUnsure, pendingPairHidden } from '@/db/schema';
import { pairKey, realOwner } from '@/domain/dedupPair';
import { hiddenAsHousematesSql } from '@/lib/housemateSql';
import { logger } from '@/lib/logger';
import { getTeamEmails, normEmail } from '@/lib/orgMembership';
import { mayAnswerPair } from '@/domain/pairAnswer';
import { storedScoreToPercent } from '@/lib/scoring';
import type { getDb } from '@/lib/db';
import type { DuplicateCandidate } from '@/types/duplicates';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * The pairs this viewer took off their list («Quitar de la lista», D27). One
 * query. A failed lookup shows them again rather than taking out the caller.
 */
export async function loadHiddenPairKeys(db: Db, actorEmail: string): Promise<Set<string>> {
    try {
        const rows = await db.select({ pairKey: pendingPairHidden.pairKey }).from(pendingPairHidden)
            .where(eq(pendingPairHidden.viewerEmail, normEmail(actorEmail))).all() as Array<{ pairKey: string }>;
        return new Set(rows.map(r => r.pairKey));
    } catch (e) {
        logger.warn('loadHiddenPairKeys: hidden pairs unreadable, showing them', {
            actorEmail, error: e instanceof Error ? e.message : String(e),
        });
        return new Set();
    }
}

/**
 * The viewer and their org-mates, normalized — whose pairs the viewer answers (step 2,
 * mayAnswerPair). getTeamEmails fails open to the viewer alone, so a lookup failure
 * narrows to the viewer's own pairs, never wider.
 */
export async function viewerTeam(viewer: string): Promise<Set<string>> {
    return new Set([normEmail(viewer), ...(await getTeamEmails(viewer)).map(normEmail)].filter(Boolean));
}

/**
 * Per pair key, who in the viewer's group answered «No sé» (pair_unsure, not withdrawn) — another group's
 * «No sé» is theirs, never the viewer's answer. A failed read answers nothing (the panel and the server
 * read the same, so they stay in step), logged.
 */
async function loadTeamUnsure(db: Db, keys: readonly string[], team: ReadonlySet<string>, viewer: string): Promise<Map<string, { by: string; sameBy: string | null }>> {
    const out = new Map<string, { by: string; sameBy: string | null }>();
    const unique = [...new Set(keys)];
    if (unique.length === 0) return out;
    try {
        const rows = await db.select({ pairKey: pairUnsure.pairKey, askerEmail: pairUnsure.askerEmail, sameBy: pairUnsure.sameBy }).from(pairUnsure)
            .where(and(eq(pairUnsure.withdrawn, 0), or(...unique.map(k => eq(pairUnsure.pairKey, k)))!))
            .all() as Array<{ pairKey: string; askerEmail: string; sameBy: string | null }>;
        for (const r of rows) {
            if (!team.has(normEmail(r.askerEmail))) continue;
            const seen = out.get(r.pairKey);
            if (!seen) out.set(r.pairKey, { by: r.askerEmail, sameBy: r.sameBy ?? null });
            else if (!seen.sameBy && r.sameBy) seen.sameBy = r.sameBy;
        }
    } catch (e) {
        logger.warn('loadOpenPairs: «No sé» answers unreadable, none counted', { viewer, pairKeys: unique.length, error: e instanceof Error ? e.message : String(e) });
    }
    return out;
}

/**
 * A profile's open «same person?» questions — the ONE read behind the profile
 * bar, the form screen and the contract screen, so they can't disagree.
 * Pending pairs whose other side is alive and isn't a housemate, strongest
 * first. Weak (`low`) pairs are left out unless `includeLow`: «Pendientes de
 * revisar» never lists them. Throws on a D1 error; callers log with their context.
 */
export async function loadOpenPairs(
    db: Db,
    adopterId: string,
    viewer: string,
    opts: { limit?: number; includeLow?: boolean } = {},
): Promise<DuplicateCandidate[]> {
    const candidates = await db.select({
        id: duplicateCandidates.id,
        adopter1Id: duplicateCandidates.adopter1Id,
        adopter2Id: duplicateCandidates.adopter2Id,
        matchTypes: duplicateCandidates.matchTypes,
        score: duplicateCandidates.score,
        confidence: duplicateCandidates.confidence,
    })
        .from(duplicateCandidates)
        .where(and(
            eq(duplicateCandidates.status, 'pending'),
            or(
                eq(duplicateCandidates.adopter1Id, adopterId),
                eq(duplicateCandidates.adopter2Id, adopterId),
            ),
            // A housemate is never a duplicate candidate (a pair detected before
            // they shared a household). In SQL, so housemates can't fill the cap.
            sql`NOT ${hiddenAsHousematesSql(duplicateCandidates.adopter1Id, duplicateCandidates.adopter2Id, duplicateCandidates.matchTypes)}`,
            ...(opts.includeLow ? [] : [sql`${duplicateCandidates.confidence} != 'low'`]),
        ))
        // Strongest first, so weak pairs can't crowd a strong one out of the cap; then
        // newest — the SAME order the /my-adopters card uses (pendingDuplicatesByAdopter).
        .orderBy(sql`${duplicateCandidates.score} DESC`, sql`${duplicateCandidates.detectedAt} DESC`)
        .limit(opts.limit ?? 5);

    if (candidates.length === 0) return [];

    // Names for the other side of each pair. A profile merged away (deletedAt
    // set) or gone drops out: there is nothing left to open.
    const otherIds = candidates.map((c: { adopter1Id: string; adopter2Id: string }) =>
        c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id
    );
    const [otherAdopters, self, hidden, team] = await Promise.all([Promise.all(
        otherIds.map((id: string) =>
            db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy })
                .from(adopters)
                .where(and(eq(adopters.id, id), isNull(adopters.deletedAt)))
                .get()
        )
    ), db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, adopterId)).get(),
    loadHiddenPairKeys(db, viewer), viewerTeam(viewer)]);
    const unsure = await loadTeamUnsure(db, candidates.map((c: { adopter1Id: string; adopter2Id: string }) => pairKey(c.adopter1Id, c.adopter2Id)), team, viewer);
    const nameMap = new Map<string, string>();
    const ownerMap = new Map<string, string | null>();
    for (const a of otherAdopters) {
        if (a) { nameMap.set(a.id, a.name); ownerMap.set(a.id, a.addedBy); }
    }
    // The same test as the feed's `listed` (the viewer's team loaded either side), minus the pairs the viewer hid.
    const onViewerList = (otherId: string) =>
        mayAnswerPair(team, self?.addedBy, ownerMap.get(otherId)) && !hidden.has(pairKey(adopterId, otherId));

    return candidates
        .filter((c: { adopter1Id: string; adopter2Id: string }) => nameMap.has(c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id))
        .map((c: { id: string; adopter1Id: string; adopter2Id: string; matchTypes: string; score: number; confidence: string }) => {
            const otherId = c.adopter1Id === adopterId ? c.adopter2Id : c.adopter1Id;
            return {
                id: c.id,
                otherAdopterId: otherId,
                otherAdopterName: nameMap.get(otherId)!,
                matchTypes: JSON.parse(c.matchTypes || '[]') as string[],
                score: c.score,
                confidence: c.confidence,
                confidencePercent: storedScoreToPercent(c.score),
                onViewerList: onViewerList(otherId),
                unsureBy: unsure.get(pairKey(c.adopter1Id, c.adopter2Id))?.by ?? null,
                unsureSameBy: unsure.get(pairKey(c.adopter1Id, c.adopter2Id))?.sameBy ?? null,
                otherSide: mayAnswerPair(team, ownerMap.get(otherId)) ? 'team' as const : realOwner(ownerMap.get(otherId)) ? 'outside' as const : 'none' as const,
            };
        })
        .sort((a: DuplicateCandidate, b: DuplicateCandidate) => b.confidencePercent - a.confidencePercent);
}

/**
 * The profiles a form may be linked to as "the same person": the other side of
 * every open pair of the form's own (auto-created) profile. A form that never
 * got a profile (`unlinked`) has no pairs and keeps the ids recorded at submit;
 * one already linked to an existing profile offers nothing. Server-side only —
 * never trust ids from the client. Throws on a D1 error; callers log.
 */
export async function formMatchIds(
    db: Db,
    form: { linkedAdopterId: string | null; autoAdopterId: string | null },
    recordedIds: readonly string[],
    viewer: string,
): Promise<string[]> {
    const { formLinkKind } = await import('@/domain/formLink');
    switch (formLinkKind(form)) {
        case 'unlinked': return [...recordedIds];
        case 'linked_existing': return [];
        case 'new_profile': {
            const pairs = await loadOpenPairs(db, form.autoAdopterId!, viewer, { limit: 20 });
            return pairs.map(p => p.otherAdopterId);
        }
    }
}

/** One open «same person?» question as a /my-adopters row shows it. */
export interface PendingDuplicateRef {
    otherAdopterId: string;
    otherAdopterName: string;
    /** On the viewer's «Pendientes» list (their team loaded a side, they didn't hide it) — the bar offers «Revisar». */
    onViewerList: boolean;
    /**
     * The next move is the viewer's (UX review 2026-11-10, Jon OK): false for a merge request the
     * viewer filed that waits on the other side, and for one the viewer (or their team) declined —
     * those rows get no amber border / «Posible duplicado» pill. The same rule as needsViewer
     * (domain/pendingRowRules); a declined request the viewer filed counts as waiting on them.
     */
    waitsOnViewer: boolean;
}

/**
 * Per row, its open pairs (already filtered: pending, not low, not housemates),
 * strongest first then newest (the profile bar's order), with the other side's name. Other sides gone (merged away) drop
 * out. Names/owners are read in D1-safe chunks. Throws on a D1 error.
 */
export async function pendingDuplicatesByAdopter(
    db: Db,
    pairs: ReadonlyArray<{ a1: string; a2: string; score: number; detectedAt: Date | number | null }>,
    ownerOf: ReadonlyMap<string, string | null>,
    viewer: string,
): Promise<Map<string, PendingDuplicateRef[]>> {
    const out = new Map<string, PendingDuplicateRef[]>();
    if (pairs.length === 0) return out;
    const { chunk, D1_IN_CHUNK } = await import('@/lib/chunk');
    const otherIds = [...new Set(pairs.flatMap(p => [p.a1, p.a2]))];
    const people = new Map<string, { name: string; addedBy: string | null }>();
    for (const ids of chunk(otherIds, D1_IN_CHUNK)) {
        const inList = sql.join(ids.map(id => sql`${id}`), sql`, `);
        const rows = await db.select({ id: adopters.id, name: adopters.name, addedBy: adopters.addedBy })
            .from(adopters)
            .where(and(sql`${adopters.id} IN (${inList})`, isNull(adopters.deletedAt)))
            .all() as Array<{ id: string; name: string; addedBy: string | null }>;
        for (const r of rows) people.set(r.id, { name: r.name, addedBy: r.addedBy });
    }
    const [hidden, team] = await Promise.all([loadHiddenPairKeys(db, viewer), viewerTeam(viewer)]);
    // Open/declined requests the viewer is party to (filed it, or it asked their team), by pair.
    const requestOf = new Map<string, { mine: boolean; status: string }>();
    try {
        const party = or(
            sql`lower(${mergeRequests.requesterEmail}) = ${normEmail(viewer)}`,
            ...[...team].map(e => sql`lower(${mergeRequests.ownerEmail}) = ${e}`),
        )!;
        const reqs = await db.select({ p: mergeRequests.primaryId, s: mergeRequests.secondaryId, requester: mergeRequests.requesterEmail, status: mergeRequests.status })
            .from(mergeRequests)
            .where(and(or(eq(mergeRequests.status, 'pending'), eq(mergeRequests.status, 'declined'))!, party))
            .all() as Array<{ p: string; s: string; requester: string; status: string }>;
        for (const r of reqs) requestOf.set(pairKey(r.p, r.s), { mine: normEmail(r.requester) === normEmail(viewer), status: r.status });
    } catch (e) {
        // Unreadable: every open pair keeps its marker (as before), logged.
        logger.warn('pendingDuplicatesByAdopter: requests unreadable, every pair marked', { viewer, error: e instanceof Error ? e.message : String(e) });
    }
    const waitsOnViewer = (a: string, b: string): boolean => {
        const r = requestOf.get(pairKey(a, b));
        if (!r) return true;
        return r.status === 'pending' ? !r.mine : r.mine; // sent → no; declined by you → no
    };
    const when = (d: Date | number | null) => (d instanceof Date ? d.getTime() : Number(d ?? 0));
    // The profile bar's order (loadOpenPairs): strongest first, then newest — so the
    // card and the profile name the same person and «Revisar» opens the same pair.
    const sorted = [...pairs].sort((x, y) => (y.score - x.score) || (when(y.detectedAt) - when(x.detectedAt)));
    for (const p of sorted) {
        for (const [self, other] of [[p.a1, p.a2], [p.a2, p.a1]] as const) {
            if (!ownerOf.has(self) || !people.has(self)) continue;
            const o = people.get(other);
            if (!o) continue;
            const list = out.get(self) ?? [];
            if (list.some(r => r.otherAdopterId === other)) continue;
            list.push({
                otherAdopterId: other,
                otherAdopterName: o.name,
                onViewerList: mayAnswerPair(team, ownerOf.get(self), o.addedBy) && !hidden.has(pairKey(self, other)),
                waitsOnViewer: waitsOnViewer(self, other),
            });
            out.set(self, list);
        }
    }
    return out;
}
