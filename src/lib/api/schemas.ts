/**
 * Wire contract of the third-party API v1. The routes validate with these
 * schemas and type their responses with them, and /api/v1/openapi.json is
 * generated from them, so the docs can't drift from what the code accepts.
 * Plan: .agents/plans/2026-10-09-third-party-api.md
 */
import { z } from 'zod';
import { RECORD_TYPES } from '@/domain/constants';
import { isFullName, isUsableDocumentId } from '@/domain/apiExactMatch';
import { readPhones } from '@/domain/phoneNumber';
import { normalizeSpecies } from '@/domain/importRow';

/** Activity types that place the animal with the person (they create it in the rescue's list). */
export const PLACEMENT_TYPES: readonly string[] = [RECORD_TYPES.ADOPTION, RECORD_TYPES.FOSTER];

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
        .meta({ description: 'Any format. Read like BuenAdoptante reads phones, with your country: "+54 9 11 6462-2274" and "11 6462-2274" are the same number.', example: '+54 9 11 6462-2274' }),
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

/** formContent: any JSON object, as the rescue's own form produced it. */
export const FORM_CONTENT_MAX_BYTES = 50_000;
export const FORM_CONTENT_MAX_DEPTH = 6;
function jsonDepth(v: unknown, d = 0): number {
    if (d > FORM_CONTENT_MAX_DEPTH) return d;
    if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, jsonDepth(x, d + 1)), d + 1);
    if (v && typeof v === 'object') return Object.values(v).reduce<number>((m, x) => Math.max(m, jsonDepth(x, d + 1)), d + 1);
    return d;
}

const activitySchema = z.object({
    activityType: z.enum(API_CONTEXTS).meta({ description: 'What the person is doing. The activity saved on their profile has this type.' }),
    externalId: z.string().trim().min(1).max(100).optional()
        .meta({ description: 'Your own id for this activity (e.g. your form submission id). Must be unique per key; a repeat is refused.', example: 'jotform-5512' }),
    animalName: z.string().trim().max(100).optional().meta({ example: 'Luna' }),
    species: z.string().trim().max(50).optional()
        .meta({ description: 'dog, cat, bird or other. Spanish words and one-letter codes are read too (perro / P, gato / G…). REQUIRED for adoption and foster.', example: 'dog' }),
    age: z.string().trim().max(40).optional()
        .meta({ description: 'adoption / foster only. As people write it: "2 años", "3 meses", "6 semanas", "1 año y 3 meses". We estimate the birth date from it at the activity date; an age we can\'t read is kept as written, without an estimate.', example: '2 años' }),
    birthDate: z.iso.date().optional().meta({ description: 'adoption / foster only. Known or estimated birth date, YYYY-MM-DD (instead of age).', example: '2024-08-01' }),
    sex: z.enum(['female', 'male']).optional().meta({ description: 'adoption / foster only.' }),
    neutered: z.boolean().optional().meta({ description: 'adoption / foster only. Spayed / neutered.' }),
    color: z.string().trim().max(60).optional().meta({ description: 'adoption / foster only.', example: 'atigrada' }),
    microchip: z.string().trim().max(40).optional().meta({ description: 'adoption / foster only.', example: '985112345678901' }),
    date: z.iso.date().optional().meta({ description: 'YYYY-MM-DD (a real calendar date). Defaults to today.', example: '2026-10-09' }),
    rating: z.number().int().min(1).max(5).nullable().optional()
        .meta({ description: 'Optional, 1 (dangerous) to 5 (excellent): your judgement of the person. Omit when you have none: it is never inferred.' }),
    notes: z.string().trim().max(2000).optional(),
    formContent: z.record(z.string(), z.unknown()).optional()
        .refine(v => v === undefined || jsonDepth(v) <= FORM_CONTENT_MAX_DEPTH, { message: `nested more than ${FORM_CONTENT_MAX_DEPTH} levels` })
        .refine(v => v === undefined || new TextEncoder().encode(JSON.stringify(v)).length <= FORM_CONTENT_MAX_BYTES, { message: `larger than ${FORM_CONTENT_MAX_BYTES} bytes` })
        .meta({ description: 'adoption_request only. Every answer of your own adoption form, as any JSON object; shown on the activity as question → answer.', example: { '¿Tenés patio?': 'Sí', mascotas: [{ tipo: 'gato', edad: 3 }] } }),
}).strict();
export type ApiActivity = z.infer<typeof activitySchema>;

export const searchRequestSchema = z.object({
    mode: z.enum(['exact', 'fuzzy']).meta({
        description: 'exact: full name + email, phone or document id; answers found / not_found / ambiguous and saves `activity` on that person. fuzzy: the same ranked search as the BuenAdoptante homepage; saves nothing.',
    }),
    person: personSchema,
    activity: activitySchema.optional().meta({
        description: 'Exact mode. The activity to save on the person (send an Idempotency-Key). Leave it out only to look up again someone YOUR rescue already registered.',
    }),
}).strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type ApiErrorCode =
    | 'invalid_json' | 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
    | 'full_name_required' | 'exact_requires_name_and_identifier' | 'invalid_phone'
    | 'invalid_document_id' | 'invalid_email' | 'fuzzy_requires_a_field'
    | 'activity_requires_exact' | 'activity_required' | 'form_content_requires_adoption_request'
    | 'species_required' | 'animal_details_require_placement' | 'invalid_age'
    | 'contract_not_allowed' | 'contract_exists' | 'unsupported_media_type'
    | 'idempotency_key_required' | 'dry_run_not_allowed' | 'idempotency_key_reused'
    | 'external_id_reused' | 'daily_cap_reached' | 'api_disabled' | 'payload_too_large' | 'record_changed' | 'server_error';

/** Every error code a partner can get, published in the docs so clients can switch on them. */
export type PublicApiErrorCode = ApiErrorCode;
export const API_ERROR_CODES: PublicApiErrorCode[] = [
    'invalid_json', 'invalid_request', 'unauthorized', 'forbidden', 'not_found',
    'full_name_required', 'exact_requires_name_and_identifier', 'invalid_phone',
    'invalid_document_id', 'invalid_email', 'fuzzy_requires_a_field',
    'activity_requires_exact', 'activity_required', 'form_content_requires_adoption_request',
    'species_required', 'animal_details_require_placement', 'invalid_age',
    'contract_not_allowed', 'contract_exists', 'unsupported_media_type',
    'idempotency_key_required', 'dry_run_not_allowed', 'idempotency_key_reused', 'external_id_reused', 'daily_cap_reached', 'api_disabled',
    'payload_too_large', 'record_changed', 'server_error',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Rules a schema can't express. Returns the first problem, or null. */
export function checkSearchRules(req: SearchRequest): { code: ApiErrorCode; message: string } | null {
    const p = req.person;
    if (p.email && !EMAIL_RE.test(p.email)) return { code: 'invalid_email', message: 'person.email is not a valid email address' };
    if (p.phone && readPhones(p.phone).length === 0) return { code: 'invalid_phone', message: 'person.phone is not a readable phone number' };
    if (p.documentId && !isUsableDocumentId(p.documentId.value)) {
        return { code: 'invalid_document_id', message: 'person.documentId.value needs at least 5 characters including 4 digits' };
    }
    const a = req.activity;
    if (a?.formContent && a.activityType !== RECORD_TYPES.REQUEST) {
        return { code: 'form_content_requires_adoption_request', message: 'activity.formContent is only accepted with activityType adoption_request' };
    }
    if (a) {
        const placement = PLACEMENT_TYPES.includes(a.activityType);
        // An adoption / foster puts the animal in the rescue's list: it needs a species.
        if (placement && !normalizeSpecies(a.species)) return { code: 'species_required', message: `activity.species is required for ${a.activityType}` };
        const details = (['age', 'birthDate', 'sex', 'neutered', 'color', 'microchip'] as const).filter(k => a[k] !== undefined);
        if (!placement && details.length) {
            return { code: 'animal_details_require_placement', message: `activity.${details[0]} describes the animal and is only accepted with adoption or foster` };
        }
        // An age we can't read is kept as written, with no estimated birth date: it never blocks the adoption.
        if (a.age && a.birthDate) return { code: 'invalid_age', message: 'send activity.age or activity.birthDate, not both' };
        if (a.birthDate && a.birthDate > (a.date ?? new Date().toISOString().slice(0, 10))) {
            return { code: 'invalid_age', message: 'activity.birthDate cannot be after the activity date' };
        }
    }
    if (req.mode === 'exact') {
        if (!p.fullName || !(p.email || p.phone || p.documentId)) {
            return { code: 'exact_requires_name_and_identifier', message: 'exact mode needs person.fullName plus person.email, person.phone or person.documentId' };
        }
        if (!isFullName(p.fullName)) return { code: 'full_name_required', message: 'person.fullName must include first name and surname' };
    } else {
        if (req.activity) return { code: 'activity_requires_exact', message: 'activity is only allowed in exact mode (fuzzy searches save nothing)' };
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
    tooManyRequests: densitySchema.meta({ description: 'Set when the person asked to adopt at many DIFFERENT rescues in a short period (count = rescues; several requests to one rescue count once).' }),
    tooManyAdoptions: densitySchema,
    records: z.record(z.string(), z.number().int()).meta({ description: 'Number of records per type.' }),
    lastRecordAt: z.string().nullable(),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

export const CONTACT_FIELDS = ['email', 'phone', 'documentId'] as const;
const savedActivitySchema = z.object({
    activityId: z.string(),
    activityUrl: z.string().meta({ description: 'The profile page, scrolled to this activity.' }),
    profileId: z.string(),
    profileUrl: z.string(),
    profileCreated: z.boolean(),
    contactsAdded: z.array(z.enum(CONTACT_FIELDS)).meta({ description: 'Contact details you sent that the known person did not have yet, now added to their profile (logged in its history).' }),
});
export type SavedActivity = z.infer<typeof savedActivitySchema>;

const riskSchema = z.object({
    worstRating: ratingSchema,
    flags: z.array(z.string()).meta({ description: 'Every active flag on any matched profile, e.g. inaccurate, too_many_requests.' }),
    profilesMatched: z.number().int(),
}).meta({ description: 'Always present: the worst signal across EVERY profile your email / phone / document matched, whatever the result. Check this before handing over an animal.' });
export type ApiRisk = z.infer<typeof riskSchema>;

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
    risk: riskSchema,
    activity: savedActivitySchema.optional().meta({ description: 'The activity this call saved (absent on a look-up without activity).' }),
    replayed: z.boolean().optional().meta({ description: 'true when this is the stored answer to an earlier call with the same Idempotency-Key.' }),
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
    activityId: z.string(),
    voided: z.literal(true),
    profileVoided: z.boolean().meta({ description: 'True when the API had also created the profile and nothing else used it.' }),
    alreadyVoided: z.boolean().optional().meta({ description: 'Voiding twice is not an error: the second call says so and changes nothing.' }),
});
export type VoidResponse = z.infer<typeof voidResponseSchema>;

export const contractResponseSchema = z.object({
    requestId: z.string(),
    activityId: z.string(),
    activityUrl: z.string().nullable().meta({ description: 'The profile page, scrolled to this activity (where "Ver contrato firmado" now shows).' }),
    contract: z.object({
        contentType: z.string(),
        size: z.number().int(),
        sha256: z.string().meta({ description: 'Fingerprint of the file as stored: proof it has not changed since.' }),
    }),
});
export type ContractResponse = z.infer<typeof contractResponseSchema>;

export const errorResponseSchema = z.object({
    requestId: z.string(),
    error: z.object({ code: z.enum(API_ERROR_CODES as [PublicApiErrorCode, ...PublicApiErrorCode[]]), message: z.string(), errorId: z.string().optional() }),
});
