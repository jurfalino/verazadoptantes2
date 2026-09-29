import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FORM_STEP_IDS, applyHiddenSteps, restoreStepIndex, stripHiddenAnswers, buildSubmitBody, draftKey, resolveDraft, isValidCustomContract, contractVersionLabel, customSectionFor, STANDARD_CONTRACT_VERSION, fnv1a, type CustomContract, type RichDoc } from './adoptionDocs'

const schema = FORM_STEP_IDS.map(id => ({ id }))

describe('applyHiddenSteps', () => {
    it('no config → identical schema (same reference)', () => {
        expect(applyHiddenSteps(schema, null)).toBe(schema)
        expect(applyHiddenSteps(schema, [])).toBe(schema)
    })
    it('hides toggleable steps, never locked ones', () => {
        const out = applyHiddenSteps(schema, ['children', 'legal', 'identity-email', 'selfie'])
        expect(out.map(s => s.id)).not.toContain('children')
        expect(out.map(s => s.id)).not.toContain('selfie')
        expect(out.map(s => s.id)).toContain('legal')
        expect(out.map(s => s.id)).toContain('identity-email')
    })
})

describe('restoreStepIndex', () => {
    const shortSchema = schema.filter(s => !['children', 'existingPets'].includes(s.id))
    it('restores by id', () => expect(restoreStepIndex(shortSchema, { answers: {}, stepId: 'hoursAlone' }, FORM_STEP_IDS)).toBe(shortSchema.findIndex(s => s.id === 'hoursAlone')))
    it('hidden stepId → next visible step', () => expect(restoreStepIndex(shortSchema, { answers: {}, stepId: 'children' }, FORM_STEP_IDS)).toBe(shortSchema.findIndex(s => s.id === 'housingType')))
    it('legacy numeric draft → start', () => expect(restoreStepIndex(shortSchema, { answers: { legal: true }, step: 14 }, FORM_STEP_IDS)).toBe(0))
    it('stepId past the end clamps', () => expect(restoreStepIndex([{ id: 'legal' }], { answers: {}, stepId: 'selfie' }, FORM_STEP_IDS)).toBe(0))
})

describe('drafts and answers', () => {
    it('draft key is scoped per rescuer and animal', () => {
        expect(draftKey('u1', null)).toBe('petshield_draft:u1:-')
        expect(draftKey('u1', 'a1')).toBe('petshield_draft:u1:a1')
        expect(draftKey(null, null)).toBe('petshield_draft:-:-')
    })
    it('strips answers of hidden steps, with their companion keys', () => {
        expect(stripHiddenAnswers({ species: 'other', speciesOther: 'x', geo: 'yes', latitude: '1', longitude: '2', name: 'A' }, ['species', 'geo']))
            .toEqual({ name: 'A' })
    })
})

describe('resolveDraft', () => {
    it('neither key present → null', () => {
        expect(resolveDraft(null, null)).toBeNull()
    })
    it('scoped key wins and legacy is left untouched (caller does not need to read it)', () => {
        const scoped = JSON.stringify({ answers: { name: 'A' }, stepId: 'hoursAlone' })
        const legacy = JSON.stringify({ answers: { name: 'STALE' }, step: 3 })
        expect(resolveDraft(scoped, legacy)).toEqual({ draft: { answers: { name: 'A' }, stepId: 'hoursAlone' }, migrated: false })
    })
    it('legacy only → answers kept, no stepId (index becomes 0 via restoreStepIndex), migrated: true', () => {
        const legacy = JSON.stringify({ answers: { name: 'A' }, step: 14 })
        const resolved = resolveDraft(null, legacy)
        expect(resolved?.migrated).toBe(true)
        expect(resolved?.draft).toEqual({ answers: { name: 'A' } })
        expect(resolved && restoreStepIndex(schema, resolved.draft, FORM_STEP_IDS)).toBe(0)
    })
    it('legacy with no answers → empty object, still migrates', () => {
        expect(resolveDraft(null, JSON.stringify({ step: 2 }))).toEqual({ draft: { answers: {} }, migrated: true })
    })
    it('malformed JSON throws (caller wraps in try/catch)', () => {
        expect(() => resolveDraft('{not json', null)).toThrow()
        expect(() => resolveDraft(null, '{not json')).toThrow()
    })
})

describe('buildSubmitBody', () => {
    const shortSchema = schema.filter(s => !['children', 'existingPets'].includes(s.id))
    it('no customization → answers pass through unchanged, plus shownSteps', () => {
        const answers = { name: 'A', email: 'a@a.com' }
        expect(buildSubmitBody(answers, null, null, schema)).toEqual({
            ...answers,
            shownSteps: schema.map(s => s.id),
        })
    })
    it('omits animalId when absent, includes it when present', () => {
        expect(buildSubmitBody({ name: 'A' }, null, null, schema)).not.toHaveProperty('animalId')
        expect(buildSubmitBody({ name: 'A' }, null, undefined, schema)).not.toHaveProperty('animalId')
        expect(buildSubmitBody({ name: 'A' }, null, 'animal-1', schema)).toMatchObject({ animalId: 'animal-1' })
    })
    it('strips hidden-step answers and lists only the shown steps', () => {
        const answers = { children: '2', name: 'A' }
        const out = buildSubmitBody(answers, ['children'], null, shortSchema)
        expect(out).toEqual({ name: 'A', shownSteps: shortSchema.map(s => s.id) })
    })
    it('null hiddenSteps behaves like an empty array', () => {
        const answers = { name: 'A' }
        expect(buildSubmitBody(answers, null, null, schema)).toEqual(buildSubmitBody(answers, [], null, schema))
    })
})

describe('custom contract', () => {
    it('validates shape', () => {
        expect(isValidCustomContract(null)).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '5': { type: 'doc', content: [] } } })).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '2': { type: 'doc', content: [] } } })).toBe(true)
    })
    it('accepts a full well-formed document', () => {
        expect(isValidCustomContract({
            versionId: 'v',
            sections: {
                '2': { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'a' }, { text: 'b', marks: ['bold', 'italic', 'underline'] }] }] },
                '3': { type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'uno' }], []] }] },
                '4': { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
            },
        })).toBe(true)
    })
    describe('rejects deep invalid shapes', () => {
        const withDoc = (doc: unknown) => ({ versionId: 'v', sections: { '2': doc } })
        const withBlocks = (blocks: unknown[]) => withDoc({ type: 'doc', content: blocks })
        const cases: Array<[string, unknown]> = [
            ['empty versionId', { versionId: '', sections: {} }],
            ['sections is an array', { versionId: 'v', sections: [] }],
            ['doc with wrong type', withDoc({ type: 'para', content: [] })],
            ['doc content not an array', withDoc({ type: 'doc', content: 'x' })],
            ['unknown block type', withBlocks([{ type: 'heading', content: [{ text: 'x' }] }])],
            ['block is not an object', withBlocks(['x'])],
            ['paragraph content not an array', withBlocks([{ type: 'paragraph', content: 'x' }])],
            ['paragraph missing content', withBlocks([{ type: 'paragraph' }])],
            ['inline text not a string', withBlocks([{ type: 'paragraph', content: [{ text: 5 }] }])],
            ['inline missing text', withBlocks([{ type: 'paragraph', content: [{ marks: ['bold'] }] }])],
            ['inline is null', withBlocks([{ type: 'paragraph', content: [null] }])],
            ['unknown mark', withBlocks([{ type: 'paragraph', content: [{ text: 'x', marks: ['strike'] }] }])],
            ['marks not an array', withBlocks([{ type: 'paragraph', content: [{ text: 'x', marks: 'bold' }] }])],
            ['bulletList items not an array', withBlocks([{ type: 'bulletList', items: 'x' }])],
            ['bulletList item not an array', withBlocks([{ type: 'bulletList', items: [{ text: 'x' }] }])],
            ['bulletList inline invalid', withBlocks([{ type: 'bulletList', items: [[{ text: 1 }]] }])],
        ]
        for (const [name, value] of cases) {
            it(name, () => expect(isValidCustomContract(value)).toBe(false))
        }
    })
    it('labels versions — a custom contract also carries the standard code', () => {
        expect(contractVersionLabel({ versionId: 'abcdef1234567', sections: {} })).toBe(`v:abcdef12 · std-${STANDARD_CONTRACT_VERSION}`)
        expect(contractVersionLabel(null)).toBe(`v:std-${STANDARD_CONTRACT_VERSION}`)
    })
    it('fnv1a is 8 hex chars and stable', () => {
        expect(fnv1a('hola')).toMatch(/^[0-9a-f]{8}$/)
        expect(fnv1a('hola')).toBe(fnv1a('hola'))
    })
    it('STANDARD_CONTRACT_VERSION is pinned — bump deliberately when the standard text changes', () => {
        expect(STANDARD_CONTRACT_VERSION).toBe('582a1a83')
    })
})

describe('customSectionFor', () => {
    const doc2: RichDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Custom 2' }] }] }
    const doc4: RichDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Custom 4' }] }] }
    const custom: CustomContract = { versionId: 'v1', sections: { '2': doc2, '4': doc4 } }

    it('no custom contract → undefined for any index', () => {
        expect(customSectionFor(null, 0)).toBeUndefined()
        expect(customSectionFor(undefined, 1)).toBeUndefined()
    })
    it('maps si 0/1/2 to section keys 2/3/4', () => {
        expect(customSectionFor(custom, 0)).toBe(doc2)
        expect(customSectionFor(custom, 1)).toBeUndefined() // section '3' not customized
        expect(customSectionFor(custom, 2)).toBe(doc4)
    })
    it('index ≥ 3 (section 5+) is never customizable', () => {
        expect(customSectionFor(custom, 3)).toBeUndefined()
        expect(customSectionFor(custom, 4)).toBeUndefined()
    })
    it('negative index → undefined', () => {
        expect(customSectionFor(custom, -1)).toBeUndefined()
    })
})

describe('PetShieldForm.tsx characterization', () => {
    it('DEFAULT_SCHEMA step ids equal FORM_STEP_IDS, in order', () => {
        const src = readFileSync(new URL('../PetShieldForm.tsx', import.meta.url), 'utf8')
        const start = src.indexOf('const DEFAULT_SCHEMA')
        const end = src.indexOf('], [t])', start)
        const slice = src.slice(start, end)
        const ids = [...slice.matchAll(/\bid: '([^']+)'/g)].map(m => m[1])
        expect(ids).toEqual([...FORM_STEP_IDS])
    })
})
