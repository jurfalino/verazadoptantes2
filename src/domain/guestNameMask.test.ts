import { describe, it, expect } from 'vitest';
import { maskGuestName, maskNameWordsInText, guestNameWords, typedWords } from './guestNameMask';

describe('maskGuestName', () => {
    it('keeps the typed words and masks the rest to an initial plus a fixed run', () => {
        expect(maskGuestName('María Rosa Rodríguez López', typedWords('maria')))
            .toBe('María R•••• R•••• L••••');
    });

    it('matches typed words regardless of accents and case', () => {
        expect(maskGuestName('MARIA Pérez', typedWords('maría perez'))).toBe('MARIA Pérez');
    });

    it('masks every word when the search was not a name (a phone, say)', () => {
        expect(maskGuestName('Juan Gómez', typedWords('1155443322'))).toBe('J•••• G••••');
    });

    it('does not reveal a word because its initial was typed', () => {
        expect(maskGuestName('Ana Bell', typedWords('a b'))).toBe('A•••• B••••');
    });

    it('gives every masked word the same length, whatever its real length', () => {
        const out = maskGuestName('Al Maximiliano', typedWords(''));
        expect(out).toBe('A•••• M••••');
    });

    it('handles an empty name', () => {
        expect(maskGuestName('', typedWords('maria'))).toBe('');
        expect(maskGuestName('   ', typedWords('maria'))).toBe('');
    });
});

describe('maskNameWordsInText', () => {
    const name = 'María Paula Garibotto Otto';

    it('masks the person’s name words inside the contact line', () => {
        const words = guestNameWords(name);
        expect(maskNameWordsInText('Redes: MARÍA OTTO EN FACEBOOK Redes: Paula Transito', words, typedWords('maria')))
            .toBe('Redes: MARÍA O•••• EN FACEBOOK Redes: P•••• Transito');
    });

    it('also masks alias words', () => {
        const words = guestNameWords('María Agustina Barron', ['Barron Maria Agustina', 'Tina']);
        expect(maskNameWordsInText('Conocido/a como: Barron Maria Agustina, Tina', words, typedWords('maria')))
            .toBe('Conocido/a como: B•••• Maria A••••, T••••');
    });

    it('leaves labels, masked values and unrelated words alone', () => {
        const words = guestNameWords(name);
        const line = 'Tel: 15-50••-•••• Dirección: •••••, CABA';
        expect(maskNameWordsInText(line, words, typedWords('maria'))).toBe(line);
    });

    it('only replaces whole words, never part of a handle', () => {
        const words = guestNameWords('Otto');
        expect(maskNameWordsInText('instagram.com/ottomanfan', words, typedWords(''))).toBe('instagram.com/ottomanfan');
    });
});
