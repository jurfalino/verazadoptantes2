import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';

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
        const specialNeeds = body.specialNeeds ? 1 : 0;
        const intent = body.intent as string || null;
        const household = Array.isArray(body.household) ? JSON.stringify(body.household) : null;

        // Validate required fields
        if (!name) {
            return withCors(NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 }), origin);
        }
        if (!email) {
            return withCors(NextResponse.json({ error: 'El email es obligatorio' }, { status: 400 }), origin);
        }

        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { formSubmissions, adopters } = await import('@/db/schema');
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
            answersJson: JSON.stringify({ ...body, selfie: selfieUrl || '[removed]' }),
            notificationId,
            createdAt: new Date(),
        });

        logger.info('PetShield form submission stored', { submissionId, rescuerEmail, name });

        // Fuzzy matching + notification (fire-and-forget style but awaited for reliability)
        try {
            const { extractNameWords, extractPhones, extractPhoneSuffixes, extractEmails, normalizeText } = await import('@/lib/tokenizer');
            const { duplicateTokens } = await import('@/db/schema');
            const { inArray: drizzleInArray, or: drizzleOr, like } = await import('drizzle-orm');
            const { createNotification } = await import('@/app/actions/notifications');

            // Tokenize submitted data
            const tokens: Array<{ type: string; value: string }> = [];
            const nameWords = extractNameWords(name);
            nameWords.forEach(w => tokens.push({ type: 'name_word', value: w }));
            if (name.trim()) tokens.push({ type: 'name_full', value: normalizeText(name) });
            if (phone) {
                const phones = extractPhones(phone);
                phones.forEach(p => tokens.push({ type: 'phone', value: p }));
                extractPhoneSuffixes(phones).forEach(s => tokens.push({ type: 'phone_suffix', value: s }));
            }
            if (email) {
                extractEmails(email).forEach(e => tokens.push({ type: 'email', value: e }));
            }

            const adopterMatches = new Map<string, Set<string>>();

            // Strategy 1: Token-based matching
            const tokenValues = tokens.map(t => t.value).filter(v => v.length >= 3);
            if (tokenValues.length > 0) {
                const tokenMatches = await db
                    .select({
                        adopterId: duplicateTokens.adopterId,
                        tokenType: duplicateTokens.tokenType,
                    })
                    .from(duplicateTokens)
                    .where(drizzleInArray(duplicateTokens.tokenValue, tokenValues))
                    .all();

                for (const m of tokenMatches) {
                    if (!adopterMatches.has(m.adopterId)) adopterMatches.set(m.adopterId, new Set());
                    adopterMatches.get(m.adopterId)!.add(`token:${m.tokenType}`);
                }
            }

            // Strategy 2: LIKE search on adopters
            const likeQueries: Array<{ field: string; value: string }> = [];
            for (const word of nameWords) {
                if (word.length >= 3) likeQueries.push({ field: 'name', value: `%${word}%` });
            }
            if (phone) {
                const digits = phone.replace(/\D/g, '');
                if (digits.length >= 6) likeQueries.push({ field: 'contact', value: `%${digits.slice(-8)}%` });
            }
            if (email && email.includes('@')) {
                likeQueries.push({ field: 'contact', value: `%${email.toLowerCase()}%` });
            }

            const likeResults = await Promise.all(
                likeQueries.map(async (q) => {
                    const col = q.field === 'name' ? adopters.name : adopters.contactInfo;
                    const results = await db
                        .select({ id: adopters.id })
                        .from(adopters)
                        .where(like(col, q.value))
                        .all();
                    return { field: q.field, ids: results.map((r: { id: string }) => r.id) };
                })
            );

            for (const lr of likeResults) {
                for (const id of lr.ids) {
                    if (!adopterMatches.has(id)) adopterMatches.set(id, new Set());
                    adopterMatches.get(id)!.add(`like:${lr.field}`);
                }
            }

            const matchCount = adopterMatches.size;

            if (matchCount > 0) {
                const matchedIds = Array.from(adopterMatches.keys()).slice(0, 5);
                const matchedAdopters = await db
                    .select({ id: adopters.id, name: adopters.name })
                    .from(adopters)
                    .where(drizzleOr(...matchedIds.map(id => eq(adopters.id, id)))!)
                    .all();

                await createNotification({
                    id: notificationId,
                    userId: rescuerEmail,
                    type: 'form_submission',
                    title: `📋 ${name} completó el formulario — ${matchCount} coincidencia${matchCount > 1 ? 's' : ''}`,
                    body: `Se encontraron posibles registros previos. Tocá para revisar las respuestas y vincular.`,
                    url: `/form-results/${submissionId}`,
                    icon: '⚠️',
                    metadata: {
                        submissionId,
                        matchCount,
                        submittedData: { ...body, selfie: selfieUrl || '[removed]' },
                        matchedAdopters: matchedAdopters.map((a: { id: string; name: string }) => ({
                            id: a.id,
                            name: a.name,
                            matchTypes: Array.from(adopterMatches.get(a.id) || []),
                        })),
                    },
                });
            } else {
                await createNotification({
                    id: notificationId,
                    userId: rescuerEmail,
                    type: 'form_submission',
                    title: `📋 ${name} completó el formulario`,
                    body: `No se encontraron registros previos. Revisá las respuestas para continuar.`,
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: {
                        submissionId,
                        matchCount: 0,
                        submittedData: { ...body, selfie: selfieUrl || '[removed]' },
                    },
                });
            }

            logger.info('Form fuzzy search completed', { submissionId, matchCount, tokenCount: tokenValues.length });

            // Fan-out to org members (fire-and-forget)
            import('@/app/actions/notifications').then(({ notifyOrgMembers }) => {
                notifyOrgMembers({
                    actorEmail: rescuerEmail,
                    type: 'form_submission',
                    title: `📋 Nueva respuesta al formulario`,
                    body: `${name} completó el formulario de adopción compartido por ${rescuerEmail}.`,
                    url: `/form-results/${submissionId}`,
                    icon: '📋',
                    metadata: { submissionId, submitterName: name },
                }).catch((e) => {
                    logger.warn('form submit: notifyOrgMembers failed', {
                        submissionId,
                        rescuerEmail,
                        error: e instanceof Error ? e.message : String(e),
                    });
                });
            });
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
