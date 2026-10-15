import { describe, it, expect } from 'vitest'
import { adaptStepForGift, giftTitleKey, isGift, stripGiftAnswers, GIFT_UNKNOWN_STEPS, giftRecipientProblem, settleGiftAnswers } from './giftFlow'
import { form } from '../i18n/catalogs/form'

const t = (k: string) => ({ 'form.q_outdoor_title_gift': '¿{n} tiene patio o jardín?', 'form.opt_unknown': 'No sé' } as Record<string, string>)[k] ?? k
const gift = { intent: 'gift', giftRecipient: { relationship: 'child', firstName: 'Laura' } }

describe('gift flow', () => {
    it('only a gift with a recipient is a gift', () => {
        expect(isGift(gift)).toBe(true)
        expect(isGift({ intent: 'self' })).toBe(false)
        expect(isGift({ intent: 'gift' })).toBe(false) // no recipient yet → neutral wording
    })
    it('rewords and adds "No sé" for a gift', () => {
        const step = { id: 'hasOutdoor', type: 'icon-cards', title: '¿Tenés patio o jardín?', options: [{ value: 'yes', label: 'Sí', icon: 'patio' }] }
        const out = adaptStepForGift(step, gift, t)
        expect(out.title).toBe('¿Laura tiene patio o jardín?')
        expect(out.options!.map(o => o.value)).toEqual(['yes', 'unknown'])
        expect(adaptStepForGift(step, { intent: 'self' }, t)).toBe(step)
    })
    it('knows which steps are worded', () => {
        expect(giftTitleKey('housingType')).toBe('form.q_housing_title_gift')
        expect(giftTitleKey('identity-phone')).toBeNull()
        expect(GIFT_UNKNOWN_STEPS).not.toContain('housingType')
    })
    it('strips gift answers from a non-gift submission', () => {
        expect(stripGiftAnswers({ intent: 'self', giftRecipient: { firstName: 'L' }, hasOutdoor: 'unknown', isSafe: 'yes' }))
            .toEqual({ intent: 'self', isSafe: 'yes' })
        expect(stripGiftAnswers({ ...gift, hasOutdoor: 'unknown' })).toEqual({ ...gift, hasOutdoor: 'unknown' })
    })
})

describe('giftRecipientProblem', () => {
    it('needs a relationship and a first name', () => {
        expect(giftRecipientProblem({ firstName: 'Laura' })).toBe('missing')
        expect(giftRecipientProblem({ relationship: 'child', firstName: ' ' })).toBe('missing')
    })
    it('checks the phone like the applicant\'s — the server would otherwise drop it', () => {
        expect(giftRecipientProblem({ relationship: 'child', firstName: 'Laura', phone: '11 5555 1234 (WhatsApp)' })).toBe('phone')
        expect(giftRecipientProblem({ relationship: 'child', firstName: 'Laura', phone: '123456' })).toBe('phone')
        expect(giftRecipientProblem({ relationship: 'child', firstName: 'Laura', phone: '+54 (11) 5555-1234' })).toBeNull()
        expect(giftRecipientProblem({ relationship: 'child', firstName: 'Laura', phone: '  ' })).toBeNull()
    })
})

describe('the issues found after release (2026-10-13)', () => {
    it('#1 a typed "unknown" in a text field is an answer, not a leftover "No sé"', () => {
        expect(stripGiftAnswers({ intent: 'self', name: 'unknown', speciesOther: 'unknown', hasOutdoor: 'unknown' }))
            .toEqual({ intent: 'self', name: 'unknown', speciesOther: 'unknown' })
    })
    it('#2 switching to "Para mí" clears every "No sé" at once, so those questions read as unanswered', () => {
        const before = { intent: 'self', giftRecipient: { relationship: 'child', firstName: 'Laura' }, children: 'unknown', hasOutdoor: 'unknown', isSafe: 'yes', name: 'unknown' }
        expect(settleGiftAnswers(before, true)).toEqual({ intent: 'self', giftRecipient: { relationship: 'child', firstName: 'Laura' }, isSafe: 'yes', name: 'unknown' })
    })
    it('#2 a gift keeps its "No sé" answers — same object, so nothing re-renders', () => {
        const a = { intent: 'gift', children: 'unknown' }
        expect(settleGiftAnswers(a, true)).toBe(a)
    })
    it('#3 when the rescuer no longer asks "Intención", an old gift draft stops being a gift', () => {
        const draft = { intent: 'gift', giftRecipient: { relationship: 'child', firstName: 'Laura' }, children: 'unknown', isSafe: 'yes' }
        expect(settleGiftAnswers(draft, false)).toEqual({ isSafe: 'yes' })
    })
    it('#6 the vacation question has its own "No lo sé aún" — no second "No sé"', () => {
        expect(GIFT_UNKNOWN_STEPS).not.toContain('vacationPlan')
    })
    it('#8 nothing the gift flow says about the recipient guesses a gender with "/a"', () => {
        for (const lang of ['es', 'pt'] as const) {
            const giftCopy = Object.entries(form[lang]).filter(([k]) => k.endsWith('_gift'))
            expect(giftCopy.length).toBeGreaterThan(5)
            for (const [k, v] of giftCopy) expect(`${lang} ${k}: ${v}`).not.toMatch(/\/a\b|\/o\b/)
        }
    })
})

describe('new home questions in a gift (spec 2026-10-14 §4.3)', () => {
    it('talk about the recipient', () => {
        for (const id of ['rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'allergy', 'lastAnimal', 'gaveAway', 'movingIfNoPets', 'sterilizeHow'])
            expect(giftTitleKey(id), id).toBe(`form.q_${id}_title_gift`)
    })
    it('offer "No sé" where the giver may not know — not where it already exists', () => {
        for (const id of ['rental', 'sleepPlace', 'catOutdoor', 'dogWalks', 'dogTied', 'lastAnimal', 'gaveAway']) expect(GIFT_UNKNOWN_STEPS).toContain(id)
        for (const id of ['allergy', 'movingIfNoPets', 'visitConsent', 'returnReasons', 'adaptPlan', 'carer']) expect(GIFT_UNKNOWN_STEPS).not.toContain(id)
    })
})
