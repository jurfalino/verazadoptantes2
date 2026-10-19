import { describe, it, expect } from 'vitest'
import { draftAnswers, photosMissing, stripPhotos, missingPhotosStep, MAX_PROTECTION_PHOTOS } from './formPhotos'

const P = 'data:image/jpeg;base64,AAAA'

describe('form photos (release 2) — public form rules', () => {
    it('are never kept in the saved draft (localStorage would overflow and lose the whole draft)', () => {
        expect(draftAnswers({ name: 'A', protectionPhotos: [P, P], sleepPhoto: P })).toEqual({ name: 'A' })
        const plain = { name: 'A' }
        expect(draftAnswers(plain)).toBe(plain)
    })
    it('required means at least one protection photo — never for a gift', () => {
        const on = ['on:photos', 'photos-required']
        expect(photosMissing({}, on)).toBe(true)
        expect(photosMissing({ protectionPhotos: [P] }, on)).toBe(false)
        expect(photosMissing({}, ['on:photos'])).toBe(false)
        expect(photosMissing({ intent: 'gift', giftRecipient: { firstName: 'Laura' } }, on)).toBe(false)
        expect(photosMissing({}, null)).toBe(false)
    })
    it('are dropped from the submission when not asked', () => {
        const a = { protectionPhotos: [P], sleepPhoto: P, name: 'A' }
        const cfg = [{ id: 'isSafe' }, { id: 'sleepPlace' }]
        expect(stripPhotos(a, ['on:photos'], cfg)).toBe(a)
        expect(stripPhotos(a, [], cfg)).toEqual({ name: 'A' })
        expect(stripPhotos(a, ['on:photos'], [{ id: 'isSafe' }])).toEqual({ protectionPhotos: [P], name: 'A' })
        expect(stripPhotos({ protectionPhotos: [P, P, P, P] }, ['on:photos'], cfg).protectionPhotos).toHaveLength(MAX_PROTECTION_PHOTOS)
    })
    it('sending checks them again: a draft reopened after the photos step lost them goes back there', () => {
        const on = ['on:photos', 'photos-required']
        const shown = [{ id: 'name' }, { id: 'isSafe' }, { id: 'sleepPlace' }]
        expect(missingPhotosStep({ name: 'A', isSafe: 'yes' }, on, shown)).toBe('isSafe')
        expect(missingPhotosStep({ name: 'A', isSafe: 'yes', protectionPhotos: [P] }, on, shown)).toBeNull()
        // Not on this applicant's form (hidden, or skipped by an earlier answer): nothing to ask for.
        expect(missingPhotosStep({ name: 'A' }, on, [{ id: 'name' }])).toBeNull()
        expect(missingPhotosStep({ intent: 'gift', giftRecipient: { firstName: 'Laura' } }, on, shown)).toBeNull()
        expect(missingPhotosStep({}, ['on:photos'], shown)).toBeNull()
    })
})
