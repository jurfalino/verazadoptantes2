import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));

import AnimalOwnedElsewhere from './AnimalOwnedElsewhere';

const owner = { displayName: 'Vero E2E', orgName: 'Refugio E2E' };

describe('AnimalOwnedElsewhere', () => {
    it('shows owner name and group, and the public link when listed', () => {
        const html = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Canela', species: 'dog' }} owner={owner} publicUrl="https://adopta.example/animal/x" />,
        );
        expect(html).toContain('Vero E2E');
        // mock t() returns keys, so the org-name substitution is asserted in e2e
        expect(html).toContain('ownedElsewhere.group');
        expect(html).toContain('href="https://adopta.example/animal/x"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('data-kind="dog"');
        expect(html).toContain('href="/my-animals"');
    });
    it('has no public link when not listed', () => {
        const html = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Pirata', species: 'other' }} owner={owner} publicUrl={null} />,
        );
        expect(html).not.toContain('target="_blank"');
        expect(html).toContain('data-kind="tag"');
        expect(html).toContain('>Pirata<');
    });
    it('omits the group line when the owner has no group', () => {
        const html = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Pirata', species: 'cat' }} owner={{ displayName: 'Solo' }} publicUrl={null} />,
        );
        expect(html).not.toContain('ownedElsewhere.group');
    });
    it('renders without an owner card when the owner lookup failed', () => {
        const html = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Pirata', species: 'cat' }} owner={null} publicUrl={null} />,
        );
        expect(html).not.toContain('data-testid="owned-elsewhere-owner"');
        expect(html).toContain('data-testid="owned-elsewhere"');
    });
    it('handles a null name and a very long name', () => {
        const unnamed = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: null, species: null }} owner={owner} publicUrl="https://x/animal/1" />,
        );
        expect(unnamed).toContain('ownedElsewhere.public_link_unnamed');
        const long = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Bartolomeo Segundo de la Costa Atlántica', species: 'other' }} owner={owner} publicUrl={null} />,
        );
        expect(long).toContain('>Bartolome…<');
        expect(long).toContain('break-words');
    });
    it('never renders an email', () => {
        const html = renderToStaticMarkup(
            <AnimalOwnedElsewhere animal={{ name: 'Canela', species: 'dog' }} owner={owner} publicUrl={null} />,
        );
        expect(html).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+/i);
    });
});
