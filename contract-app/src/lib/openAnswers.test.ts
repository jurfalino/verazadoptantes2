import { describe, it, expect } from 'vitest'
import { withOpenSteps, openText, isAnswered, settleOpenAnswers } from './openAnswers'

const schema = [
    { id: 'rental', type: 'choice-list', title: '¿La casa es tuya o alquilás?', options: [{ value: 'own', label: 'Es propia' }] },
    { id: 'visitConsent', type: 'choice-list', title: '¿Aceptás una visita?', options: [{ value: 'yes', label: 'Sí' }] },
]

describe('open answers (release 3) — public form', () => {
    it('a question set to free text becomes a text box with the same title; the rest stay as they are', () => {
        const out = withOpenSteps(schema, ['way:rental:open'])
        expect(out[0]).toEqual({ id: 'rental', type: 'open-text', title: '¿La casa es tuya o alquilás?' })
        expect(out[1]).toBe(schema[1])
        expect(withOpenSteps(schema, null)).toBe(schema)
    })
    it('the answer is { open: text } — never confused with an option value', () => {
        expect(openText({ open: ' alquilo ' })).toBe(' alquilo ')
        expect(openText('own')).toBe('')
        expect(isAnswered({ open: '  ' })).toBe(false)
        expect(isAnswered({ open: 'Sí, permiten' })).toBe(true)
    })
    it('an answer of the wrong kind for how the question is asked now is dropped (old drafts)', () => {
        const stored = ['way:rental:open']
        const cfg = [{ id: 'rental' }, { id: 'sleepPlace' }]
        expect(settleOpenAnswers({ rental: 'own', sleepPlace: { open: 'x' }, name: 'A' }, stored, cfg)).toEqual({ name: 'A' })
        const fine = { rental: { open: 'propia' }, sleepPlace: 'inside' }
        expect(settleOpenAnswers(fine, stored, cfg)).toBe(fine)
    })
})
