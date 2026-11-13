import { test, expect } from '@playwright/test';

/**
 * Group branding on the public JSON responses (flag ENABLE_GROUP_BRANDING is ON in the seed).
 * UNAUTHED: the audience is a stranger opening a rescuer's link.
 */
const SOLO = 'test-user-fixture-brand-solo';
const TWO = 'test-user-fixture-brand-two';
const LEFT = 'test-user-fixture-brand-left';

test.describe('Public responses carry the group branding', () => {
    test('form: a member\'s ?g= hint wins over the chosen group', async ({ request }) => {
        const res = await request.get(`/api/form/${TWO}?g=refugio-marca-e2e`);
        expect(res.status()).toBe(200);
        expect((await res.json()).branding.orgSlug).toBe('refugio-marca-e2e');
    });

    test('form: a forged ?g= is ignored', async ({ request }) => {
        const res = await request.get(`/api/form/${SOLO}?g=refugio-e2e`);
        expect(res.status()).toBe(200);
        expect((await res.json()).branding.orgSlug).toBe('refugio-marca-e2e');
    });

    test('form: sole member gets the group look', async ({ request }) => {
        const res = await request.get(`/api/form/${SOLO}`);
        expect((await res.json()).branding).toMatchObject({ orgSlug: 'refugio-marca-e2e', theme: 'light', accentId: 'naranja' });
    });

    test('form: a member who left gets no branding and no error', async ({ request }) => {
        const res = await request.get(`/api/form/${LEFT}`);
        expect(res.status()).toBe(200);
        expect((await res.json()).branding).toBeNull();
    });

    test('org showcase: branded group vs. group without branding', async ({ request }) => {
        const a = await (await request.get('/api/showcase/org/refugio-marca-e2e')).json();
        expect(a.branding.logoUrl).toBe('https://example.com/logo.jpg');
        const b = await request.get('/api/showcase/org/refugio-e2e');
        expect(b.status()).toBe(200);
        expect((await b.json()).branding).toBeNull();
    });

    test('animal showcase: branding and rescuer group agree', async ({ request }) => {
        const res = await request.get('/api/showcase/animal/test-animal-fixture-brand');
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.branding.orgSlug).toBe('refugio-marca-e2e');
        expect(body.animal.rescuer.orgSlug).toBe('refugio-marca-e2e');
    });
});
