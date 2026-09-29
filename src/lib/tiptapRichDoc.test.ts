import { describe, it, expect } from 'vitest';
import { tiptapToRichDoc, richDocToTiptap } from './tiptapRichDoc';
import { normalizeRichDoc, SECTION_KEYS } from '@/domain/adoptionDocs';
import { STANDARD_RICH_DOCS } from '@/domain/standardContractText';

describe('tiptapToRichDoc', () => {
    it('paragraphs, marks and bullet lists', () => {
        const tt = { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hola ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'mundo', marks: [{ type: 'italic' }, { type: 'underline' }] }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] }] },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Hola ', marks: ['bold'] }, { text: 'mundo', marks: ['italic', 'underline'] }] },
            { type: 'bulletList', items: [[{ text: 'uno' }]] },
        ] });
    });
    it('flattens pasted unknown nodes (heading, blockquote, ordered list, link mark, hardBreak) to allowed ones', () => {
        const tt = { type: 'doc', content: [
            { type: 'heading', content: [{ type: 'text', text: 'Título' }] },
            { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cita', marks: [{ type: 'link' }] }] }] },
            { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }] },
            { type: 'image' },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'Título' }] },
            { type: 'paragraph', content: [{ text: 'cita' }] },
            { type: 'bulletList', items: [[{ text: 'a' }, { text: ' ' }, { text: 'b' }]] },
        ] });
    });
    it('nested lists flatten into the parent list', () => {
        const tt = { type: 'doc', content: [{ type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] }] },
        ] }] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'a' }], [{ text: 'b' }]] }] });
    });
    it('round-trips', () => {
        const rd = { type: 'doc' as const, content: [
            { type: 'paragraph' as const, content: [{ text: 'x', marks: ['bold' as const] }] },
            { type: 'bulletList' as const, items: [[{ text: 'y' }]] },
        ] };
        expect(tiptapToRichDoc(richDocToTiptap(rd))).toEqual(rd);
    });

    // Review Focus #3 — content pasted from Word / Google Docs.
    it('reduces Word/Docs tables, code blocks, rules and odd marks to paragraphs; never throws', () => {
        const tt = { type: 'doc', content: [
            { type: 'table', content: [{ type: 'tableRow', content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'celda 1' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'celda 2', marks: [{ type: 'bold' }, { type: 'textStyle' }] }] }] },
            ] }] },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1', marks: [{ type: 'code' }] }] },
            { type: 'horizontalRule' },
            { type: 'paragraph', content: [{ type: 'text', text: 'tachado', marks: [{ type: 'strike' }, { type: 'underline' }, { type: 'bold' }] }] },
            { type: 'paragraph' },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'celda 1' }] },
            { type: 'paragraph', content: [{ text: 'celda 2', marks: ['bold'] }] },
            { type: 'paragraph', content: [{ text: 'const x = 1' }] },
            { type: 'paragraph', content: [{ text: 'tachado', marks: ['bold', 'underline'] }] },
            { type: 'paragraph', content: [] },
        ] });
    });

    it('tolerates malformed input (missing content, non-object children, empty text)', () => {
        const tt = { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: '' }, { type: 'text' }, { type: 'text', text: 'ok' }] },
            { type: 'bulletList' },
            { type: 'bulletList', content: [{ type: 'listItem' }] },
        ] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ text: 'ok' }] },
        ] });
        expect(tiptapToRichDoc({ type: 'doc' })).toEqual({ type: 'doc', content: [] });
    });

    it('an ordered list inside a list item and a heading inside a list item stay items', () => {
        const tt = { type: 'doc', content: [{ type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'heading', content: [{ type: 'text', text: 'h' }] }, { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'n' }] }] }] }] },
        ] }] };
        expect(tiptapToRichDoc(tt)).toEqual({ type: 'doc', content: [{ type: 'bulletList', items: [[{ text: 'h' }], [{ text: 'n' }]] }] });
    });
});

describe('richDocToTiptap', () => {
    it('maps bulletList items to listItem > paragraph and never emits empty text nodes', () => {
        const rd = { type: 'doc' as const, content: [
            { type: 'paragraph' as const, content: [{ text: '' }, { text: 'a', marks: ['underline' as const] }] },
            { type: 'paragraph' as const, content: [] },
            { type: 'bulletList' as const, items: [] },
            { type: 'bulletList' as const, items: [[{ text: 'b' }]] },
        ] };
        expect(richDocToTiptap(rd)).toEqual({ type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'underline' }] }] },
            { type: 'paragraph' },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
        ] });
    });

    it('an empty doc still yields one paragraph (TipTap needs a block)', () => {
        expect(richDocToTiptap({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    });

    // The editor strips an untouched section before saving by comparing it to
    // the standard text. That only works if the standard text survives a trip
    // through the editor unchanged.
    it.each(SECTION_KEYS)('standard section %s survives the editor round-trip', (k) => {
        const std = STANDARD_RICH_DOCS[k];
        expect(normalizeRichDoc(tiptapToRichDoc(richDocToTiptap(std)))).toEqual(normalizeRichDoc(std));
    });
});
