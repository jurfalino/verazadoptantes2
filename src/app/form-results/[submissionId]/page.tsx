export const runtime = 'edge';

import { selfieUrlColumn } from '@/lib/selfieLink';
import { photoLinks } from '@/domain/formPhotos';
import { redirect, notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { notifications, adopters, animals, formSubmissions, adopterImages, adoptions } from '@/db/schema';
import { eq, or, and, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getUser } from '@/app/actions/_db';
import { markNotificationRead } from '@/app/actions/notifications';
import FormResultsContent from '@/components/FormResultsContent';
import { canAccessFormSubmission } from '@/app/actions/_applicants';
import { logger } from '@/lib/logger';
import { loadOpenPairs } from '@/lib/openPairs';
import { formBackLink } from '@/domain/formBackLink';
import Link from 'next/link';
import { formLinkKind } from '@/domain/formLink';
import { computeAvgRating } from '@/domain/ratings';
import { loadFormMatchCards } from '@/lib/formMatchCards';
import type { FormResultMatchCardProps } from '@/components/FormResultMatchCard';

interface MatchedAdopter {
    id: string;
    name: string;
    matchTypes: string[];
    /** Search score; stored on notifications since 2026-10-25, admins only. */
    score?: number;
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




export default async function FormResultsPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
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

    // The access check, the viewer's own notification (to mark it read), and
    // the full submission are mutually independent — fetch them in one
    // parallel wave instead of three sequential D1 round-trips. (The extra
    // reads for a stranger are harmless: we still gate before rendering.)
    const notifFor = (recipient: string, role: 'viewer' | 'formOwner') =>
        db.select({ id: notifications.id, metadata: notifications.metadata })
            .from(notifications)
            .where(and(
                eq(notifications.userId, recipient),
                sql`json_extract(${notifications.metadata}, '$.submissionId') = ${submissionId}`,
            ))
            .get()
            .catch((e: unknown) => {
                logger.warn('form-results: notification read fallback', {
                    submissionId, currentUser, role,
                    error: e instanceof Error ? e.message : String(e),
                });
                return null;
            });
    const [ownerCheck, notif, submission] = await Promise.all([
        db.select({ userId: formSubmissions.userId, selectedAnimalId: formSubmissions.selectedAnimalId })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submissionId))
            .get(),
        notifFor(currentUser, 'viewer'),
        db.select({
            id: formSubmissions.id,
            selfieUrl: selfieUrlColumn, // private selfies → their checked route (src/lib/selfieLink.ts)
            photoKeys: formSubmissions.photoKeys, // turned into checked links below; never sent to the page
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

    // Auth: ONE rule shared with the prefill and link actions, agreeing with
    // the animal page (src/lib/formSubmissionAccess.ts): the form-link owner's
    // team, an admin, or the animal owner's team when the form link is inside
    // it (2026-09-30 — the team sees its applicants). Missing or a stranger →
    // 404, so we never confirm a submission exists (applicant PII).
    if (!ownerCheck) notFound();
    const isFormOwner = ownerCheck.userId.trim().toLowerCase() === currentUser.trim().toLowerCase();
    if (!isFormOwner) {
        let allowed: boolean;
        try {
            allowed = await canAccessFormSubmission(db, ownerCheck, currentUser);
        } catch (e) {
            // Fails closed, but never silently: the lookup itself broke (D1), not a denial.
            const errorId = logger.error('form-results: access check failed', e, { submissionId, user: currentUser });
            return <ErrorState message="No pudimos cargar este formulario. Probá de nuevo en un rato." errorId={errorId} />;
        }
        if (!allowed) {
            logger.info('form-results: denied', { submissionId, userEmail: currentUser });
            notFound();
        }
    }

    // The duplicate-match data lives on the FORM-LINK OWNER's notification;
    // the teammate copy carries only the submitter's name. Read the owner's
    // (raw user_id, exactly what the submit route stored) so a teammate sees
    // the same matches block. The viewer's own notification is still the one
    // marked read.
    const metaNotif = isFormOwner ? notif : await notifFor(ownerCheck.userId, 'formOwner');

    // Notification → mark as read (best-effort) + parse match metadata
    let metadata: NotificationMetadata = { submissionId, matchCount: 0 };
    if (notif) {
        try {
            await markNotificationRead(notif.id, currentUser);
        } catch (e) {
            logger.warn('form-results: mark-read failed (non-blocking)', {
                submissionId, currentUser, notificationId: notif.id,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    if (metaNotif?.metadata) {
        try {
            const parsed = JSON.parse(metaNotif.metadata);
            metadata = {
                submissionId,
                matchCount: parsed.matchCount ?? 0,
                submittedData: parsed.submittedData,
                matchedAdopters: parsed.matchedAdopters,
            };
        } catch (e) {
            logger.warn('form-results: notification metadata unparseable — no match block', {
                submissionId, currentUser, notificationId: metaNotif.id,
                error: e instanceof Error ? e.message : String(e),
            });
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
    // A form match is an ordinary duplicate pair (spec 2026-11-05): the cards are
    // the form profile's OPEN PAIRS, so an answer given anywhere («Mantener
    // separados», another tab) clears them here too. The notification's
    // recorded matches only stand in for a form that never got a profile.
    type MatchRow = { id: string; name: string; matchTypes: string[]; score?: number; candidateId: string | null; canAnswer: boolean };
    let matchList: MatchRow[] = [];
    if (linkKind === 'new_profile' && submission?.autoAdopterId) {
        try {
            const pairs = await loadOpenPairs(db, submission.autoAdopterId, currentUser, { limit: 20 });
            matchList = pairs.map(p => ({ id: p.otherAdopterId, name: p.otherAdopterName, matchTypes: p.matchTypes, score: p.score, candidateId: p.id, canAnswer: p.onViewerList }));
        } catch (e) {
            const errorId = logger.error('form-results: open pairs unreadable', e, { submissionId, user: currentUser, adopterId: submission.autoAdopterId });
            return <ErrorState message="No pudimos cargar este formulario. Probá de nuevo en un rato." errorId={errorId} />;
        }
    } else if (linkKind === 'linked_existing' && linkedId) {
        // The chosen profile's card, so «which did I pick?» is answered on open.
        const recorded = (metadata.matchedAdopters ?? []).find(a => a.id === linkedId);
        matchList = [{ id: linkedId, name: recorded?.name ?? '', matchTypes: recorded?.matchTypes ?? [], score: recorded?.score, candidateId: null, canAnswer: false }];
    } else if (linkKind === 'unlinked') {
        matchList = (metadata.matchedAdopters ?? []).map(a => ({ ...a, candidateId: null, canAnswer: false }));
    }
    // The match cards (profile reads, masking, households, standing) are the
    // ones the applicant panel shows too (src/lib/formMatchCards.ts). The
    // linked profile, for the banner, is usually one of them; else (the
    // auto-created profile) it is read on its own, in the same wave.
    let matchedProfiles: FormResultMatchCardProps['profile'][] = [];
    let linkedProfile: { id: string; name: string; profileImageUrl: string | null; avgRating: number | null } | null = null;
    if (matchList.length > 0 || linkedId) {
        const linkedIsMatch = !!linkedId && matchList.some(m => m.id === linkedId);
        const [cards, linkedOwn, linkedRatings] = await Promise.all([
            loadFormMatchCards(db, currentUser, matchList, {
                submissionId,
                typed: [metadata.submittedData?.phone, metadata.submittedData?.email],
            }),
            linkedId && !linkedIsMatch ? readLinkedProfile(db, linkedId) : Promise.resolve(null),
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
        // `addedByName` is the panel's «Cargado por»; this page does not show it.
        matchedProfiles = cards.map(({ profile: { addedByName: _addedByName, ...profile } }) => profile);

        // A form linked to a profile that was later merged away (before merges
        // carried form links along, v2.56.129) has no live profile to name —
        // the banner falls back to its generic wording then.
        const linkedCard = linkedIsMatch ? cards.find(c => c.profile.id === linkedId)?.profile : null;
        const linked = linkedCard ? { id: linkedCard.id, name: linkedCard.name, profileImageUrl: linkedCard.profileImageUrl ?? null } : linkedOwn;
        if (linked) {
            linkedProfile = {
                ...linked,
                avgRating: linkedRatings ? computeAvgRating(linkedRatings as Array<{ rating: number | null }>) : null,
            };
        }
    }

    const hasMatches = matchList.length > 0;
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

    // Photos (release 2): access-checked links only — the storage keys stay here.
    const submissionView = submission ? (() => {
        const { photoKeys, ...rest } = submission;
        return { ...rest, photos: photoLinks(submission.id, photoKeys) };
    })() : submission;

    // Back link: names the screen the rescuer came from (`?from=`), but only a
    // profile or animal that belongs to THIS form gets named (spec 2026-11-05).
    const fromParam = (await searchParams)?.from;
    const from = typeof fromParam === 'string' ? fromParam : null;
    const backNames: { adopter?: string | null; animal?: string | null } = {};
    {
        const [fromKind, fromId] = (from ?? '').split(':', 2);
        try {
            if (fromKind === 'adopter' && fromId && (fromId === submission?.linkedAdopterId || fromId === submission?.autoAdopterId)) {
                backNames.adopter = (await db.select({ name: adopters.name }).from(adopters).where(and(eq(adopters.id, fromId), isNull(adopters.deletedAt))).get())?.name ?? null;
            } else if (fromKind === 'animal' && fromId && fromId === ownerCheck?.selectedAnimalId) {
                backNames.animal = (await db.select({ name: animals.name }).from(animals).where(eq(animals.id, fromId)).get())?.name ?? null;
            }
        } catch (e) {
            logger.warn('form-results: back-link name lookup failed, back to Mis adoptantes', { submissionId, user: currentUser, from, error: e instanceof Error ? e.message : String(e) });
        }
    }
    const back = formBackLink(from, backNames);

    return (
        <FormResultsContent
            back={back}
            submitted={submitted}
            submission={submissionView}
            fullAnswers={fullAnswers}
            householdItems={householdItems}
            hasMatches={hasMatches}
            matchCount={matchList.length}
            everMatched={(metadata.matchCount ?? 0) > 0 || matchList.length > 0}
            matchedAdopters={matchList}
            matchedProfiles={matchedProfiles}
            linkKind={linkKind}
            linkedProfile={linkedProfile}
        />
    );
}

/** The banner's linked profile when it is not one of the match cards (the profile auto-created from this form). */
async function readLinkedProfile(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, adopterId: string): Promise<{ id: string; name: string; profileImageUrl: string | null } | null> {
    const [row, image] = await Promise.all([
        db.select({ name: adopters.name, deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, adopterId)).get(),
        // Same picture rule as the cards: profile-level OR the flagged profile picture.
        db.select({ url: adopterImages.url })
            .from(adopterImages)
            .where(and(eq(adopterImages.adopterId, adopterId), or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1))))
            .orderBy(sql`${adopterImages.isProfilePicture} DESC`, sql`${adopterImages.uploadedAt} DESC`)
            .limit(1)
            .get(),
    ]);
    if (!row || row.deletedAt) return null;
    return { id: adopterId, name: row.name, profileImageUrl: image?.url ?? null };
}

function ErrorState({ message, errorId }: { message: string; errorId?: string }) {
    return (
        <main className="container mx-auto px-4 py-16 text-center">
            <p className="text-2xl mb-2">😕</p>
            <p className="text-sm text-stone-500 font-medium">{message}</p>
            {errorId && <p className="text-xs text-stone-400 font-mono mt-2">Error ID: {errorId}</p>}
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 mt-4 inline-block">
                ← Volver al inicio
            </Link>
        </main>
    );
}
