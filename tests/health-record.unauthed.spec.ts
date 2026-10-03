import { test, expect } from '@playwright/test';

/**
 * v2.56.123 — /api/showcase/health/[id], the public feed behind the shared
 * veterinary record at adoptions…/salud/:id.
 *
 * UNAUTHED on purpose. The real consumer is a family opening a WhatsApp link
 * in a browser that has never signed in, from another origin. Asserting this
 * from the `authed` project would carry the admin's session cookie and prove
 * nothing about what a stranger receives — and "what a stranger receives" is
 * the entire security property of this endpoint.
 *
 * The privacy assertions grep the WHOLE response body for names that exist in
 * the seed, rather than checking that particular fields are absent. The
 * failure that matters is not a field someone thought about; it is a caption,
 * a details string or a join nobody thought about putting a person into a link
 * that leaves the app.
 */

const ADOPTED = 'test-animal-fixture-1';          // Timon: adopted, one vaccination, one event photo
const NOTE_ONLY = 'test-animal-fixture-note';     // Soloanota: one `note`, nothing clinical

// Seeded people and households that must never reach the family (seed.sql).
const ADOPTER_NAME = 'Fátima';
const FOSTER_NAME = 'Tránsito Timeline';

test.describe('Health record API (anonymous visitor)', () => {

    test('serves the clinical timeline with its photos', async ({ request }) => {
        const res = await request.get(`/api/showcase/health/${ADOPTED}`);
        expect(res.status()).toBe(200);
        expect(res.headers()['x-robots-tag']).toContain('noindex');

        const body = await res.json();
        expect(body.animal.id).toBe(ADOPTED);
        expect(body.animal.name).toBe('Timon');

        const vac = body.events.find((e: { eventType: string }) => e.eventType === 'vaccination');
        expect(vac).toBeTruthy();
        expect(vac.details).toContain('Quíntuple');
        expect(vac.date).toBeGreaterThan(0);
        expect(vac.images.length).toBeGreaterThanOrEqual(1);
        expect(vac.images[0].caption).toContain('Carnet');

        for (const e of body.events) {
            expect(['vaccination', 'deworming', 'vet_visit', 'neuter']).toContain(e.eventType);
        }

        // "Recorded up to" is the freshest CLINICAL date, so the page can say
        // how far the record goes without implying anything past it.
        expect(body.recordedUpTo).toBe(
            Math.max(...body.events.map((e: { date: number }) => e.date)),
        );
    });

    test('shows the animal\'s own photos and not the one from its adoption', async ({ request }) => {
        // All three seeded rows sit on `adoption_id = <animal id>`, and two of
        // them carry the SAME adopter_id — the one added from «Editar» on the
        // animal page while Timon was already adopted, and the one attached to
        // the adoption record. Nothing but `scope` separates those two, which
        // is the whole reason the column exists.
        const res = await request.get(`/api/showcase/health/${ADOPTED}`);
        expect(res.status()).toBe(200);
        const body = await res.json();

        const ids = body.animal.images.map((i: { id: string }) => i.id);
        expect(ids).toContain('test-img-fixture-listing');
        // Added while the animal was ALREADY adopted — still the animal's.
        expect(ids).toContain('test-img-fixture-while-placed');
        // Attached to the adoption from the adopter's side — never the family's.
        expect(ids).not.toContain('test-img-fixture-adoption');
    });

    test('carries no person but the rescue', async ({ request }) => {
        const res = await request.get(`/api/showcase/health/${ADOPTED}`);
        expect(res.status()).toBe(200);
        const raw = await res.text();

        // Timon has an ACTIVE adoption and an ENDED foster span. Neither
        // household may appear anywhere — not in a field, not in a caption,
        // not inside a details string.
        expect(raw).not.toContain(ADOPTER_NAME);
        expect(raw).not.toContain(FOSTER_NAME);
        expect(raw).not.toContain('test-adopter-fixture-tl1');
        expect(raw).not.toContain('test-adopter-fixture-tl2');
        expect(raw).not.toContain('test-plc-fixture-1a');
        // The seeded follow-up is a note ABOUT THE FAMILY, so it is not here.
        expect(raw).not.toContain('Muy bien adaptado');
        // Free-text description: a third of production ones name a household.
        expect(raw).not.toContain('Perro fixture');

        const body = await res.json();
        expect(body.animal.details).toBeUndefined();
        expect(body.placements).toBeUndefined();
        expect(body.adopter).toBeUndefined();
        expect(body.rating).toBeUndefined();
        // The one person named is the rescue, and without the handle/userId
        // the adoption listing exposes for its "apply to adopt" CTA.
        expect(body.rescuer.displayName).toBeTruthy();
        expect(body.rescuer.userId).toBeUndefined();
        expect(body.rescuer.userHandle).toBeUndefined();
    });

    test('a video arrives as a video, with its poster', async ({ request }) => {
        // Without mediaType the page drops an .mp4 into an <img> and the
        // family sees a broken frame where the animal should be.
        const res = await request.get(`/api/showcase/health/${ADOPTED}`);
        const body = await res.json();
        const vid = body.animal.images.find((i: { id: string }) => i.id === 'test-vid-fixture-animal');
        expect(vid).toBeTruthy();
        expect(vid.mediaType).toBe('video');
        expect(vid.thumbnailUrl).toBeTruthy();
    });

    test('an animal with only a free-text note has no record at all', async ({ request }) => {
        // Soloanota's single event is a `note` that names a foster family.
        // 404, not an empty page: a rescuer must not be able to send a link to
        // nothing, and the note must never be the thing that fills it.
        const res = await request.get(`/api/showcase/health/${NOTE_ONLY}`);
        expect(res.status()).toBe(404);
        expect(await res.text()).not.toContain('Belgrano');
    });

    test('a missing animal 404s', async ({ request }) => {
        const res = await request.get('/api/showcase/health/test-animal-does-not-exist');
        expect(res.status()).toBe(404);
    });
});

test.describe('Public adoption listing of a RETURNED animal', () => {
    // v2.56.124. A devolución puts the animal back on the public catalog, and
    // by then its newest photos are the ones from the adoption it just left.
    // Both seeded rows sit on the animal's key with the SAME adopter_id, so
    // `scope` is the only thing standing between a stranger and a photo of the
    // family — which is why this is asserted against the LIVE listing route,
    // not only against the health record.
    const RETURNED = 'test-animal-fixture-ret';

    test('the health record link stops working once the animal is back', async ({ request }) => {
        // Vuelta HAS a vaccination on file, so this 404 is about custody: the
        // family that was handed this link no longer has the animal
        // (product decision, 2026-10-03).
        const res = await request.get(`/api/showcase/health/${RETURNED}`);
        expect(res.status()).toBe(404);
        expect(await res.text()).not.toContain('Triple felina');
    });

    test('the listing leaves out a video it cannot play', async ({ request }) => {
        const res = await request.get(`/api/showcase/animal/${RETURNED}`);
        const body = await res.json();
        const ids = body.animal.images.map((i: { id: string }) => i.id);
        expect(ids).toContain('test-img-ret-animal');
        expect(ids).not.toContain('test-vid-ret-animal');
    });

    test('brings back the animal\'s photos and not the adoption\'s', async ({ request }) => {
        const res = await request.get(`/api/showcase/animal/${RETURNED}`);
        expect(res.status()).toBe(200);

        const raw = await res.text();
        expect(raw).not.toContain('Devuelto Timeline');
        expect(raw).not.toContain('firmando el contrato');

        const body = await res.json();
        const ids = body.animal.images.map((i: { id: string }) => i.id);
        expect(ids).toContain('test-img-ret-animal');
        expect(ids).not.toContain('test-img-ret-placement');
    });
});
