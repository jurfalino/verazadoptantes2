import { test, expect } from '@playwright/test';

/**
 * v2.56.128 — who is in the public catalogue.
 *
 * UNAUTHED, because the catalogue's audience is a stranger looking for an
 * animal to adopt; asserting it with a session proves nothing about what they
 * see. The rescuer's side of the switch is in catalogue.authed.spec.ts.
 *
 * Two rules, and the second exists because the first is not enough: an animal
 * is in the catalogue while it has no permanent home AND the rescuer wants it
 * seen. A tránsito satisfies the first; only the rescuer settles the second.
 */

const FOSTERED = 'test-animal-fixture-cat';       // in a foster home, photo, switch untouched
const HIDDEN = 'test-animal-fixture-hidden';      // available, photo, rescuer switched it off
const ADOPTED = 'test-animal-fixture-1';          // has a home

test.describe('Public catalogue', () => {

    test('an animal in a foster home is in the catalogue', async ({ request }) => {
        // The case this whole change is about: a tránsito used to drop the
        // animal out of the catalogue, which is backwards — it is still
        // looking for a permanent home, and now it has photos of it settled
        // in and someone who knows what it is like to live with.
        const res = await request.get(`/api/showcase/animal/${FOSTERED}`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.animal.animalName).toBe('Catalogo');
    });

    test('the foster home is not named anywhere on its public page', async ({ request }) => {
        // Being in the catalogue must not disclose whose house it is in.
        const raw = await (await request.get(`/api/showcase/animal/${FOSTERED}`)).text();
        expect(raw).not.toContain('Tránsito Catálogo');
        expect(raw).not.toContain('test-adopter-fixture-cat');
        expect(raw).not.toContain('test-plc-fixture-cat');
        const body = await (await request.get(`/api/showcase/animal/${FOSTERED}`)).json();
        expect(body.animal.adopterId).toBeUndefined();
    });

    test('it also shows up in the catalogue listing, not only by direct link', async ({ request }) => {
        const res = await request.get('/api/showcase/all');
        expect(res.status()).toBe(200);
        const body = await res.json();
        const ids = (body.animals as { id: string }[]).map(a => a.id);
        expect(ids).toContain(FOSTERED);
        expect(ids).not.toContain(HIDDEN);
        expect(ids).not.toContain(ADOPTED);
    });

    test('an animal the rescuer took out is not in the catalogue', async ({ request }) => {
        // Everything else about it is unchanged — still available, still has
        // its photo. Only the switch is off.
        const res = await request.get(`/api/showcase/animal/${HIDDEN}`);
        expect(res.status()).toBe(404);
        expect(await res.text()).not.toContain('Escondido');
    });

    test('an animal with a home is still never in the catalogue', async ({ request }) => {
        const res = await request.get(`/api/showcase/animal/${ADOPTED}`);
        expect(res.status()).toBe(404);
    });
});
