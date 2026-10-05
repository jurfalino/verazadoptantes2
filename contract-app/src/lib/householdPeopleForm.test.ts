import { describe, it, expect } from 'vitest'
import { isPersonComplete, householdStepTitleKey, canLeaveHouseholdStep } from './householdPeopleForm'

describe('household step helpers', () => {
    it('a person needs a relationship and a whole age 0–120', () => {
        expect(isPersonComplete({ relationship: 'child', age: 7 })).toBe(true)
        expect(isPersonComplete({ relationship: 'child', age: null })).toBe(false)
        expect(isPersonComplete({ relationship: null, age: 7 })).toBe(false)
        expect(isPersonComplete({ relationship: 'child', age: 130 })).toBe(false)
        expect(isPersonComplete({ relationship: 'child', age: 2.5 })).toBe(false)
    })
    it('title follows the housing answer', () => {
        expect(householdStepTitleKey('house')).toBe('form.q_household_title_house')
        expect(householdStepTitleKey('apartment')).toBe('form.q_household_title_apartment')
        expect(householdStepTitleKey(undefined)).toBe('form.q_household_title_home')
    })
    it('Continue needs "Vivo solo/a" or at least one person, and no unfinished card', () => {
        expect(canLeaveHouseholdStep({ livesAlone: true, people: [], editing: null })).toBe(true)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [], editing: null })).toBe(false)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [{ relationship: 'partner', age: 40 }], editing: null })).toBe(true)
        expect(canLeaveHouseholdStep({ livesAlone: false, people: [{ relationship: 'partner', age: 40 }], editing: { relationship: 'child', age: null } })).toBe(false)
    })
})
