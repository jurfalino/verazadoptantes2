import { describe, it, expect } from 'vitest';
import {
    FORM_STEP_IDS, LOCKED_FORM_STEPS, TOGGLEABLE_FORM_STEPS, FORM_STEP_GROUPS,
    sanitizeHiddenSteps, sanitizeShownSteps, parseDocsSource, serializeDocsSource,
    resolveDocsOwner, normalizeRichDoc, normalizeSections, isStandardSections,
    canonicalSectionsJson, planContractSave, deriveSpecialNeeds, richDocSchema,
    contractSectionsSchema, type RichDoc,
} from './adoptionDocs';

const doc = (...texts: string[]): RichDoc => ({ type: 'doc', content: texts.map(t => ({ type: 'paragraph', content: [{ text: t }] })) });

describe('form steps', () => {
    it('lists the 23 PetShield steps in form order', () => {
        expect(FORM_STEP_IDS).toEqual([
            'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'children', 'existingPets',
            'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone', 'petExperience', 'willingToSterilize',
            'vetCommitment', 'movingPlans', 'vacationPlan', 'identity-name', 'identity-email',
            'identity-phone', 'identity-address', 'ageRange', 'geo', 'selfie',
        ]);
    });
    it('locks terms + identity', () => {
        expect(LOCKED_FORM_STEPS).toEqual(['legal', 'identity-name', 'identity-email', 'identity-phone', 'identity-address']);
        expect(TOGGLEABLE_FORM_STEPS).toHaveLength(18);
    });
    it('groups cover every toggleable step exactly once', () => {
        const all = (FORM_STEP_GROUPS.flatMap(g => g.steps) as string[]).filter(s => !(LOCKED_FORM_STEPS as readonly string[]).includes(s));
        expect([...all].sort()).toEqual([...TOGGLEABLE_FORM_STEPS].sort());
    });
    it('sanitizeHiddenSteps drops unknown, locked, duplicates and non-strings; keeps form order', () => {
        expect(sanitizeHiddenSteps(['selfie', 'legal', 'nope', 'children', 'selfie', 3])).toEqual(['children', 'selfie']);
        expect(sanitizeHiddenSteps('children')).toEqual([]);
        expect(sanitizeHiddenSteps(null)).toEqual([]);
    });
    it('sanitizeShownSteps keeps known ids (locked included), null when not an array', () => {
        expect(sanitizeShownSteps(['legal', 'x', 'intent'])).toEqual(['legal', 'intent']);
        expect(sanitizeShownSteps(undefined)).toBeNull();
    });
});

describe('docs source', () => {
    it('parses and serializes', () => {
        expect(parseDocsSource(null)).toEqual({ type: 'self' });
        expect(parseDocsSource('self')).toEqual({ type: 'self' });
        expect(parseDocsSource('org:abc')).toEqual({ type: 'org', orgId: 'abc' });
        expect(parseDocsSource('org:')).toEqual({ type: 'self' });
        expect(parseDocsSource('garbage')).toEqual({ type: 'self' });
        expect(serializeDocsSource({ type: 'self' })).toBeNull();
        expect(serializeDocsSource({ type: 'org', orgId: 'abc' })).toBe('org:abc');
    });
    it('resolves to the org only while the user is a member', () => {
        expect(resolveDocsOwner('Ana@X.com ', { type: 'org', orgId: 'o1' }, ['o1'])).toEqual({ ownerType: 'org', ownerId: 'o1' });
        expect(resolveDocsOwner('Ana@X.com', { type: 'org', orgId: 'o1' }, [])).toEqual({ ownerType: 'user', ownerId: 'ana@x.com' });
        expect(resolveDocsOwner('ana@x.com', { type: 'self' }, ['o1'])).toEqual({ ownerType: 'user', ownerId: 'ana@x.com' });
    });
});

describe('rich doc', () => {
    it('normalizes: drops empty runs, empty paragraphs at the edges, empty list items; sorts marks', () => {
        const input: RichDoc = { type: 'doc', content: [
            { type: 'paragraph', content: [] },
            { type: 'paragraph', content: [{ text: '' }, { text: 'Hola', marks: ['underline', 'bold', 'bold'] }] },
            { type: 'bulletList', items: [[{ text: '' }], [{ text: 'uno' }]] },
            { type: 'bulletList', items: [[{ text: '' }]] },
            { type: 'paragraph', content: [{ text: '' }] },
        ] };
        expect(normalizeRichDoc(input)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Hola', marks: ['bold', 'underline'] }] },
            { type: 'bulletList', items: [[{ text: 'uno' }]] },
        ] });
    });
    it('keeps an empty paragraph between two texts (spacing)', () => {
        const n = normalizeRichDoc(doc('a', '', 'b'))!;
        expect(n.content).toHaveLength(3);
    });
    it('returns null for a doc with no text', () => {
        expect(normalizeRichDoc(doc('', '   '))).toBeNull();
    });
    it('schema rejects unknown node types, marks and oversize docs', () => {
        expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'heading', content: [] }] }).success).toBe(false);
        expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x', marks: ['link'] }] }] }).success).toBe(false);
        expect(richDocSchema.safeParse(doc('x'.repeat(8001))).success).toBe(false);
        expect(richDocSchema.safeParse(doc(...Array(201).fill('x'))).success).toBe(false);
        expect(richDocSchema.safeParse(doc('ok')).success).toBe(true);
    });
    it('sections schema only allows keys 2, 3, 4', () => {
        expect(contractSectionsSchema.safeParse({ '5': doc('x') }).success).toBe(false);
        expect(contractSectionsSchema.safeParse({ '2': doc('x') }).success).toBe(true);
    });
    it('normalizeSections drops empty sections; isStandardSections when none remain', () => {
        const s = normalizeSections({ '2': doc('  '), '3': doc('x') });
        expect(Object.keys(s)).toEqual(['3']);
        expect(isStandardSections(normalizeSections({ '2': doc('') }))).toBe(true);
    });
    it('canonical JSON is key-order independent', () => {
        expect(canonicalSectionsJson({ '4': doc('b'), '2': doc('a') })).toBe(canonicalSectionsJson({ '2': doc('a'), '4': doc('b') }));
    });
});

describe('planContractSave', () => {
    it('standard to standard is a no-op', () => expect(planContractSave(null, null)).toBe('noop'));
    it('custom to standard resets', () => expect(planContractSave({ contentHash: 'h1' }, null)).toBe('setStandard'));
    it('same content is a no-op', () => expect(planContractSave({ contentHash: 'h1' }, 'h1')).toBe('noop'));
    it('new content inserts a version', () => {
        expect(planContractSave(null, 'h1')).toBe('insert');
        expect(planContractSave({ contentHash: 'h1' }, 'h2')).toBe('insert');
    });
});

describe('deriveSpecialNeeds', () => {
    it('null when the step was not shown', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true, shownSteps: ['legal'] })).toBeNull();
    });
    it('0/1 when shown', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true, shownSteps: ['specialNeeds'] })).toBe(1);
        expect(deriveSpecialNeeds({ shownSteps: ['specialNeeds'] })).toBe(0);
    });
    it('old client for a specific animal (no shownSteps) never saw the step', () => {
        expect(deriveSpecialNeeds({ animalId: 'a1' })).toBeNull();
    });
    it('old client, generic form: behavior from old code', () => {
        expect(deriveSpecialNeeds({ specialNeeds: true })).toBe(1);
        expect(deriveSpecialNeeds({})).toBe(0);
    });
});
