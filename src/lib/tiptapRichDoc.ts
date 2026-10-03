/**
 * TipTap JSON ⇄ RichDoc (the stored contract-section format, see
 * src/domain/adoptionDocs.ts). Used only by the contract editor.
 *
 * tiptapToRichDoc is deliberately forgiving: whatever TipTap hands back after
 * a paste from Word or Google Docs (headings, blockquotes, ordered lists,
 * tables, code, links, images…) is reduced to paragraphs, one flat bullet
 * list level and bold/italic/underline — never rejected, never kept raw
 * (spec Review Focus #3). Type-only imports: this file adds nothing to the
 * client bundle beyond its own code.
 */
import type { Block, Inline, Mark, RichDoc } from '@/domain/adoptionDocs';

export type TipTapNode = { type: string; text?: string; marks?: { type: string }[]; content?: TipTapNode[] };

const MARK_ORDER: readonly Mark[] = ['bold', 'italic', 'underline'];
const LIST_TYPES = new Set(['bulletList', 'orderedList']);
/** Blocks that hold inline content even when empty (an empty one is a blank line). */
const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const INLINE_TYPES = new Set(['text', 'hardBreak']);

function children(node: TipTapNode): TipTapNode[] {
    return Array.isArray(node.content) ? node.content.filter(c => !!c && typeof c === 'object') : [];
}

function isInline(node: TipTapNode): boolean {
    return INLINE_TYPES.has(node.type);
}

/** Inline children → runs. Unknown inline nodes (mentions, images) are dropped. */
function toInlines(nodes: TipTapNode[]): Inline[] {
    const out: Inline[] = [];
    for (const n of nodes) {
        if (n.type === 'hardBreak') {
            // The public contract PDF collapses whitespace inside a run, so a
            // line break is a space, never '\n'.
            out.push({ text: ' ' });
        } else if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) {
            // A pasted <br> (hardBreak is disabled) arrives as "\n"; same rule
            // as hardBreak — the contract never carries a newline.
            const text = n.text.replace(/\s*[\r\n]+\s*/g, ' ');
            const present = new Set((n.marks ?? []).map(m => m?.type));
            const marks = MARK_ORDER.filter(m => present.has(m));
            out.push(marks.length ? { text, marks } : { text });
        } else if (!isInline(n) && children(n).length) {
            // An unexpected wrapper inside inline content: keep its text.
            out.push(...toInlines(children(n)));
        }
    }
    return out;
}

/** Every item a list node contributes, nested lists flattened in order. */
function listItems(list: TipTapNode): Inline[][] {
    const items: Inline[][] = [];
    for (const li of children(list)) {
        collectItems(li, items);
    }
    return items;
}

function collectItems(node: TipTapNode, items: Inline[][]): void {
    const kids = children(node);
    if (!kids.length) return;
    if (kids.some(isInline)) {
        const runs = toInlines(kids);
        if (runs.length) items.push(runs);
        return;
    }
    for (const k of kids) {
        if (LIST_TYPES.has(k.type)) items.push(...listItems(k));
        else collectItems(k, items);
    }
}

function toBlocks(nodes: TipTapNode[], out: Block[]): void {
    for (const n of nodes) {
        if (LIST_TYPES.has(n.type)) {
            const items = listItems(n);
            if (items.length) out.push({ type: 'bulletList', items });
            continue;
        }
        const kids = children(n);
        if (TEXTBLOCK_TYPES.has(n.type) || kids.some(isInline)) {
            out.push({ type: 'paragraph', content: toInlines(kids) });
        } else if (kids.length) {
            // blockquote, table, tableRow, tableCell, listItem out of a list…
            toBlocks(kids, out);
        }
        // else: a leaf with no text (image, horizontalRule) — dropped.
    }
}

export function tiptapToRichDoc(json: TipTapNode): RichDoc {
    const content: Block[] = [];
    toBlocks(children(json), content);
    return { type: 'doc', content };
}

function runsToTiptap(runs: Inline[]): TipTapNode[] {
    return runs
        .filter(r => r.text.length > 0) // ProseMirror throws on empty text nodes
        .map(r => (r.marks?.length
            ? { type: 'text', text: r.text, marks: r.marks.map(m => ({ type: m })) }
            : { type: 'text', text: r.text }));
}

function paragraph(runs: Inline[]): TipTapNode {
    const content = runsToTiptap(runs);
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

export function richDocToTiptap(doc: RichDoc): TipTapNode {
    const content: TipTapNode[] = [];
    for (const b of doc.content) {
        if (b.type === 'paragraph') {
            content.push(paragraph(b.content));
        } else if (b.items.length) {
            content.push({ type: 'bulletList', content: b.items.map(it => ({ type: 'listItem', content: [paragraph(it)] })) });
        }
    }
    if (!content.length) content.push({ type: 'paragraph' });
    return { type: 'doc', content };
}
