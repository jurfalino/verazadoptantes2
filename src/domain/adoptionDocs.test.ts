import { describe, it, expect } from 'vitest';
import {
    FORM_STEP_IDS, LOCKED_FORM_STEPS, TOGGLEABLE_FORM_STEPS, FORM_STEP_GROUPS,
    sanitizeHiddenSteps, sanitizeShownSteps, parseDocsSource, serializeDocsSource, effectiveDocsSource, pinSourceBeforeMembershipChange, sourceAfterLosingStoredGroup, keepSourceAcrossMembershipChange, shouldAskDocsSource,
    resolveDocsOwner, normalizeRichDoc, normalizeSections, isStandardSections,
    canonicalSectionsJson, planContractSave, deriveSpecialNeeds, richDocSchema,
    contractSectionsSchema, isContractVersionOwnedBy, parseStoredHiddenSteps, isPhoneRequired, FORM_OPTION_TOKENS,
    isQuestionOn, toggleQuestion, questionWay, setQuestionWay, settingKeyQuestion, settingChange, photosOn, photosRequired, isAskedOpen, answerStyle, setAnswerStyle, OPEN_CAPABLE_STEPS, FOLLOW_UP_HOSTS, DEFAULT_OFF_FORM_STEPS, type RichDoc,
} from './adoptionDocs';

const doc = (...texts: string[]): RichDoc => ({ type: 'doc', content: texts.map(t => ({ type: 'paragraph', content: [{ text: t }] })) });

describe('form steps', () => {
    it('locks terms + identity', () => {
        expect(LOCKED_FORM_STEPS).toEqual(['legal', 'identity-name', 'identity-email', 'identity-phone', 'identity-address']);
        expect(TOGGLEABLE_FORM_STEPS.length).toBe(62); // 35 rows + 11 tokens + 16 open-text tokens
    });
    it('groups cover every toggleable step exactly once', () => {
        const all = (FORM_STEP_GROUPS.flatMap(g => g.steps) as string[]).filter(s => !(LOCKED_FORM_STEPS as readonly string[]).includes(s));
        expect([...all, ...FORM_OPTION_TOKENS].sort()).toEqual([...TOGGLEABLE_FORM_STEPS].sort());
    });
    it('phone is required unless the token is present', () => {
        expect(isPhoneRequired([])).toBe(true);
        expect(isPhoneRequired(['phone-optional'])).toBe(false);
    });
    it('the sanitiser keeps the option token, after the steps, and drops unknown ones', () => {
        expect(sanitizeHiddenSteps(['phone-optional', 'intent', 'bogus'])).toEqual(['intent', 'phone-optional']);
        expect(parseStoredHiddenSteps('["phone-optional"]').steps).toEqual(['phone-optional']);
    });
    it('a shown-steps list is questions only — never the option token', () => {
        expect(sanitizeShownSteps(['intent', 'phone-optional'])).toEqual(['intent']);
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
        expect(serializeDocsSource({ type: 'self' })).toBe('self'); // explicit «Los míos» ≠ never chosen (null)
        expect(parseDocsSource(serializeDocsSource({ type: 'self' }))).toEqual({ type: 'self' });
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

describe('isContractVersionOwnedBy', () => {
    const userVersion = { ownerType: 'user', ownerId: 'rescuer@example.com' };
    const orgVersion = { ownerType: 'org', ownerId: 'org-1' };
    it('user version: owned by the same (normalized) email', () => {
        expect(isContractVersionOwnedBy(userVersion, '  Rescuer@Example.COM ', [])).toBe(true);
        expect(isContractVersionOwnedBy(userVersion, 'someone@example.com', [])).toBe(false);
    });
    it('org version: owned when the animal owner is a member of that org', () => {
        expect(isContractVersionOwnedBy(orgVersion, 'rescuer@example.com', ['org-1'])).toBe(true);
        expect(isContractVersionOwnedBy(orgVersion, 'rescuer@example.com', ['org-2'])).toBe(false);
        expect(isContractVersionOwnedBy(orgVersion, 'rescuer@example.com', [])).toBe(false);
    });
    it('an org version is never matched by the owner email itself', () => {
        expect(isContractVersionOwnedBy({ ownerType: 'org', ownerId: 'rescuer@example.com' }, 'rescuer@example.com', [])).toBe(false);
    });
    it('missing / anonymous owner, or unknown owner type → not owned', () => {
        expect(isContractVersionOwnedBy(userVersion, null, [])).toBe(false);
        expect(isContractVersionOwnedBy(userVersion, undefined, [])).toBe(false);
        expect(isContractVersionOwnedBy(userVersion, '', [])).toBe(false);
        expect(isContractVersionOwnedBy({ ownerType: 'user', ownerId: 'anonymous' }, 'anonymous', [])).toBe(false);
        expect(isContractVersionOwnedBy({ ownerType: 'team', ownerId: 'org-1' }, 'rescuer@example.com', ['org-1'])).toBe(false);
    });
});

describe('parseStoredHiddenSteps', () => {
    it('null / empty → no steps, not malformed', () => {
        expect(parseStoredHiddenSteps(null)).toEqual({ steps: [], malformed: false });
        expect(parseStoredHiddenSteps(undefined)).toEqual({ steps: [], malformed: false });
        expect(parseStoredHiddenSteps('')).toEqual({ steps: [], malformed: false });
    });
    it('valid JSON is sanitized (locked + unknown dropped, form order)', () => {
        expect(parseStoredHiddenSteps('["selfie","legal","bogus","children"]')).toEqual({ steps: ['children', 'selfie'], malformed: false });
    });
    it('malformed JSON → no steps, flagged malformed (never throws)', () => {
        expect(parseStoredHiddenSteps('{not json')).toEqual({ steps: [], malformed: true });
    });
    it('valid JSON of the wrong shape → no steps, flagged malformed', () => {
        expect(parseStoredHiddenSteps('{"a":1}')).toEqual({ steps: [], malformed: true });
        expect(parseStoredHiddenSteps('"selfie"')).toEqual({ steps: [], malformed: true });
    });
});

import { householdQuestion, isStepAsked } from './adoptionDocs';
describe('household question choice', () => {
    it('reads the token', () => {
        expect(householdQuestion([])).toBe('children');
        expect(householdQuestion(['household'])).toBe('people');
    });
    it('isStepAsked mirrors the public form', () => {
        expect(isStepAsked('children', [])).toBe(true);
        expect(isStepAsked('household', [])).toBe(false);
        expect(isStepAsked('household', ['household'])).toBe(true);
        expect(isStepAsked('children', ['household'])).toBe(false);
        expect(isStepAsked('household', ['children', 'household'])).toBe(false);
        expect(isStepAsked('intent', ['intent'])).toBe(false);
        expect(isStepAsked('legal', ['legal'])).toBe(true);
    });
});

import { DERIVED_FORM_STEPS } from './adoptionDocs';
describe('derived gift step', () => {
    it('is a form step but never toggleable, grouped or storable', () => {
        expect(FORM_STEP_IDS).toContain('giftRecipient');
        expect(DERIVED_FORM_STEPS).toEqual(['giftRecipient']);
        expect(TOGGLEABLE_FORM_STEPS).not.toContain('giftRecipient');
        expect(FORM_STEP_GROUPS.flatMap(g => g.steps as readonly string[])).not.toContain('giftRecipient');
        expect(sanitizeHiddenSteps(['giftRecipient', 'intent'])).toEqual(['intent']);
    });
});

describe('release 1 — new questions (spec 2026-10-14)', () => {
    it('lists the questions in form order', () => {
        expect(FORM_STEP_IDS).toEqual([
            'legal', 'species', 'lifeStage', 'specialNeeds', 'intent', 'carer', 'giftRecipient', 'children', 'allergy',
            'existingPets', 'petsCare', 'housingType', 'rental', 'household', 'hasOutdoor', 'isSafe', 'catOutdoor',
            'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'petExperience', 'lastAnimal', 'gaveAway',
            'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingPlans', 'movingIfNoPets', 'vacationPlan',
            'returnReasons', 'adaptPlan', 'visitConsent', 'identity-name', 'identity-email', 'identity-phone',
            'identity-address', 'social', 'ageRange', 'vetReference', 'motivation', 'geo', 'selfie',
        ]);
    });
    it('on by default unless listed as default-off', () => {
        expect(isQuestionOn('gaveAway', [])).toBe(true);
        expect(isQuestionOn('catOutdoor', [])).toBe(false);
        expect(isQuestionOn('catOutdoor', ['on:catOutdoor'])).toBe(true);
        expect(isQuestionOn('gaveAway', ['gaveAway'])).toBe(false);
    });
    it('toggling writes the right key and keeps order', () => {
        expect(toggleQuestion('catOutdoor', ['selfie'])).toEqual(['selfie', 'on:catOutdoor']);
        expect(toggleQuestion('catOutdoor', ['on:catOutdoor'])).toEqual([]);
        expect(toggleQuestion('gaveAway', [])).toEqual(['gaveAway']);
    });
    it('previous animal and moving: new wording by default, old on request, one switch hides both', () => {
        expect(isStepAsked('lastAnimal', [])).toBe(true);
        expect(isStepAsked('petExperience', [])).toBe(false);
        const old = setQuestionWay('petExperience', 'old', []);
        expect(old).toEqual(['way:petExperience:old']);
        expect(questionWay('petExperience', old)).toBe('old');
        expect(isStepAsked('petExperience', old)).toBe(true);
        expect(isStepAsked('lastAnimal', old)).toBe(false);
        // A row hidden before this release hides the topic in both wordings.
        expect(isStepAsked('lastAnimal', ['petExperience'])).toBe(false);
        expect(isStepAsked('petExperience', ['petExperience', 'way:petExperience:old'])).toBe(false);
        expect(isStepAsked('movingIfNoPets', [])).toBe(true);
        expect(isStepAsked('movingPlans', ['way:movingPlans:old'])).toBe(true);
    });
    it('a row saved before this release still gets the new on-by-default questions', () => {
        for (const id of ['carer', 'allergy', 'petsCare', 'rental', 'sleepPlace', 'gaveAway', 'sterilizeHow', 'returnReasons', 'adaptPlan', 'visitConsent']) {
            expect(isStepAsked(id, ['selfie']), id).toBe(true);
        }
        for (const id of DEFAULT_OFF_FORM_STEPS) expect(isStepAsked(id, ['selfie']), id).toBe(false);
    });
    it('the sanitiser keeps the new tokens and drops unknown ones', () => {
        expect(sanitizeHiddenSteps(['on:catOutdoor', 'on:nope', 'way:movingPlans:old', 'way:x:old', 'gaveAway']))
            .toEqual(['gaveAway', 'on:catOutdoor', 'way:movingPlans:old']);
    });
    it('variants are not rows of their own', () => {
        expect(TOGGLEABLE_FORM_STEPS).not.toContain('lastAnimal');
        expect(TOGGLEABLE_FORM_STEPS).not.toContain('movingIfNoPets');
        expect(TOGGLEABLE_FORM_STEPS).toContain('on:social');
    });
    it('a setting key names the question it belongs to', () => {
        expect(settingKeyQuestion('on:catOutdoor')).toBe('catOutdoor');
        expect(settingKeyQuestion('way:petExperience:old')).toBe('petExperience');
        expect(settingKeyQuestion('gaveAway')).toBe('gaveAway');
    });
});

describe('what a teammate\'s change to a setting means (review fix 2026-10-14)', () => {
    // `present` = the stored key exists ('hidden' in stepStates terms).
    it('a plain question id present means it is no longer asked', () => {
        expect(settingChange('gaveAway', true)).toBe('notAsked');
        expect(settingChange('gaveAway', false)).toBe('asked');
    });
    it('an on: token present means the question IS asked', () => {
        expect(settingChange('on:catOutdoor', true)).toBe('asked');
        expect(settingChange('on:catOutdoor', false)).toBe('notAsked');
    });
    it('a way: token only changes the wording', () => {
        expect(settingChange('way:petExperience:old', true)).toBe('oldWording');
        expect(settingChange('way:petExperience:old', false)).toBe('newWording');
    });
    it('the phone option only changes whether it must be answered', () => {
        expect(settingChange('phone-optional', true)).toBe('phoneOptional');
        expect(settingChange('phone-optional', false)).toBe('phoneRequired');
    });
});

describe('photos (release 2)', () => {
    it('are off by default; required only counts when they are on', () => {
        expect(photosOn([])).toBe(false);
        expect(photosOn(['on:photos'])).toBe(true);
        expect(photosRequired(['photos-required'])).toBe(false);
        expect(photosRequired(['on:photos', 'photos-required'])).toBe(true);
    });
    it('the sanitiser keeps both tokens', () => {
        expect(sanitizeHiddenSteps(['photos-required', 'on:photos', 'x'])).toEqual(['on:photos', 'photos-required']);
    });
    it('a teammate turning photos on / making them required is described the right way round', () => {
        expect(settingChange('on:photos', true)).toBe('asked');
        expect(settingChange('photos-required', true)).toBe('photosRequired');
        expect(settingChange('photos-required', false)).toBe('photosOptional');
    });
});

describe('open vs closed per question (release 3)', () => {
    it('covers the questions spec §6.0 lists — never consents, facts or what the form branches on', () => {
        expect([...OPEN_CAPABLE_STEPS].sort()).toEqual(['adaptPlan', 'carer', 'catOutdoor', 'dogTied', 'dogWalks', 'gaveAway', 'hoursAlone', 'isSafe', 'movingPlans', 'petExperience', 'petsCare', 'rental', 'returnReasons', 'sleepPlace', 'sterilizeHow', 'vacationPlan']);
        for (const id of ['visitConsent', 'allergy', 'species', 'intent', 'housingType', 'existingPets', 'hasOutdoor']) expect(OPEN_CAPABLE_STEPS as readonly string[]).not.toContain(id);
    });
    it('a question a follow-up depends on is never free text (its follow-up would never show)', () => {
        for (const hosts of Object.values(FOLLOW_UP_HOSTS)) {
            for (const host of hosts) expect(OPEN_CAPABLE_STEPS as readonly string[]).not.toContain(host);
        }
        expect(FORM_OPTION_TOKENS as readonly string[]).not.toContain('way:willingToSterilize:open');
    });
    it('closed by default; open on request; a variant follows its row', () => {
        expect(answerStyle('rental', [])).toBe('closed');
        const open = setAnswerStyle('rental', 'open', []);
        expect(open).toEqual(['way:rental:open']);
        expect(isAskedOpen('rental', open)).toBe(true);
        expect(setAnswerStyle('rental', 'closed', open)).toEqual([]);
        expect(isAskedOpen('lastAnimal', ['way:petExperience:open'])).toBe(true);
    });
    it('previous animal / moving: new, old or open — one at a time', () => {
        const old = setQuestionWay('petExperience', 'old', []);
        const open = setQuestionWay('petExperience', 'open', old);
        expect(open).toEqual(['way:petExperience:open']);
        expect(questionWay('petExperience', open)).toBe('open');
        expect(isStepAsked('lastAnimal', open)).toBe(true);
        expect(setQuestionWay('petExperience', 'old', open)).toEqual(['way:petExperience:old']);
    });
    it('the sanitiser keeps open tokens for capable questions only', () => {
        expect(sanitizeHiddenSteps(['way:rental:open', 'way:visitConsent:open'])).toEqual(['way:rental:open']);
    });
    it('a teammate switching a question to free text is described as such', () => {
        expect(settingChange('way:rental:open', true)).toBe('openWording');
        expect(settingChange('way:rental:open', false)).toBe('closedWording');
    });
});

describe('effectiveDocsSource', () => {
    it('never-chosen + exactly one group + default on → that group', () => {
        expect(effectiveDocsSource(null, ['A'], true)).toEqual({ type: 'org', orgId: 'A' });
        expect(effectiveDocsSource(undefined, ['A'], true)).toEqual({ type: 'org', orgId: 'A' });
        expect(effectiveDocsSource(null, ['A'], false)).toEqual({ type: 'self' });
        expect(effectiveDocsSource(null, ['A', 'B'], true)).toEqual({ type: 'self' });
        expect(effectiveDocsSource(null, [], true)).toEqual({ type: 'self' });
    });
    it('an explicit choice always wins', () => {
        expect(effectiveDocsSource('self', ['A'], true)).toEqual({ type: 'self' });
        expect(effectiveDocsSource('org:B', ['A', 'B'], true)).toEqual({ type: 'org', orgId: 'B' });
    });
});

describe('pinSourceBeforeMembershipChange («Al cambiar de grupos»: never switch silently)', () => {
    const pin = pinSourceBeforeMembershipChange;
    it('join / create 1 → 2: the sole group is kept', () => {
        expect(pin(null, ['X'], ['X', 'Y'], true)).toBe('org:X');
        expect(pin(undefined, ['X'], ['X', 'NEW'], true)).toBe('org:X');
    });
    it('leaving (or being removed from) the unused group 2 → 1: «Los míos» is kept', () => {
        expect(pin(null, ['X', 'Y'], ['X'], true)).toBe('self');
    });
    it('leaving the used sole group 1 → 0: nothing to keep', () => {
        expect(pin(null, ['X'], [], true)).toBeNull();
    });
    it('her first group 0 → 1: the default is how a new member starts', () => {
        expect(pin(null, [], ['Y'], true)).toBeNull();
    });
    it('no switch → nothing: 2 → 3, 3 → 2, 0 → 0', () => {
        expect(pin(null, ['X', 'Y'], ['X', 'Y', 'Z'], true)).toBeNull();
        expect(pin(null, ['X', 'Y', 'Z'], ['X', 'Y'], true)).toBeNull();
        expect(pin(null, [], [], true)).toBeNull();
    });
    it('an explicit source is never touched', () => {
        for (const raw of ['self', 'org:X', 'org:Y']) {
            expect(pin(raw, ['X'], ['X', 'Y'], true)).toBeNull();
            expect(pin(raw, ['X', 'Y'], ['X'], true)).toBeNull();
        }
    });
    it('branding off → no sole-group default → nothing', () => {
        expect(pin(null, ['X'], ['X', 'Y'], false)).toBeNull();
        expect(pin(null, ['X', 'Y'], ['X'], false)).toBeNull();
    });
    it('what it stores is what was in effect, and keeps it in effect after the change', () => {
        const cases: Array<[string[], string[]]> = [[['X'], ['X', 'Y']], [['X', 'Y'], ['X']], [['X', 'Y'], ['Y']]];
        for (const [before, after] of cases) {
            const pinned = pin(null, before, after, true)!;
            expect(parseDocsSource(pinned)).toEqual(effectiveDocsSource(null, before, true));
            expect(effectiveDocsSource(pinned, after, true)).toEqual(effectiveDocsSource(null, before, true));
        }
    });
});

describe('sourceAfterLosingStoredGroup (R18: a left group never comes back silently)', () => {
    it('leaving / removed from / deletion of the stored group → «Los míos»', () => {
        expect(sourceAfterLosingStoredGroup('org:X', ['X', 'Y'], ['Y'])).toBe('self');
        expect(sourceAfterLosingStoredGroup('org:X', ['X'], [])).toBe('self');
    });
    it('any other change leaves it alone', () => {
        expect(sourceAfterLosingStoredGroup('org:X', ['X', 'Y'], ['X'])).toBeNull();      // left another group
        expect(sourceAfterLosingStoredGroup('org:X', ['X'], ['X', 'Y'])).toBeNull();      // joined one
        expect(sourceAfterLosingStoredGroup('org:X', ['Y'], [])).toBeNull();              // already stale: not this change
        expect(sourceAfterLosingStoredGroup('self', ['X'], [])).toBeNull();
        expect(sourceAfterLosingStoredGroup(null, ['X'], [])).toBeNull();
    });
});

describe('keepSourceAcrossMembershipChange', () => {
    it('NULL → pin (requires still NULL); explicit lost group → self (requires still that group)', () => {
        expect(keepSourceAcrossMembershipChange(null, ['X'], ['X', 'Y'], true)).toEqual({ expected: null, value: 'org:X' });
        expect(keepSourceAcrossMembershipChange(null, ['X', 'Y'], ['X'], true)).toEqual({ expected: null, value: 'self' });
        expect(keepSourceAcrossMembershipChange('org:X', ['X', 'Y'], ['Y'], true)).toEqual({ expected: 'org:X', value: 'self' });
        expect(keepSourceAcrossMembershipChange('org:X', ['X', 'Y'], ['Y'], false)).toEqual({ expected: 'org:X', value: 'self' });
    });
    it('nothing otherwise', () => {
        expect(keepSourceAcrossMembershipChange('self', ['X'], ['X', 'Y'], true)).toBeNull();
        expect(keepSourceAcrossMembershipChange('org:X', ['X'], ['X', 'Y'], true)).toBeNull();
        expect(keepSourceAcrossMembershipChange(null, [], ['Y'], true)).toBeNull();
    });
});

describe('shouldAskDocsSource («Al cambiar de grupos»)', () => {
    const on = { brandingOn: true, customDocsOn: true };
    const groupA = { type: 'org' as const, orgId: 'A' };
    it('join / create ending in ≥ 2 groups → ask', () => {
        expect(shouldAskDocsSource({ kind: 'join', orgCountAfter: 2 }, on)).toBe(true);
        expect(shouldAskDocsSource({ kind: 'create', orgCountAfter: 2 }, on)).toBe(true);
        expect(shouldAskDocsSource({ kind: 'join', orgCountAfter: 5 }, on)).toBe(true);
    });
    it('join / create ending in 1 group → no ask', () => {
        expect(shouldAskDocsSource({ kind: 'join', orgCountAfter: 1 }, on)).toBe(false);
        expect(shouldAskDocsSource({ kind: 'create', orgCountAfter: 1 }, on)).toBe(false);
    });
    it('leaving the group her links used, with ≥ 1 left → ask', () => {
        expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 1, leftOrgId: 'A', effectiveBefore: groupA }, on)).toBe(true);
        expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 3, leftOrgId: 'A', effectiveBefore: groupA }, on)).toBe(true);
    });
    it('leaving the used group with no group left → no ask', () => {
        expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 0, leftOrgId: 'A', effectiveBefore: groupA }, on)).toBe(false);
    });
    it('leaving another group → no ask', () => {
        expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 1, leftOrgId: 'B', effectiveBefore: groupA }, on)).toBe(false);
        expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 1, leftOrgId: 'B', effectiveBefore: { type: 'self' } }, on)).toBe(false);
    });
    it('either flag off → never ask', () => {
        for (const flags of [{ brandingOn: false, customDocsOn: true }, { brandingOn: true, customDocsOn: false }, { brandingOn: false, customDocsOn: false }]) {
            expect(shouldAskDocsSource({ kind: 'join', orgCountAfter: 2 }, flags)).toBe(false);
            expect(shouldAskDocsSource({ kind: 'create', orgCountAfter: 3 }, flags)).toBe(false);
            expect(shouldAskDocsSource({ kind: 'leave', orgCountAfter: 1, leftOrgId: 'A', effectiveBefore: groupA }, flags)).toBe(false);
        }
    });
});
