'use server';

/**
 * Shared adopter-creation path for non-manual flows (form submit + legacy
 * contract submit). Lives outside the action barrel (underscore-prefixed)
 * because it's an internal helper, not an exported user-facing server action.
 *
 * Why this exists:
 *   • Two endpoints (`/api/form/[userId]/submit` and
 *     `/api/contract/[id]/submit` legacy path) need to create adopters from
 *     anonymous submissions. Before this helper, only contract-submit did,
 *     and form submissions sat in `form_submissions` purgatory until a
 *     rescuer manually clicked "Create Profile". Auto-create eliminates that.
 *   • Both routes also need to populate `duplicate_candidates` so the new
 *     `/my-adopters` pending-dedup section has something to render. The only
 *     other writer of that table is the admin reconciliation route
 *     (`src/app/api/admin/duplicates/route.ts:285`) which does a full sweep;
 *     here we INSERT just the pairs that involve the freshly-created row.
 *
 * Race-condition note (S1 in the design plan): we `await` tokenizeAdopter
 * before running findAdopters so concurrent submissions for the same person
 * can detect each other via the freshly-written tokens. ~200-500ms cost is
 * acceptable on submit; the alternative (fire-and-forget tokenize, sniff
 * with LIKE-only) misses name-only duplicates.
 *
 * Edge runtime: all callers are edge routes, so this module uses dynamic
 * imports for everything it touches (mirrors the pattern already used by
 * the two submit routes).
 */

import { logger } from '@/lib/logger';

export type AdopterSource = 'manual' | 'form' | 'contract' | 'imported';

export interface CreateAdopterInput {
    /** Always 'form' or 'contract' here; 'manual'/'imported' use their own paths. */
    source: Extract<AdopterSource, 'form' | 'contract'>;
    name: string;
    /** Rescuer email — owns the row. Falls back to 'anonymous' only if no rescuer is known. */
    addedBy: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    /** Free-form social handles or extra contact lines, joined into contactInfo. */
    socials?: string | null;
    /** Document ID (DNI/Documento) — joined into contactInfo for the contract path. */
    documentId?: string | null;
    /** Optional history context: form submission id (for `source: 'form'`). */
    submissionId?: string | null;
    /** Optional history context: animal the submission targeted. */
    animalId?: string | null;
    animalName?: string | null;
    animalSpecies?: string | null;
}

export interface DupCandidateSummary {
    adopterId: string;
    adopterName: string;
    matchTypes: string[];
    relevancePercent: number;
}

export interface CreateAdopterResult {
    adopterId: string;
    /** Surfaced for the caller's notification metadata. */
    dupCandidates: DupCandidateSummary[];
}

function bucketConfidence(relevancePercent: number): 'high' | 'medium' | 'low' {
    if (relevancePercent >= 70) return 'high';
    if (relevancePercent >= 40) return 'medium';
    return 'low';
}

/**
 * Create an adopter row from an anonymous submission, log history, tokenize,
 * and persist any pending duplicate candidates. Returns the new adopterId and
 * a summary of matches for the caller to include in its notification payload.
 */
export async function createAdopterFromSubmission(
    input: CreateAdopterInput,
): Promise<CreateAdopterResult> {
    const trimmedName = input.name.trim();
    if (!trimmedName) throw new Error('createAdopterFromSubmission: name is required');

    const { getDb } = await import('@/lib/db');
    const db = await getDb();
    if (!db) throw new Error('createAdopterFromSubmission: database unavailable');

    const { adopters, adopterHistory, duplicateCandidates } = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const adopterId = crypto.randomUUID();
    // Dynamic import to match this module's edge-route import convention.
    // `address` is intentionally excluded — it goes to addressInfo, not contactEntries.
    const { buildContactEntries, contactEntriesToBlob } = await import('@/lib/contactEntries');
    const contactEntries = buildContactEntries({
        ids: input.documentId ? [{ value: input.documentId, label: 'Documento' }] : [],
        emails: input.email ? [input.email] : [],
        phones: input.phone ? [input.phone] : [],
        socials: input.socials ? [input.socials] : [],
        addresses: input.address ? [input.address] : [],
    });
    const contactInfo = contactEntriesToBlob(contactEntries);
    const now = new Date();

    // 1. Insert adopter
    await db.insert(adopters).values({
        id: adopterId,
        name: trimmedName,
        contactInfo: contactInfo || null,
        contactEntries: contactEntries.length ? JSON.stringify(contactEntries) : null,
        addressInfo: input.address || null,
        addedBy: input.addedBy || 'anonymous',
        source: input.source,
        status: '5',
        createdAt: now,
        updatedAt: now,
    });

    // 2. Log history. Shape distinct per source so the timeline reads sensibly.
    const changes = input.source === 'form'
        ? {
            auto_created_from_form: {
                submissionId: input.submissionId || null,
                name: trimmedName,
                animalId: input.animalId || null,
                animalName: input.animalName || null,
            },
        }
        : {
            adoption_via_contract: {
                animalId: input.animalId || null,
                animalName: input.animalName || null,
                species: input.animalSpecies || null,
                dni: input.documentId || null,
                email: input.email || null,
                phone: input.phone || null,
            },
        };

    await db.insert(adopterHistory).values({
        id: crypto.randomUUID(),
        adopterId,
        changedBy: input.source === 'form' ? 'form-submission' : 'contract-submission',
        changes: JSON.stringify(changes),
        changedAt: now,
    });

    // 3. Tokenize SYNCHRONOUSLY so the immediately-following findAdopters
    // call (and any concurrent submission for the same person) can match
    // this row through the token index. ~200-500ms — acceptable on submit.
    try {
        const { tokenizeAdopter } = await import('@/app/actions/duplicates');
        await tokenizeAdopter(adopterId);
    } catch (e) {
        logger.warn('createAdopterFromSubmission: tokenize failed (continuing)', {
            adopterId,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // 4. Find duplicates + persist a filtered subset as `duplicate_candidates`
    // pending rows so the pending-dedup section on /my-adopters has data.
    //
    // Two thresholds intentionally split:
    //   • findAdopters minRelevance:0 — matches the existing form/contract
    //     notification recall (the prior code paths use 0). Keeps the
    //     notification banner honest about borderline matches and preserves
    //     existing e2e behavior (notably contract-link.spec.ts which sets up
    //     a low-confidence fixture and expects the "Es la misma persona"
    //     merge button to render).
    //   • PERSIST_THRESHOLD = 30 — only pairs with ≥30% relevance get
    //     written to duplicate_candidates. Stops the pending-dedup table
    //     from filling with noise that the rescuer would just dismiss.
    const PERSIST_THRESHOLD = 30;
    let dupCandidates: DupCandidateSummary[] = [];
    try {
        const { findAdopters } = await import('@/app/actions/findAdopters');
        const { extractPhones, extractEmails, extractSocials } = await import('@/lib/tokenizer');

        const phones = input.phone ? extractPhones(input.phone) : [];
        // Mirror the contract-submit semantic: DNI / Documento digits are
        // appended to phones because the duplicate matcher historically
        // treats them as phone-style tokens.
        if (input.documentId) {
            const digits = input.documentId.replace(/\D/g, '');
            if (digits.length >= 5) phones.push(digits);
        }

        const dupResult = await findAdopters(
            {
                name: trimmedName,
                phones,
                emails: input.email ? extractEmails(input.email) : [],
                socials: input.socials ? extractSocials(input.socials) : [],
                excludeAdopterId: adopterId,
            },
            { mode: 'duplicate', minRelevance: 0, limit: 5 },
        );

        const matches = (dupResult.results as Array<{ adopterId: string; adopterName: string; matchTypes: string[]; relevancePercent: number }>) || [];

        // Persist only matches above the noise floor. Skip pairs that are
        // already recorded (dismissed / merged) — the admin reconciliation
        // route owns that state transition and we shouldn't reopen its decisions.
        for (const match of matches) {
            if (match.relevancePercent < PERSIST_THRESHOLD) continue;
            const [id1, id2] = adopterId < match.adopterId
                ? [adopterId, match.adopterId]
                : [match.adopterId, adopterId];

            const existing = await db.select({ id: duplicateCandidates.id, status: duplicateCandidates.status })
                .from(duplicateCandidates)
                .where(and(
                    eq(duplicateCandidates.adopter1Id, id1),
                    eq(duplicateCandidates.adopter2Id, id2),
                ))
                .get();

            if (existing) {
                // Already known. Don't touch dismissed/merged. Leave pending as-is.
                continue;
            }

            await db.insert(duplicateCandidates).values({
                id: crypto.randomUUID(),
                adopter1Id: id1,
                adopter2Id: id2,
                matchTypes: JSON.stringify(match.matchTypes),
                matchValues: null,
                score: match.relevancePercent,
                confidence: bucketConfidence(match.relevancePercent),
                status: 'pending',
                detectedAt: new Date(),
            });
        }

        dupCandidates = matches.map(m => ({
            adopterId: m.adopterId,
            adopterName: m.adopterName,
            matchTypes: m.matchTypes,
            relevancePercent: m.relevancePercent,
        }));
    } catch (e) {
        logger.warn('createAdopterFromSubmission: duplicate detection failed (continuing)', {
            adopterId,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    logger.info('Adopter auto-created from submission', {
        adopterId,
        source: input.source,
        addedBy: input.addedBy,
        dupCount: dupCandidates.length,
    });

    return { adopterId, dupCandidates };
}
