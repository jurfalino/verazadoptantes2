/**
 * Node-side smoke tests for generateContractPdf. jsPDF runs fine under
 * vitest's `environment: 'node'` (verified: no DOM/canvas needed for
 * text-only PDFs, which is all this generator produces) — no skip needed.
 */
import { describe, it, expect } from 'vitest'
import { generateContractPdf } from './contractPdf'
import type { CustomContract } from './lib/adoptionDocs'

const animal = {
    animalName: 'Firulais',
    species: 'dog',
    age: '2 años',
    sex: 'macho',
    color: 'marrón',
    microchip: null,
    details: null,
    rescuerName: 'Refugio Test',
}

const form = {
    name: 'Ana',
    lastName: 'Pérez',
    dni: '12345678',
    email: 'ana@example.com',
    phone: '555-1234',
    address: 'Calle Falsa 123',
    socialNetworks: '@ana',
    locality: 'Ciudad',
}

describe('generateContractPdf', () => {
    it('no custom contract → returns a non-empty Blob and does not throw', () => {
        expect(() => {
            const blob = generateContractPdf(animal, form, 'es')
            expect(blob).toBeInstanceOf(Blob)
            expect(blob!.size).toBeGreaterThan(0)
        }).not.toThrow()
    })

    it('custom contract with bold/italic/underline/bullets → returns a non-empty Blob and does not throw', () => {
        const custom: CustomContract = {
            versionId: 'abcdef1234567890',
            sections: {
                '2': {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { text: 'Este texto es ' },
                                { text: 'negrita', marks: ['bold'] },
                                { text: ', ' },
                                { text: 'cursiva', marks: ['italic'] },
                                { text: ' y ' },
                                { text: 'subrayado', marks: ['underline'] },
                                { text: '.' },
                            ],
                        },
                        {
                            type: 'bulletList',
                            items: [
                                [{ text: 'Primer punto con ' }, { text: 'énfasis', marks: ['bold', 'italic'] }],
                                [{ text: 'Segundo punto' }],
                            ],
                        },
                    ],
                },
                '4': {
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ text: 'Sección 4 personalizada.' }] }],
                },
            },
        }
        expect(() => {
            const blob = generateContractPdf(animal, form, 'es', custom)
            expect(blob).toBeInstanceOf(Blob)
            expect(blob!.size).toBeGreaterThan(0)
        }).not.toThrow()
    })
})
