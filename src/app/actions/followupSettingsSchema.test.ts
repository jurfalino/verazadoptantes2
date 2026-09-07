/**
 * The settings payload shapes the /settings screen actually sends.
 *
 * v2.56.11: zod v4 makes an ENUM-keyed `z.record` exhaustive, so
 * `{ messages: { neuter: '…' } }` — what the screen sends when ONE template is
 * edited — failed with "expected string, received undefined" for every absent
 * subtype. Saving then died before reaching the DB. Locked down here because
 * the failure is invisible to tsc and only reproduces at runtime.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FOLLOWUP_SUBTYPES } from '@/domain/followups';

// Mirrors the schema in settings.ts (kept in sync deliberately: importing it
// would drag 'use server' + Cloudflare context into the test runtime).
const schema = z.object({
    version: z.literal(1),
    disabledKeys: z.array(z.string().max(100)).max(20).optional(),
    checkins: z.array(z.object({
        offsetDays: z.number().int().min(1).max(720),
        windowDays: z.number().int().min(1).max(365).optional(),
    })).max(12).optional(),
    fosterIntervalDays: z.number().int().min(7).max(120).optional(),
    messages: z.record(z.string().max(40), z.string().max(1000)).optional(),
    emailReminders: z.boolean().optional(),
    onlyMyAnimals: z.boolean().optional(),
}).nullable();

const base = { version: 1 as const, checkins: [{ offsetDays: 7 }, { offsetDays: 30 }], fosterIntervalDays: 30 };

describe('followup settings payloads', () => {
    it('accepts a schedule-only change (the reported failure)', () => {
        expect(schema.safeParse(base).success).toBe(true);
    });

    it('accepts ONE customized message — the zod-v4 exhaustive-record regression', () => {
        expect(schema.safeParse({ ...base, messages: { neuter: 'Hola' } }).success).toBe(true);
    });

    it('accepts every message customized', () => {
        const messages = Object.fromEntries(FOLLOWUP_SUBTYPES.map(s => [s, 'x']));
        expect(schema.safeParse({ ...base, messages }).success).toBe(true);
    });

    it('accepts null (restore defaults) and the preference toggles', () => {
        expect(schema.safeParse(null).success).toBe(true);
        expect(schema.safeParse({ ...base, emailReminders: true, onlyMyAnimals: true }).success).toBe(true);
    });

    it('still rejects out-of-range offsets', () => {
        expect(schema.safeParse({ ...base, checkins: [{ offsetDays: 0 }] }).success).toBe(false);
        expect(schema.safeParse({ ...base, checkins: [{ offsetDays: 900 }] }).success).toBe(false);
    });
});
