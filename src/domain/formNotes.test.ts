import { describe, it, expect } from 'vitest';
import { answerNoteLines } from './formNotes';

describe('answerNoteLines — the answers listed in a profile created from a form', () => {
    it('shows a free-text answer as the applicant wrote it, never as {"open":…}', () => {
        expect(answerNoteLines({ rental: { open: 'Alquilo, el dueño acepta gatos' } })).toEqual(['rental: Alquilo, el dueño acepta gatos']);
    });
    it('keeps today\'s lines: plain values as text, other objects as JSON, identity and empty answers left out', () => {
        expect(answerNoteLines({
            name: 'Ana', email: 'a@a.com', selfie: 'x', hoursAlone: '4-8', existingPets: { cats: 1 }, notes: '', gone: null,
        })).toEqual(['hoursAlone: 4-8', 'existingPets: {"cats":1}']);
    });
    it('lists at most 15 answers', () => {
        const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`q${i}`, 'yes']));
        expect(answerNoteLines(many)).toHaveLength(15);
    });
});
