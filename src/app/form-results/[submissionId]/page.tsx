export const runtime = 'edge';

import { redirect, notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, formSubmissions, adopterImages, adoptions } from '@/db/schema';
import { eq, or, and, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import FormResultsContent from '@/components/FormResultsContent';
import Link from 'next/link';
import { logger } from '@/lib/logger';
import { isOrgMate } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { formLinkKind } from '@/domain/formLink';
import { computeAvgRating } from '@/domain/ratings';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
}

interface NotificationMetadata {
    submissionId: string;
    matchCount: number;
    submittedData?: {
        name: string;
        email: string;
        phone: string;
        address: string;
        species: string;
        lifeStage: string;
        intent: string;
        household: string;
    };
    matchedAdopters?: MatchedAdopter[];
}




export default async function FormResultsPage({ params }: { params: Promise<{ submissionId: string }> }) {
    const { submissionId } = await params;
    let currentUser = '';
    try {
        currentUser = await getUser();
    } catch (e: any) {
        if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e;
        redirect(`/?authRequired=1&callbackUrl=${encodeURIComponent(`/form-results/${submissionId}`)}`);
    }

    const db = await getDb();
    if (!db) return <ErrorState message="Database unavailable" />;

    // The ownership check, the match-metadata notification, and the full
    // submission are mutually independent — fetch them in one parallel wave
    // instead of three sequential D1 round-trips. (The extra two reads for a
    // non-owner are harmless: we still gate on ownerCheck before rendering.)
    const [ownerCheck, notif, submission] = await Promise.all([
        db.select({ userId: formSubmissions.userId })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submissionId))
            .get(),
        db.select({ id: notifications.id, metadata: notifications.metadata })
            .from(notifications)
            .where(and(
                eq(notifications.userId, currentUser),
                sql`json_extract(${notifications.metadata}, '$.submissionId') = ${submissionId}`,
            ))
            .get()
            .catch((e: unknown) => {
                logger.warn('form-results: notification lookup fallback', { submissionId, userEmail: currentUser, error: e instanceof Error ? e.message : String(e) });
                return null;
            }),
        db.select({
            id: formSubmissions.id,
            selfieUrl: formSubmissions.selfieUrl,
            species: formSubmissions.species,
            lifeStage: formSubmissions.lifeStage,
            specialNeeds: formSubmissions.specialNeeds,
            intent: formSubmissions.intent,
            household: formSubmissions.household,
            latitude: formSubmissions.latitude,
            longitude: formSubmissions.longitude,
            status: formSubmissions.status,
            linkedAdopterId: formSubmissions.linkedAdopterId,
            autoAdopterId: formSubmissions.autoAdopterId,
            answersJson: formSubmissions.answersJson,
            createdAt: formSubmissions.createdAt,
        })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submissionId))
            .get(),
    ]);

    // Auth: verify the current user owns this submission (is the rescuer)
    // Missing → 404. Not yours → teammates/admins (who get notification links
    // here) keep the "no permission" screen; strangers get the 404 so we don't
    // confirm the submission exists (applicant PII). `userId` holds the owner's email.
    if (!ownerCheck) notFound();
    if (ownerCheck.userId !== currentUser) {
        const teammateOrAdmin = (await isOrgMate(currentUser, ownerCheck.userId)) || (await isAdminAsync(currentUser));
        logger.info('form-results: denied', { submissionId, userEmail: currentUser, teammateOrAdmin });
        if (!teammateOrAdmin) notFound();
        return <ErrorState message="No tenés permiso para ver este formulario" />;
    }

    // Notification → mark as read (best-effort) + parse match metadata
    let metadata: NotificationMetadata = { submissionId, matchCount: 0 };
    if (notif) {
        try { await markNotificationRead(notif.id, currentUser); } catch { /* non-blocking */ }
        if (notif.metadata) {
            try {
                const parsed = JSON.parse(notif.metadata);
                metadata = {
                    submissionId,
                    matchCount: parsed.matchCount ?? 0,
                    submittedData: parsed.submittedData,
                    matchedAdopters: parsed.matchedAdopters,
                };
            } catch { /* keep defaults */ }
        }
    }

    // Matched profiles (for the comparison cards) and the linked profile (for
    // the banner) in one wave. The linked profile is usually one of the
    // matches or the auto-created profile, so they share the queries.
    const linkKind = formLinkKind({
        linkedAdopterId: submission?.linkedAdopterId ?? null,
        autoAdopterId: submission?.autoAdopterId ?? null,
    });
    const linkedId = submission?.linkedAdopterId ?? null;
    const matchIds = (metadata.matchedAdopters ?? []).map(a => a.id);
    const profileIds = [...new Set([...matchIds, ...(linkedId ? [linkedId] : [])])];

    type ProfileRow = { id: string; name: string; contactInfo: string | null; addressInfo: string | null; status: string | null; profileImageUrl: string | null };
    let matchedProfiles: ProfileRow[] = [];
    let linkedProfile: { id: string; name: string; profileImageUrl: string | null; avgRating: number | null } | null = null;
    if (profileIds.length > 0) {
        // OR-of-eq id filters, never `inArray`: D1 does NOT expand array params
        // in IN clauses (it binds `IN (?)` with a single value and silently
        // returns wrong results — see docs/D1_COMPATIBILITY.md).
        const [rows, imageRows, linkedRatings] = await Promise.all([
            db
                .select({ id: adopters.id, name: adopters.name, contactInfo: adopters.contactInfo, addressInfo: adopters.addressInfo, status: adopters.status, deletedAt: adopters.deletedAt })
                .from(adopters)
                .where(or(...profileIds.map(id => eq(adopters.id, id)))!)
                .all(),
            // v2.26.1: profile-level OR the flagged profile picture (an activity/
            // observation photo can be the avatar); isProfilePicture DESC wins.
            db
                .select({ adopterId: adopterImages.adopterId, url: adopterImages.url, isProfilePicture: adopterImages.isProfilePicture })
                .from(adopterImages)
                .where(and(
                    or(...profileIds.map(id => eq(adopterImages.adopterId, id)))!,
                    or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1)),
                ))
                .orderBy(sql`${adopterImages.isProfilePicture} DESC`, sql`${adopterImages.uploadedAt} DESC`),
            // The chosen person's rating, for the "Solicitud vinculada a X"
            // banner — the trust signal the rescuer is here to read. Same
            // computation as the profile and /my-adopters (computeAvgRating
            // over every rated record). Only for an existing profile: one
            // auto-created from this form has no history to rate.
            linkKind === 'linked_existing' && linkedId
                ? db.select({ rating: adoptions.rating }).from(adoptions).where(eq(adoptions.adopterId, linkedId)).all()
                    .catch((e: unknown) => {
                        logger.warn('form-results: linked profile rating lookup failed', { submissionId, adopterId: linkedId, error: e instanceof Error ? e.message : String(e) });
                        return null;
                    })
                : Promise.resolve(null),
        ]);
        const imageByAdopter = new Map<string, string>();
        for (const row of imageRows) {
            if (!imageByAdopter.has(row.adopterId)) imageByAdopter.set(row.adopterId, row.url);
        }
        type Row = Omit<ProfileRow, 'profileImageUrl'> & { deletedAt: Date | null };
        const withImage = (r: Row): ProfileRow => {
            const { deletedAt: _deletedAt, ...rest } = r;
            return { ...rest, profileImageUrl: imageByAdopter.get(r.id) ?? null };
        };

        // Soft-deleted (merged-away) matches are dropped at read time, so a
        // notification recorded before a merge still renders correctly.
        // Sort by match strength (more matchTypes first), preserving order of metadata.matchedAdopters for ties
        const order = new Map((metadata.matchedAdopters ?? []).map((a, i) => [a.id, { count: a.matchTypes?.length ?? 0, index: i }]));
        matchedProfiles = (rows as Row[])
            .filter(r => order.has(r.id) && !r.deletedAt)
            .map(withImage)
            .sort((a, b) => {
                const ac = order.get(a.id) ?? { count: 0, index: 999 };
                const bc = order.get(b.id) ?? { count: 0, index: 999 };
                return bc.count !== ac.count ? bc.count - ac.count : ac.index - bc.index;
            });

        // A form linked to a profile that was later merged away (before merges
        // carried form links along, v2.56.129) has no live profile to name —
        // the banner falls back to its generic wording then.
        const linkedRow = (rows as Row[]).find(r => r.id === linkedId && !r.deletedAt);
        if (linkedRow) {
            const p = withImage(linkedRow);
            linkedProfile = {
                id: p.id,
                name: p.name,
                profileImageUrl: p.profileImageUrl,
                avgRating: linkedRatings ? computeAvgRating(linkedRatings as Array<{ rating: number | null }>) : null,
            };
        }
    }

    const hasMatches = (metadata.matchCount ?? 0) > 0;
    const submitted = metadata.submittedData;
    let fullAnswers: Record<string, any> = (metadata.submittedData as any) || {};
    try {
        if (submission?.answersJson) fullAnswers = JSON.parse(submission.answersJson);
    } catch {
        // Keep submittedData fallback
    }
    let householdItems: string[] = [];
    try {
        if (submission?.household) {
            const parsed = JSON.parse(submission.household);
            householdItems = Array.isArray(parsed) ? parsed : [];
        }
    } catch {
        // Invalid household JSON
    }

    return (
        <FormResultsContent
            submitted={submitted}
            submission={submission}
            fullAnswers={fullAnswers}
            householdItems={householdItems}
            hasMatches={hasMatches}
            matchCount={metadata.matchCount ?? 0}
            matchedAdopters={metadata.matchedAdopters}
            matchedProfiles={matchedProfiles}
            linkKind={linkKind}
            linkedProfile={linkedProfile}
        />
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <main className="container mx-auto px-4 py-16 text-center">
            <p className="text-2xl mb-2">😕</p>
            <p className="text-sm text-stone-500 font-medium">{message}</p>
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 mt-4 inline-block">
                ← Volver al inicio
            </Link>
        </main>
    );
}
