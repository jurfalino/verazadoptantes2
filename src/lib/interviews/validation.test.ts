import { describe, it, expect } from 'vitest';
import { draftPatchSchema, prepSchema, completeInputSchema } from './validation';

describe('interview validation caps', () => {
    it('refuses oversized answers and payloads', () => {
        const huge = 'x'.repeat(4001);
        expect(draftPatchSchema.safeParse({ answers: { rapport_work: { status: 'answered', text: huge } }, visited: [], custom: [], leadCandidateId: null }).success).toBe(false);
        const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`custom:${i}`, { status: 'skipped' }]));
        expect(draftPatchSchema.safeParse({ answers: many, visited: [], custom: [], leadCandidateId: null }).success).toBe(false);
    });
    it('accepts a normal draft', () => {
        expect(draftPatchSchema.safeParse({
            answers: { story_household: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] } },
            visited: ['story_household'], custom: [{ id: 'custom:1', stage: 'details', text: '¿Auto?' }], leadCandidateId: null,
        }).success).toBe(true);
    });
    it('prep needs a 2+ character name', () => {
        expect(prepSchema.safeParse({ name: 'J', phones: [], emails: [], socials: [], address: '' }).success).toBe(false);
    });
    it('complete input: rating 1-5 or null, target id or "new"', () => {
        expect(completeInputSchema.safeParse({ adopterId: 'new', additions: { contacts: [], address: null, household: [] }, rating: 6, summary: null }).success).toBe(false);
        expect(completeInputSchema.safeParse({ adopterId: 'new', additions: { contacts: [], address: null, household: [] }, rating: null, summary: 'ok' }).success).toBe(true);
    });
});
