/**
 * Wire contract of the third-party API v1. The routes validate with these
 * schemas and type their responses with them, and /api/v1/openapi.json is
 * generated from them, so the docs can't drift from what the code accepts.
 * Plan: .agents/plans/2026-10-09-third-party-api.md
 */
import { z } from 'zod';
import { RECORD_TYPES } from '@/domain/constants';
import { isFullName, isUsableDocumentId, phoneLookups } from '@/domain/apiExactMatch';

/** What the person is doing. RECORD_TYPES minus `available` (that describes an animal, not a person). */
export const API_CONTEXTS = [
    RECORD_TYPES.REQUEST, RECORD_TYPES.ADOPTION, RECORD_TYPES.FOSTER,
    RECORD_TYPES.FOLLOW_UP, RECORD_TYPES.RETURNED, RECORD_TYPES.OBSERVATION,
] as const;
export type ApiContext = typeof API_CONTEXTS[number];

export const API_SCOPES = ['search', 'search:fuzzy', 'record:write'] as const;
export type ApiScope = typeof API_SCOPES[number];

export const SOCIAL_PLATFORMS_API = ['facebook', 'instagram', 'tiktok', 'x', 'threads', 'other'] as const;

const personSchema = z.object({
    fullName: z.string().trim().min(1).max(200).optional()
        .meta({ description: 'Full name: first name and surname. Required in exact mode.', example: 'María José Pérez' }),
    email: z.string().trim().max(254).optional().meta({ example: 'maria@example.com' }),
    phone: z.string().trim().max(40).optional()
        .meta({ description: 'Any format. Matched on its last 8 digits, so country and area codes do not matter.', example: '+54 9 11 6462-2274' }),
    documentId: z.object({
        value: z.string().trim().min(1).max(40).meta({ example: '30.123.456' }),
        country: z.string().trim().length(2).optional().meta({ description: 'ISO 3166-1 alpha-2', example: 'AR' }),
    }).strict().optional().meta({ description: 'National ID (DNI, CI, CPF, RUT…). Punctuation is ignored.' }),
    address: z.string().trim().max(300).optional()
        .meta({ description: 'Used by fuzzy search. Accepted but not used to decide an exact match.', example: 'Av. Siempreviva 742, CABA' }),
    socials: z.array(z.object({
        platform: z.enum(SOCIAL_PLATFORMS_API),
        handle: z.string().trim().min(1).max(200).meta({ example: '@mariajose' }),
    }).strict()).max(10).optional()
        .meta({ description: 'Used by fuzzy search. Accepted but not used to decide an exact match.' }),
}).strict();

const saveSchema = z.object({
    externalId: z.string().trim().min(1).max(100).optional()
        .meta({ description: 'Your own id for this record. Must be unique per key; a repeat is refused.', example: 'jotform-5512' }),
    animalName: z.string().trim().max(100).optional().meta({ example: 'Luna' }),
    species: z.string().trim().max(50).optional().meta({ example: 'dog' }),
    date: z.iso.date().optional().meta({ description: 'YYYY-MM-DD (a real calendar date). Defaults to today.', example: '2026-10-09' }),
    rating: z.number().int().min(1).max(5).nullable().optional()
        .meta({ description: 'Optional, 1 (dangerous) to 5 (excellent). Omit when you have no judgement: it is never inferred.' }),
    notes: z.string().trim().max(2000).optional(),
}).strict();

export const searchRequestSchema = z.object({
    mode: z.enum(['exact', 'fuzzy']).meta({
        description: 'exact: full name + email, phone or document id; answers found / not_found / ambiguous and may save a record. fuzzy: the same ranked search as the BuenAdoptante homepage.',
    }),
    context: z.enum(API_CONTEXTS).meta({ description: 'What the person is doing. Also the type of the record saved with `save`.' }),
    person: personSchema,
    save: saveSchema.optional().meta({
        description: 'Exact mode only. Saves a record in the same call. Requires the Idempotency-Key header.',
    }),
}).strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type ApiErrorCode =
    | 'invalid_json' | 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
    | 'full_name_required' | 'exact_requires_name_and_identifier' | 'invalid_phone'
    | 'invalid_document_id' | 'invalid_email' | 'fuzzy_requires_a_field'
    | 'save_requires_exact' | 'idempotency_key_required' | 'idempotency_key_reused'
    | 'external_id_reused' | 'daily_cap_reached' | 'api_disabled' | 'payload_too_large' | 'record_changed' | 'server_error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Rules a schema can't express. Returns the first problem, or null. */
export function checkSearchRules(req: SearchRequest): { code: ApiErrorCode; message: string } | null {
    const p = req.person;
    if (p.email && !EMAIL_RE.test(p.email)) return { code: 'invalid_email', message: 'person.email is not a valid email address' };
    if (p.phone && phoneLookups(p.phone).length === 0) return { code: 'invalid_phone', message: 'person.phone needs at least 7 digits' };
    if (p.documentId && !isUsableDocumentId(p.documentId.value)) {
        return { code: 'invalid_document_id', message: 'person.documentId.value needs at least 5 characters including 4 digits' };
    }
    if (req.mode === 'exact') {
        if (!p.fullName || !(p.email || p.phone || p.documentId)) {
            return { code: 'exact_requires_name_and_identifier', message: 'exact mode needs person.fullName plus person.email, person.phone or person.documentId' };
        }
        if (!isFullName(p.fullName)) return { code: 'full_name_required', message: 'person.fullName must include first name and surname' };
    } else {
        if (req.save) return { code: 'save_requires_exact', message: 'save is only allowed in exact mode' };
        if (!(p.fullName || p.email || p.phone || p.documentId || p.address || p.socials?.length)) {
            return { code: 'fuzzy_requires_a_field', message: 'fuzzy mode needs at least one person field' };
        }
    }
    return null;
}

// ── Responses ────────────────────────────────────────────────────────────────

const ratingSchema = z.object({
    rating: z.number().nullable().meta({ description: 'Average of all rated records, 1–5. null when nobody has rated this person.' }),
    ratingLevel: z.number().int().min(0).max(5).meta({ description: '0 = not rated, else 1 (dangerous) … 5 (excellent).' }),
    ratingLabel: z.enum(['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent']),
});

const densitySchema = z.object({ count: z.number().int(), periodDays: z.number().int() }).nullable();

export const profileSummarySchema = ratingSchema.extend({
    profileId: z.string(),
    url: z.string().meta({ description: 'The profile page. Opens for logged-in BuenAdoptante users, with their own access rules.' }),
    matchedOn: z.array(z.enum(['email', 'phone', 'documentId'])).optional(),
    nameMatchedAs: z.enum(['profile', 'alias', 'household_member']).optional(),
    flags: z.array(z.string()).meta({ description: 'Active flags, e.g. inaccurate, duplicate, verified_identity.' }),
    tooManyRequests: densitySchema.meta({ description: 'Set when the person asked to adopt unusually often in a short period.' }),
    tooManyAdoptions: densitySchema,
    records: z.record(z.string(), z.number().int()).meta({ description: 'Number of records per type.' }),
    lastRecordAt: z.string().nullable(),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

const savedSchema = z.object({
    recordId: z.string(),
    recordUrl: z.string().meta({ description: 'The profile page, scrolled to this record.' }),
    profileId: z.string(),
    profileUrl: z.string(),
    profileCreated: z.boolean(),
});
export type SavedRecord = z.infer<typeof savedSchema>;

export const exactResponseSchema = z.object({
    requestId: z.string(),
    mode: z.literal('exact'),
    result: z.enum(['found', 'not_found', 'ambiguous']),
    profile: profileSummarySchema.optional().meta({ description: 'result = found. Describes the person BEFORE anything saved by this call.' }),
    otherMatches: z.object({
        count: z.number().int(),
        urls: z.array(z.string()),
        worstRating: ratingSchema,
    }).optional().meta({ description: 'result = found: other profiles the same email / phone / document also belongs to, under an unrelated name (e.g. a shared family phone). Check them before deciding.' }),
    reason: z.enum(['multiple_profiles', 'name_mismatch']).optional().meta({ description: 'result = ambiguous.' }),
    candidates: z.number().int().optional(),
    candidateUrls: z.array(z.string()).optional(),
    worstRating: ratingSchema.optional().meta({ description: 'result = ambiguous: the lowest rating among the candidates, so you can still block.' }),
    saved: savedSchema.optional(),
});
export type ExactResponse = z.infer<typeof exactResponseSchema>;

export const fuzzyResponseSchema = z.object({
    requestId: z.string(),
    mode: z.literal('fuzzy'),
    results: z.array(z.object({
        relevancePercent: z.number(),
        name: z.string().meta({ description: 'As your account would see it in BuenAdoptante (may be masked).' }),
        profile: profileSummarySchema,
    })),
    truncated: z.boolean().optional(),
});
export type FuzzyResponse = z.infer<typeof fuzzyResponseSchema>;

export const meResponseSchema = z.object({
    requestId: z.string(),
    key: z.object({ name: z.string(), prefix: z.string(), environment: z.enum(['live', 'test']), scopes: z.array(z.enum(API_SCOPES)) }),
    rescuer: z.object({ email: z.string(), name: z.string().nullable() }),
    caps: z.object({ exact: z.number().int(), fuzzy: z.number().int() }),
    usedToday: z.object({ exact: z.number().int(), fuzzy: z.number().int() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const voidResponseSchema = z.object({
    requestId: z.string(),
    recordId: z.string(),
    voided: z.literal(true),
    profileVoided: z.boolean().meta({ description: 'True when the API had also created the profile and nothing else used it.' }),
    alreadyVoided: z.boolean().optional().meta({ description: 'Voiding twice is not an error: the second call says so and changes nothing.' }),
});
export type VoidResponse = z.infer<typeof voidResponseSchema>;

export const errorResponseSchema = z.object({
    requestId: z.string(),
    error: z.object({ code: z.string(), message: z.string(), errorId: z.string().optional() }),
});
