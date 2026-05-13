import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: animalId } = await params;
    const origin = request.headers.get('origin');

    try {
        const body = await request.json();
        const { name, lastName, dni, email, phone, address, socialNetworks, screenshot } = body as {
            name: string;
            lastName: string;
            dni: string;
            email: string;
            phone: string;
            address: string;
            socialNetworks: string;
            screenshot?: string; // base64 data URL of contract PDF
        };

        if (!name || !lastName) {
            return withCors(NextResponse.json({ error: 'Name and last name are required' }, { status: 400 }), origin);
        }

        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { adoptions } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // 1. Find the animal record
        const animal = await db.select().from(adoptions).where(eq(adoptions.id, animalId)).get();
        if (!animal) {
            return withCors(NextResponse.json({ error: 'Animal not found' }, { status: 404 }), origin);
        }

        if (animal.adopterId) {
            return withCors(NextResponse.json({ error: 'This animal has already been adopted' }, { status: 409 }), origin);
        }

        // 2. Upload contract document to R2 FIRST — adoption only proceeds if this succeeds
        let contractUrl: string | null = null;
        if (screenshot && screenshot.startsWith('data:')) {
            const match = screenshot.match(/^data:([^;]+);base64,([\s\S]+)$/);
            if (!match) {
                return withCors(NextResponse.json({ error: 'Invalid contract document format' }, { status: 400 }), origin);
            }

            const contentType = match[1];
            const base64Data = match[2].replace(/\s/g, '');
            const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
            const sizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
            logger.info('Contract document received', { animalId, contentType, sizeKB });

            const { uploadToR2 } = await import('@/lib/r2');
            // Convert base64 to a native ArrayBuffer via Blob (miniflare-compatible)
            const blobFromBase64 = await fetch(`data:${contentType};base64,${base64Data}`).then(r => r.arrayBuffer());
            const key = `contracts/${animalId}/signed-contract.${ext}`;
            // This will throw on failure — intentionally NOT caught here.
            // If the upload fails, the entire submission fails and nothing is persisted.
            contractUrl = await uploadToR2(key, blobFromBase64, contentType);
            logger.info('Contract document uploaded to R2', { animalId, key, sizeKB });
        } else {
            return withCors(NextResponse.json({ error: 'Contract document is required' }, { status: 400 }), origin);
        }

        const fullName = `${name} ${lastName}`.trim();

        // 4. Create the adopter via the shared factory (v2.14.10-18):
        // INSERTs adopter + adopter_history, synchronously tokenizes, runs
        // duplicate detection, and persists pending dedup candidates so the
        // /my-adopters pending-dedup section has data. source='contract'
        // attribution. addedBy falls back to the literal 'contract' string
        // when the animal was added anonymously (preserves prior semantic).
        const { createAdopterFromSubmission } = await import('@/app/actions/_adopterFactory');
        const factoryResult = await createAdopterFromSubmission({
            source: 'contract',
            name: fullName,
            addedBy: animal.addedBy || 'contract',
            email: email || null,
            phone: phone || null,
            address: address || null,
            socials: socialNetworks || null,
            documentId: dni || null,
            animalId,
            animalName: animal.animalName,
            animalSpecies: animal.species,
        });
        const adopterId = factoryResult.adopterId;
        const matches = factoryResult.dupCandidates.map(c => ({
            adopterId: c.adopterId,
            adopterName: c.adopterName,
            matchTypes: c.matchTypes,
        }));

        // 5. Link the animal to the adopter (convert to adoption)
        await db.update(adoptions).set({
            adopterId,
            recordType: 'adoption',
            date: new Date(),
            status: 'active',
            rating: 5,
            comments: JSON.stringify({ contractScreenshot: contractUrl }),
        }).where(eq(adoptions.id, animalId));

        logger.info('Contract adoption submitted', { animalId, adopterId, adopterName: fullName, contractUrl });

        // 6. Notification for the rescuer using the matches the factory
        // already computed (no second findAdopters call).
        try {
            const rescuerEmail = animal.addedBy;
            if (rescuerEmail && rescuerEmail !== 'anonymous' && rescuerEmail !== 'contract') {
                const { createNotification } = await import('@/app/actions/notifications');
                const matchCount = matches.length;
                const animalName = animal.animalName || 'Animal';
                const notificationId = crypto.randomUUID();

                if (matchCount > 0) {
                    await createNotification({
                        id: notificationId,
                        userId: rescuerEmail,
                        type: 'contract_result',
                        title: `${matchCount} coincidencia${matchCount > 1 ? 's' : ''} para ${fullName}`,
                        body: `${animalName} fue adoptado por ${fullName}. Se encontraron posibles registros previos. Tocá para revisar.`,
                        url: `/contract-results/${notificationId}`,
                        icon: '⚠️',
                        metadata: {
                            notificationId,
                            animalId,
                            animalName,
                            adopterId,
                            adopterName: fullName,
                            matchCount,
                            matchedAdopters: matches.map(m => ({
                                id: m.adopterId,
                                name: m.adopterName,
                                matchTypes: m.matchTypes,
                            })),
                            submittedData: { name: fullName, phone, email, dni, address, socialNetworks },
                        },
                    });
                } else {
                    await createNotification({
                        id: notificationId,
                        userId: rescuerEmail,
                        type: 'contract_result',
                        title: `${animalName} adoptado por ${fullName}`,
                        body: `No se encontraron registros previos para ${fullName}. Todo en orden.`,
                        icon: '✅',
                        metadata: {
                            animalId,
                            animalName,
                            adopterId,
                            adopterName: fullName,
                            matchCount: 0,
                            submittedData: { name: fullName, phone, email, dni, address, socialNetworks },
                        },
                    });
                }

                logger.info('Contract fuzzy search completed', { animalId, adopterId, matchCount });

                // Fan-out to org members (fire-and-forget)
                import('@/app/actions/notifications').then(({ notifyOrgMembers }) => {
                    notifyOrgMembers({
                        actorEmail: rescuerEmail,
                        type: 'contract_result',
                        title: `Contrato firmado: ${animal.animalName || 'Animal'}`,
                        body: `${fullName} firmó el contrato de adopción de ${animal.animalName || 'un animal'}.`,
                        url: `/adopter/${adopterId}`,
                        icon: '📝',
                        metadata: { adopterId, adopterName: fullName, animalName: animal.animalName },
                    }).catch((e) => {
                        logger.warn('contract submit: notifyOrgMembers failed', {
                            adopterId,
                            animalId,
                            rescuerEmail,
                            error: e instanceof Error ? e.message : String(e),
                        });
                    });
                });
            }
        } catch (searchErr) {
            // Never block the contract response — just log
            logger.warn('Contract fuzzy search/notification failed (non-blocking)', { error: (searchErr as Error).message, animalId });
        }

        return withCors(NextResponse.json({
            success: true,
            adopterId,
            contractUrl,
            message: 'Adoption contract submitted successfully',
        }), origin);
    } catch (error) {
        const errorId = logger.error('Contract submission failed', error);
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        return withCors(NextResponse.json({
            error: `Contract submission failed: ${errMsg} (Error ID: ${errorId})`,
        }, { status: 500 }), origin);
    }
}
