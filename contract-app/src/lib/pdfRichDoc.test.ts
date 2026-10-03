import { describe, it, expect } from 'vitest'
import { layoutRichDoc, pdfSafeText, pdfSafeRichDoc, type LaidLine } from './pdfRichDoc'
import type { RichDoc } from './adoptionDocs'
const measure = (t: string) => t.length   // 1 unit per char
const lineRight = (l: LaidLine) => l.words.reduce((m, w) => Math.max(m, w.x + w.width), 0)
describe('layoutRichDoc', () => {
    it('wraps words greedily and keeps styles', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'aaa ', marks: ['bold'] }, { text: 'bbb ccc' }] }] }, 7, measure, { bulletIndent: 2 })
        const text = lines.filter(l => l !== 'gap').map(l => (l as any).words.map((w: any) => w.text).join(' '))
        expect(text).toEqual(['aaa bbb', 'ccc'])
        expect((lines[0] as any).words[0].style).toBe('bold')
    })
    it('bullets indent and mark only the first line of each item', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'uno dos tres' }]] }] }, 9, measure, { bulletIndent: 2 })
        const real = lines.filter(l => l !== 'gap') as any[]
        expect(real[0].bullet).toBe(true); expect(real[0].indent).toBe(2)
        expect(real[1].bullet).toBe(false); expect(real[1].indent).toBe(2)
    })
    it('a word wider than the line is broken by characters, never past the margin', () => {
        const width = 30
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x'.repeat(400) }] }] }, width, measure, { bulletIndent: 2 })
        const real = lines.filter(l => l !== 'gap') as LaidLine[]
        expect(real).toHaveLength(Math.ceil(400 / width))
        for (const l of real) expect(lineRight(l)).toBeLessThanOrEqual(width)
        expect(real.map(l => l.words.map(w => w.text).join('')).join('')).toBe('x'.repeat(400))
    })
    it('a long word after short ones starts on its own line and the text after it continues on its last line', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: `ab ${'y'.repeat(25)} cd` }] }] }, 10, measure, { bulletIndent: 2 }) as LaidLine[]
        expect(lines.map(l => l.words.map(w => w.text).join(' '))).toEqual(['ab', 'yyyyyyyyyy', 'yyyyyyyyyy', 'yyyyy cd'])
        for (const l of lines) expect(lineRight(l)).toBeLessThanOrEqual(10)
    })
    it('a long bullet item stays inside the indented width', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'z'.repeat(40) }]] }] }, 12, measure, { bulletIndent: 2 }) as LaidLine[]
        expect(lines).toHaveLength(4)
        expect(lines[0].bullet).toBe(true)
        expect(lines.slice(1).every(l => !l.bullet && l.indent === 2)).toBe(true)
        for (const l of lines) expect(lineRight(l)).toBeLessThanOrEqual(10)
    })
    it('a long word keeps per-run styles when broken (one segment per style per line)', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'aaaaaa', marks: ['bold'] }, { text: 'bbbbbb', marks: ['underline'] }] }] }, 8, measure, { bulletIndent: 2 }) as LaidLine[]
        expect(lines.map(l => l.words.map(w => `${w.text}:${w.style}:${w.underline}`))).toEqual([
            ['aaaaaa:bold:false', 'bb:normal:true'],
            ['bbbb:normal:true'],
        ])
    })
    it('a single character wider than the line still makes progress', () => {
        const wide = (t: string) => t.length * 5
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'abc' }] }] }, 3, wide, { bulletIndent: 2 }) as LaidLine[]
        expect(lines.map(l => l.words.map(w => w.text).join(''))).toEqual(['a', 'b', 'c'])
    })
    it('NBSP and other unicode spaces separate words', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'a\u00a0b\u2009c' }] }] }, 100, measure, { bulletIndent: 2 }) as LaidLine[]
        expect(lines[0].words.map(w => w.text)).toEqual(['a', 'b', 'c'])
    })
    it('unknown block types are skipped, with no stray gap', () => {
        const doc = { type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'a' }] },
            { type: 'heading', content: [{ text: 'h' }] },
            { type: 'paragraph', content: [{ text: 'b' }] },
            { type: 'image' },
        ] } as unknown as RichDoc
        const lines = layoutRichDoc(doc, 10, measure, { bulletIndent: 2 })
        expect(lines.map(l => l === 'gap' ? 'gap' : l.words.map(w => w.text).join(' '))).toEqual(['a', 'gap', 'b'])
    })
    it('underline is carried per word', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'u', marks: ['underline', 'italic'] }] }] }, 10, measure, { bulletIndent: 2 })
        expect((lines[0] as any).words[0]).toMatchObject({ underline: true, style: 'italic' })
    })
    it('gap between blocks', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'a' }] }, { type: 'paragraph', content: [{ text: 'b' }] }] }, 10, measure, { bulletIndent: 2 })
        expect(lines[1]).toBe('gap')
    })
})

describe('pdfSafeText', () => {
    it('folds typographic quotes, dashes, ellipsis and bullets to ASCII', () => {
        expect(pdfSafeText('\u201cHola\u201d \u201eX\u201c \u2018a\u2019 \u201ab')).toBe('"Hola" "X" \'a\' \'b')
        expect(pdfSafeText('a\u2013b\u2014c')).toBe('a-b-c')
        expect(pdfSafeText('fin\u2026')).toBe('fin...')
        expect(pdfSafeText('\u2022 item')).toBe('- item')
    })
    it('turns NBSP and other unicode spaces into a normal space', () => {
        expect(pdfSafeText('a\u00a0b\u2009c\u202fd\u3000e')).toBe('a b c d e')
    })
    it('strips accents like the standard path', () => {
        expect(pdfSafeText('Adopción ñandú')).toBe('Adopcion nandu')
    })
    it('drops anything outside Latin-1 that could not be folded', () => {
        expect(pdfSafeText('ok \u{1F436} \u20ac5 \u4e2d')).toBe('ok  5 ')
        expect(pdfSafeText('\u00b7 \u00df \u00bf')).toBe('\u00b7 \u00df \u00bf')
    })
})

describe('pdfSafeRichDoc', () => {
    it('folds every inline in paragraphs and bullet items, keeping marks and shape', () => {
        const doc: RichDoc = { type: 'doc', content: [
            { type: 'paragraph', content: [{ text: '\u201cS\u00ed\u201d', marks: ['bold'] }] },
            { type: 'bulletList', items: [[{ text: 'a\u2014b' }]] },
        ] }
        expect(pdfSafeRichDoc(doc)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: '"Si"', marks: ['bold'] }] },
            { type: 'bulletList', items: [[{ text: 'a-b' }]] },
        ] })
    })
    it('an emoji-only word disappears instead of leaving an empty word', () => {
        const doc: RichDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'hola \u{1F436} chau' }] }] }
        const lines = layoutRichDoc(pdfSafeRichDoc(doc), 100, measure, { bulletIndent: 2 }) as LaidLine[]
        expect(lines[0].words.map(w => w.text)).toEqual(['hola', 'chau'])
    })
})
