export const runtime = 'edge';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, formSubmissions, adopterImages } from '@/db/schema';
import { eq, or, and, inArray, isNull } from 'drizzle-orm';
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

    // Auth: verify the current user owns this submission (is the rescuer)
    const ownerCheck = await db.select({ userId: formSubmissions.userId })
        .from(formSubmissions)
        .where(eq(formSubmissions.id, submissionId))
        .get();
    if (!ownerCheck) return <ErrorState message="Formulario no encontrado" />;
    if (ownerCheck.userId !== currentUser) return <ErrorState message="No tenés permiso para ver este formulario" />;

    // Load notification for match metadata + mark as read (single query)
    let metadata: NotificationMetadata = { submissionId, matchCount: 0 };
    try {
        const notif = await db.select({ id: notifications.id, metadata: notifications.metadata })
            .from(notifications)
            .where(and(
                eq(notifications.userId, currentUser),
                sql`json_extract(${notifications.metadata}, '$.submissionId') = ${submissionId}`,
            ))
            .get();
        if (notif) {
            // Best-effort mark as read
            try { await markNotificationRead(notif.id, currentUser); } catch { /* non-blocking */ }
            if (notif.metadata) {
                const parsed = JSON.parse(notif.metadata);
                metadata = {
                    submissionId,
                    matchCount: parsed.matchCount ?? 0,
                    submittedData: parsed.submittedData,
                    matchedAdopters: parsed.matchedAdopters,
                };
            }
        }
    } catch { /* keep defaults */ }

    // Load the full submission
    const submission = await db
        .select({
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
        .get();

    // Fetch matched adopter profiles (with addressInfo and profile image for comparison)
    let matchedProfiles: Array<{ id: string; name: string; contactInfo: string | null; addressInfo: string | null; status: string | null; profileImageUrl: string | null }> = [];
    if (metadata.matchedAdopters && metadata.matchedAdopters.length > 0) {
        const adopterIds = metadata.matchedAdopters.map(a => a.id);
        // Filter soft-deleted (merged-duplicate) adopters at read time so even legacy
        // notifications whose stored matchedAdopters contains since-deleted IDs render correctly.
        const rows = await db
            .select({ id: adopters.id, name: adopters.name, contactInfo: adopters.contactInfo, addressInfo: adopters.addressInfo, status: adopters.status })
            .from(adopters)
            .where(and(or(...adopterIds.map(id => eq(adopters.id, id)))!, isNull(adopters.deletedAt)))
            .all();
        // Profile images: one per adopter (prefer isProfilePicture=1)
        const imageRows = await db
            .select({ adopterId: adopterImages.adopterId, url: adopterImages.url, isProfilePicture: adopterImages.isProfilePicture })
            .from(adopterImages)
            // v2.26.1: profile-level OR the flagged profile picture (an activity/
            // observation photo can be the avatar); isProfilePicture DESC wins.
            .where(and(
                inArray(adopterImages.adopterId, adopterIds),
                or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1)),
            ))
            .orderBy(sql`${adopterImages.isProfilePicture} DESC`, sql`${adopterImages.uploadedAt} DESC`);
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
