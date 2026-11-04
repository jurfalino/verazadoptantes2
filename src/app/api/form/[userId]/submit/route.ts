import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { runAfterResponse } from '@/lib/background';
import { deriveSpecialNeeds, sanitizeShownSteps, isPhoneRequired, photosOn } from '@/domain/adoptionDocs';
import { isValidFormEmail } from '@/domain/formEmail';
import { parseHouseholdPeople, childrenAnswer, fullName } from '@/domain/householdPeople';
import { parseGiftRecipient, recipientFullName } from '@/domain/giftRecipient';
import { clampFreeText, socialHandle, normalizeOpenAnswers } from '@/domain/formFreeText';
import { parsePhotoInputs, type StoredPhoto } from '@/domain/formPhotos';

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
        // Gift flow (spec Part 2): the recipient is who will live with the
        // animal. Re-parsed here; never kept on a "Para mí" submission.
        const gift = body.intent === 'gift';
        const recipient = gift ? parseGiftRecipient(body.giftRecipient) : null;
        delete answers.giftRecipient;
        if (recipient) answers.giftRecipient = recipient;
        const sentPhone = (body.giftRecipient as { phone?: unknown } | undefined)?.phone;
        if (recipient && !recipient.phone && typeof sentPhone === 'string' && sentPhone.trim()) {
            // The form checks the same rule, so only an old tab or a hand-made POST gets here.
            logger.warn('form submit: gift recipient phone dropped (bad format)', { userId });
        }
        // New free-text answers (spec 2026-10-14): clamped here, never trusted.
        for (const [key, max] of [['gaveAwayWhy', 300], ['vetReference', 300], ['motivation', 300], ['howHeard', 300], ['instagram', 100], ['facebook', 100]] as const) {
            const v = clampFreeText(body[key], max);
            if (v === undefined) delete answers[key]; else answers[key] = v;
        }
        // Free-text answers to closed questions (release 3): { open }, clamped.
        const normalized = normalizeOpenAnswers(answers);
        for (const k of Object.keys(answers)) if (!(k in normalized)) delete answers[k];
        Object.assign(answers, normalized);
        // Instagram / Facebook become profile contacts only when they look like one.
        const socials = [socialHandle(body.instagram, 'instagram'), socialHandle(body.facebook, 'facebook')]
            .filter((s): s is NonNullable<typeof s> => s !== null);
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

        // The rescuer's form settings (null while custom forms is off, or
        // nothing is customised → today's form).
        const { resolveDocsForRescuer } = await import('@/lib/adoptionDocsRepo');
        const hiddenSteps = (await resolveDocsForRescuer(db, rescuerEmail))?.hiddenSteps ?? [];

        // Spec Part 3: the phone is required unless the rescuer made it
        // optional. Never refused here — a tab opened before the switch
        // changed must still get through — only logged, so a client that
        // skips its own check shows up.
        if (!phone && isPhoneRequired(hiddenSteps)) logger.warn('form submit: phone missing on a phone-required form', { userId });

        const submissionId = crypto.randomUUID();

        // The applicant's selfie (if any) goes to PRIVATE storage, tagged with
        // this submission; it opens only through /api/files/selfie/{id} for whoever
        // may see this form's results (src/lib/contractStorage.ts storeSelfie).
        let selfieKey: string | null = null;
        if (selfieData && selfieData.startsWith('data:')) {
            try {
                const match = selfieData.match(/^data:([^;]+);base64,([\s\S]+)$/);
                if (match) {
                    const contentType = match[1];
                    const base64Data = match[2].replace(/\s/g, '');
                    const { storeSelfie } = await import('@/lib/contractStorage');
                    const blobFromBase64 = await fetch(`data:${contentType};base64,${base64Data}`).then(r => r.arrayBuffer());
                    selfieKey = (await storeSelfie(blobFromBase64, contentType, submissionId)).key;
                }
            } catch (uploadErr) {
                logger.warn('Form selfie upload failed (non-blocking)', { submissionId, error: (uploadErr as Error).message });
            }
        }

        // Photos of the protection / where it sleeps (spec 2026-10-14 release 2):
        // private storage like the selfie; keys only in photo_keys, never in the
        // answers. A photo that can't be stored never fails the submission.
        // Only kept when this rescuer asks for photos: a forged or stale
        // submit can't put files in storage on a form that never offered it.
        const photoInput = photosOn(hiddenSteps) ? parsePhotoInputs(body) : { protection: [], sleep: null, dropped: 0 };
        if (!photosOn(hiddenSteps) && (body.protectionPhotos != null || body.sleepPhoto != null)) {
            logger.warn('form submit: photos sent to a form that does not ask for them, ignored', { submissionId });
        }
        if (photoInput.dropped) logger.warn('form submit: photos dropped (limit, type or size)', { submissionId, dropped: photoInput.dropped });
        const photoKeys: StoredPhoto[] = [];
        let photosFailed = 0;
        const { storeFormPhoto } = await import('@/lib/contractStorage');
        for (const [kind, dataUrl] of [
            ...photoInput.protection.map(d => ['protection', d] as const),
            ...(photoInput.sleep ? [['sleep', photoInput.sleep] as const] : []),
        ]) {
            try {
                const contentType = dataUrl.slice(5, dataUrl.indexOf(';'));
                const bytes = await fetch(dataUrl).then(r => r.arrayBuffer());
                photoKeys.push({ kind, key: (await storeFormPhoto(bytes, contentType, submissionId, kind)).key });
            } catch (e) {
                photosFailed++;
                logger.warn('form photo upload failed (non-blocking)', { submissionId, kind, error: e instanceof Error ? e.message : String(e) });
            }
        }
        delete answers.protectionPhotos;
        delete answers.sleepPhoto;
        const storedProtection = photoKeys.filter(p => p.kind === 'protection').length;
        if (storedProtection) answers.protectionPhotos = storedProtection;
        if (photoKeys.some(p => p.kind === 'sleep')) answers.sleepPhoto = true;

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
            selfieKey,
            photoKeys: photoKeys.length ? JSON.stringify(photoKeys) : null,
            species,
            lifeStage,
            specialNeeds,
            intent,
            household,
            answersJson: JSON.stringify({ ...answers, selfie: selfieKey ? '[private]' : '[removed]' }),
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
        // Its owner — the teammate fan-out names the animal only when that
        // owner is in the form-link owner's team (forged ?animal= rows).
        let selectedAnimalOwner: string | null = null;
        if (selectedAnimalId) {
            try {
                const { adoptions } = await import('@/db/schema');
                const animal = await db.select({ animalName: adoptions.animalName, addedBy: adoptions.addedBy })
                    .from(adoptions)
                    .where(eq(adoptions.id, selectedAnimalId))
                    .get();
                if (animal?.animalName) selectedAnimalName = animal.animalName;
                selectedAnimalOwner = animal?.addedBy ?? null;
            } catch (e) {
                logger.warn('Form submit: animal lookup failed — generic notification copy', {
                    submissionId, selectedAnimalId, error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // v2.14.10-18: auto-create an adopter row + run duplicate detection
        // + persist pending-dedup candidates in one helper. Replaces the
        // previous "form submissions live in purgatory until the rescuer
        // manually links them" workflow. The matches returned here feed the
        // notification below.
        let adopterId: string | null = null;
        let matches: Array<{ adopterId: string; adopterName: string; matchTypes: string[]; relevancePercent?: number }> = [];
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
                socials,
            });
            adopterId = result.adopterId;
            matches = result.dupCandidates.map(c => ({
                adopterId: c.adopterId,
                adopterName: c.adopterName,
                matchTypes: c.matchTypes,
                relevancePercent: c.relevancePercent,
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

        // Households as profiles (spec «When nobody can answer», «Gift recipient»):
        // after the applicant exists, is linked and has its request — a failure
        // here never leaves the submission unlinked.
        if (adopterId) {
            const applicantId = adopterId;
            if (!gift) {
                // The fully named people of "¿Quiénes viven en la casa?" become profiles
                // (owner = the form's owner) in the applicant's household. In a gift the
                // people list is the RECIPIENT's home: never the giver's household.
                const people = householdPeople.flatMap((p, i) => {
                    const memberName = fullName(p);
                    return memberName ? [{ name: memberName, relationship: p.relationship, age: p.age, index: i }] : [];
                });
                if (people.length) {
                    try {
                        const { attachHouseholdPeople } = await import('@/lib/householdPeople');
                        await attachHouseholdPeople(db, {
                            anchorAdopterId: applicantId, people, actor: 'form-submission', ownerEmail: rescuerEmail,
                            sourceKey: `form-${submissionId}`, requestId: submissionId, background: true,
                        });
                    } catch (e) {
                        logger.error('Form household people not attached (the form is saved)', e, { submissionId, adopterId: applicantId });
                    }
                }
            } else if (recipient?.phone && recipientFullName(recipient)) {
                // The gift's recipient is form data on the giver (no profile until a rescuer
                // presses «Crear perfil»): index its phone with the giver's, now that the
                // form is linked, so searching it finds the giver (src/lib/giftRecipients.ts).
                try {
                    const { tokenizeAdopter } = await import('@/lib/adopterTokenize');
                    await tokenizeAdopter(applicantId, { force: true });
                } catch (e) {
                    logger.warn('Form gift recipient phone not indexed on the giver', { submissionId, adopterId: applicantId, error: e instanceof Error ? e.message : String(e) });
                }
            }
        }

        logger.info('PetShield form submission stored', { submissionId, rescuerEmail, name, adopterId, shownCount: shownSteps ? shownSteps.length : null });

        // Notification + org fan-out. Helper above already ran duplicate
        // detection and returned the matches; we just plug them into the
        // notification metadata.
        try {
            const { createNotification } = await import('@/app/actions/notifications');
            const matchCount = matches.length;

            // When the submission targets a specific animal the title reads
            // "Juana aplicó para Luna", with the match count appended
            // (src/domain/formNotification.ts — shared with the teammate copy).
            const { notificationContent } = await import('@/domain/notificationTemplates');
            const titleParams = { submitterName: name, matchCount: String(matchCount) };
            const ownerContent = notificationContent({
                key: 'form_submission_owner',
                params: { ...titleParams, ...(selectedAnimalName ? { animalName: selectedAnimalName } : {}) },
            });
            if (matchCount > 0) {
                await createNotification({
                    id: notificationId,
                    userId: rescuerEmail,
                    type: 'form_submission',
                    ...ownerContent,
                    url: `/form-results/${submissionId}`,
                    icon: '⚠️',
                    metadata: {
                        submissionId,
                        matchCount,
                        submittedData: { ...answers, selfie: selfieKey ? '[private]' : '[removed]' },
                        matchedAdopters: matches.map(m => ({
                            id: m.adopterId,
                            name: m.adopterName,
                            matchTypes: m.matchTypes,
                            // The search score, shown to admins only (Jon, 2026-10-25).
                            score: m.relevancePercent,
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
                    ...ownerContent,
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: {
                        submissionId,
                        matchCount: 0,
                        submittedData: { ...answers, selfie: selfieKey ? '[private]' : '[removed]' },
                        selectedAnimalId,
                        selectedAnimalName,
                    },
                });
            }

            logger.info('Form fuzzy search completed', { submissionId, matchCount });

            // Fan-out to org members (after the response, kept alive — see src/lib/background.ts).
            // With an animal of THIS team, teammates get the owner's title
            // («Juana aplicó para Luna …») and the animal in metadata, like the
            // owner's copy. A forged ?animal= row (another team's animal) gets
            // the generic title and no animal: never name another team's
            // animal to these teammates.
            await runAfterResponse('formSubmit.notifyOrgMembers', async () => {
                const [{ notifyOrgMembers, resolveDisplayName }, { getTeamEmails }, { teammateVisibleAnimal }] = await Promise.all([
                    import('@/app/actions/notifications'),
                    import('@/lib/orgMembership'),
                    import('@/lib/applicantScope'),
                ]);
                const animal = selectedAnimalId
                    ? teammateVisibleAnimal(
                        { id: selectedAnimalId, name: selectedAnimalName, owner: selectedAnimalOwner },
                        await getTeamEmails(rescuerEmail),
                    )
                    : null;
                // Teammates read the sharer's name, never the address.
                const sharedByName = await resolveDisplayName(rescuerEmail);
                await notifyOrgMembers({
                    actorEmail: rescuerEmail,
                    type: 'form_submission',
                    ...notificationContent({
                        key: 'form_submission_teammate',
                        params: { ...titleParams, sharedByName, ...(animal?.name ? { animalName: animal.name } : {}) },
                    }),
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: {
                        submissionId, submitterName: name,
                        selectedAnimalId: animal?.id ?? null, selectedAnimalName: animal?.name ?? null,
                    },
                });
            }, { submissionId, rescuerEmail, selectedAnimalId });
        } catch (searchErr) {
            logger.warn('Form fuzzy search/notification failed (non-blocking)', { error: (searchErr as Error).message, submissionId });
        }

        return withCors(NextResponse.json({
            success: true,
            submissionId,
            // false: a selfie was sent but couldn't be stored (the form is saved anyway).
            selfieSaved: selfieData && selfieData.startsWith('data:') ? !!selfieKey : null,
            photosSaved: photosFailed ? false : null,
        }), origin);
    } catch (error) {
        const errorId = logger.error('Form submission failed', error);
        const errMsg = error instanceof Error ? `${error.message} - Cause: ${JSON.stringify(error.cause || error)}` : 'Unknown error';
        return withCors(NextResponse.json({
            error: `Form submission failed: ${errMsg} (Error ID: ${errorId})`,
        }, { status: 500 }), origin);
    }
}
