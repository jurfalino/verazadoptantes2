import { describe, it, expect } from 'vitest';
import { decideInvitationAccess, buildContractPrefill, contactUpdateOnSign, splitName, tokenRef } from './contractInvitation';
import { hashEntryValue, type Visibility } from './piiAccess';
import { buildContactEntries, deserializeContactEntries } from './contactEntries';

function vis(partial: Partial<Visibility> = {}): Visibility {
    return {
        tier: 'none', privileged: false, nothingMasked: false, hasAllContactGrant: false,
        unlockedEntryHashes: new Set(), unlockedNameTokenHashes: new Set(), ...partial,
    };
}

// Rescuer A's adopter; rescuer B invites her after «Es la misma persona».
const PHONE = '+54 9 11 5555-0109';
const A_EMAIL = 'carla.privada@example.com';
const DNI = '31.456.789';
const STREET = 'Calle Secreta 1234, Flores';
const carla = {
    name: 'Carla Gómez',
    contactEntries: JSON.stringify([
        { type: 'id', value: DNI, label: 'Documento' },
        { type: 'phone', value: PHONE },
        { type: 'email', value: A_EMAIL },
        { type: 'address', value: STREET },
    ]),
    contactInfo: `Documento: ${DNI}\nTel: ${PHONE}\nEmail: ${A_EMAIL}\nDirección: ${STREET}`,
    addressInfo: STREET,
};

describe('decideInvitationAccess', () => {
    const base = { isApplicant: false, nothingMasked: false, gatingOn: true, adopterIsPublic: false, isOwnerOrTeammate: false };

    it('a foreign adopter who never applied for this animal: refused', () => {
        expect(decideInvitationAccess(base).allowed).toBe(false);
    });

    it('still refused with gating off — the gate also protects the record from a signature', () => {
        expect(decideInvitationAccess({ ...base, gatingOn: false }).allowed).toBe(false);
    });

    it('an applicant for this animal: allowed, but neither full access nor overwrite on a foreign profile', () => {
        expect(decideInvitationAccess({ ...base, isApplicant: true })).toEqual({ allowed: true, fullAccess: false, overwriteOnSign: false });
    });

    it('own / teammate profile: allowed, full access, and a signature may overwrite', () => {
        expect(decideInvitationAccess({ ...base, nothingMasked: true, isOwnerOrTeammate: true }))
            .toEqual({ allowed: true, fullAccess: true, overwriteOnSign: true });
    });

    // Seeing a profile in full is not owning it: these all MERGE on sign.
    it('admin / moderator / approved full-contact grant (nothingMasked, not the team): allowed, full access, merge', () => {
        expect(decideInvitationAccess({ ...base, nothingMasked: true }))
            .toEqual({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

    it('public profile: full access for the pre-fill, still merge on sign', () => {
        expect(decideInvitationAccess({ ...base, isApplicant: true, adopterIsPublic: true }))
            .toEqual({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

    it('gating off: full access for the pre-fill, still merge on sign', () => {
        expect(decideInvitationAccess({ ...base, isApplicant: true, gatingOn: false }))
            .toEqual({ allowed: true, fullAccess: true, overwriteOnSign: false });
    });

});

describe('buildContractPrefill', () => {
    it('applicant on a foreign profile: only what she typed; A\'s email, DNI and street stay blank', () => {
        const p = buildContractPrefill(carla, { fullAccess: false, visibility: vis(), submitted: ['nueva@example.com', '11 5555-0109'] });
        expect(p).toEqual({ name: 'Carla', lastName: 'Gómez', email: '', phone: PHONE, address: '', dni: '' });
    });

    it('never a partial-reveal value', () => {
        const p = buildContractPrefill(carla, { fullAccess: false, visibility: vis(), submitted: [] });
        expect(JSON.stringify(p)).not.toMatch(/•/);
        expect(p.phone).toBe('');
    });

    it('the same email typed in the form fills the email', () => {
        expect(buildContractPrefill(carla, { fullAccess: false, visibility: vis(), submitted: [A_EMAIL] }).email).toBe(A_EMAIL);
    });

    it('an existing grant counts (she sees it on the profile)', () => {
        const visibility = vis({ unlockedEntryHashes: new Set([hashEntryValue('id', DNI)]) });
        expect(buildContractPrefill(carla, { fullAccess: false, visibility, submitted: [] }).dni).toBe(DNI);
    });

    it('full access: today\'s behaviour, every line of the profile', () => {
        expect(buildContractPrefill(carla, { fullAccess: true, visibility: vis(), submitted: [] }))
            .toEqual({ name: 'Carla', lastName: 'Gómez', email: A_EMAIL, phone: PHONE, address: STREET, dni: DNI });
    });

    it('splitName keeps a multi-word first name', () => {
        expect(splitName('María José Pérez')).toEqual({ first: 'María José', last: 'Pérez' });
    });
});

describe('contactUpdateOnSign', () => {
    const signed = {
        entries: buildContactEntries({ emails: ['nueva@example.com'], phones: [PHONE], ids: [], socials: [], addresses: ['Otra Calle 9, Caballito'] }),
        address: 'Otra Calle 9, Caballito',
    };

    it('not her / her team\'s profile: signed values are added; A\'s email, DNI, street and name survive', () => {
        const u = contactUpdateOnSign(carla, signed, false);
        const values = deserializeContactEntries(u.contactEntries).map(e => e.value);
        expect(values).toEqual(expect.arrayContaining([A_EMAIL, DNI, STREET, 'nueva@example.com', PHONE]));
        expect(values.filter(v => v === PHONE)).toHaveLength(1);
        expect(u.addressInfo).toBe(STREET);
        expect(u.replaceName).toBe(false);
    });

    it('her own / team profile: the signed values replace the contact, as before', () => {
        const u = contactUpdateOnSign(carla, signed, true);
        const values = deserializeContactEntries(u.contactEntries).map(e => e.value);
        expect(values).not.toContain(A_EMAIL);
        expect(u.addressInfo).toBe('Otra Calle 9, Caballito');
        expect(u.replaceName).toBe(true);
    });
});

describe('tokenRef', () => {
    it('logs only a prefix of the bearer token', () => {
        const t = '0f8b2c4e-1111-2222-3333-444455556666';
        expect(tokenRef(t)).toBe('0f8b2c4e…');
        expect(tokenRef(t)).not.toContain('4444');
        expect(tokenRef(undefined)).toBe('');
    });
});
