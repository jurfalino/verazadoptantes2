import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARD_SECTIONS_ES, standardSectionToRichDoc, STANDARD_RICH_DOCS } from './standardContractText';
import { normalizeRichDoc, canonicalSectionsJson } from './adoptionDocs';

const contractAppSource = readFileSync(join(__dirname, '../../contract-app/src/i18n/contractContent.ts'), 'utf8');

describe('standard contract text mirror', () => {
    it('every es title/intro/clause string exists verbatim in contract-app contractContent.ts', () => {
        for (const s of Object.values(STANDARD_SECTIONS_ES)) {
            const strings = [s.title, s.intro, ...s.clauses.flatMap(c => [c.title, c.body])].filter(Boolean) as string[];
            for (const str of strings) expect(contractAppSource).toContain(`'${str}'`);
        }
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
