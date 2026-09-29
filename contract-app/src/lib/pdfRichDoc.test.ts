import { describe, it, expect } from 'vitest'
import { layoutRichDoc } from './pdfRichDoc'
const measure = (t: string) => t.length   // 1 unit per char
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
    it('a word longer than the line does not loop forever', () => {
        const lines = layoutRichDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'x'.repeat(50) }] }] }, 10, measure, { bulletIndent: 2 })
        expect(lines.filter(l => l !== 'gap')).toHaveLength(1)
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
