/**
 * Pure line-layout for rendering a RichDoc (contract sections 2–4) into a
 * jsPDF page. No jsPDF import here — the caller supplies `measure` (usually
 * `doc.getTextWidth` after `doc.setFont(...)`), so this module stays testable
 * without a PDF engine.
 *
 * `LaidWord.x` is relative to the LINE's left edge AFTER `LaidLine.indent` is
 * applied — i.e. the caller draws each word at `pageLeft + line.indent + word.x`.
 */
import type { RichDoc, Inline, Mark } from './adoptionDocs'

export type Style = 'normal' | 'bold' | 'italic' | 'bolditalic'
export type Measure = (text: string, style: Style) => number
export type LaidWord = { text: string; x: number; style: Style; underline: boolean; width: number }
export type LaidLine = { words: LaidWord[]; indent: number; bullet: boolean }

function styleOf(marks: Mark[] | undefined): Style {
    const bold = !!marks?.includes('bold')
    const italic = !!marks?.includes('italic')
    if (bold && italic) return 'bolditalic'
    if (bold) return 'bold'
    if (italic) return 'italic'
    return 'normal'
}

type Piece = { text: string; style: Style; underline: boolean }
type WordGroup = Piece[]

/**
 * Splits a run of inline text into word groups (maximal non-whitespace
 * spans). A word group can be made of several pieces from different Inline
 * runs when two runs abut with no whitespace between them (e.g. a bold
 * "Salud" immediately followed by a plain ":") — each piece keeps its own
 * style/underline but no space is inserted between pieces of one group.
 * Runs of whitespace (of any length) collapse to a single word break.
 */
function tokenize(runs: Inline[]): WordGroup[] {
    const groups: WordGroup[] = []
    let current: WordGroup | null = null
    for (const run of runs) {
        if (!run.text) continue
        const style = styleOf(run.marks)
        const underline = !!run.marks?.includes('underline')
        const parts = run.text.split(/(\s+)/).filter(p => p.length > 0)
        for (const part of parts) {
            if (/^\s+$/.test(part)) {
                current = null // whitespace closes the current word group
                continue
            }
            if (!current) {
                current = []
                groups.push(current)
            }
            current.push({ text: part, style, underline })
        }
    }
    return groups
}

function groupWidth(group: WordGroup, measure: Measure): number {
    return group.reduce((sum, p) => sum + measure(p.text, p.style), 0)
}

/**
 * Greedy-fills `groups` into lines no wider than `width`. Every line is
 * tagged with `indent`; only the first line gets `bullet: true` when
 * `firstLineBullet` is set (subsequent wrapped lines of the same item are
 * `bullet: false`, still indented). A word group wider than `width` is
 * always placed — alone, on its own line — so layout can never loop forever.
 */
function layoutWords(groups: WordGroup[], width: number, measure: Measure, indent: number, firstLineBullet: boolean): LaidLine[] {
    const lines: LaidLine[] = []
    let words: LaidWord[] = []
    let x = 0
    let lineWidth = 0
    const flush = () => {
        if (words.length > 0) lines.push({ words, indent, bullet: lines.length === 0 && firstLineBullet })
        words = []
        x = 0
        lineWidth = 0
    }
    for (const group of groups) {
        const gWidth = groupWidth(group, measure)
        const firstStyle = group[0].style
        const spaceWidth = words.length > 0 ? measure(' ', firstStyle) : 0
        const needed = spaceWidth + gWidth
        if (words.length > 0 && lineWidth + needed > width) {
            flush()
        }
        if (words.length > 0) {
            x += spaceWidth
            lineWidth += spaceWidth
        }
        for (const piece of group) {
            const w = measure(piece.text, piece.style)
            words.push({ text: piece.text, x, style: piece.style, underline: piece.underline, width: w })
            x += w
            lineWidth += w
        }
    }
    flush()
    return lines
}

export function layoutRichDoc(doc: RichDoc, maxWidth: number, measure: Measure, opts: { bulletIndent: number }): Array<LaidLine | 'gap'> {
    const out: Array<LaidLine | 'gap'> = []
    doc.content.forEach((block, i) => {
        if (block.type === 'paragraph') {
            const groups = tokenize(block.content)
            out.push(...layoutWords(groups, maxWidth, measure, 0, false))
        } else {
            for (const item of block.items) {
                const groups = tokenize(item)
                out.push(...layoutWords(groups, maxWidth - opts.bulletIndent, measure, opts.bulletIndent, true))
            }
        }
        if (i < doc.content.length - 1) out.push('gap')
    })
    return out
}
