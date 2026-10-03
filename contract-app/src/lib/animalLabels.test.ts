import { describe, it, expect } from 'vitest'
import { speciesLabel, sexLabel, isFemale, ageLabel, ageLabelMs, type TFn } from './animalLabels'

// The catalog is not under test here — a pass-through `t` keeps the assertions
// about NORMALISATION, which is the whole job of these helpers: the same animal
// can carry `perro` or `dog` depending on how it was created, and both public
// pages have to render it the same way.
const t: TFn = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key)

describe('speciesLabel', () => {
    it('maps both vocabularies to one key', () => {
        expect(speciesLabel('perro', t)).toBe('animal.species_dog')
        expect(speciesLabel('dog', t)).toBe('animal.species_dog')
        expect(speciesLabel('Gato', t)).toBe('animal.species_cat')
        expect(speciesLabel('CONEJO', t)).toBe('animal.species_rabbit')
    })

    it('passes an unknown species through rather than dropping it', () => {
        expect(speciesLabel('hurón', t)).toBe('hurón')
    })

    it('renders nothing when there is no species', () => {
        expect(speciesLabel(null, t)).toBe('')
    })
})

describe('sexLabel / isFemale', () => {
    it('maps both vocabularies', () => {
        expect(sexLabel('hembra', t)).toBe('animal.sex_female')
        expect(sexLabel('FEMALE', t)).toBe('animal.sex_female')
        expect(sexLabel('macho', t)).toBe('animal.sex_male')
        expect(sexLabel('male', t)).toBe('animal.sex_male')
    })

    it('drives the gendered castration wording', () => {
        expect(isFemale('Hembra')).toBe(true)
        expect(isFemale('female')).toBe(true)
        expect(isFemale('macho')).toBe(false)
        // Unknown sex is not female — the caller falls back to masculine, which
        // is the Spanish default, rather than guessing.
        expect(isFemale(null)).toBe(false)
    })
})

describe('ageLabel', () => {
    const SEC = 1
    const now = () => Date.now() / 1000

    it('counts months below a year and years above', () => {
        expect(ageLabel(now() - 90 * 24 * 3600 * SEC, null, t)).toBe('animal.age_months:{"n":3}')
        expect(ageLabel(now() - 2.1 * 365.25 * 24 * 3600 * SEC, null, t)).toBe('animal.age_years:{"n":2}')
    })

    it('uses the singular at exactly one', () => {
        expect(ageLabel(now() - 30 * 24 * 3600 * SEC, null, t)).toBe('animal.age_month:{"n":1}')
        expect(ageLabel(now() - 365.25 * 24 * 3600 * SEC, null, t)).toBe('animal.age_year:{"n":1}')
    })

    it('never says "0 months" for a newborn', () => {
        expect(ageLabel(now() - 2 * 24 * 3600 * SEC, null, t)).toBe('animal.age_month:{"n":1}')
    })

    it('falls back to the free-text age when no birth date was recorded', () => {
        expect(ageLabel(null, 'cachorro', t)).toBe('cachorro')
        expect(ageLabel(null, null, t)).toBe('')
    })

    it('accepts milliseconds too — the health API serves ms, the showcase seconds', () => {
        const ms = Date.now() - 90 * 24 * 3600 * 1000
        expect(ageLabelMs(ms, null, t)).toBe('animal.age_months:{"n":3}')
        expect(ageLabelMs(null, 'cachorro', t)).toBe('cachorro')
    })
})
