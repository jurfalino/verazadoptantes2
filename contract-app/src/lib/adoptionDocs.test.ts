import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FORM_STEP_IDS, applyHiddenSteps, restoreStepIndex, stripHiddenAnswers, draftKey, isValidCustomContract, contractVersionLabel, STANDARD_CONTRACT_VERSION, fnv1a } from './adoptionDocs'

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

describe('custom contract', () => {
    it('validates shape', () => {
        expect(isValidCustomContract(null)).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '5': { type: 'doc', content: [] } } })).toBe(false)
        expect(isValidCustomContract({ versionId: 'v', sections: { '2': { type: 'doc', content: [] } } })).toBe(true)
    })
    it('labels versions', () => {
        expect(contractVersionLabel({ versionId: 'abcdef1234567', sections: {} })).toBe('v:abcdef12')
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
