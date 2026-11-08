import { describe, it, expect } from 'vitest';
import { formBackLink } from './formBackLink';

describe('formBackLink — the form screen\'s back link names where you came from', () => {
    it('from Mis adoptantes → back to Mis adoptantes', () => {
        expect(formBackLink('adopters', {})).toEqual({ href: '/my-adopters', label: { key: 'formResults.back_to_adopters' } });
    });

    it('from a profile → back to that profile, by name', () => {
        expect(formBackLink('adopter:abc-123', { adopter: 'Pedro Paez' }))
            .toEqual({ href: '/adopter/abc-123', label: { key: 'formResults.back_to_name', name: 'Pedro Paez' } });
    });

    it('from an animal → back to that animal, by name', () => {
        expect(formBackLink('animal:luna_1', { animal: 'Luna' }))
            .toEqual({ href: '/my-animals/luna_1', label: { key: 'formResults.back_to_name', name: 'Luna' } });
    });

    it('no source, an unknown source, or a source whose name the page could not confirm → Mis adoptantes', () => {
        const home = { href: '/my-adopters', label: { key: 'formResults.back_to_adopters' } };
        expect(formBackLink(null, {})).toEqual(home);
        expect(formBackLink('notifications', {})).toEqual(home);
        expect(formBackLink('adopter:abc-123', { adopter: null })).toEqual(home);
    });

    it('a malformed id falls back — `from` never builds an arbitrary link', () => {
        const home = { href: '/my-adopters', label: { key: 'formResults.back_to_adopters' } };
        expect(formBackLink('adopter:../../evil', { adopter: 'X' })).toEqual(home);
        expect(formBackLink('animal:' + 'a'.repeat(65), { animal: 'X' })).toEqual(home);
    });
});
