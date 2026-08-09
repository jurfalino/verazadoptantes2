export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, formSubmissions, adopterImages } from '@/db/schema';
import { eq, or, and, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import FormResultsContent from '@/components/FormResultsContent';
import Link from 'next/link';

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
            .catch(() => null),
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
            answersJson: formSubmissions.answersJson,
            createdAt: formSubmissions.createdAt,
        })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submissionId))
            .get(),
    ]);

    // Auth: verify the current user owns this submission (is the rescuer)
    if (!ownerCheck) return <ErrorState message="Formulario no encontrado" />;
    if (ownerCheck.userId !== currentUser) return <ErrorState message="No tenés permiso para ver este formulario" />;

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

    // Fetch matched adopter profiles (with addressInfo and profile image for comparison)
    let matchedProfiles: Array<{ id: string; name: string; contactInfo: string | null; addressInfo: string | null; status: string | null; profileImageUrl: string | null }> = [];
    if (metadata.matchedAdopters && metadata.matchedAdopters.length > 0) {
        const adopterIds = metadata.matchedAdopters.map(a => a.id);
        // Profiles and their images are independent — fetch both in one wave.
        // Both use the OR-of-eq id filter, never `inArray`: D1 does NOT expand
        // array params in IN clauses (it binds `IN (?)` with a single value and
        // silently returns wrong results — see docs/D1_COMPATIBILITY.md). The
        // images query previously used `inArray(...)`, so matched-adopter avatars
        // could come back missing/wrong on D1; this switches it to the same safe
        // pattern the profile query already uses.
        // Filter soft-deleted (merged-duplicate) adopters at read time so even legacy
        // notifications whose stored matchedAdopters contains since-deleted IDs render correctly.
        const [rows, imageRows] = await Promise.all([
            db
                .select({ id: adopters.id, name: adopters.name, contactInfo: adopters.contactInfo, addressInfo: adopters.addressInfo, status: adopters.status })
                .from(adopters)
                .where(and(or(...adopterIds.map(id => eq(adopters.id, id)))!, isNull(adopters.deletedAt)))
                .all(),
            // v2.26.1: profile-level OR the flagged profile picture (an activity/
            // observation photo can be the avatar); isProfilePicture DESC wins.
            db
                .select({ adopterId: adopterImages.adopterId, url: adopterImages.url, isProfilePicture: adopterImages.isProfilePicture })
                .from(adopterImages)
                .where(and(
                    or(...adopterIds.map(id => eq(adopterImages.adopterId, id)))!,
                    or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1)),
                ))
                .orderBy(sql`${adopterImages.isProfilePicture} DESC`, sql`${adopterImages.uploadedAt} DESC`),
        ]);
        const imageByAdopter = new Map<string, string>();
        for (const row of imageRows) {
            if (!imageByAdopter.has(row.adopterId)) imageByAdopter.set(row.adopterId, row.url);
        }
        // Sort by match strength (more matchTypes first), preserving order of metadata.matchedAdopters for ties
        const order = new Map(metadata.matchedAdopters.map((a, i) => [a.id, { count: a.matchTypes?.length ?? 0, index: i }]));
        type ProfileRow = { id: string; name: string; contactInfo: string | null; addressInfo: string | null; status: string | null; profileImageUrl: string | null };
        matchedProfiles = rows.map((r: Omit<ProfileRow, 'profileImageUrl'>) => ({
            ...r,
            profileImageUrl: imageByAdopter.get(r.id) ?? null,
        })).sort((a: ProfileRow, b: ProfileRow) => {
            const ac = order.get(a.id) ?? { count: 0, index: 999 };
            const bc = order.get(b.id) ?? { count: 0, index: 999 };
            return bc.count !== ac.count ? bc.count - ac.count : ac.index - bc.index;
        });
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
            notificationId={submissionId}
            submitted={submitted}
            submission={submission}
            fullAnswers={fullAnswers}
            householdItems={householdItems}
            hasMatches={hasMatches}
            matchCount={metadata.matchCount ?? 0}
            matchedAdopters={metadata.matchedAdopters}
            matchedProfiles={matchedProfiles}
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
