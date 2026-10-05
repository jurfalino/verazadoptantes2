import { describe, it, expect } from 'vitest'
import { adaptStepForGift, giftTitleKey, isGift, stripGiftAnswers, GIFT_UNKNOWN_STEPS, giftRecipientProblem } from './giftFlow'

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
