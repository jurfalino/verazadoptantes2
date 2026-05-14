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
        const { name, lastName, dni, email, phone, address, socialNetworks, screenshot, token } = body as {
            name: string;
            lastName: string;
            dni: string;
            email: string;
            phone: string;
            address: string;
            socialNetworks: string;
            screenshot?: string; // base64 data URL of contract PDF
            /** v2.14.10-21: when set, this is a locked-contract submission for a
              * specific adopter — we resolve the token, link the existing adopter
              * instead of creating a new one, and mark the invitation used. */
            token?: string;
        };

        if (!name || !lastName) {
            return withCors(NextResponse.json({ error: 'Name and last name are required' }, { status: 400 }), origin);
        }

        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { adoptions, contractInvitations } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        // v2.14.10-21: resolve token (if present) BEFORE the animal lookup so we
        // can also use the token to identify the animal. Token-based submissions
        // are the new locked path; tokenless submissions use the legacy open path.
        let invitation: typeof contractInvitations.$inferSelect | undefined;
        if (token) {
            invitation = await db.select().from(contractInvitations).where(eq(contractInvitations.token, token)).get();
            if (!invitation) {
                return withCors(NextResponse.json({ error: 'Invitation not found' }, { status: 404 }), origin);
            }
            if (invitation.usedAt) {
                return withCors(NextResponse.json({ error: 'Invitation already used' }, { status: 410 }), origin);
            }
            const nowSec = Math.floor(Date.now() / 1000);
            if (invitation.expiresAt && invitation.expiresAt < nowSec) {
                return withCors(NextResponse.json({ error: 'Invitation expired' }, { status: 410 }), origin);
            }
            // The token's animalId takes precedence over the URL param (which the
            // contract-app passes through for backward compat).
            if (invitation.animalId !== animalId) {
                return withCors(NextResponse.json({ error: 'Invitation does not match this animal' }, { status: 400 }), origin);
            }
        }

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

        // 4. Adopter creation:
        //  • Token path (v2.14.10-21 / Phase 5): link the existing adopter
        //    that the invitation was issued for. No new row, no duplicate
        //    detection (this person is already in our DB).
        //  • Legacy open path: route through createAdopterFromSubmission
        //    (Phase 1) to create a fresh row with source='contract' and run
        //    dedup detection.
        let adopterId: string;
        let matches: Array<{ adopterId: string; adopterName: string; matchTypes: string[] }> = [];
        if (invitation) {
            adopterId = invitation.adopterId;
            // Best-effort update of the adopter's contactInfo with any
            // typo-corrected fields the signer changed. Keep it simple:
            // overwrite the contactInfo with the re-built string from the
            // submitted fields. The original adopter row keeps its source.
            const { adopters: adoptersTable, adopterHistory } = await import('@/db/schema');
            const contactParts: string[] = [];
            if (dni) contactParts.push(`Documento: ${dni}`);
            if (email) contactParts.push(`Email: ${email}`);
            if (phone) contactParts.push(`Tel: ${phone}`);
            if (address) contactParts.push(`Dirección: ${address}`);
            if (socialNetworks) contactParts.push(`Redes: ${socialNetworks}`);
            const newContactInfo = contactParts.join('\n');

            await db.update(adoptersTable).set({
                name: fullName,
                contactInfo: newContactInfo || null,
                addressInfo: address || null,
                updatedAt: new Date(),
            }).where(eq(adoptersTable.id, adopterId));

            await db.insert(adopterHistory).values({
                id: crypto.randomUUID(),
                adopterId,
                changedBy: 'contract-signed-via-invitation',
                changes: JSON.stringify({
                    contract_signed_via_invitation: {
                        token,
                        animalId,
                        animalName: animal.animalName,
                    },
                }),
                changedAt: new Date(),
            });

            // Mark invitation used (must happen after a successful sign).
            await db.update(contractInvitations).set({
                usedAt: Math.floor(Date.now() / 1000),
            }).where(eq(contractInvitations.token, token!));

            logger.info('Contract signed via invitation', { animalId, adopterId, token });
        } else {
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
            adopterId = factoryResult.adopterId;
            matches = factoryResult.dupCandidates.map(c => ({
                adopterId: c.adopterId,
                adopterName: c.adopterName,
                matchTypes: c.matchTypes,
            }));
        }

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
