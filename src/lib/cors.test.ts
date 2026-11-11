/** The public site (catalogue, forms, contracts) moved to enadopcion.org (Jon 2026-11-11): its API calls must be accepted. */
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { withCors } from './cors';

const allowed = (origin: string) => withCors(new NextResponse(null), origin).headers.get('Access-Control-Allow-Origin') === origin;

describe('withCors', () => {
    it.each(['https://enadopcion.org', 'https://www.enadopcion.org', 'https://staging.enadopcion.org'])('accepts the new public address %s', (o) => {
        expect(allowed(o)).toBe(true);
    });

    it.each(['https://adoptions.pages.dev', 'https://adoptions-staging.pages.dev', 'https://abc123.adoptions.pages.dev'])('keeps accepting the old address %s', (o) => {
        expect(allowed(o)).toBe(true);
    });

    it.each(['https://evil.org', 'https://enadopcion.org.evil.com', 'https://notenadopcion.org'])('refuses look-alikes: %s', (o) => {
        expect(allowed(o)).toBe(false);
    });
});
