import { describe, it, expect } from 'vitest';
import { canonicalRedirect } from './canonicalHost';

describe('canonicalRedirect — old addresses land on enadopcion.org (Jon 2026-11-11)', () => {
    it('the old production address keeps the path and query (printed QR codes, shared links)', () => {
        expect(canonicalRedirect('https://adoptions.pages.dev/catalogo/gatitos?animal=luna', 'enadopcion.org'))
            .toBe('https://enadopcion.org/catalogo/gatitos?animal=luna');
    });

    it('the old staging address goes to the staging domain', () => {
        expect(canonicalRedirect('https://adoptions-staging.pages.dev/contract/abc', 'staging.enadopcion.org'))
            .toBe('https://staging.enadopcion.org/contract/abc');
    });

    it('www goes to the bare domain', () => {
        expect(canonicalRedirect('https://www.enadopcion.org/form/x', 'enadopcion.org')).toBe('https://enadopcion.org/form/x');
    });

    it('the canonical address itself is never redirected (no loop)', () => {
        expect(canonicalRedirect('https://enadopcion.org/', 'enadopcion.org')).toBeNull();
        expect(canonicalRedirect('https://staging.enadopcion.org/', 'staging.enadopcion.org')).toBeNull();
    });

    it('switched off until CANONICAL_HOST is set: nothing redirects', () => {
        expect(canonicalRedirect('https://adoptions.pages.dev/', undefined)).toBeNull();
        expect(canonicalRedirect('https://adoptions.pages.dev/', '')).toBeNull();
    });

    it('preview deployments (<hash>.adoptions.pages.dev) and unknown hosts are left alone', () => {
        expect(canonicalRedirect('https://3f2a.adoptions.pages.dev/', 'enadopcion.org')).toBeNull();
        expect(canonicalRedirect('http://localhost:5173/', 'enadopcion.org')).toBeNull();
    });
});
