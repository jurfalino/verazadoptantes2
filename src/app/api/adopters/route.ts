export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adopterFlags, adopterImages, adopterEvents, placements, animals } from '@/db/schema';
import { postKey, samePost } from '@/domain/postKey';
import { eq, like, or, and, isNull, sql, desc, type InferSelectModel } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { processImageForStorage, uploadToR2 } from '@/lib/r2';
import { createAdopterApiSchema } from '@/app/actions/validation';
import { deserializeContactEntries, contactEntriesToBlob } from '@/lib/contactEntries';
import { deserializeHouseholdMembers, withoutProfileLinks } from '@/lib/householdMembers';
import { maskAdopterRow } from '@/lib/piiAccess';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility, maskOptionsFor } from '@/lib/piiAccessServer';

type MaskableRow = {
    id: string;
    addedBy: string | null;
    name: string;
    contactInfo: string | null;
    contactEntries: string | null;
    addressInfo: string | null;
    familyMembers: string | null;
    householdMembers?: string | null;
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
    // Households as profiles (Task 8): the old household JSON never leaves the server.
    const withoutHousehold = (r: T): T => ({ ...r, householdMembers: null });
    if (rows.length === 0 || !(await isPiiGatingEnabled())) return rows.map(withoutHousehold);
    const visMap = await resolveAdoptersVisibility(viewerEmail, rows.map(r => ({ id: r.id, addedBy: r.addedBy })));
    const publicProfilesFlag = await isPublicProfilesEnabled();
    return rows.map(r => {
        const vis = visMap.get(r.id);
        const maskOpts = maskOptionsFor(publicProfilesFlag, r);
        if (!vis || vis.nothingMasked || maskOpts.adopterIsPublic) return withoutHousehold(r);
        return withoutHousehold(maskAdopterRow(r, vis, maskOpts));
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

        // Mode 1: same-post detection. Matched by the POST the link names, not the
        // link's exact text (www/m., tracking parameters, permalink vs /posts/ —
        // audit 2026-10-21, D1), and against activity records too: a post merged
        // into an existing profile is stored on the activity only (D2). Every
        // profile that post was saved to is returned, not just the first.
        //
        // Several `sourceUrl` values may be sent (the link as shared and the one
        // Facebook resolved it to); a profile matching any of them counts.
        //
        // instr(), not LIKE: D1 rejects LIKE patterns over ~50 bytes ("pattern too
        // complex"), and Facebook pfbid ids are 60–70 chars — the check threw, the
        // catch below answered "no matches", and a re-paste created a duplicate
        // (review of 2.56.213, item 1). instr has no length cap and no wildcards.
        //
        // Only id, name and whether the viewer may edit the profile go back: the
        // full row carried notes and the other rescuer's email (review item 10).
        if (sourceUrl) {
            const links = [...new Set(searchParams.getAll('sourceUrl').map(u => u.trim()).filter(Boolean))].slice(0, 3);
            const keys = links.map(postKey).filter((k): k is NonNullable<typeof k> => !!k);
            if (!keys.length) return NextResponse.json({ matches: [], matchType: 'url' });
            const matchesAny = (stored: string | null) => !!stored && links.some(l => samePost(stored, l));
            type AdopterRow = InferSelectModel<typeof adopters>;
            const needles = [...new Set(keys.map(k => k.needle))];
            const perNeedle = await Promise.all(needles.map(needle => Promise.all([
                // A generic needle can hit many rows; newest first and a roomy cap so
                // the right one is not cut before samePost() decides.
                db.select().from(adopters)
                    // lower() on both sides: instr is case-sensitive, stored hosts and
                    // vanity names are not (final review of 2.56.215, item 2).
                    .where(and(isNull(adopters.deletedAt), sql`instr(lower(${adopters.sourceUrl}), lower(${needle})) > 0`))
                    .orderBy(desc(adopters.createdAt))
                    .limit(200) as Promise<AdopterRow[]>,
                // The tables behind the `adoptions` view, not the view: it has no
                // created_at to order by, and it hides links on ended placements.
                db.select({ adopterId: adopterEvents.adopterId, sourceUrl: adopterEvents.sourceUrl }).from(adopterEvents)
                    .where(sql`instr(lower(${adopterEvents.sourceUrl}), lower(${needle})) > 0`)
                    .orderBy(desc(adopterEvents.createdAt))
                    .limit(200) as Promise<Array<{ adopterId: string | null; sourceUrl: string | null }>>,
                db.select({ adopterId: placements.adopterId, sourceUrl: placements.sourceUrl }).from(placements)
                    .where(sql`instr(lower(${placements.sourceUrl}), lower(${needle})) > 0`)
                    .orderBy(desc(placements.createdAt))
                    .limit(200) as Promise<Array<{ adopterId: string | null; sourceUrl: string | null }>>,
                // The view fell back to the animal's own link (COALESCE) when the
                // placement had none; keep that (review of 2.56.216, item 5).
                db.select({ adopterId: placements.adopterId, sourceUrl: animals.sourceUrl }).from(placements)
                    .innerJoin(animals, eq(placements.animalId, animals.id))
                    .where(and(isNull(animals.deletedAt), sql`instr(lower(${animals.sourceUrl}), lower(${needle})) > 0`))
                    .orderBy(desc(placements.createdAt))
                    .limit(200) as Promise<Array<{ adopterId: string | null; sourceUrl: string | null }>>,
            ])));
            const byId = new Map<string, AdopterRow>();
            for (const [direct] of perNeedle) for (const r of direct) if (matchesAny(r.sourceUrl)) byId.set(r.id, r);
            const recordAdopterIds = [...new Set(perNeedle.flatMap(([, events, placed, viaAnimal]) => [...events, ...placed, ...viaAnimal])
                .filter(r => matchesAny(r.sourceUrl))
                .map(r => r.adopterId)
                .filter((id): id is string => !!id && !byId.has(id)))];
            // One query per id: D1 does not expand arrays in IN (CLAUDE.md).
            const viaRecordRows: Array<AdopterRow | undefined> = await Promise.all(recordAdopterIds.map(id =>
                db.select().from(adopters).where(and(eq(adopters.id, id), isNull(adopters.deletedAt))).get()
                    .catch((e: unknown) => {
                        logger.warn('Adopter duplicate check: record-adopter lookup failed', { adopterId: id, error: e instanceof Error ? e.message : String(e) });
                        return undefined;
                    })));
            for (const r of viaRecordRows) if (r) byId.set(r.id, r);

            // canEdit drives the wizard's "add as a relative" (household writes are
            // owner / admin / org-mate only — review item 5).
            const viewer = session.user.email ?? '';
            const { isAdminAsync } = await import('@/config/admins');
            const { isOrgMate } = await import('@/lib/orgMembership');
            const viewerIsAdmin = await isAdminAsync(viewer);
            const matches = await Promise.all([...byId.values()].map(async r => ({
                id: r.id,
                name: r.name,
                canEdit: viewerIsAdmin || r.addedBy === viewer || await isOrgMate(viewer, r.addedBy).catch((e: unknown) => {
                    logger.warn('Adopter duplicate check: org lookup failed', { adopterId: r.id, error: e instanceof Error ? e.message : String(e) });
                    return false;
                }),
            })));
            return NextResponse.json({ matches, matchType: 'url' });
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
                    // v2.26.1: the flagged profile picture wherever it lives — an
                    // activity/observation photo can be the avatar. (Dropped the
                    // adoptionId IS NULL filter that hid such a pick.)
                    .where(and(
                        eq(adopterImages.adopterId, match.id),
                        eq(adopterImages.isProfilePicture, 1)
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
        // No names or links in the log (privacy); the mode is enough to triage.
        const errorId = logger.error('Adopter duplicate check failed', error, { mode: sourceUrl ? 'url' : 'person', user: session.user.email });
        // The same-post check must fail LOUDLY: an empty 200 read as "not imported
        // yet" and let a re-paste create a duplicate. The wizard shows its
        // "couldn't verify" warning on a non-OK answer.
        if (sourceUrl) return NextResponse.json({ error: 'Duplicate check failed', errorId }, { status: 500 });
        return NextResponse.json({ matches: [], matchType: 'person', confidence: 'none' });
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
        const issues = parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
        // v2.19.66: a 400 validation reject previously logged NOTHING (only 500s
        // hit logger), so a payload the schema rejects was invisible in Axiom —
        // the user saw a bare "Invalid input" toast with no way to know which
        // field failed. Log it as `warn` (degraded, not broken) with the field
        // paths + privacy-safe size hints so we can pinpoint the offending field
        // (empty/over-long name, oversized image base64, malformed sourceUrl)
        // without dumping PII. errorId is shared with the response below so a
        // user-reported id correlates to this entry.
        const b = body as Record<string, unknown>;
        const imgs = Array.isArray(b?.images) ? (b.images as Array<Record<string, unknown>>) : [];
        logger.warn('Adopter create: validation rejected', {
            errorId,
            issues,
            nameLen: typeof b?.name === 'string' ? (b.name as string).length : null,
            imageCount: imgs.length,
            maxImageDataLen: imgs.length
                ? Math.max(0, ...imgs.map(im => (typeof im?.data === 'string' ? (im.data as string).length : 0)))
                : 0,
            sourceUrl: typeof b?.sourceUrl === 'string' ? b.sourceUrl : undefined,
            user: session.user.email,
        });
        return NextResponse.json({
            error: 'Invalid input',
            // Field-level so the caller (e.g. the import wizard) can show WHICH
            // field failed, not a bare "Invalid input".
            details: issues.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)),
            errorId,
        }, { status: 400 });
    }

    const { name, contactInfo, contactEntries, notes, sourceUrl, flags, images, adoption, source, isPublic: callerIsPublic, householdMembers: householdJson } = parsed.data;
    // Relatives named in the same post (Jon, 2026-10-22): sanitized, their
    // contacts credited to the contributor. They become profiles + memberships
    // after the profile is saved (households as profiles: attachHouseholdPeople,
    // the exact match) — never adopters.household_members, never a planted profileId.
    const relatives = withoutProfileLinks(deserializeHouseholdMembers(householdJson ?? null))
        .map(m => ({
            name: m.name,
            relationship: m.relationship,
            age: m.age ?? null,
            contactEntries: m.contactEntries.map(({ own: _own, ...e }) => ({ ...e, id: crypto.randomUUID(), addedBy: session.user?.email || undefined })),
        }));

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
            const { env } = (await import('@/lib/requestContext')).getRequestContext();
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
        const stampRecordPublic = (recordHasPublicSource || callerIsPublic === true) && recordCallerConsentedToPublic;

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
            // Pack notes (only if this adoption IS the observation) into details. If
            // recordType !== 'observation', notes is handled separately below as its
            // own observation record. Contacts are NOT copied in any more: they live
            // in the profile's contact entries (tokenized, so still searchable), where
            // protected/public applies per entry — a plain-text copy in the note
            // bypassed that (audit 2026-10-21, D8; same change as add-record).
            const detailsParts: string[] = [];
            const adoptionRecordType = adoption.recordType || 'adoption';
            // v2.24.6: an explicit per-record `details` (spreadsheet import) is
            // part of the record itself, regardless of type.
            if (adoption.details?.trim()) detailsParts.push(adoption.details.trim());
            if (notes && adoptionRecordType === 'observation') detailsParts.push(notes);

            const { insertRecord } = await import('@/app/actions/_recordWrite');
            adoptionId = await insertRecord(db, {
                adopterId: newId,
                // v2.19.52: was `|| 'Unknown'` — coerced empty/missing names
                // to a literal English string regardless of the user's
                // locale. Now passes through as NULL so downstream renderers
                // and queries can distinguish "no name" from a real animal.
                animalName: adoption.animalName?.trim() || null,
                species: adoption.species || 'other',
                status: 'completed',
                rating: adoption.rating || null,
                recordType: adoptionRecordType,
                // NULL (not now()) when the row has no date: fabricating import-time
                // as the event date is misleading for a historical entry, AND it
                // symmetrises with the upsert path (which stores null) so a dateless
                // row's activity dedups on re-import instead of duplicating.
                date: adoption.date ? new Date(adoption.date) : null,
                sourceUrl: sourceUrl || null,
                details: detailsParts.length > 0 ? detailsParts.join('\n') : null,
                // v2.24.6: animal/record fields forwarded from the importer.
                sex: adoption.sex || null,
                neutered: adoption.neutered ?? null,
                color: adoption.color || null,
                microchip: adoption.microchip || null,
                age: adoption.age || null,
                onBehalfOf: adoption.onBehalfOf || null,
            }, session.user.email || 'anonymous');

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
            const { insertRecord } = await import('@/app/actions/_recordWrite');
            await insertRecord(db, {
                adopterId: newId,
                details: notes,
                status: null,
                recordType: 'observation',
                date: new Date(),
                sourceUrl: sourceUrl || null,
            }, session.user.email || 'anonymous');
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

        // The post's relatives as profiles in this person's household (exact match, else new).
        // After the profile's own tokens, so its own scan never sees them. A failure keeps the profile.
        if (relatives.length && session.user.email) {
            try {
                // Same visibility as before, when they were JSON of this record: the record's
                // «público» covered them (maskHouseholdMembers), their entries were never stamped.
                const { attachHouseholdPeople } = await import('@/lib/householdPeople');
                await attachHouseholdPeople(db, {
                    anchorAdopterId: newId, people: relatives, actor: session.user.email, ownerEmail: session.user.email,
                    sourceKey: `import:${newId}`, requestId: errorId, isPublic: stampRecordPublic,
                });
            } catch (e) {
                logger.error('Adopter create: relatives not attached (the profile is saved)', e, { errorId, adopterId: newId, user: session.user.email });
            }
        }

        // v2.19.73: audit creates from this API/import path. Previously only the
        // saveAdopter server action logged adopter_created/adoption_created, so
        // adopters created via the import wizard had NO audit trail — a per-user
        // audit filter came up empty even though /admin/users showed the activity.
        logAudit({ userEmail: session.user.email || undefined, action: 'adopter_created', target: newId, details: { name, source: source || 'manual', viaApi: true } });
        if (adoptionId) {
            logAudit({ userEmail: session.user.email || undefined, action: 'adoption_created', target: adoptionId, details: { adopterId: newId, viaApi: true } });
        }

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
