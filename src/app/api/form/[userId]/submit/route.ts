import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { runAfterResponse } from '@/lib/background';
import { deriveSpecialNeeds, sanitizeShownSteps } from '@/domain/adoptionDocs';
import { isValidFormEmail } from '@/domain/formEmail';
import { parseHouseholdPeople, childrenAnswer, fullName } from '@/domain/householdPeople';
import type { HouseholdMember } from '@/lib/householdMembers';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { userId } = await params;
    const origin = request.headers.get('origin');

    try {
        const body = await request.json() as Record<string, unknown>;

        // Extract form answers
        const name = (body.name as string || '').trim();
        const email = (body.email as string || '').trim();
        const phone = (body.phone as string || '').trim();
        const address = (body.address as string || '').trim();
        const latitude = body.latitude as string || null;
        const longitude = body.longitude as string || null;
        const selfieData = body.selfie as string || null;
        const species = body.species as string || null;
        const lifeStage = body.lifeStage as string || null;
        // Custom adoption docs (2026-09, additive): NULL when the step wasn't
        // asked (hidden by rescuer config, or an old SPA opened for a specific
        // animal that always hid this step) — "unasked" is not "no". See spec
        // §3.3 and src/domain/adoptionDocs.ts:deriveSpecialNeeds.
        const specialNeeds = deriveSpecialNeeds(body);
        const shownSteps = sanitizeShownSteps(body.shownSteps);
        // The adopter's answers, minus submission metadata: shownSteps has its
        // own column, so it isn't stored again in answers_json / the
        // notification's submittedData (where it would read as an "answer").
        const answers: Record<string, unknown> = { ...body };
        delete answers.shownSteps;
        // "¿Quiénes viven en la casa?" (spec 2026-10-04). Re-parsed here: the
        // client can't put junk on a profile or lie about the children count.
        const householdPeople = parseHouseholdPeople(body.householdPeople);
        if (Array.isArray(body.householdPeople) || body.livesAlone === true) {
            answers.householdPeople = householdPeople;
            answers.livesAlone = body.livesAlone === true && householdPeople.length === 0;
            answers.children = childrenAnswer(householdPeople);
        }
        const intent = body.intent as string || null;
        const household = Array.isArray(body.household) ? JSON.stringify(body.household) : null;
        // v2.14.10-2: form launched from the public showcase pre-selected
        // an animal; carry the id through to the form_submissions row so
        // the rescuer's notification can name the specific animal.
        const selectedAnimalId = typeof body.animalId === 'string' && body.animalId.trim() ? body.animalId.trim() : null;

        // Validate required fields
        if (!name) {
            return withCors(NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 }), origin);
        }
        if (!email) {
            return withCors(NextResponse.json({ error: 'El email es obligatorio' }, { status: 400 }), origin);
        }
        // Same rule as the form's own client check, so a real applicant is
        // never refused here; a hand-made POST with `email: "x"` is.
        if (!isValidFormEmail(email)) {
            logger.info('form submit: invalid email format refused', { userId });
            return withCors(NextResponse.json({ error: 'El email no es válido' }, { status: 400 }), origin);
        }

        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { formSubmissions } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // Validate that userId belongs to a real user (userId is the user's UUID from the DB)
        const { users } = await import('@/db/schema');
        const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
        if (!user) {
            return withCors(NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 }), origin);
        }
        const rescuerEmail = user.email;

        // Upload selfie to R2 (if provided)
        let selfieUrl: string | null = null;
        if (selfieData && selfieData.startsWith('data:')) {
            try {
                const match = selfieData.match(/^data:([^;]+);base64,([\s\S]+)$/);
                if (match) {
                    const contentType = match[1];
                    const base64Data = match[2].replace(/\s/g, '');
                    const ext = contentType.includes('png') ? 'png' : 'jpg';
                    const { uploadToR2 } = await import('@/lib/r2');
                    const blobFromBase64 = await fetch(`data:${contentType};base64,${base64Data}`).then(r => r.arrayBuffer());
                    const key = `forms/${rescuerEmail}/${crypto.randomUUID()}.${ext}`;
                    selfieUrl = await uploadToR2(key, blobFromBase64, contentType);
                    logger.info('Form selfie uploaded to R2', { key });
                }
            } catch (uploadErr) {
                logger.warn('Form selfie upload failed (non-blocking)', { error: (uploadErr as Error).message });
            }
        }

        const submissionId = crypto.randomUUID();
        const notificationId = crypto.randomUUID();

        // Store in form_submissions
        await db.insert(formSubmissions).values({
            id: submissionId,
            userId: rescuerEmail,
            name,
            email,
            phone,
            address,
            latitude,
            longitude,
            selfieUrl,
            species,
            lifeStage,
            specialNeeds,
            intent,
            household,
            answersJson: JSON.stringify({ ...answers, selfie: selfieUrl || '[removed]' }),
            notificationId,
            selectedAnimalId,
            createdAt: new Date(),
            shownSteps: shownSteps ? JSON.stringify(shownSteps) : null,
        });

        // If the submission targeted a specific animal (showcase flow), look
        // up its name so the notification can read "Juana aplicó para Luna"
        // instead of "Juana completó el formulario". Best-effort: if the
        // lookup fails we fall back to the generic copy.
        let selectedAnimalName: string | null = null;
        if (selectedAnimalId) {
            try {
                const { adoptions } = await import('@/db/schema');
                const animal = await db.select({ animalName: adoptions.animalName })
                    .from(adoptions)
                    .where(eq(adoptions.id, selectedAnimalId))
                    .get();
                if (animal?.animalName) selectedAnimalName = animal.animalName;
            } catch { /* fall through */ }
        }

        // v2.14.10-18: auto-create an adopter row + run duplicate detection
        // + persist pending-dedup candidates in one helper. Replaces the
        // previous "form submissions live in purgatory until the rescuer
        // manually links them" workflow. The matches returned here feed the
        // notification below.
        let adopterId: string | null = null;
        let matches: Array<{ adopterId: string; adopterName: string; matchTypes: string[] }> = [];
        try {
            const { createAdopterFromSubmission } = await import('@/app/actions/_adopterFactory');
            const result = await createAdopterFromSubmission({
                source: 'form',
                name,
                addedBy: rescuerEmail,
                email: email || null,
                phone: phone || null,
                address: address || null,
                submissionId,
                animalId: selectedAnimalId,
                animalName: selectedAnimalName,
                // Only fully named people become profile household members.
                householdMembers: householdPeople.flatMap((p, i): HouseholdMember[] => {
                    const memberName = fullName(p);
                    return memberName ? [{
                        id: `form-${submissionId}-${i}`, name: memberName, relationship: p.relationship, contactEntries: [],
                        age: p.age, ageAsOf: new Date().toISOString().slice(0, 10), addedBy: 'form-submission',
                    }] : [];
                }),
            });
            adopterId = result.adopterId;
            matches = result.dupCandidates.map(c => ({
                adopterId: c.adopterId,
                adopterName: c.adopterName,
                matchTypes: c.matchTypes,
            }));

            // Link form submission to the new adopter and mark it linked
            // so the old "Unlinked Forms" surface stays empty post-launch.
            // autoAdopterId records which profile that was, so form-results
            // can tell "still on the new profile" from "rescuer chose an
            // existing one" (src/domain/formLink.ts).
            await db.update(formSubmissions).set({
                linkedAdopterId: adopterId,
                autoAdopterId: adopterId,
                status: 'linked',
            }).where(eq(formSubmissions.id, submissionId));

            // Every form shows in its profile's history ("Ver formulario
            // completado") and counts toward "demasiados pedidos" (Jon,
            // 2026-10-04). Idempotent; best-effort (logs, never throws).
            const { addFormRequestRecord } = await import('@/lib/formRequest');
            await addFormRequestRecord(db, submissionId, adopterId, rescuerEmail);
        } catch (e) {
            logger.warn('Form auto-create-adopter failed (continuing with notification only)', {
                submissionId,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        logger.info('PetShield form submission stored', { submissionId, rescuerEmail, name, adopterId, shownCount: shownSteps ? shownSteps.length : null });

        // Notification + org fan-out. Helper above already ran duplicate
        // detection and returned the matches; we just plug them into the
        // notification metadata.
        try {
            const { createNotification } = await import('@/app/actions/notifications');
            const matchCount = matches.length;

            // When the submission targets a specific animal, prepend the
            // animal-application framing to the title so the notification reads
            // "Juana aplicó para Luna" with the match-count appended.
            const animalPrefix = selectedAnimalName ? `${name} aplicó para ${selectedAnimalName}` : `${name} completó el formulario`;
            if (matchCount > 0) {
                await createNotification({
                    id: notificationId,
                    userId: rescuerEmail,
                    type: 'form_submission',
                    title: `${animalPrefix} — ${matchCount} coincidencia${matchCount > 1 ? 's' : ''}`,
                    body: `Se encontraron posibles registros previos. Tocá para revisar las respuestas y vincular.`,
                    url: `/form-results/${submissionId}`,
                    icon: '⚠️',
                    metadata: {
                        submissionId,
                        matchCount,
                        submittedData: { ...answers, selfie: selfieUrl || '[removed]' },
                        matchedAdopters: matches.map(m => ({
                            id: m.adopterId,
                            name: m.adopterName,
                            matchTypes: m.matchTypes,
                        })),
                        selectedAnimalId,
                        selectedAnimalName,
                    },
                });
            } else {
                await createNotification({
                    id: notificationId,
                    userId: rescuerEmail,
                    type: 'form_submission',
                    title: animalPrefix,
                    body: `No se encontraron registros previos. Revisá las respuestas para continuar.`,
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: {
                        submissionId,
                        matchCount: 0,
                        submittedData: { ...answers, selfie: selfieUrl || '[removed]' },
                        selectedAnimalId,
                        selectedAnimalName,
                    },
                });
            }

            logger.info('Form fuzzy search completed', { submissionId, matchCount });

            // Fan-out to org members (after the response, kept alive — see src/lib/background.ts)
            await runAfterResponse('formSubmit.notifyOrgMembers', async () => {
                const { notifyOrgMembers } = await import('@/app/actions/notifications');
                await notifyOrgMembers({
                    actorEmail: rescuerEmail,
                    type: 'form_submission',
                    title: `Nueva respuesta al formulario`,
                    body: `${name} completó el formulario de adopción compartido por ${rescuerEmail}.`,
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: { submissionId, submitterName: name },
                });
            }, { submissionId, rescuerEmail });
        } catch (searchErr) {
            logger.warn('Form fuzzy search/notification failed (non-blocking)', { error: (searchErr as Error).message, submissionId });
        }

        return withCors(NextResponse.json({
            success: true,
            submissionId,
        }), origin);
    } catch (error) {
        const errorId = logger.error('Form submission failed', error);
        const errMsg = error instanceof Error ? `${error.message} - Cause: ${JSON.stringify(error.cause || error)}` : 'Unknown error';
        return withCors(NextResponse.json({
            error: `Form submission failed: ${errMsg} (Error ID: ${errorId})`,
        }, { status: 500 }), origin);
    }
}
