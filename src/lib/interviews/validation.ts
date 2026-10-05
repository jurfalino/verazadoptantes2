import { z } from 'zod';
import type { Relationship } from '@/lib/householdMembers';

// Mirrors RELATIONSHIPS in src/lib/householdMembers.ts; `satisfies` fails tsc if they drift.
const REL = ['partner', 'child', 'parent', 'sibling', 'other_relative', 'housemate', 'unknown'] as const satisfies readonly Relationship[];

const text = z.string().max(4000);
const short = z.string().max(300);
const contact = z.object({ type: z.enum(['phone', 'email', 'social']), value: short });
const household = z.object({ name: z.string().max(120), relationship: z.enum(REL).nullable() });
const answer = z.object({
    status: z.enum(['answered', 'skipped', 'no_answer']),
    text: text.optional(),
    contacts: z.array(contact).max(20).optional(),
    household: z.array(household).max(30).optional(),
    choice: z.string().max(40).optional(),
    number: z.number().finite().min(0).max(1000).optional(),
});
const questionId = z.string().regex(/^(custom:\d{1,3}|[a-z_]{3,60})$/);

export const prepSchema = z.object({
    name: z.string().trim().min(2).max(200),
    phones: z.array(short).max(10),
    emails: z.array(short).max(10),
    socials: z.array(short).max(10),
    address: z.string().max(500),
});

export const draftPatchSchema = z.object({
    answers: z.record(questionId, answer).refine(r => Object.keys(r).length <= 200, 'too many answers'),
    visited: z.array(questionId).max(300),
    custom: z.array(z.object({ id: z.string().regex(/^custom:\d{1,3}$/), stage: z.enum(['rapport', 'story', 'details']), text: z.string().trim().min(1).max(500) })).max(30),
    leadCandidateId: z.string().max(64).nullable(),
});
export type DraftPatch = z.infer<typeof draftPatchSchema>;

export const completeInputSchema = z.object({
    adopterId: z.string().max(64),
    additions: z.object({
        contacts: z.array(contact).max(30),
        address: z.string().max(500).nullable(),
        household: z.array(household).max(30),
    }),
    rating: z.number().int().min(1).max(5).nullable(),
    summary: z.string().max(2000).nullable(),
});
export type CompleteInput = z.infer<typeof completeInputSchema>;
