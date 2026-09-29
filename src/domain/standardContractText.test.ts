import { describe, it, expect } from 'vitest';
import { STANDARD_SECTIONS_ES, standardSectionToRichDoc, STANDARD_RICH_DOCS } from './standardContractText';
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
