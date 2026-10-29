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
import { API_EMAIL_RE } from '@/domain/apiPersonCleanup';
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
    phone: z.string().trim().max(200).optional()
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
        .meta({ description: 'REQUIRED. Your own id for this activity (e.g. your form submission id, a spreadsheet row). It is how a retry is recognised: the same externalId with the same content returns the original answer and saves nothing new; with different content it is refused (409 external_id_reused). Voiding an activity frees its externalId.', example: 'jotform-5512' }),
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
        description: 'Exact mode: REQUIRED — an exact call always saves an activity. To look someone up without saving, use mode fuzzy.',
    }),
}).strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type ApiErrorCode =
    | 'invalid_json' | 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
    | 'full_name_required' | 'exact_requires_name_and_identifier' | 'invalid_phone'
    | 'invalid_document_id' | 'invalid_email' | 'fuzzy_requires_a_field'
    | 'activity_requires_exact' | 'activity_required' | 'external_id_required' | 'form_content_requires_adoption_request'
    | 'species_required' | 'animal_details_require_placement' | 'invalid_age' | 'example_data'
    | 'contract_not_allowed' | 'contract_exists' | 'unsupported_media_type'
    | 'dry_run_not_allowed' | 'external_id_reused' | 'external_id_expired' | 'request_in_progress' | 'partially_saved'
    | 'daily_cap_reached' | 'daily_call_ceiling_reached' | 'api_disabled' | 'payload_too_large' | 'record_changed'
    | 'temporarily_unavailable' | 'server_error';

/** Every error code a partner can get, published in the docs so clients can switch on them. */
export type PublicApiErrorCode = ApiErrorCode;
export const API_ERROR_CODES: PublicApiErrorCode[] = [
    'invalid_json', 'invalid_request', 'unauthorized', 'forbidden', 'not_found',
    'full_name_required', 'exact_requires_name_and_identifier', 'invalid_phone',
    'invalid_document_id', 'invalid_email', 'fuzzy_requires_a_field',
    'activity_requires_exact', 'activity_required', 'external_id_required', 'form_content_requires_adoption_request',
    'species_required', 'animal_details_require_placement', 'invalid_age', 'example_data',
    'contract_not_allowed', 'contract_exists', 'unsupported_media_type',
    'dry_run_not_allowed', 'external_id_reused', 'external_id_expired', 'request_in_progress', 'partially_saved',
    'daily_cap_reached', 'daily_call_ceiling_reached', 'api_disabled', 'payload_too_large', 'record_changed',
    'temporarily_unavailable', 'server_error',
];

const EMAIL_RE = API_EMAIL_RE;

export interface RuleProblem { code: ApiErrorCode; message: string; field: string }

/** Rules a schema can't express. Returns EVERY problem (the first is the error's code), empty when valid. */
export function checkSearchRules(req: SearchRequest): RuleProblem[] {
    const out: RuleProblem[] = [];
    const add = (code: ApiErrorCode, field: string, message: string) => out.push({ code, field, message });
    const p = req.person;
    if (p.email && !EMAIL_RE.test(p.email)) add('invalid_email', 'person.email', 'person.email is not a valid email address');
    if (p.phone && readPhones(p.phone).length === 0) add('invalid_phone', 'person.phone', 'person.phone is not a readable phone number');
    if (p.documentId && !isUsableDocumentId(p.documentId.value)) {
        add('invalid_document_id', 'person.documentId.value', 'person.documentId.value needs at least 5 characters including 4 digits');
    }
    const a = req.activity;
    if (req.mode === 'exact') {
        if (!p.fullName || !(p.email || p.phone || p.documentId)) {
            add('exact_requires_name_and_identifier', p.fullName ? 'person' : 'person.fullName', 'exact mode needs person.fullName plus person.email, person.phone or person.documentId');
        } else if (!isFullName(p.fullName)) add('full_name_required', 'person.fullName', 'person.fullName must be a first name and surname (not an email, a phone number or a single word)');
        // An exact call always saves (Jon, 2026-10-17): to look someone up, use fuzzy.
        if (!a) add('activity_required', 'activity', 'an exact call always saves an activity; to look someone up without saving anything, use mode "fuzzy"');
        else if (!a.externalId) add('external_id_required', 'activity.externalId', 'activity.externalId is required: your own id for this activity (e.g. your form submission id); it is how a retry is recognised');
    } else {
        if (a) add('activity_requires_exact', 'activity', 'activity is only allowed in exact mode (fuzzy searches save nothing)');
        if (!(p.fullName || p.email || p.phone || p.documentId || p.address || p.socials?.length)) {
            add('fuzzy_requires_a_field', 'person', 'fuzzy mode needs at least one person field');
        }
    }
    if (a?.formContent && a.activityType !== RECORD_TYPES.REQUEST) {
        add('form_content_requires_adoption_request', 'activity.formContent', 'activity.formContent is only accepted with activityType adoption_request');
    }
    if (a) {
        const placement = PLACEMENT_TYPES.includes(a.activityType);
        // An adoption / foster puts the animal in the rescue's list: it needs a species.
        if (placement && !normalizeSpecies(a.species)) add('species_required', 'activity.species', `activity.species is required for ${a.activityType}`);
        const details = (['age', 'birthDate', 'sex', 'neutered', 'color', 'microchip'] as const).filter(k => a[k] !== undefined);
        if (!placement && details.length) {
            add('animal_details_require_placement', `activity.${details[0]}`, `activity.${details[0]} describes the animal and is only accepted with adoption or foster`);
        }
        // An age we can't read is kept as written, with no estimated birth date: it never blocks the adoption.
        if (a.age && a.birthDate) add('invalid_age', 'activity.birthDate', 'send activity.age or activity.birthDate, not both');
        else if (a.birthDate && a.birthDate > (a.date ?? new Date().toISOString().slice(0, 10))) {
            add('invalid_age', 'activity.birthDate', 'activity.birthDate cannot be after the activity date');
        }
    }
    return out;
}

// ── Responses ────────────────────────────────────────────────────────────────

const ratingSchema = z.object({
    rating: z.number().nullable().meta({ description: 'Average of all rated records, 1–5. null when nobody has rated this person.' }),
    ratingLevel: z.number().int().min(0).max(5).meta({ description: '0 = not rated, else 1 (dangerous) … 5 (excellent).' }),
    ratingLabel: z.enum(['not_rated', 'dangerous', 'poor', 'average', 'good', 'excellent']),
});

export const ALERT_TYPES = ['too_many_requests', 'too_many_adoptions'] as const;
export const PROFILE_FLAGS = ['inaccurate', 'duplicate', 'possible_duplicate', 'verified_identity', 'verified_address'] as const;
export const RISK_FLAGS = ['inaccurate', 'duplicate', 'possible_duplicate'] as const;
const alertSchema = z.object({
    type: z.enum(ALERT_TYPES).meta({ description: 'too_many_requests: asked to adopt at many DIFFERENT rescues in a short period (count = rescues; several requests to one rescue count once). too_many_adoptions: adopted many animals in a short period (count = adoptions).' }),
    count: z.number().int(),
    periodDays: z.number().int(),
});
export type ApiAlert = z.infer<typeof alertSchema>;

export const profileSummarySchema = ratingSchema.extend({
    profileId: z.string(),
    url: z.string().meta({ description: 'The profile page. Opens for logged-in BuenAdoptante users, with their own access rules.' }),
    matchedOn: z.array(z.enum(['email', 'phone', 'documentId'])).optional(),
    nameMatchedAs: z.enum(['profile', 'alias', 'household_member']).optional()
        .meta({ description: 'Which of the profile\'s names fits the name you sent: its own name (profile) or one it is also known by (alias). household_member is no longer returned: each person in a household is a profile of their own.' }),
    flags: z.array(z.enum(PROFILE_FLAGS)).meta({ description: 'Marks on the profile: inaccurate, duplicate, possible_duplicate (bad signs) and verified_identity, verified_address (good signs). duplicate is an open report only: once the two profiles are merged or kept separate it is no longer listed.' }),
    alerts: z.array(alertSchema).meta({ description: 'Activity alerts BuenAdoptante computed for this person: too_many_requests, too_many_adoptions. Empty when none.' }),
    records: z.partialRecord(z.enum(API_CONTEXTS), z.number().int()).meta({ description: 'Number of records per type.' }),
    lastRecordAt: z.string().nullable().meta({ description: 'Date (YYYY-MM-DD, UTC) of the latest record.' }),
    createdAt: z.string().nullable().meta({ description: 'Date (YYYY-MM-DD, UTC) the profile was created.' }),
    registeredByYourRescue: z.boolean().meta({ description: 'true when your rescue (this key\'s owner or their organization) has put at least one activity on this profile — e.g. it was created by one of your earlier calls.' }),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

export const CONTACT_FIELDS = ['email', 'phone', 'documentId'] as const;
/** What THIS call did (Jon, 2026-10-17: `match` says what existed, `saved.action` what was done). */
export const SAVE_ACTIONS = ['added_to_profile', 'created_profile', 'added_to_best_match', 'created_profile_for_review', 'nothing_saved'] as const;
export type SaveAction = typeof SAVE_ACTIONS[number];
const savedSchema = z.object({
    action: z.enum(SAVE_ACTIONS).meta({
        description: 'added_to_profile: the activity went on the person found. created_profile: nobody had that data, a new profile was created with the activity. ' +
            'added_to_best_match: several profiles fit the name, it went on the best match. created_profile_for_review: the email / phone / document belongs to someone with another name, ' +
            'so a new profile was created and an admin reviews it as a possible duplicate. nothing_saved: a look-up without activity, or a dry run.',
    }),
    dryRun: z.literal(true).optional().meta({ description: 'X-Dry-Run (staging only): `action` is what the call WOULD have done; nothing was saved and there are no ids.' }),
    activityId: z.string().optional().meta({ description: 'The saved activity (use it to attach a contract or void it). Absent when nothing was saved.' }),
    activityUrl: z.string().optional().meta({ description: 'The profile page, scrolled to this activity.' }),
    profileId: z.string().optional(),
    profileUrl: z.string().optional(),
    contactsAdded: z.array(z.enum(CONTACT_FIELDS)).optional().meta({ description: 'Contact details you sent that the person did not have yet, now added to their profile (logged in its history).' }),
});
export type Saved = z.infer<typeof savedSchema>;
/**
 * A stable order for ambiguous candidates (and other matches): profiles whose
 * name fits first, then the one matching more of the sent email / phone /
 * document, then by id — never the database's row order. Pure.
 */
export function orderCandidates<T extends { profileId: string; nameMatchedAs?: string | null }>(items: T[], matchedCount: (profileId: string) => number): T[] {
    return [...items].sort((a, b) =>
        Number(!!b.nameMatchedAs) - Number(!!a.nameMatchedAs)
        || matchedCount(b.profileId) - matchedCount(a.profileId)
        || (a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0));
}
/** What a saving call did, from what it found and whether it had to create the profile. Pure. */
export function saveActionOf(match: 'found' | 'not_found' | 'ambiguous', profileCreated: boolean): SaveAction {
    if (match === 'found') return 'added_to_profile';
    if (match === 'not_found') return 'created_profile';
    return profileCreated ? 'created_profile_for_review' : 'added_to_best_match';
}

/** What saveApiActivity hands back to the search (the response's `saved` is built from it). */
export interface SavedActivity { activityId: string; activityUrl: string; profileId: string; profileUrl: string; profileCreated: boolean; contactsAdded: Array<typeof CONTACT_FIELDS[number]> }


const riskSchema = z.object({
    worstRating: ratingSchema,
    flags: z.array(z.enum(RISK_FLAGS)).meta({ description: 'Every negative mark on any matched profile: inaccurate, duplicate (an open report only), possible_duplicate.' }),
    alerts: z.array(alertSchema.extend({ profileId: z.string() })).meta({ description: 'Every activity alert of any matched profile (too_many_requests, too_many_adoptions), with the profile it belongs to.' }),
    profilesMatched: z.number().int(),
}).meta({ description: 'Always present: the worst signal across EVERY profile your email / phone / document matched, whatever the result. Check this before handing over an animal.' });
export type ApiRisk = z.infer<typeof riskSchema>;

export const warningSchema = z.object({
    field: z.string().meta({ example: 'person.phone' }),
    code: z.enum(['value_dropped', 'value_cleaned']),
    reason: z.enum(['not_an_email', 'not_a_phone', 'no_account', 'not_a_social_profile', 'first_valid_email', 'phone_numbers_only']),
    message: z.string(),
}).meta({ description: 'value_dropped: the value was not usable and was not saved (the rest was). value_cleaned: only the usable part was kept (the first valid email; the phone numbers without the note).' });
export type ApiWarning = z.infer<typeof warningSchema>;

export const exactResponseSchema = z.object({
    requestId: z.string(),
    mode: z.literal('exact'),
    match: z.enum(['found', 'not_found', 'ambiguous']).meta({ description: 'What BuenAdoptante had BEFORE this call: found (one person fits), not_found (nobody has that email / phone / document), ambiguous (several profiles, or a profile with another name). What the call did is in `saved.action`.' }),
    profile: profileSummarySchema.optional().meta({ description: 'match = found. Describes the person BEFORE anything saved by this call.' }),
    otherMatches: z.array(z.object({ profileId: z.string(), url: z.string() })).optional()
        .meta({ description: 'match = found: other profiles the same email / phone / document also belongs to, under an unrelated name (e.g. a shared family phone). Their ratings and alerts are in `risk`. Check them before deciding.' }),
    reason: z.enum(['multiple_profiles', 'name_mismatch']).optional().meta({ description: 'match = ambiguous. multiple_profiles: several profiles fit the name. name_mismatch: the email / phone / document belongs to someone with another name.' }),
    candidates: z.array(z.object({
        profileId: z.string(), url: z.string(),
        nameMatchedAs: z.enum(['profile', 'alias', 'household_member']).nullable().meta({ description: 'Which of the profile\'s names fits the name you sent; null when none does. household_member is no longer returned: each person in a household is a profile of their own.' }),
    })).optional().meta({ description: 'match = ambiguous: the profiles the email / phone / document belongs to. Their ratings and alerts are in `risk`.' }),
    risk: riskSchema,
    saved: savedSchema.meta({ description: 'Always present: what this call did.' }),
    replayed: z.boolean().optional().meta({ description: 'true when this is the stored answer to an earlier call with the same externalId and content (a retry): nothing new was saved.' }),
    originalRequestId: z.string().optional().meta({ description: 'On a replay: the requestId of the call that saved it.' }),
    warnings: z.array(warningSchema).optional().meta({ description: 'Present when something you sent was not usable and was left out, or only part of it was kept. Fix it at the source.' }),
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
    warnings: z.array(warningSchema).optional(),
});
export type FuzzyResponse = z.infer<typeof fuzzyResponseSchema>;

export const meResponseSchema = z.object({
    requestId: z.string(),
    key: z.object({ name: z.string(), prefix: z.string(), environment: z.enum(['live', 'test']), scopes: z.array(z.enum(API_SCOPES)) }),
    rescuer: z.object({ email: z.string(), name: z.string().nullable() }),
    caps: z.object({ exact: z.number().int(), fuzzy: z.number().int() }),
    usedToday: z.object({ exact: z.number().int(), fuzzy: z.number().int() }).meta({ description: 'Successful searches today (refused calls and replays do not count).' }),
    callCeiling: z.object({ limit: z.number().int(), usedToday: z.number().int() }).meta({ description: 'Every call of any kind this key may make per day (a guard against a client stuck in a loop).' }),
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

export const pastCallResponseSchema = z.object({
    requestId: z.string(),
    call: z.object({
        requestId: z.string(),
        createdAt: z.string().meta({ description: 'When the call was made (ISO 8601, UTC).' }),
        endpoint: z.string(),
        httpStatus: z.number().int(),
        externalId: z.string().nullable(),
        activityId: z.string().nullable().meta({ description: 'The activity that call saved, if any.' }),
        voided: z.boolean().meta({ description: 'true when that activity has since been voided.' }),
        dryRun: z.boolean(),
        response: z.record(z.string(), z.unknown()).nullable().meta({ description: 'The answer that call got (null after 90 days, when person data is dropped).' }),
    }),
});
export type PastCallResponse = z.infer<typeof pastCallResponseSchema>;

export const errorResponseSchema = z.object({
    requestId: z.string(),
    error: z.object({
        code: z.enum(API_ERROR_CODES as [PublicApiErrorCode, ...PublicApiErrorCode[]]),
        message: z.string(),
        field: z.string().optional().meta({ description: 'The request field the problem is in, e.g. person.phone.' }),
        details: z.array(z.object({ code: z.string(), field: z.string(), message: z.string() })).optional()
            .meta({ description: 'Validation: EVERY problem found, not just the first.' }),
        docUrl: z.string().meta({ description: 'Where the docs explain this error and how to fix it.' }),
        errorId: z.string().optional().meta({ description: 'Server errors: quote it when you report the problem.' }),
        originalRequestId: z.string().optional().meta({ description: 'external_id_reused / partially_saved: the earlier call with this externalId.' }),
        activityId: z.string().optional().meta({ description: 'external_id_reused / partially_saved: the activity that call saved, if any.' }),
        profileId: z.string().optional().meta({ description: 'external_id_reused / partially_saved: the profile that call saved on or created, if any.' }),
    }),
});
