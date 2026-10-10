/**
 * Node-side smoke tests for generateContractPdf. jsPDF runs fine under
 * vitest's `environment: 'node'` (verified: no DOM/canvas needed for
 * text-only PDFs, which is all this generator produces) — no skip needed.
 */
import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
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

// ── Accents in the generated PDF ───────────────────────────────────────────
// Pull every string the content streams draw (Tj / TJ), undo PDF string
// escapes, and decode the bytes as WinAnsi (cp1252) — what a PDF viewer does
// for helvetica with /WinAnsiEncoding.
const CP1252_HIGH: Record<number, string> = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
    0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
    0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
}
function decodePdfString(raw: string): string {
    const bytes: number[] = []
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]
        if (ch !== '\\') { bytes.push(raw.charCodeAt(i) & 0xFF); continue }
        const nx = raw[++i]
        if (/[0-7]/.test(nx)) { let o = nx; while (o.length < 3 && /[0-7]/.test(raw[i + 1])) o += raw[++i]; bytes.push(parseInt(o, 8)) }
        else bytes.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 } as Record<string, number>)[nx] ?? nx.charCodeAt(0))
    }
    return bytes.map(b => CP1252_HIGH[b] ?? String.fromCharCode(b)).join('')
}
async function drawnText(blob: Blob): Promise<{ text: string; winAnsi: boolean }> {
    const bin = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    const streams: string[] = []
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g
    let m: RegExpExecArray | null
    while ((m = re.exec(bin))) {
        const body = m[1]
        try { streams.push(inflateSync(Buffer.from(body, 'latin1')).toString('latin1')) } catch { streams.push(body) }
    }
    const parts: string[] = []
    for (const st of streams) {
        const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g
        let t: RegExpExecArray | null
        while ((t = tj.exec(st))) parts.push(decodePdfString(t[1]))
    }
    return { text: parts.join(' '), winAnsi: bin.includes('/WinAnsiEncoding') }
}

describe('generateContractPdf — accents and typography survive', () => {
    const SAMPLE = 'á é í ó ú ü ñ ç ã õ â ê ô à ¿Sí? ¡Ya! «Gómez» • primer año – “hola”'

    it('the standard contract keeps its accents (e.g. ADOPCIÓN, COMPAÑÍA)', async () => {
        const { text, winAnsi } = await drawnText(generateContractPdf(animal, { ...form, lastName: 'Gómez Ñandú' }, 'es')!)
        expect(winAnsi).toBe(true)
        expect(text).toContain('ADOPCIÓN')
        expect(text).toContain('COMPAÑÍA')
        expect(text).toContain('Gómez Ñandú')
    })

    it('a multi-line value (address / details fallback) keeps its words apart', async () => {
        const { text } = await drawnText(generateContractPdf({ ...animal, color: null, details: 'Mancha blanca\nen el lomo' }, { ...form, address: 'Calle Falsa 123\nPiso 2' }, 'es')!)
        const flat = text.replace(/\s+/g, ' ')
        expect(flat).toContain('Mancha blanca en el lomo')
        expect(flat).toContain('Calle Falsa 123 Piso 2')
    })

    it('a custom section with every character renders exactly as typed, bullets as •', async () => {
        const custom: CustomContract = {
            versionId: 'abcdef1234567890',
            sections: { '3': { type: 'doc', content: [
                { type: 'paragraph', content: [{ text: SAMPLE }] },
                { type: 'bulletList', items: [[{ text: 'Vacunas al día' }]] },
            ] } },
        }
        const { text } = await drawnText(generateContractPdf(animal, form, 'es', custom)!)
        // Words are drawn one run at a time; compare with whitespace collapsed.
        const flat = text.replace(/\s+/g, ' ')
        for (const word of SAMPLE.split(' ')) expect(flat).toContain(word)
        expect(flat).toContain('• Vacunas al día')
    })
})
