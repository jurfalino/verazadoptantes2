import { describe, it, expect } from 'vitest';
import { formSubmissionOwnerTitle, formSubmissionTeammateTitle } from './formNotification';

/**
 * Bell titles for a new adoption-form submission. Titles are stored strings
 * (Spanish, like every notification title), not i18n keys.
 *
 * The form-link owner's wording is unchanged. Teammates get the SAME title
 * when the form targeted an animal («Valeria Sosa aplicó para Luna …»), and
 * keep the generic «Nueva respuesta al formulario» without one.
 */
describe('formSubmissionOwnerTitle (unchanged wording)', () => {
    it('names the animal when there is one', () => {
        expect(formSubmissionOwnerTitle({ submitterName: 'Valeria Sosa', animalName: 'Luna', matchCount: 0 }))
            .toBe('Valeria Sosa aplicó para Luna');
    });

    it('falls back to «completó el formulario» without an animal', () => {
        expect(formSubmissionOwnerTitle({ submitterName: 'Valeria Sosa', animalName: null, matchCount: 0 }))
            .toBe('Valeria Sosa completó el formulario');
    });

    it('appends the match count, singular and plural', () => {
        expect(formSubmissionOwnerTitle({ submitterName: 'Valeria Sosa', animalName: 'Luna', matchCount: 1 }))
            .toBe('Valeria Sosa aplicó para Luna — 1 coincidencia');
        expect(formSubmissionOwnerTitle({ submitterName: 'Valeria Sosa', animalName: null, matchCount: 3 }))
            .toBe('Valeria Sosa completó el formulario — 3 coincidencias');
    });
});

describe('formSubmissionTeammateTitle', () => {
    it('with an animal: exactly the owner\'s title', () => {
        for (const matchCount of [0, 1, 2]) {
            const input = { submitterName: 'Valeria Sosa', animalName: 'Luna', matchCount };
            expect(formSubmissionTeammateTitle(input)).toBe(formSubmissionOwnerTitle(input));
        }
        expect(formSubmissionTeammateTitle({ submitterName: 'Valeria Sosa', animalName: 'Luna', matchCount: 0 }))
            .toBe('Valeria Sosa aplicó para Luna');
    });

    it('without an animal: the current generic title', () => {
        expect(formSubmissionTeammateTitle({ submitterName: 'Valeria Sosa', animalName: null, matchCount: 2 }))
            .toBe('Nueva respuesta al formulario');
        expect(formSubmissionTeammateTitle({ submitterName: 'Valeria Sosa', animalName: '  ', matchCount: 0 }))
            .toBe('Nueva respuesta al formulario');
    });
});
