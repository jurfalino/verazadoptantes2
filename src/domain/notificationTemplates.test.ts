import { describe, it, expect } from 'vitest';
import {
    localizedNotification,
    NOTIFICATION_TEMPLATE_KEYS,
    notificationContent,
    renderNotification,
    templateFromMetadata,
    type NotificationLocale,
    type NotificationTemplate,
} from './notificationTemplates';

const sides = {
    survivorName: 'Julieta Paz', survivorOwner: 'María', survivorDate: '2026-10-22T15:00:00.000Z',
    absorbedName: 'Julieta Paz', absorbedOwner: 'Jon', absorbedDate: '2026-09-03T15:00:00.000Z',
};

/** One filled-in sample per key: the compiler checks every key is covered. */
const SAMPLES: { [K in NotificationTemplate['key']]: Extract<NotificationTemplate, { key: K }>['params'] } = {
    member_joined: { memberName: 'Ana', orgName: 'Patitas' },
    contact_entry_added: { actorName: 'Ana', adopterName: 'Carla Gómez', entryType: 'phone' },
    ownership_transferred: { role: 'to', adopterName: 'Carla', actorName: 'Admin', toName: 'Ana' },
    pii_access_approved: { adopterName: 'Carla' },
    pii_access_denied: { adopterName: 'Carla', note: 'falta info' },
    pii_access_revoked: { adopterName: 'Carla' },
    pii_access_request: { requesterName: 'Ana', adopterName: 'Carla', kind: 'direct' },
    deletion_request: { requesterName: 'Ana' },
    adopter_flagged: { reporterName: 'Ana', reason: 'dangerous' },
    contract_attached: { actorName: 'Ana', profileName: 'Carla', animalName: 'Luna' },
    form_attached: { actorName: 'Ana', profileName: 'Carla' },
    form_submission_owner: { submitterName: 'Juana', animalName: 'Luna', matchCount: '2' },
    form_submission_teammate: { submitterName: 'Juana', matchCount: '0', sharedByName: 'Ana' },
    contract_result_matches: { adopterName: 'Juana', animalName: 'Luna', matchCount: '1' },
    contract_result_clear: { adopterName: 'Juana', animalName: 'Luna' },
    contract_result_teammate: { adopterName: 'Juana', animalName: 'Luna' },
    api_access: { decision: 'approve', exact: '100', fuzzy: '20' },
    api_record: { personName: 'Juana', context: 'adoption', keyName: 'Catpuccino', outcome: 'found', contactsAdded: 'email,phone' },
    api_access_requested: { requesterEmail: 'dev@example.com', tool: 'Zapier' },
    merge_request: { requesterName: 'Jon', ...sides },
    merge_request_accepted: { actorName: 'María', ...sides },
    merge_request_flipped: { actorName: 'María', ...sides },
    merge_request_declined: { actorName: 'María', ...sides },
    merge_request_answered_by_teammate: { actorName: 'Ana', requesterName: 'Jon', outcome: 'accepted', ...sides },
    adopter_merged_by_rescuer: { actorName: 'Jon', ...sides },
    adopter_merged_by_admin: sides,
    pair_message: { fromName: 'Jon', profileName: 'Julieta Paz', message: 'Hola' },
    household_linked: { actorName: 'Jon', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' },
    household_link_hidden: { actorName: 'María', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' },
};

const LOCALES: NotificationLocale[] = ['es', 'en', 'pt'];

describe('renderNotification', () => {
    it('every key renders a non-empty title and body in es, en and pt', () => {
        expect(NOTIFICATION_TEMPLATE_KEYS.sort()).toEqual(Object.keys(SAMPLES).sort());
        for (const key of NOTIFICATION_TEMPLATE_KEYS) {
            for (const locale of LOCALES) {
                const out = renderNotification({ key, params: SAMPLES[key] }, locale);
                expect(out, `${key}/${locale}`).not.toBeNull();
                expect(out!.title.trim(), `${key}/${locale} title`).not.toBe('');
                expect(out!.body.trim(), `${key}/${locale} body`).not.toBe('');
                expect(out!.title + out!.body, `${key}/${locale}`).not.toMatch(/undefined|\{\w+\}/);
            }
        }
    });

    it('en and pt are translations, not the Spanish text', () => {
        for (const key of NOTIFICATION_TEMPLATE_KEYS) {
            if (key === 'pair_message') continue; // the body is the sender's own words
            const es = renderNotification({ key, params: SAMPLES[key] }, 'es')!;
            expect(renderNotification({ key, params: SAMPLES[key] }, 'en')!.body, key).not.toBe(es.body);
        }
    });

    it('Spanish reproduces today\'s strings', () => {
        // addContactEntry.ts
        expect(renderNotification({ key: 'contact_entry_added', params: { actorName: 'Ana', adopterName: 'Carla Gómez', entryType: 'social' } }, 'es'))
            .toEqual({ title: 'Nuevo dato de contacto', body: 'Ana agregó una red social a Carla Gómez.' });
        // piiAccess.ts revoke
        expect(renderNotification({ key: 'pii_access_revoked', params: { adopterName: 'Carla' } }, 'es'))
            .toEqual({ title: 'Acceso a contacto removido', body: 'Tu acceso a los datos de contacto de Carla fue removido.' });
        // contract submit, no matches
        expect(renderNotification({ key: 'contract_result_clear', params: { adopterName: 'Juana Pérez', animalName: 'Luna' } }, 'es'))
            .toEqual({ title: 'Luna adoptado por Juana Pérez', body: 'No se encontraron registros previos para Juana Pérez. Todo en orden.' });
        // form submit with an animal and matches (formSubmissionOwnerTitle)
        expect(renderNotification({ key: 'form_submission_owner', params: { submitterName: 'Juana', animalName: 'Luna', matchCount: '2' } }, 'es'))
            .toEqual({ title: 'Juana aplicó para Luna — 2 coincidencias', body: 'Se encontraron posibles registros previos. Tocá para revisar las respuestas y vincular.' });
        // merge request declined: «rechazó» (D30)
        expect(renderNotification({ key: 'merge_request_declined', params: { actorName: 'owner', survivorName: 'A', absorbedName: 'B' } }, 'es')!.title)
            .toBe('owner rechazó combinar dos perfiles');
    });

    it('unknown key, missing required param, non-string param or unknown code → null', () => {
        expect(renderNotification({ key: 'nope', params: {} }, 'es')).toBeNull();
        expect(renderNotification({ key: 'member_joined', params: {} }, 'en')).toBeNull();
        expect(renderNotification({ key: 'member_joined', params: { memberName: 3 } }, 'en')).toBeNull();
        expect(renderNotification({ key: 'ownership_transferred', params: { role: 'sideways', actorName: 'a', toName: 'b' } }, 'es')).toBeNull();
        expect(renderNotification({ key: 'api_access', params: { decision: 'approve' } }, 'es')).toBeNull();
        expect(renderNotification({ key: 'form_submission_owner', params: { submitterName: 'J', matchCount: 'two' } }, 'es')).toBeNull();
        expect(renderNotification({ key: 'toString', params: {} }, 'es')).toBeNull();
    });

    it('a missing optional name picks each language\'s own fallback, never a hole', () => {
        expect(renderNotification({ key: 'member_joined', params: { memberName: 'Ana' } }, 'es')!.body).toBe('Ana se unió a la organización.');
        expect(renderNotification({ key: 'member_joined', params: { memberName: 'Ana' } }, 'en')!.body).toBe('Ana joined the organization.');
        expect(renderNotification({ key: 'pii_access_revoked', params: {} }, 'pt')!.body).toBe('Seu acesso aos dados de contato de um adotante foi removido.');
    });

    it('same-name pairs: each side shows its owner and date, per locale (D31)', () => {
        const es = renderNotification({ key: 'merge_request', params: SAMPLES.merge_request }, 'es')!;
        expect(es.body).toContain("se conserva «Julieta Paz (de María, 22 oct '26)» y se absorbe «Julieta Paz (de Jon, 3 sept '26)»");
        const en = renderNotification({ key: 'merge_request', params: SAMPLES.merge_request }, 'en')!;
        expect(en.body).toContain("“Julieta Paz (from María, Oct 22 '26)” stays");
        const pt = renderNotification({ key: 'adopter_merged_by_admin', params: SAMPLES.adopter_merged_by_admin }, 'pt')!;
        expect(pt.body).toContain("«Julieta Paz (de María, 22 out '26)»");
        // No owner, no date: just the name.
        const bare = renderNotification({ key: 'merge_request_declined', params: { byAdmin: '1', survivorName: 'A', absorbedName: '' } }, 'es')!;
        expect(bare).toEqual({ title: 'Un administrador rechazó combinar dos perfiles', body: '«sin nombre» y «A» siguen como perfiles separados.' });
    });

    it('a teammate\'s answer reads per outcome', () => {
        const p = { ...SAMPLES.merge_request_answered_by_teammate };
        expect(renderNotification({ key: 'merge_request_answered_by_teammate', params: { ...p, outcome: 'declined' } }, 'es')!.title).toBe('Ana rechazó el pedido de Jon');
        expect(renderNotification({ key: 'merge_request_answered_by_teammate', params: { ...p, outcome: 'flipped' } }, 'en')!.title).toBe("Ana accepted Jon's request");
        expect(renderNotification({ key: 'merge_request_answered_by_teammate', params: { ...p, outcome: 'maybe' } }, 'es')).toBeNull();
    });

    it('api_record maps codes per language', () => {
        expect(renderNotification({ key: 'api_record', params: SAMPLES.api_record }, 'es'))
            .toEqual({ title: 'Juana: adopción (vía Catpuccino)', body: 'Se agregó a un perfil existente. También se agregó a su perfil: email, teléfono.' });
        expect(renderNotification({ key: 'api_record', params: SAMPLES.api_record }, 'pt')!.body).toContain('e-mail, telefone');
    });
});

describe('notificationContent', () => {
    it('gives the Spanish render plus the template', () => {
        const t: NotificationTemplate = { key: 'member_joined', params: { memberName: 'Ana', orgName: 'Patitas' } };
        expect(notificationContent(t)).toEqual({ title: '👋 Nuevo miembro', body: 'Ana se unió a Patitas.', template: t });
    });
});

describe('templateFromMetadata / localizedNotification', () => {
    const stored = { title: 'Nuevo dato de contacto', body: 'Ana agregó un teléfono a Carla.' };
    const template = { key: 'contact_entry_added', params: { actorName: 'Ana', adopterName: 'Carla', entryType: 'phone' } };

    it('reads the template from a JSON string or an object', () => {
        expect(templateFromMetadata(JSON.stringify({ adopterId: 'a1', template }))).toEqual(template);
        expect(templateFromMetadata({ template })).toEqual(template);
        expect(templateFromMetadata('not json')).toBeNull();
        expect(templateFromMetadata(null)).toBeNull();
        expect(templateFromMetadata(JSON.stringify({ adopterId: 'a1' }))).toBeNull();
    });

    it('the bell renders English for an English reader', () => {
        expect(localizedNotification({ ...stored, metadata: JSON.stringify({ template }) }, 'en'))
            .toEqual({ title: 'New contact detail', body: 'Ana added a phone number to Carla.' });
    });

    it('no template, an unknown key or a broken template → the stored text', () => {
        expect(localizedNotification({ ...stored, metadata: null }, 'en')).toEqual(stored);
        expect(localizedNotification({ ...stored, metadata: JSON.stringify({ template: { key: 'gone', params: {} } }) }, 'pt')).toEqual(stored);
        expect(localizedNotification({ ...stored, metadata: JSON.stringify({ template: { key: 'contact_entry_added', params: {} } }) }, 'en')).toEqual(stored);
    });
});

describe('Spanish without a name (final review M2)', () => {
    it.each(NOTIFICATION_TEMPLATE_KEYS)('%s: never «a el» / «de el» when any one param is left out', (key) => {
        const sample = SAMPLES[key] as Record<string, string | undefined>;
        for (const drop of Object.keys(sample)) {
            const params = { ...sample, [drop]: undefined };
            const out = renderNotification({ key, params }, 'es');
            if (!out) continue; // a required param: nothing renders
            expect(`${out.title} ${out.body}`).not.toMatch(/\b(a|de) el\b/);
        }
    });

    it('the two that had it read «al / del adoptante»', () => {
        expect(renderNotification({ key: 'contact_entry_added', params: { actorName: 'Ana', entryType: 'phone' } }, 'es')!.body).toMatch(/ al adoptante\.$/);
        expect(renderNotification({ key: 'pii_access_request', params: { requesterName: 'Ana', kind: 'contribution' } }, 'es')!.body).toContain('un dato al adoptante y');
        expect(renderNotification({ key: 'pii_access_request', params: { requesterName: 'Ana', kind: 'direct' } }, 'es')!.body).toMatch(/de contacto del adoptante\.$/);
    });
});
