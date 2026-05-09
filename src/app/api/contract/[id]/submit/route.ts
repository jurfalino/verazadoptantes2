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

        const { adopters, adoptions, adopterHistory } = await import('@/db/schema');
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

        // 3. Build contact info from form data
        const contactParts: string[] = [];
        if (dni) contactParts.push(`DNI: ${dni}`);
        if (email) contactParts.push(`Email: ${email}`);
        if (phone) contactParts.push(`Tel: ${phone}`);
        if (address) contactParts.push(`Dirección: ${address}`);
        if (socialNetworks) contactParts.push(`Redes: ${socialNetworks}`);
        const contactInfo = contactParts.join('\n');

        const fullName = `${name} ${lastName}`.trim();

        // 4. Create the adopter
        const adopterId = crypto.randomUUID();
        await db.insert(adopters).values({
            id: adopterId,
            name: fullName,
            contactInfo,
            status: 'active',
            addedBy: animal.addedBy || 'contract',
            country: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // 5. Link the animal to the adopter (convert to adoption)
        await db.update(adoptions).set({
            adopterId,
            recordType: 'adoption',
            date: new Date(),
            status: 'active',
            rating: 5,
            comments: JSON.stringify({ contractScreenshot: contractUrl }),
        }).where(eq(adoptions.id, animalId));

        // 6. Log history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: 'contract-submission',
            changes: JSON.stringify({
                adoption_via_contract: {
                    animalId,
                    animalName: animal.animalName,
                    species: animal.species,
                    dni,
                    email,
                    phone,
                }
            }),
            changedAt: new Date(),
        });

        logger.info('Contract adoption submitted', { animalId, adopterId, adopterName: fullName, contractUrl });

        // 7a. Tokenize the new adopter for future duplicate detection (fire-and-forget)
        import('@/app/actions/duplicates').then(({ tokenizeAdopter }) => {
            tokenizeAdopter(adopterId).catch(e => { logger.warn('Tokenize adopter failed (fire-and-forget)', { adopterId, error: e instanceof Error ? e.message : String(e) }); });
        });

        // 7b. Fire-and-forget: fuzzy search + notification for the rescuer
        // This NEVER blocks the response — adopter gets success regardless.
        // Backed by findAdopters({ mode: 'duplicate' }) — single source of truth shared with
        // ImportWizard / AdopterFlagging / form submit. minRelevance:0 preserves recall (vetting wants
        // to surface even weak matches; missing a duplicate is worse than a false positive).
        try {
            const rescuerEmail = animal.addedBy;
            if (rescuerEmail && rescuerEmail !== 'anonymous' && rescuerEmail !== 'contract') {
                const { findAdopters } = await import('@/app/actions/findAdopters');
                const { extractPhones, extractEmails, extractSocials } = await import('@/lib/tokenizer');
                const { createNotification } = await import('@/app/actions/notifications');

                // Build duplicate-mode inputs.
                // DNI is appended to phones because the bespoke matcher historically treated DNI as a
                // phone-token; preserving that semantic keeps DNI-only matches working.
                const phonesIn = phone ? extractPhones(phone) : [];
                const dniDigits = dni ? dni.replace(/\D/g, '') : '';
                if (dniDigits.length >= 5) phonesIn.push(dniDigits);

                const dupResult = await findAdopters(
                    {
                        name: fullName,
                        phones: phonesIn,
                        emails: email ? extractEmails(email) : [],
                        socials: socialNetworks ? extractSocials(socialNetworks) : [],
                        excludeAdopterId: adopterId,
                    },
                    { mode: 'duplicate', minRelevance: 0, limit: 5 },
                );
                const matches = dupResult.results as Array<{ adopterId: string; adopterName: string; matchTypes: string[] }>;
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
