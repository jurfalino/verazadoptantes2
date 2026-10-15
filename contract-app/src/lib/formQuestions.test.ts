import { describe, it, expect } from 'vitest'
import { effectiveSpecies, followUpVisible, followUpsUnder, stripUnaskedNewAnswers } from './formQuestions'
import { formStepsToAsk, stepsForAnswers, buildSubmitBody, FORM_STEP_IDS } from './adoptionDocs'

const all = FORM_STEP_IDS.map(id => ({ id }))
const ids = (s: { id: string }[]) => s.map(x => x.id)

describe('which questions the public form asks', () => {
    it('custom forms off (null config) = today\'s form: none of the new questions, old wordings', () => {
        const asked = ids(formStepsToAsk(all, null))
        for (const id of ['carer', 'allergy', 'petsCare', 'rental', 'gaveAway', 'lastAnimal', 'movingIfNoPets', 'visitConsent', 'social'])
            expect(asked, id).not.toContain(id)
        expect(asked).toContain('petExperience')
        expect(asked).toContain('movingPlans')
    })
    it('custom forms on, nothing changed: new on-by-default questions, new wordings, default-off ones off', () => {
        const asked = ids(formStepsToAsk(all, []))
        for (const id of ['carer', 'allergy', 'rental', 'gaveAway', 'lastAnimal', 'movingIfNoPets', 'visitConsent']) expect(asked, id).toContain(id)
        for (const id of ['petExperience', 'movingPlans', 'catOutdoor', 'social', 'motivation']) expect(asked, id).not.toContain(id)
    })
    it('a row hidden before this release hides its topic in both wordings', () => {
        const asked = ids(formStepsToAsk(all, ['petExperience']))
        expect(asked).not.toContain('petExperience')
        expect(asked).not.toContain('lastAnimal')
    })
})

describe('species-only questions', () => {
    const cfg = formStepsToAsk(all, ['on:catOutdoor', 'on:dogWalks'])
    it('follow the species answer', () => {
        expect(ids(stepsForAnswers(cfg, { species: 'cat' }))).toContain('catOutdoor')
        expect(ids(stepsForAnswers(cfg, { species: 'cat' }))).not.toContain('dogWalks')
    })
    it('follow the animal when the form is for one (species question skipped)', () => {
        expect(ids(stepsForAnswers(cfg, {}, { animalSpecies: 'dog' }))).toContain('dogWalks')
        expect(effectiveSpecies({}, { animalSpecies: 'Perro' })).toBe(null) // only 'cat' | 'dog' values
    })
    it('unknown species → not asked', () => {
        expect(ids(stepsForAnswers(cfg, {}))).not.toContain('catOutdoor')
        expect(ids(stepsForAnswers(cfg, { species: 'other' }))).not.toContain('dogWalks')
    })
})

describe('follow-ups', () => {
    const cfg = formStepsToAsk(all, [])
    it('live under their host, not as screens of their own', () => {
        const screens = ids(stepsForAnswers(cfg, { intent: 'self' }))
        for (const id of ['carer', 'allergy', 'petsCare', 'sterilizeHow']) expect(screens, id).not.toContain(id)
        expect(followUpsUnder('intent', cfg, { intent: 'self' })).toEqual(['carer'])
        expect(followUpsUnder('intent', cfg, { intent: 'gift' })).toEqual([])
        expect(followUpsUnder('existingPets', cfg, { existingPets: { dogs: 1 } })).toEqual(['petsCare'])
        expect(followUpsUnder('existingPets', cfg, { existingPets: { dogs: 0 } })).toEqual([])
        expect(followUpsUnder('willingToSterilize', cfg, { willingToSterilize: 'yes' })).toEqual(['sterilizeHow'])
        expect(followUpsUnder('children', cfg, {})).toEqual(['allergy'])
    })
    it('become their own screen when no host is asked (allergy, carer)', () => {
        const noHosts = formStepsToAsk(all, ['children', 'intent'])
        const screens = ids(stepsForAnswers(noHosts, {}))
        expect(screens).toContain('allergy')
        expect(screens).toContain('carer')
    })
    it('host visibility rules', () => {
        expect(followUpVisible('carer', { intent: 'self' })).toBe(true)
        expect(followUpVisible('sterilizeHow', { willingToSterilize: 'no' })).toBe(false)
    })
})

describe('answers that were not asked never reach the submission', () => {
    const cfg = formStepsToAsk(all, [])
    it('a follow-up whose host answer changed', () => {
        const out = stripUnaskedNewAnswers({ willingToSterilize: 'no', sterilizeHow: 'vet', existingPets: { dogs: 0 }, petsCare: 'yes', intent: 'gift', carer: 'me' }, cfg, {})
        expect(out).toEqual({ willingToSterilize: 'no', existingPets: { dogs: 0 }, intent: 'gift' })
    })
    it('"¿Por qué?" only with "Sí, regalé un animal"', () => {
        expect(stripUnaskedNewAnswers({ gaveAway: 'no', gaveAwayWhy: 'x' }, cfg, {})).toEqual({ gaveAway: 'no' })
        expect(stripUnaskedNewAnswers({ gaveAway: 'yes', gaveAwayWhy: 'x' }, cfg, {})).toEqual({ gaveAway: 'yes', gaveAwayWhy: 'x' })
    })
    it('species-only answers after the species changed', () => {
        const withCat = formStepsToAsk(all, ['on:catOutdoor'])
        expect(stripUnaskedNewAnswers({ species: 'dog', catOutdoor: 'yes' }, withCat, {})).toEqual({ species: 'dog' })
    })
    it('custom forms off: no new answers at all, even from an old draft', () => {
        const today = formStepsToAsk(all, null)
        const body = buildSubmitBody({ name: 'A', rental: 'own', visitConsent: 'no', instagram: '@a' }, null, null, today, {})
        expect(body).toMatchObject({ name: 'A' })
        expect(body).not.toHaveProperty('rental')
        expect(body).not.toHaveProperty('visitConsent')
        expect(body).not.toHaveProperty('instagram')
    })
})

describe('shownSteps — what the applicant saw', () => {
    it('includes the follow-ups shown under their host, not the hidden ones', () => {
        const cfg = formStepsToAsk(all, [])
        const shown = buildSubmitBody({ intent: 'self', willingToSterilize: 'no', name: 'A' }, [], null, cfg, {}).shownSteps as string[]
        expect(shown).toContain('carer')
        expect(shown).toContain('allergy')
        expect(shown).not.toContain('sterilizeHow')
        expect(shown).not.toContain('petsCare')
        expect(shown).not.toContain('giftRecipient')
    })
})
