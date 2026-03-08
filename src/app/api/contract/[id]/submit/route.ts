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
        // This NEVER blocks the response — adopter gets success regardless
        try {
            const rescuerEmail = animal.addedBy;
            if (rescuerEmail && rescuerEmail !== 'anonymous' && rescuerEmail !== 'contract') {
                const { extractNameWords, extractPhones, extractPhoneSuffixes, extractEmails, extractSocials, normalizeText } = await import('@/lib/tokenizer');
                const { duplicateTokens } = await import('@/db/schema');
                const { and: drizzleAnd, ne, inArray: drizzleInArray, or: drizzleOr } = await import('drizzle-orm');
                const { createNotification } = await import('@/app/actions/notifications');

                // Tokenize submitted data
                const tokens: Array<{ type: string; value: string }> = [];
                const nameWords = extractNameWords(fullName);
                nameWords.forEach(w => tokens.push({ type: 'name_word', value: w }));
                if (fullName.trim()) tokens.push({ type: 'name_full', value: normalizeText(fullName) });

                if (phone) {
                    const phones = extractPhones(phone);
                    phones.forEach(p => tokens.push({ type: 'phone', value: p }));
                    extractPhoneSuffixes(phones).forEach(s => tokens.push({ type: 'phone_suffix', value: s }));
                }
                if (email) {
                    extractEmails(email).forEach(e => tokens.push({ type: 'email', value: e }));
                }
                if (socialNetworks) {
                    extractSocials(socialNetworks).forEach(s => tokens.push({ type: 'social', value: s }));
                }
                if (dni) {
                    tokens.push({ type: 'phone', value: dni.replace(/\D/g, '') }); // DNI as digit sequence
                }

                if (tokens.length > 0) {
                    const tokenValues = tokens.map(t => t.value).filter(v => v.length >= 3);

                    // Accumulate matching adopter IDs from multiple search strategies
                    const adopterMatches = new Map<string, Set<string>>();

                    // Strategy 1: Token-based matching (pre-indexed)
                    if (tokenValues.length > 0) {
                        const tokenMatches = await db
                            .select({
                                adopterId: duplicateTokens.adopterId,
                                tokenType: duplicateTokens.tokenType,
                                tokenValue: duplicateTokens.tokenValue,
                            })
                            .from(duplicateTokens)
                            .where(
                                drizzleAnd(
                                    drizzleInArray(duplicateTokens.tokenValue, tokenValues),
                                    ne(duplicateTokens.adopterId, adopterId)
                                )!
                            )
                            .all();

                        for (const m of tokenMatches) {
                            if (!adopterMatches.has(m.adopterId)) adopterMatches.set(m.adopterId, new Set());
                            adopterMatches.get(m.adopterId)!.add(`token:${m.tokenType}`);
                        }
                    }

                    // Strategy 2: Direct LIKE search on adopters table (catches untokenized profiles)
                    const { like } = await import('drizzle-orm');
                    const likeQueries: Array<{ field: string; value: string }> = [];

                    // Search by each name word
                    const nameWords = extractNameWords(fullName);
                    for (const word of nameWords) {
                        if (word.length >= 3) likeQueries.push({ field: 'name', value: `%${word}%` });
                    }
                    // Search by phone digits
                    if (phone) {
                        const digits = phone.replace(/\D/g, '');
                        if (digits.length >= 6) likeQueries.push({ field: 'contact', value: `%${digits.slice(-8)}%` });
                    }
                    // Search by email
                    if (email && email.includes('@')) {
                        likeQueries.push({ field: 'contact', value: `%${email.toLowerCase()}%` });
                    }
                    // Search by DNI
                    if (dni) {
                        const dniClean = dni.replace(/\D/g, '');
                        if (dniClean.length >= 5) likeQueries.push({ field: 'contact', value: `%${dniClean}%` });
                    }
                    // Search by social networks
                    if (socialNetworks) {
                        const socials = extractSocials(socialNetworks);
                        for (const s of socials) {
                            if (s.length >= 4) likeQueries.push({ field: 'contact', value: `%${s}%` });
                        }
                    }

                    // Run LIKE queries in parallel
                    const likeResults = await Promise.all(
                        likeQueries.map(async (q) => {
                            const col = q.field === 'name' ? adopters.name : adopters.contactInfo;
                            const results = await db
                                .select({ id: adopters.id })
                                .from(adopters)
                                .where(drizzleAnd(like(col, q.value), ne(adopters.id, adopterId))!)
                                .all();
                            return { field: q.field, value: q.value, ids: results.map((r: { id: string }) => r.id) };
                        })
                    );

                    for (const lr of likeResults) {
                        for (const id of lr.ids) {
                            if (!adopterMatches.has(id)) adopterMatches.set(id, new Set());
                            adopterMatches.get(id)!.add(`like:${lr.field}`);
                        }
                    }

                    const matchCount = adopterMatches.size;
                    const animalName = animal.animalName || 'Animal';
                    const notificationId = crypto.randomUUID();

                    if (matchCount > 0) {
                        // Fetch matched adopter names for the notification
                        const matchedIds = Array.from(adopterMatches.keys()).slice(0, 5);
                        const matchedAdopters = await db
                            .select({ id: adopters.id, name: adopters.name })
                            .from(adopters)
                            .where(drizzleOr(...matchedIds.map(id => eq(adopters.id, id)))!)
                            .all();

                        await createNotification({
                            id: notificationId,
                            userId: rescuerEmail,
                            type: 'contract_result',
                            title: `⚠️ ${matchCount} coincidencia${matchCount > 1 ? 's' : ''} para ${fullName}`,
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
                                matchedAdopters: matchedAdopters.map((a: { id: string; name: string }) => ({
                                    id: a.id,
                                    name: a.name,
                                    matchTypes: Array.from(adopterMatches.get(a.id) || []),
                                })),
                                submittedData: { name: fullName, phone, email, dni, address, socialNetworks },
                            },
                        });
                    } else {
                        await createNotification({
                            id: notificationId,
                            userId: rescuerEmail,
                            type: 'contract_result',
                            title: `✅ ${animalName} adoptado por ${fullName}`,
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

                    logger.info('Contract fuzzy search completed', { animalId, adopterId, matchCount, tokenCount: tokenValues.length });
                }
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
