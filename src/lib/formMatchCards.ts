/**
 * The «¿Es la misma persona?» cards of a form: the other profile of each
 * match, read and masked for the viewer exactly as /form-results shows them.
 * Shared by /form-results/[submissionId] and the applicant panel
 * (`getApplicationDuplicates`), so both show the same object the same way.
 *
 * Not a `'use server'` module: callers authorize the viewer and pass the
 * match list (never ids from the browser).
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { adopters, adopterImages } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { maskMatchCardsForViewer } from '@/lib/piiAccessServer';
import { householdLinesFor, HOUSEHOLD_LINE_CARDS } from '@/lib/households';
import { countsFor } from '@/lib/profileSummary';
import { isMinor } from '@/domain/households';
import { realOwner } from '@/domain/dedupPair';
import { emailHandle } from '@/lib/userDisplay';
import type { FormResultMatchCardProps } from '@/components/FormResultMatchCard';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type FormMatch = { id: string; name: string; matchTypes: string[]; score?: number; candidateId: string | null; canAnswer: boolean };
export type FormMatchCardData = {
    match: FormMatch;
    /** `addedByName`: who loaded the other profile («Cargado por …»), by name, else their email handle; null when anonymous. */
    profile: FormResultMatchCardProps['profile'] & { addedByName: string | null };
};

type Row = {
    id: string; name: string; status: string | null; deletedAt: Date | null;
    addedBy: string | null; isPublic: number | null;
    contactInfo: string | null; contactEntries: string | null; addressInfo: string | null;
    age: number | null; ageAsOf: string | null; isMinor: number | null;
};

/**
 * One card per live matched profile, strongest match first (more match types,
 * then the order given). Contact and address are masked for `viewer` with only
 * the values the applicant typed (`ctx.typed`) unlocked; housemates and the
 * card's own standing for the first HOUSEHOLD_LINE_CARDS cards. A merged-away
 * (soft-deleted) profile has no card. Throws on a D1 error in the profile
 * reads; callers log with their context.
 */
export async function loadFormMatchCards(
    db: Db,
    viewer: string,
    matches: readonly FormMatch[],
    ctx: { submissionId: string; typed: Array<string | null | undefined> },
): Promise<FormMatchCardData[]> {
    if (matches.length === 0) return [];
    const ids = [...new Set(matches.map(m => m.id))];
    const { submissionId } = ctx;
    // OR-of-eq id filters, never `inArray`: D1 does NOT expand array params
    // in IN clauses (it binds `IN (?)` with a single value and silently
    // returns wrong results — see docs/D1_COMPATIBILITY.md).
    const [rows, imageRows] = await Promise.all([
        db
            .select({
                id: adopters.id, name: adopters.name, status: adopters.status, deletedAt: adopters.deletedAt,
                // Masking inputs only — never forwarded to the client.
                addedBy: adopters.addedBy, isPublic: adopters.isPublic,
                contactInfo: adopters.contactInfo, contactEntries: adopters.contactEntries, addressInfo: adopters.addressInfo,
                age: adopters.age, ageAsOf: adopters.ageAsOf, isMinor: adopters.isMinor,
            })
            .from(adopters)
            .where(or(...ids.map(id => eq(adopters.id, id)))!)
            .all() as Promise<Row[]>,
        // v2.26.1: profile-level OR the flagged profile picture (an activity/
        // observation photo can be the avatar); isProfilePicture DESC wins.
        db
            .select({ adopterId: adopterImages.adopterId, url: adopterImages.url, isProfilePicture: adopterImages.isProfilePicture })
            .from(adopterImages)
            .where(and(
                or(...ids.map(id => eq(adopterImages.adopterId, id)))!,
                or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1)),
            ))
            .orderBy(sql`${adopterImages.isProfilePicture} DESC`, sql`${adopterImages.uploadedAt} DESC`)
            .all() as Promise<Array<{ adopterId: string; url: string }>>,
    ]);
    const imageByAdopter = new Map<string, string>();
    for (const row of imageRows) {
        if (!imageByAdopter.has(row.adopterId)) imageByAdopter.set(row.adopterId, row.url);
    }

    // Soft-deleted (merged-away) matches are dropped at read time, so a
    // notification recorded before a merge still renders correctly.
    const liveRows = rows.filter(r => !r.deletedAt);
    // Another rescuer's protected profile must not reach the browser raw:
    // contact and address go through the same masking discovery search
    // applies, and only the values this applicant typed are unlocked. Built
    // field by field — never spread a DB row into what is returned.
    const [masked, names] = await Promise.all([
        maskMatchCardsForViewer(viewer, liveRows, ctx.typed, { submissionId }),
        creatorNames(liveRows, { submissionId, viewer }),
    ]);

    // Sort by match strength (more matchTypes first), preserving the given order for ties.
    const order = new Map(matches.map((a, i) => [a.id, { count: a.matchTypes?.length ?? 0, index: i }]));
    let profiles: FormMatchCardData['profile'][] = liveRows
        .filter(r => order.has(r.id))
        .map(r => {
            const creator = realOwner(r.addedBy);
            return {
                id: r.id,
                name: r.name,
                contactInfo: masked.get(r.id)?.contactInfo ?? null,
                contactEntries: masked.get(r.id)?.contactEntries ?? null,
                addressInfo: masked.get(r.id)?.addressInfo ?? null,
                status: r.status,
                profileImageUrl: imageByAdopter.get(r.id) ?? null,
                ...(isMinor(r) ? { isMinor: true } : {}),
                addedByName: creator ? (names.get(creator) || emailHandle(creator)) : null,
            };
        })
        .sort((a, b) => {
            const ac = order.get(a.id) ?? { count: 0, index: 999 };
            const bc = order.get(b.id) ?? { count: 0, index: 999 };
            return bc.count !== ac.count ? bc.count - ac.count : ac.index - bc.index;
        });

    if (profiles.length) {
        // Who each one lives with (never throws): every card its housemate chips; the first HOUSEHOLD_LINE_CARDS their list whatever it says.
        const homes = await householdLinesFor(db, viewer, profiles.map(p => p.id), { listCards: HOUSEHOLD_LINE_CARDS });
        profiles = profiles.map(p => (homes[p.id] ? { ...p, households: homes[p.id] } : p));
        // Each card's own rating and alerts (audit B6), the same counts a household line shows; countsFor
        // never throws (a failure logs and shows «Sin calificación»). One query per card, capped like the lines.
        const standing = await Promise.all(profiles.slice(0, HOUSEHOLD_LINE_CARDS).map(p => countsFor(db, p.id, { submissionId, user: viewer }, { activity: false })));
        profiles = profiles.map((p, i) => (standing[i] ? { ...p, rating: standing[i].rating, openFlags: standing[i].openFlags } : p));
    }

    const matchById = new Map(matches.map(m => [m.id, m]));
    return profiles.map(profile => ({ match: matchById.get(profile.id)!, profile }));
}

/**
 * Display names of the profiles' creators, as «Pendientes de revisar» resolves
 * them (resolveUserNames; the email handle when there is no name). A failed
 * lookup degrades to handles, logged.
 */
async function creatorNames(rows: readonly Row[], ctx: { submissionId: string; viewer: string }): Promise<Map<string, string>> {
    const creators = [...new Set(rows.map(r => realOwner(r.addedBy)).filter((e): e is string => !!e))];
    if (creators.length === 0) return new Map();
    try {
        const { resolveUserNames } = await import('@/app/actions/userNames');
        return new Map(Object.entries(await resolveUserNames(creators)));
    } catch (e) {
        logger.warn('loadFormMatchCards: creator names unresolved, showing handles', {
            ...ctx, count: creators.length, error: e instanceof Error ? e.message : String(e),
        });
        return new Map();
    }
}
