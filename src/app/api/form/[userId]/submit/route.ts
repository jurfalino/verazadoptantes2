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

        // Fuzzy matching + notification (fire-and-forget style but awaited for reliability).
        // Backed by findAdopters({ mode: 'duplicate' }) — single source of truth shared with
        // ImportWizard / AdopterFlagging / contract submit. minRelevance:0 preserves recall.
        try {
            const { findAdopters } = await import('@/app/actions/findAdopters');
            const { extractPhones, extractEmails } = await import('@/lib/tokenizer');
            const { createNotification } = await import('@/app/actions/notifications');

            const dupResult = await findAdopters(
                {
                    name,
                    phones: phone ? extractPhones(phone) : [],
                    emails: email ? extractEmails(email) : [],
                },
                { mode: 'duplicate', minRelevance: 0, limit: 5 },
            );
            const matches = dupResult.results as Array<{ adopterId: string; adopterName: string; matchTypes: string[] }>;
            const matchCount = matches.length;

            if (matchCount > 0) {
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
                        matchedAdopters: matches.map(m => ({
                            id: m.adopterId,
                            name: m.adopterName,
                            matchTypes: m.matchTypes,
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

            logger.info('Form fuzzy search completed', { submissionId, matchCount });

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
