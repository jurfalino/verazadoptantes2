/**
 * Zod validation schemas for all server action inputs.
 *
 * Every server action that accepts user input must validate through
 * these schemas BEFORE any database operation. This is the primary
 * defense against malformed or malicious payloads.
 */

import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────

const id = z.string().uuid().or(z.string().max(64));
const optionalText = z.string().max(10_000).optional().nullable();
const requiredText = z.string().min(1).max(5_000);

// ── Adopter ──────────────────────────────────────────────────────

export const saveAdopterSchema = z.object({
    id: id.optional(),
    name: requiredText,
    contactInfo: optionalText,
    addressInfo: optionalText,
    familyMembers: optionalText,
    notes: optionalText,
    status: z.string().regex(/^[1-5]$/).optional().nullable(),
    sourceUrl: z.string().url().max(2_000).optional().nullable().or(z.literal('')),
    country: z.string().length(2).optional().nullable(),
    tokenHash: z.string().max(256).optional().nullable(),
    deletedAt: z.coerce.date().optional().nullable(),
});

// ── Adoption / Interaction ───────────────────────────────────────

export const saveAdoptionSchema = z.object({
    id: id.optional(),
    adopterId: id.optional().nullable(),
    animalName: z.string().max(500).optional().nullable(),
    species: z.string().max(100).optional().nullable(),
    details: optionalText,
    status: z.string().max(100).optional().nullable(),
    rating: z.number().int().min(1).max(5).optional().nullable(),
    comments: optionalText,
    date: z.union([z.coerce.date(), z.string().max(50)]).optional().nullable(),
    onBehalfOf: z.string().max(500).optional().nullable(),
    recordType: z.enum(['adoption', 'adoption_request', 'observation', 'follow_up', 'returned_pet', 'available']).optional().nullable(),
    deliveredToHome: z.number().int().min(0).max(1).optional().nullable(),
    verifiedAddress: z.string().max(2_000).optional().nullable(),
    identityVerified: z.number().int().min(0).max(1).optional().nullable(),
    sourceUrl: z.string().url().max(2_000).optional().nullable().or(z.literal('')),
});

// ── Search ───────────────────────────────────────────────────────

export const searchSchema = z.object({
    query: z.string().min(1, 'Query is required').max(500),
});

// ── Flags ────────────────────────────────────────────────────────

export const flagAdopterSchema = z.object({
    adopterId: id,
    reason: z.string().min(1).max(200),
    details: z.string().max(5_000).optional(),
    targetAdopterId: id.optional(),
});

export const dismissFlagSchema = z.object({
    flagId: id,
});

export const removeVerificationSchema = z.object({
    adopterId: id,
    type: z.enum(['verified_identity', 'verified_address']),
});

// ── Settings ─────────────────────────────────────────────────────

export const updateCountrySchema = z.object({
    country: z.string().length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)'),
});

export const acceptTermsAndCountrySchema = z.object({
    country: z.string().length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)'),
    version: z.number().int().min(1, 'Terms version must be a positive integer'),
});

// ── Adopters API (POST /api/adopters) ────────────────

export const createAdopterApiSchema = z.object({
    name: z.string().min(1, 'Name is required').max(1_000),
    contactInfo: z.union([
        z.string().max(10_000),
        z.object({
            phones: z.array(z.string().max(100)).optional(),
            emails: z.array(z.string().max(200)).optional(),
            socialProfiles: z.array(z.string().max(500)).optional(),
            addresses: z.array(z.string().max(1_000)).optional(),
        }),
    ]).optional(),
    notes: z.string().max(10_000).optional(),
    sourceUrl: z.string().url().max(2_000).optional().or(z.literal('')),
    flags: z.array(z.string().max(200)).max(20).optional(),
    images: z.array(z.object({
        data: z.string().max(10_000_000), // ~7.5MB base64
        mimeType: z.string().max(100),
        originalUrl: z.string().max(2_000).optional(),
        thumbnail: z.string().max(10_000_000).optional(),
    })).max(20).optional(),
    adoption: z.object({
        animalName: z.string().max(500).optional(),
        species: z.string().max(100).optional(),
        recordType: z.enum(['adoption', 'adoption_request', 'returned_pet', 'follow_up', 'observation']).optional(),
        rating: z.number().int().min(1).max(5).optional(),
        date: z.string().max(50).optional(),
    }).optional(),
});
