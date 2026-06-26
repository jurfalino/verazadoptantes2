import { describe, it, expect } from 'vitest';
import {
    WALKTHROUGH_DEMO_FIXTURES,
    fixtureToEdit,
    applyOverlayToEdit,
    editToOverlay,
    editToAdopterRow,
    buildDemoMatch,
    demoAdopterRow,
    type DemoRecordEdit,
} from './walkthroughDemo';
import { deserializeContactEntries } from './contactEntries';

const bueno = WALKTHROUGH_DEMO_FIXTURES.find(f => f.id === 'demo-juan-bueno')!;
const dudoso = WALKTHROUGH_DEMO_FIXTURES.find(f => f.id === 'demo-juan-dudoso')!;

describe('walkthrough demo admin round-trip', () => {
    it('flattens a fixture into the editable shape', () => {
        const e = fixtureToEdit(bueno);
        expect(e.name).toBe('Juan BuenAdoptante');
        expect(e.rating).toBe(4);
        expect(e.verifiedAddress).toBe(true);
        expect(e.isPublic).toBe(false);
        expect(e.phone).toContain('4567');
        expect(e.email).toContain('@');
        expect(fixtureToEdit(dudoso).tooManyAdoptionsCount).toBe(4);
    });

    it('editToOverlay reflects edited rating + flags', () => {
        const e: DemoRecordEdit = { ...fixtureToEdit(bueno), rating: 3, verifiedAddress: false, tooManyAdoptionsCount: 5, tooManyAdoptionsDays: 10, adoptions: 12 };
        const o = editToOverlay(e);
        expect(o.avgRating).toBe(3);
        expect(o.flags.verified_address).toBe(false);
        expect(o.flags.tooManyAdoptions).toEqual(expect.objectContaining({ count: 5, periodDays: 10 }));
        expect(o.stats.adoptions).toBe(12);
    });

    it('editToOverlay clears the too-many-adoptions flag at count 0', () => {
        const e: DemoRecordEdit = { ...fixtureToEdit(dudoso), tooManyAdoptionsCount: 0 };
        expect(editToOverlay(e).flags.tooManyAdoptions).toBeNull();
    });

    it('editToAdopterRow serializes the filled contact fields', () => {
        const e: DemoRecordEdit = { ...fixtureToEdit(bueno), phone: '+54 11 9999-0000', email: 'x@y.com', social: '', address: 'Calle Test 1' };
        const row = editToAdopterRow(e);
        const entries = deserializeContactEntries(row.contactEntries);
        expect(entries.map(x => x.type).sort()).toEqual(['address', 'email', 'phone']);
        expect(entries.find(x => x.type === 'phone')!.value).toBe('+54 11 9999-0000');
        expect(row.isDemo).toBe(1);
        expect(row.deletedAt).not.toBeNull(); // stays soft-deleted → excluded from search
    });

    it('a public edit renders unmasked; a gated edit renders masked', () => {
        const publicEdit: DemoRecordEdit = { ...fixtureToEdit(bueno), isPublic: true, phone: '+54 11 2222-3333' };
        const publicMatch = buildDemoMatch(editToAdopterRow(publicEdit), editToOverlay(publicEdit), false);
        expect(publicMatch.adopter.contactInfo).toContain('2222-3333'); // shown

        const gatedEdit: DemoRecordEdit = { ...fixtureToEdit(bueno), isPublic: false, phone: '+54 11 2222-3333' };
        const gatedMatch = buildDemoMatch(editToAdopterRow(gatedEdit), editToOverlay(gatedEdit), true);
        expect(gatedMatch.adopter.contactInfo).toContain('•'); // masked
        expect(gatedMatch.adopter.contactInfo).not.toContain('2222-3333');
    });

    it('applyOverlayToEdit is the inverse of editToOverlay', () => {
        const e0 = fixtureToEdit(dudoso);
        const round = applyOverlayToEdit(e0, editToOverlay(e0));
        expect(round.rating).toBe(e0.rating);
        expect(round.tooManyAdoptionsCount).toBe(e0.tooManyAdoptionsCount);
        expect(round.adoptions).toBe(e0.adoptions);
    });

    it('demoAdopterRow stays excluded (soft-deleted + isDemo)', () => {
        const row = demoAdopterRow(bueno);
        expect(row.isDemo).toBe(1);
        expect(row.deletedAt).not.toBeNull();
    });
});
