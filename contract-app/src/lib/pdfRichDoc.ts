/**
 * Pure line-layout for rendering a RichDoc (contract sections 2–4) into a
 * jsPDF page. No jsPDF import here — the caller supplies `measure` (usually
 * `doc.getTextWidth` after `doc.setFont(...)`), so this module stays testable
 * without a PDF engine.
 *
 * `LaidWord.x` is relative to the LINE's left edge AFTER `LaidLine.indent` is
 * applied — i.e. the caller draws each word at `pageLeft + line.indent + word.x`.
 */
import type { RichDoc, Block, Inline, Mark } from './adoptionDocs'

export type Style = 'normal' | 'bold' | 'italic' | 'bolditalic'
export type Measure = (text: string, style: Style) => number
export type LaidWord = { text: string; x: number; style: Style; underline: boolean; width: number }
export type LaidLine = { words: LaidWord[]; indent: number; bullet: boolean }

// ── Text the built-in helvetica font can draw ─────────────────────
// jsPDF writes helvetica text in WinAnsiEncoding (cp1252): every Spanish and
// Portuguese letter (á é í ó ú ü ñ ç ã õ â ê ô à), ¿ ¡ « » and the typographic
// specials (• – — “ ” ‘ ’ … €) are IN that encoding and render as typed. Only
// code points outside it (other dashes, odd spaces, emoji, CJK…) must be
// folded or dropped, or jsPDF mis-measures/mis-draws the word. Applied to
// EVERY string the contract PDF draws — standard text, form data, rescuer
// sections — and before measuring, so wrap and draw see the same string.
// (It used to strip accents from everything: «primer año» printed «primer ano».)

/** The 27 cp1252 code points above U+007F that are not Latin-1. */
const WINANSI_SPECIALS = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])

const FOLD: Array<[RegExp, string]> = [
    [/[\u2010\u2011\u2012\u2015\u2212]/g, '-'],          // other dashes (– and — are WinAnsi)
    [/[\u201B\u2032]/g, "'"],
    [/[\u201F\u2033]/g, '"'],
    [/[\u2023\u2043\u2219\u25AA\u25CF\u25E6]/g, '\u2022'], // other bullets → •
    [/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' '],
    // Line breaks / tabs in a pasted value (a multi-line address, the details
    // fallback): one space, so words never run together. jsPDF would otherwise
    // have to place them, and WinAnsi has no glyph for them.
    [/[\t\r\n]+/g, ' '],
]

const inWinAnsi = (ch: string): boolean => {
    const cp = ch.codePointAt(0)!
    return (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || WINANSI_SPECIALS.has(ch)
}

/** `s` reduced to what helvetica (WinAnsi) can draw; accents and ñ are kept. */
export function toWinAnsi(s: string): string {
    let out = s.normalize('NFC')
    for (const [re, rep] of FOLD) out = out.replace(re, rep)
    let kept = ''
    for (const ch of out) {
        if (inWinAnsi(ch)) { kept += ch; continue }
        // Outside WinAnsi: keep the base letter when there is one (ă → a, ő → o);
        // otherwise (emoji, CJK, C1 controls) drop it.
        for (const b of ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) if (inWinAnsi(b)) kept += b
    }
    return kept
}

/** Kept for the rich-doc path's callers; same rule as every other PDF string. */
export function pdfSafeText(s: string): string {
    return toWinAnsi(s)
}

/** Same document with every inline's text passed through pdfSafeText (marks and shape kept). */
export function pdfSafeRichDoc(doc: RichDoc): RichDoc {
    const fold = (runs: Inline[]): Inline[] => runs.map(r => ({ ...r, text: pdfSafeText(r.text) }))
    return {
        type: 'doc',
        content: doc.content.map((b): Block => {
            if (b?.type === 'bulletList') return { type: 'bulletList', items: b.items.map(fold) }
            if (b?.type === 'paragraph') return { type: 'paragraph', content: fold(b.content) }
            return b // unknown block: left as-is, layoutRichDoc skips it
        }),
    }
}

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
 * `bullet: false`, still indented). A word group wider than `width` starts
 * on a fresh line and is broken by characters across as many lines as it
 * needs (consecutive characters of one style merge into one LaidWord per
 * line); the text after it continues on its last line. A line always takes
 * at least one character, so layout can never loop forever even if a single
 * glyph is wider than the line.
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
    const placeByChars = (group: WordGroup) => {
        if (words.length > 0) flush()
        for (const piece of group) {
            for (const ch of Array.from(piece.text)) {
                const last = words[words.length - 1]
                const merge = !!last && last.style === piece.style && last.underline === piece.underline
                const nextRight = merge ? last.x + measure(last.text + ch, piece.style) : x + measure(ch, piece.style)
                if (lineWidth > 0 && nextRight > width) {
                    flush()
                    const w = measure(ch, piece.style)
                    words.push({ text: ch, x: 0, style: piece.style, underline: piece.underline, width: w })
                    x = w
                } else if (merge) {
                    last.text += ch
                    last.width = nextRight - last.x
                    x = nextRight
                } else {
                    const w = nextRight - x
                    words.push({ text: ch, x, style: piece.style, underline: piece.underline, width: w })
                    x = nextRight
                }
                lineWidth = x
            }
        }
    }
    for (const group of groups) {
        const gWidth = groupWidth(group, measure)
        if (gWidth > width) {
            placeByChars(group)
            continue
        }
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

/**
 * Lays out only the known block types (paragraph, bulletList). Anything else
 * is skipped entirely — no lines and no 'gap' for it — so a document from a
 * newer editor degrades instead of throwing mid-PDF.
 */
export function layoutRichDoc(doc: RichDoc, maxWidth: number, measure: Measure, opts: { bulletIndent: number }): Array<LaidLine | 'gap'> {
    const out: Array<LaidLine | 'gap'> = []
    const blocks = doc.content.filter(b => !!b && (b.type === 'paragraph' || b.type === 'bulletList'))
    blocks.forEach((block, i) => {
        if (block.type === 'paragraph') {
            const groups = tokenize(block.content)
            out.push(...layoutWords(groups, maxWidth, measure, 0, false))
        } else if (block.type === 'bulletList') {
            for (const item of block.items) {
                const groups = tokenize(item)
                out.push(...layoutWords(groups, maxWidth - opts.bulletIndent, measure, opts.bulletIndent, true))
            }
        }
        if (i < blocks.length - 1) out.push('gap')
    })
    return out
}
