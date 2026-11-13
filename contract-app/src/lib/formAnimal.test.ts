import { describe, it, expect } from 'vitest'
import { formAnimalFromConfig } from './formAnimal'

describe('formAnimalFromConfig', () => {
    it('reads the animal the link was opened for', () => {
        expect(formAnimalFromConfig({ animal: { name: ' Juanete ', photo: 'https://cdn.example.org/j.jpg' } }))
            .toEqual({ name: 'Juanete', photo: 'https://cdn.example.org/j.jpg' })
    })
    it('keeps an inline image photo', () => {
        expect(formAnimalFromConfig({ animal: { name: 'Ojito', photo: 'data:image/jpeg;base64,AAAA' } })?.photo).toBe('data:image/jpeg;base64,AAAA')
    })
    it('drops a photo that is not an image link', () => {
        expect(formAnimalFromConfig({ animal: { name: 'Ojito', photo: 'javascript:alert(1)' } })).toEqual({ name: 'Ojito', photo: null })
        expect(formAnimalFromConfig({ animal: { name: 'Ojito', photo: 'data:text/html,<b>' } })).toEqual({ name: 'Ojito', photo: null })
        expect(formAnimalFromConfig({ animal: { name: 'Ojito', photo: 42 } })).toEqual({ name: 'Ojito', photo: null })
    })
    it('no animal, a nameless one or a malformed answer shows nothing', () => {
        expect(formAnimalFromConfig(null)).toBeNull()
        expect(formAnimalFromConfig({})).toBeNull()
        expect(formAnimalFromConfig({ animal: null })).toBeNull()
        expect(formAnimalFromConfig({ animal: { name: '  ' } })).toBeNull()
        expect(formAnimalFromConfig({ animal: 'Juanete' })).toBeNull()
    })
})
