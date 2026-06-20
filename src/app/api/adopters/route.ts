export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adopterFlags, adopterImages, adoptions } from '@/db/schema';
import { eq, like, or, and, isNull, type InferSelectModel } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';
import { tokenizeAdopter } from '@/app/actions/duplicates';
import { processImageForStorage, uploadToR2 } from '@/lib/r2';
import { createAdopterApiSchema } from '@/app/actions/validation';
import { deserializeContactEntries, contactEntriesToBlob } from '@/lib/contactEntries';
import { maskAdopterContact, renderName } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility, maskOptionsFor } from '@/lib/piiAccessServer';

type MaskableRow = {
    id: string;
    addedBy: string | null;
    name: string;
    contactInfo: string | null;
    contactEntries: string | null;
    addressInfo: string | null;
    familyMembers: string | null;
    /** Optional — when present + flag on, the whole row bypasses masking. */
    isPublic?: number | null;
};

/**
 * PII access gating: mask the matched-adopter rows for non-privileged viewers.
 * Contact fields go through `maskAdopterContact` (partial-reveal); the name
 * collapses to initials and family members are hidden — same treatment the
 * search results get.
 */
async function maskMatchesForViewer<T extends MaskableRow>(
    rows: T[],
    viewerEmail: string | null | undefined,
): Promise<T[]> {
    if (rows.length === 0 || !(await isPiiGatingEnabled())) return rows;
    const visMap = await resolveAdoptersVisibility(viewerEmail, rows.map(r => ({ id: r.id, addedBy: r.addedBy })));
    const publicProfilesFlag = await isPublicProfilesEnabled();
    return rows.map(r => {
        const vis = visMap.get(r.id);
        const maskOpts = maskOptionsFor(publicProfilesFlag, r);
        if (!vis || vis.nothingMasked || maskOpts.adopterIsPublic) return r;
        const masked = maskAdopterContact(r, vis, maskOpts);
        return {
            ...r,
            name: renderName(r.name, vis, undefined, maskOpts),
            contactInfo: masked.contactInfo,
            contactEntries: masked.contactEntries,
            addressInfo: masked.addressInfo,
            familyMembers: null,
        };
    });
}

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sourceUrl = searchParams.get('sourceUrl');
    const matchName = searchParams.get('matchName');
    const matchPhones = searchParams.get('matchPhones'); // comma-separated
    const matchAddresses = searchParams.get('matchAddresses'); // comma-separated

    if (!sourceUrl && !matchName && !matchPhones) {
        return NextResponse.json({ error: 'Missing search parameters' }, { status: 400 });
    }

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Mode 1: Exact URL match (same-post duplicate detection)
        if (sourceUrl) {
            const matches = await db.select()
                .from(adopters)
                .where(and(isNull(adopters.deletedAt), eq(adopters.sourceUrl, sourceUrl)));
            return NextResponse.json({
                matches: await maskMatchesForViewer(matches, session.user.email),
                matchType: 'url',
            });
        }

        // Mode 2: Multi-field person matching (different post, same person)
        const phones = matchPhones ? matchPhones.split(',').map(p => p.trim()).filter(Boolean) : [];
        const addresses = matchAddresses ? matchAddresses.split(',').map(a => a.trim()).filter(Boolean) : [];

        // Build OR conditions for fuzzy matching
        const conditions = [];
        if (matchName) {
            conditions.push(like(adopters.name, `%${matchName}%`));
        }
        for (const phone of phones) {
            // Strip non-digits for more flexible matching
            const digitsOnly = phone.replace(/\D/g, '');
            if (digitsOnly.length >= 4) {
                conditions.push(like(adopters.contactInfo, `%${digitsOnly}%`));
            }
        }
        for (const addr of addresses) {
            if (addr.length >= 5) {
                conditions.push(like(adopters.contactInfo, `%${addr}%`));
            }
        }

        if (conditions.length === 0) {
            return NextResponse.json({ matches: [], matchType: 'person', confidence: 'none' });
        }

        const matches = await db.select()
            .from(adopters)
            .where(and(isNull(adopters.deletedAt), or(...conditions)))
            .limit(5);

        if (matches.length === 0) {
            return NextResponse.json({ matches: [], matchType: 'person', confidence: 'none' });
        }

        // Score confidence for each match
        const scoredMatches = await Promise.all(matches.map(async (match: InferSelectModel<typeof adopters>) => {
            let confidence: 'high' | 'medium' | 'low' = 'low';
            const reasons: string[] = [];

            // Check name match
            const nameMatch = matchName && match.name?.toLowerCase().includes(matchName.toLowerCase());
            if (nameMatch) reasons.push('name');

            // Check phone match
            const phoneMatch = phones.some(phone => {
                const digits = phone.replace(/\D/g, '');
                return digits.length >= 4 && match.contactInfo?.includes(digits);
            });
            if (phoneMatch) reasons.push('phone');

            // Check address match
            const addrMatch = addresses.some(addr => {
                return addr.length >= 5 && match.contactInfo?.toLowerCase().includes(addr.toLowerCase());
            });
            if (addrMatch) reasons.push('address');

            // Determine confidence level
            if (phoneMatch && nameMatch) confidence = 'high';
            else if (phoneMatch) confidence = 'high';
            else if (nameMatch && addrMatch) confidence = 'medium';
            else if (nameMatch) confidence = 'medium';
            else if (addrMatch) confidence = 'low';

            // Fetch thumbnail for preview
            let thumbnail: string | null = null;
            try {
                const imgs = await db.select({ url: adopterImages.url })
                    .from(adopterImages)
                    .where(and(
                        eq(adopterImages.adopterId, match.id),
                        eq(adopterImages.isProfilePicture, 1),
                        isNull(adopterImages.adoptionId)
                    ))
                    .limit(1);
                if (imgs.length > 0) thumbnail = imgs[0].url;
            } catch (e) { console.warn('[adopters/route] Thumbnail fetch failed for', match.id, e); }

            return {
                ...match,
                thumbnail,
                confidence,
                matchReasons: reasons
            };
        }));

        // Sort by confidence (high first)
        const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        scoredMatches.sort((a: { confidence: string }, b: { confidence: string }) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

        return NextResponse.json({
            matches: await maskMatchesForViewer(scoredMatches, session.user.email),
            matchType: 'person',
            confidence: scoredMatches[0]?.confidence || 'none'
        });
    } catch (error) {
        logger.error('Adopter duplicate check failed', error, { sourceUrl: sourceUrl || undefined, matchName: matchName || undefined });
        return NextResponse.json({ matches: [], matchType: sourceUrl ? 'url' : 'person', confidence: 'none' });
    }
}

export async function POST(request: Request) {
    const errorId = generateErrorId();

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: {
        name: string;
        contactInfo?: string | { phones?: string[]; emails?: string[]; socialProfiles?: string[]; addresses?: string[] };
        contactEntries?: string;
        notes?: string;
        sourceUrl?: string;
        flags?: string[];
        images?: Array<{ data: string; mimeType: string; originalUrl?: string; thumbnail?: string }>;
        adoption?: {
            animalName?: string;
            species?: string;
            recordType?: 'adoption' | 'adoption_request' | 'returned_pet' | 'follow_up' | 'observation';
            rating?: number;
            date?: string; // YYYY-MM-DD format
        };
    };

    try {
        body = await request.json();
    } catch (parseError) {
        logger.error('Adopter create: failed to parse body', parseError, {
            errorId,
            user: session.user.email
        });
        return NextResponse.json({ error: 'Invalid JSON body', errorId }, { status: 400 });
    }

    // Validate input
    const parsed = createAdopterApiSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({
            error: 'Invalid input',
            details: parsed.error.issues.map(i => i.message),
            errorId,
        }, { status: 400 });
    }

    const { name, contactInfo, contactEntries, notes, sourceUrl, flags, images, adoption, source, isPublic: callerIsPublic } = parsed.data;

    // Log the incoming request (without image data for size)
    logger.info('Adopter create: start', {
        errorId,
        name,
        sourceUrl,
        hasContactInfo: !!contactInfo,
        flagCount: flags?.length || 0,
        imageCount: images?.length || 0,
        user: session.user.email
    });

    try {
        const db = await getDb();
        if (!db) {
            logger.error('Adopter create: DB not available', undefined, { errorId, user: session.user.email });
            throw new Error('Database not available');
        }

        // Format contact info — accept raw string or structured object
        let contactInfoStr = '';
        if (typeof contactInfo === 'string') {
            contactInfoStr = contactInfo;
        } else if (contactInfo) {
            const parts = [];
            if (contactInfo.phones?.length) parts.push(`Teléfonos: ${contactInfo.phones.join(', ')}`);
            if (contactInfo.emails?.length) parts.push(`Correos: ${contactInfo.emails.join(', ')}`);
            if (contactInfo.socialProfiles?.length) parts.push(`Redes sociales: ${contactInfo.socialProfiles.join(', ')}`);
            if (contactInfo.addresses?.length) parts.push(`Dirección: ${contactInfo.addresses.join(', ')}`);
            contactInfoStr = parts.join('\n');
        }

        // Structured contact entries (ImportWizard) — derive the blob from them
        // and persist the JSON so the categorization survives.
        // When source='imported' AND the public-profiles flag is on, stamp
        // isPublic=true on each entry so authenticated viewers see them
        // unmasked even under PII gating (the data came from a public social
        // source). Per-entry granularity here is important: a later
        // contributor who adds a non-public phone to the same profile will
        // NOT have their addition flagged public.
        let contactEntriesJson: string | null = null;
        if (contactEntries) {
            const entries = deserializeContactEntries(contactEntries);
            if (entries.length) {
                // v2.19.11: stampPublic only fires for SOCIAL imports
                // (ImportWizard with a sourceUrl — Facebook, Instagram, etc.),
                // not Google Contacts imports which arrive with sourceUrl=null.
                // Pre-fix, ANY source='imported' adopter had its entries
                // auto-stamped isPublic=true, which then short-circuited the
                // PII visibility resolver for every viewer (piiAccess.ts:684).
                // For someone's private Google address book that's wrong —
                // those contacts aren't on a public channel. The sourceUrl
                // presence is the existing structural signal: social imports
                // carry a public URL, address-book imports don't. The
                // rescuer can still flip individual chips public later
                // via the per-entry isPublic affordance.
                const isSocialImport = source === 'imported' && !!sourceUrl?.trim();
                // v2.19.47: per-record consent. When the ImportWizard sends
                // `isPublic: false` (rescuer flipped the toggle off in the
                // social-import flow), we honour it and skip stamping —
                // record lands fully private. Default (undefined) keeps the
                // historical "social import = public" behaviour so existing
                // callers and the contacts path don't shift.
                const callerConsentedToPublic = callerIsPublic !== false;
                const stampPublic = isSocialImport && callerConsentedToPublic && await isPublicProfilesEnabled();
                const persisted = stampPublic
                    ? entries.map(e => ({ ...e, isPublic: true }))
                    : entries;
                contactEntriesJson = JSON.stringify(persisted);
                contactInfoStr = contactEntriesToBlob(persisted);
            }
        }



        const newId = crypto.randomUUID();

        // Look up the user's country to stamp on the adopter. Two-tier
        // fallback identical to saveAdopter's at adopters.ts:307-332 —
        // user_profiles.country (set on first sign-in), then live
        // CF-IPCountry header. Before v2.19.4 this route only checked
        // user_profiles, so an import / contact-picker create by a user
        // whose profile country was still null (header missing on their
        // first sign-in) silently landed with country=null and got hidden
        // from the discovery search forever after.
        let userCountry: string | null = null;
        try {
            const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
            if (env?.DB) {
                const row = await env.DB.prepare(
                    `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                ).bind(session.user.email).first<{ country: string | null }>();
                userCountry = row?.country || null;
            }
        } catch { /* best-effort */ }
        if (!userCountry) {
            const hdr = request.headers.get('cf-ipcountry');
            if (hdr) userCountry = hdr;
        }

        // v2.19.58: stamp record-level `isPublic` when the record carries a
        // sourceUrl. Whether the record came through the ImportWizard
        // (`source='imported'`) or the manual new-adopter form
        // (`source='manual'` + pasted URL), the provenance is the same: the
        // data is on the open internet. DB survey at version-bump time showed
        // 9/10 staging + 35/35 prod existing public-URL rows were tagged
        // manual, so gating on source='imported' here would miss the
        // overwhelming majority of the cases the user actually wants caught.
        //
        // Google-Contacts imports arrive with source='imported' AND
        // sourceUrl=null, so the sourceUrl-only check correctly excludes them
        // (private address-book data is NOT public).
        //
        // NOT gated on ENABLE_PUBLIC_PROFILES — the data-flag should reflect
        // reality whether or not the global bypass flag is on. Functional
        // unmasking still requires both record-level isPublic AND the global
        // flag (see buildMaskOptions in piiAccessServer.ts), so this is a
        // passive data-correctness change today; turning the global flag on
        // later activates the bypass without a second backfill.
        //
        // Caller can opt out via `isPublic: false` (the ImportWizard's
        // "este perfil será visible para todos" toggle, v2.19.47).
        const recordHasPublicSource = !!sourceUrl?.trim();
        const recordCallerConsentedToPublic = callerIsPublic !== false;
        const stampRecordPublic = recordHasPublicSource && recordCallerConsentedToPublic;

        // Insert adopter record
        // notes deprecated v2.12.1-28 — handled below as a dedicated observation record.
        await db.insert(adopters).values({
            id: newId,
            name,
            contactInfo: contactInfoStr || null,
            contactEntries: contactEntriesJson,
            familyMembers: null,
            status: '5', // Default neutral/good
            addedBy: session.user.email || 'anonymous',
            sourceUrl: sourceUrl || null,
            country: userCountry,
            isPublic: stampRecordPublic ? 1 : 0,
            // Provenance: 'imported' when the caller (ImportWizard) tells us
            // so; everything else falls through to the column default 'manual'.
            // Surfaces the 'Imported' badge on /my-adopters and gates the
            // per-entry isPublic stamp above.
            ...(source === 'imported' ? { source: 'imported' as const } : {}),
            // createdAt and updatedAt use database defaults
        });

        // Add flags if any (don't pass createdAt, let DB default handle it)
        if (flags && Array.isArray(flags) && flags.length > 0) {
            for (const flagReason of flags) {
                await db.insert(adopterFlags).values({
                    id: crypto.randomUUID(),
                    adopterId: newId,
                    flaggedBy: 'system',
                    reason: flagReason
                    // createdAt uses database default
                });
            }
        }

        // Save media (images + videos) if any
        let savedImageCount = 0;
        if (images && Array.isArray(images) && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                const isVideo = img.mimeType?.startsWith('video/');

                // Use original URL if available (from Playwright scraper), otherwise create data URL (from uploads)
                const mediaUrl = img.originalUrl || (img.data ? `data:${img.mimeType};base64,${img.data}` : null);

                // Skip items with no usable URL
                if (!mediaUrl) {
                    logger.warn('Adopter create: skipping media item with no URL or data', {
                        errorId, index: i, mimeType: img.mimeType, user: session.user.email
                    });
                    continue;
                }

                // Skip if data URL is too large (>500KB base64 = ~375KB actual) - these shouldn't be stored
                if (mediaUrl.startsWith('data:') && mediaUrl.length > 500000) {
                    logger.warn('Adopter create: skipping oversized image', {
                        errorId,
                        index: i,
                        size: mediaUrl.length,
                        user: session.user.email
                    });
                    continue;
                }

                const imageId = crypto.randomUUID();

                // Persist external URLs (social media CDN etc.) to R2
                const persistedUrl = await processImageForStorage(mediaUrl, newId, imageId);

                // Upload thumbnail if provided
                let thumbnailUrl: string | null = null;
                if (img.thumbnail && img.thumbnail.startsWith('data:')) {
                    try {
                        const thumbResponse = await fetch(img.thumbnail);
                        const thumbBlob = await thumbResponse.blob();
                        const thumbArrayBuffer = await thumbBlob.arrayBuffer();
                        const thumbKey = `adopters/${newId}/${imageId}_thumb.jpg`;
                        thumbnailUrl = await uploadToR2(thumbKey, thumbArrayBuffer, thumbBlob.type || 'image/jpeg');
                    } catch (e) {
                        // Thumbnail upload failed, continue without
                    }
                }

                await db.insert(adopterImages).values({
                    id: imageId,
                    adopterId: newId,
                    url: persistedUrl,
                    caption: isVideo ? `Imported video (${i + 1})` : `Imported image (${i + 1})`,
                    addedBy: session.user.email || 'anonymous',
                    isProfilePicture: (!isVideo && savedImageCount === 0) ? 1 : 0, // First image (not video) as profile picture
                    mediaType: isVideo ? 'video' : 'image',
                    thumbnailUrl,
                    // uploadedAt uses database default
                });
                savedImageCount++;
            }
        }

        // Create interaction record if adoption data provided
        let adoptionId: string | null = null;
        if (adoption) {
            // Pack notes (only if this adoption IS the observation) and contact info into
            // details for searchability. If recordType !== 'observation', notes is handled
            // separately below as its own observation record.
            const detailsParts: string[] = [];
            const adoptionRecordType = adoption.recordType || 'adoption';
            if (notes && adoptionRecordType === 'observation') detailsParts.push(notes);
            if (contactInfoStr) detailsParts.push(`Contact: ${contactInfoStr}`);

            adoptionId = crypto.randomUUID();
            await db.insert(adoptions).values({
                id: adoptionId,
                adopterId: newId,
                // v2.19.52: was `|| 'Unknown'` — coerced empty/missing names
                // to a literal English string regardless of the user's
                // locale. Now passes through as NULL so downstream renderers
                // and queries can distinguish "no name" from a real animal.
                animalName: adoption.animalName?.trim() || null,
                species: adoption.species || 'other',
                status: 'completed',
                rating: adoption.rating || 2,
                addedBy: session.user.email || 'anonymous',
                recordType: adoptionRecordType,
                date: adoption.date ? new Date(adoption.date) : new Date(),
                sourceUrl: sourceUrl || null,
                details: detailsParts.length > 0 ? detailsParts.join('\n') : null
            });

            // Link all imported media to this adoption record
            if (savedImageCount > 0) {
                await db.update(adopterImages)
                    .set({ adoptionId })
                    .where(eq(adopterImages.adopterId, newId));
            }

            logger.info('Adopter create: adoption record created', {
                errorId,
                adopterId: newId,
                adoptionId,
                mediaLinked: savedImageCount,
                user: session.user.email
            });
        }

        // Auto-create observation record when notes provided but the main adoption
        // (if any) was not itself an observation. Replaces the deprecated adopter.notes
        // write. v2.12.1-28.
        if (notes && (!adoption || (adoption.recordType || 'adoption') !== 'observation')) {
            await db.insert(adoptions).values({
                id: crypto.randomUUID(),
                adopterId: newId,
                details: notes,
                status: null,
                addedBy: session.user.email || 'anonymous',
                recordType: 'observation',
                date: new Date(),
                sourceUrl: sourceUrl || null,
            });
        }

        logger.info('Adopter create: complete', {
            errorId,
            adopterId: newId,
            flagCount: flags?.length || 0,
            imageCount: savedImageCount,
            hasAdoption: !!adoption,
            user: session.user.email
        });

        // Generate duplicate-detection tokens BEFORE returning. Fire-and-forget
        // gets killed on the Cloudflare Workers edge runtime when the response
        // returns (the same reason audit + logger use ctx.waitUntil), which
        // left newly-created adopters un-tokenized. That broke the wizard's
        // pre-save duplicate check: a user could create two identical contacts
        // in a row and the second creation's findAdopters lookup found nothing
        // because the first one's tokens were never written. Mirrors the
        // `await tokenizeAdopter` pattern already used in actions/adopters.ts
        // (lines 286, 337) and documented as the canonical race-safe
        // approach in actions/_adopterFactory.ts:20-24 (~200-500ms cost is
        // acceptable on submit). Tokenize is idempotent and try/catches
        // internally — await is safe.
        await tokenizeAdopter(newId);

        return NextResponse.json({ success: true, id: newId });

    } catch (error) {
        const loggedErrorId = logger.error('Adopter create: failed', error, {
            originalErrorId: errorId,
            name,
            sourceUrl,
            user: session.user.email
        });

        return NextResponse.json({
            error: 'Failed to create adopter',
            errorId: loggedErrorId
        }, { status: 500 });
    }
}
