import { describe, it, expect } from 'vitest';
import { STANDARD_SECTIONS_ES, standardSectionToRichDoc, STANDARD_RICH_DOCS, sectionsToSave } from './standardContractText';
import { normalizeRichDoc, canonicalSectionsJson } from './adoptionDocs';
import { CONTRACT_CONTENT } from '../../contract-app/src/i18n/contractContent';

describe('standard contract text mirror', () => {
    it('sections 2–5 match contract-app source exactly (ordered deep equality)', () => {
        expect([STANDARD_SECTIONS_ES['2'], STANDARD_SECTIONS_ES['3'], STANDARD_SECTIONS_ES['4'], STANDARD_SECTIONS_ES['5']]).toEqual(CONTRACT_CONTENT.es.sections);
    });
});

describe('standardSectionToRichDoc', () => {
    it('intro paragraph, then one paragraph per clause with a bold title run', () => {
        const d = standardSectionToRichDoc(STANDARD_SECTIONS_ES['2']);
        expect(d.content[0]).toEqual({ type: 'paragraph', content: [{ text: STANDARD_SECTIONS_ES['2'].intro }] });
        expect(d.content[1]).toEqual({ type: 'paragraph', content: [
            { text: 'Bienestar y Trato:', marks: ['bold'] },
            { text: ' ' + STANDARD_SECTIONS_ES['2'].clauses[0].body },
        ] });
    });
    it('section 3: titled clauses without intro', () => {
        const d = standardSectionToRichDoc(STANDARD_SECTIONS_ES['3']);
        expect(d.content[0]).toEqual({ type: 'paragraph', content: [
            { text: 'Seguimiento:', marks: ['bold'] },
            { text: ' ' + STANDARD_SECTIONS_ES['3'].clauses[0].body },
        ] });
    });
    it('untitled clauses are plain paragraphs', () => {
        const d = standardSectionToRichDoc(STANDARD_SECTIONS_ES['4']);
        expect(d.content[0]).toEqual({ type: 'paragraph', content: [{ text: STANDARD_SECTIONS_ES['4'].clauses[0].body }] });
    });
    it('standard docs are already normalized (so "unchanged" compares equal)', () => {
        for (const k of ['2', '3', '4'] as const) {
            expect(canonicalSectionsJson({ [k]: normalizeRichDoc(STANDARD_RICH_DOCS[k])! })).toBe(canonicalSectionsJson({ [k]: STANDARD_RICH_DOCS[k] }));
        }
    });
});

describe('sectionsToSave', () => {
    it('drops sections equal to the standard text (so they follow the adopter\'s language)', () => {
        expect(sectionsToSave({ '2': STANDARD_RICH_DOCS['2'], '3': STANDARD_RICH_DOCS['3'], '4': STANDARD_RICH_DOCS['4'] })).toEqual({});
    });
    it('compares after normalization: blank paragraphs around the standard text still count as standard', () => {
        const padded = { type: 'doc' as const, content: [
            { type: 'paragraph' as const, content: [] },
            ...STANDARD_RICH_DOCS['3'].content,
            { type: 'paragraph' as const, content: [{ text: '   ' }] },
        ] };
        expect(sectionsToSave({ '3': padded })).toEqual({});
    });
    it('keeps an edited section, normalized, and leaves the others out', () => {
        const edited = { type: 'doc' as const, content: [
            ...STANDARD_RICH_DOCS['2'].content,
            { type: 'paragraph' as const, content: [{ text: 'Cláusula extra', marks: ['underline' as const, 'bold' as const] }] },
        ] };
        const out = sectionsToSave({ '2': edited, '4': STANDARD_RICH_DOCS['4'] });
        expect(Object.keys(out)).toEqual(['2']);
        expect(out['2']!.content.at(-1)).toEqual({ type: 'paragraph', content: [{ text: 'Cláusula extra', marks: ['bold', 'underline'] }] });
    });
    it('an emptied section is left out — it goes back to the standard text', () => {
        expect(sectionsToSave({ '2': { type: 'doc', content: [{ type: 'paragraph', content: [] }] } })).toEqual({});
    });
});
