import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORM_STEP_IDS, LOCKED_FORM_STEPS } from './adoptionDocs';

const src = readFileSync(join(__dirname, '../../contract-app/src/lib/adoptionDocs.ts'), 'utf8');
const qsrc = readFileSync(join(__dirname, '../../contract-app/src/lib/formQuestions.ts'), 'utf8');
const appSrc = readFileSync(join(__dirname, 'adoptionDocs.ts'), 'utf8');
/** The new-question lists live in contract-app/src/lib/formQuestions.ts. */
const idsIn = (name: string) => {
    const m = qsrc.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
};
const ids = (name: string) => {
    const m = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
};

describe('contract-app mirror', () => {
    it('FORM_STEP_IDS match', () => expect(ids('FORM_STEP_IDS')).toEqual([...FORM_STEP_IDS]));
    it('LOCKED_FORM_STEPS match', () => expect(ids('LOCKED_FORM_STEPS')).toEqual([...LOCKED_FORM_STEPS]));
    it('DERIVED_FORM_STEPS match', async () => {
        const { DERIVED_FORM_STEPS } = await import('./adoptionDocs');
        expect(ids('DERIVED_FORM_STEPS')).toEqual([...DERIVED_FORM_STEPS]);
    });
    it('FORM_OPTION_TOKENS match', async () => {
        const { FORM_OPTION_TOKENS } = await import('./adoptionDocs');
        expect(ids('FORM_OPTION_TOKENS')).toEqual([...FORM_OPTION_TOKENS]);
    });
    for (const name of ['NEW_FORM_STEPS', 'DEFAULT_OFF_FORM_STEPS', 'VARIANT_FORM_STEPS'] as const) {
        it(`${name} match`, async () => {
            const app = (await import('./adoptionDocs'))[name] as readonly string[];
            expect(idsIn(name)).toEqual([...app]);
        });
    }
    for (const name of ['FOLLOW_UP_HOSTS', 'SPECIES_ONLY_STEPS']) {
        it(`${name} match`, () => {
            const block = (text: string) => {
                const m = text.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\})`));
                return m ? m[1].replace(/\s+/g, '').replace(/,}/g, '}') : null;
            };
            expect(block(qsrc)).not.toBeNull();
            expect(block(qsrc)).toEqual(block(appSrc));
        });
    }
    it('FORM_RELATIONSHIPS match', async () => {
        const { FORM_RELATIONSHIPS } = await import('./householdPeople');
        expect(ids('FORM_RELATIONSHIPS')).toEqual([...FORM_RELATIONSHIPS]);
    });
});
