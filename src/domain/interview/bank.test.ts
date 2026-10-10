import { describe, it, expect } from 'vitest';
import { QUESTION_BANK, questionById, textMatches } from './bank';
import { es } from '@/i18n/locales/es';
import { en } from '@/i18n/locales/en';
import { pt } from '@/i18n/locales/pt';

const LOCALES = { es, en, pt } as const;
type Dict = Record<string, unknown>;
const get = (d: Dict, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], d);

describe('QUESTION_BANK', () => {
    it('has ~40 questions with unique ids across all three stages', () => {
        const ids = QUESTION_BANK.map(q => q.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(38);
        for (const s of ['rapport', 'story', 'details']) expect(QUESTION_BANK.some(q => q.stage === s)).toBe(true);
    });

    it('every question, hint and choice has copy in es, en and pt', () => {
        for (const [loc, dict] of Object.entries(LOCALES)) {
            for (const q of QUESTION_BANK) {
                expect(typeof get(dict as Dict, `interview.q.${q.id}`), `${loc} interview.q.${q.id}`).toBe('string');
                if (q.hint) expect(typeof get(dict as Dict, `interview.h.${q.id}`), `${loc} interview.h.${q.id}`).toBe('string');
                for (const c of q.choices ?? []) expect(typeof get(dict as Dict, `interview.choice.${c}`), `${loc} choice.${c}`).toBe('string');
            }
            for (const s of ['rapport', 'story', 'details']) {
                for (const k of ['title', 'goal', 'tip1', 'tip2', 'tip3', 'tip4']) {
                    expect(typeof get(dict as Dict, `interview.technique.${s}.${k}`), `${loc} technique.${s}.${k}`).toBe('string');
                }
            }
        }
    });

    it('follow-ups point at real parents; choice questions declare choices', () => {
        for (const q of QUESTION_BANK) {
            for (const p of q.followUpOf?.parents ?? []) expect(questionById(p), `${q.id} → ${p}`).toBeDefined();
            if (q.kind === 'choice') expect(q.choices?.length).toBeGreaterThan(1);
        }
    });

    it('the lost-pet follow-up fires in all three languages and stays quiet otherwise', () => {
        const q = questionById('details_pet_what_happened')!;
        for (const text of ['Se me perdió en 2022', 'He ran away last year', 'Ele fugiu de casa']) {
            expect(q.followUpOf!.test({ status: 'answered', text })).toBe(true);
        }
        expect(q.followUpOf!.test({ status: 'answered', text: 'Vive conmigo, tiene 12 años' })).toBe(false);
    });

    it('textMatches also reads choices and household relationships', () => {
        expect(textMatches(/^rent$/)({ status: 'answered', choice: 'rent' })).toBe(true);
        expect(textMatches(/child/)({ status: 'answered', household: [{ name: 'Leo', relationship: 'child' }] })).toBe(true);
    });

    it('KIDS follow-up avoids false positives', () => {
        const t = questionById('details_kids')!.followUpOf!.test;
        expect(t({ status: 'answered', text: 'Mis padres son jubilados' })).toBe(false);
        expect(t({ status: 'answered', household: [{ name: 'Nelson', relationship: 'parent' }] })).toBe(false);
        expect(t({ status: 'answered', text: 'Tengo dos hijos' })).toBe(true);
        expect(t({ status: 'answered', household: [{ name: 'Leo', relationship: 'child' }] })).toBe(true);
    });

    it('PETS_NOW follow-up avoids false positives', () => {
        const t = questionById('details_pets_now_care')!.followUpOf!.test;
        expect(t({ status: 'answered', text: 'Vivo con Catalina' })).toBe(false);
        expect(t({ status: 'answered', text: 'Es obligatorio' })).toBe(false);
        expect(t({ status: 'answered', text: 'Tengo un perro y dos gatos' })).toBe(true);
        expect(t({ status: 'answered', text: 'I have a dog' })).toBe(true);
    });

    it('LOST_PET follow-up ignores unrelated words', () => {
        const t = questionById('details_pet_what_happened')!.followUpOf!.test;
        expect(t({ status: 'answered', text: 'I studied vet medicine' })).toBe(false);
    });
});
