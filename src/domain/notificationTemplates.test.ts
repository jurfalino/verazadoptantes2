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
    adopter_merged_by_admin: { disputable: '1', ...sides },
    merge_disputed: { raiserName: 'María', ...sides },
    merge_dispute_resolved: { outcome: 'undone', ...sides },
    pair_message: { fromName: 'Jon', profileName: 'Julieta Paz', message: 'Hola' },
    household_linked: { actorName: 'Jon', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' },
    household_link_removed: { actorName: 'María', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' },
    household_link_disputed: { actorName: 'Jon', hostName: 'Pedro Paez', linkedName: 'Jonathan Urfalino' },
    household_contribution: { actorName: 'Ana', adopterName: 'Pedro Paez', what: 'contact', entryType: 'phone' },
    household_also_lives_with: { actorName: 'Jon', personName: 'Marta Paez', hostName: 'Pedro Paez' },
    household_relationship_changed: { actorName: 'Ana', personName: 'Marta Paez', relationship: 'partner', relativeName: 'Pedro Paez' },
    household_member_removed: { actorName: 'María', personName: 'Marta Paez', hostName: 'Pedro Paez', reason: 'not_living' },
    household_member_disputed: { actorName: 'Jon', personName: 'Marta Paez', hostName: 'Pedro Paez' },
    profile_renamed: { actorName: 'Jonathan U', fromName: 'Pedro Paez', toName: 'P. Paez' },
    profile_rename_undone: { actorName: 'Ana', restoredName: 'Pedro Paez', revertedName: 'P. Paez' },
    profile_age_changed: { actorName: 'Ana', personName: 'Lucas Paez', age: '12', minor: '1' },
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

    it('households as profiles: relationship words per locale, removal reasons, unknown codes render nothing', () => {
        expect(renderNotification({ key: 'household_relationship_changed', params: { actorName: 'Ana', personName: 'Marta Paez', relationship: 'partner', relativeName: 'Pedro Paez' } }, 'es')!.body)
            .toBe('Ana cambió el parentesco de Marta Paez a «pareja» (respecto de Pedro Paez).');
        expect(renderNotification({ key: 'household_relationship_changed', params: { actorName: 'Ana', personName: 'Marta Paez', relationship: 'child' } }, 'en')!.body)
            .toBe("Ana changed Marta Paez's relationship to “child”.");
        expect(renderNotification({ key: 'household_relationship_changed', params: { actorName: 'Ana', relationship: 'cousin' } }, 'pt')).toBeNull();
        expect(renderNotification({ key: 'household_member_removed', params: { actorName: 'Ana', personName: 'Lucas', hostName: 'Pedro Paez', reason: 'mistake' } }, 'es')!.body)
            .toBe('Ana quitó a Lucas del grupo familiar de Pedro Paez porque se había cargado por error.');
        expect(renderNotification({ key: 'household_member_removed', params: { actorName: 'Ana', personName: 'Lucas', reason: 'not_living' } }, 'en')!.title)
            .toBe("Doesn't live there: Lucas");
        expect(renderNotification({ key: 'household_member_removed', params: { actorName: 'Ana', reason: 'moved' } }, 'es')).toBeNull();
        expect(renderNotification({ key: 'household_member_disputed', params: { actorName: 'Jon', personName: 'Marta Paez' } }, 'es')!.body)
            .toBe('Jon volvió a agregar a Marta Paez al grupo familiar del adoptante, después de que alguien indicara que no vive ahí. Revisá quién tiene razón.');
    });

    it('household_contribution: a member or a contact on one, per locale (D54)', () => {
        expect(renderNotification({ key: 'household_contribution', params: { actorName: 'Ana', adopterName: 'Pedro Paez', what: 'member' } }, 'es'))
            .toEqual({ title: 'Nuevo conviviente', body: 'Ana agregó a alguien al grupo familiar de Pedro Paez.' });
        expect(renderNotification({ key: 'household_contribution', params: { actorName: 'Ana', adopterName: 'Pedro Paez', what: 'contact', entryType: 'phone' } }, 'es')!.body)
            .toBe('Ana agregó un teléfono de alguien del grupo familiar de Pedro Paez.');
        expect(renderNotification({ key: 'household_contribution', params: { actorName: 'Ana', what: 'member' } }, 'en')!.body)
            .toBe("Ana added someone to the adopter's household.");
        expect(renderNotification({ key: 'household_contribution', params: { actorName: 'Ana', what: 'sideways' } }, 'pt')).toBeNull();
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

    it('disputes (D49, D50): the admin request, the hint on a merge notice, and both outcomes', () => {
        expect(renderNotification({ key: 'merge_request', params: { requesterName: 'Jon', dispute: '1', ...sides } }, 'es')!.title)
            .toBe('Jon pide que un administrador revise dos perfiles');
        expect(renderNotification({ key: 'adopter_merged_by_rescuer', params: { actorName: 'Jon', disputable: '1', ...sides } }, 'es')!.body)
            .toMatch(/¿No es la misma persona\? Avisale a un administrador desde el perfil\.$/);
        expect(renderNotification({ key: 'adopter_merged_by_rescuer', params: { actorName: 'Jon', ...sides } }, 'es')!.body).not.toMatch(/administrador/);
        expect(renderNotification({ key: 'merge_dispute_resolved', params: { outcome: 'kept', ...sides } }, 'en')!.title).toBe('An administrator kept a merge');
        expect(renderNotification({ key: 'merge_dispute_resolved', params: { outcome: 'sideways', ...sides } }, 'es')).toBeNull();
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

describe('profile identity notices (households as profiles, Task 3)', () => {
    it('profile_renamed reads like the approved notice (N2/N3)', () => {
        const es = renderNotification({ key: 'profile_renamed', params: { actorName: 'Jonathan U', fromName: 'Pedro Paez', toName: 'P. Paez' } }, 'es')!;
        expect(es.title).toBe('Jonathan U cambió el nombre de Pedro Paez a P. Paez');
        expect(es.body).toBe('El nombre anterior quedó como «Conocido/a como», así que buscar «Pedro Paez» lo sigue encontrando. Si el cambio no corresponde, deshacelo.');
        expect(renderNotification({ key: 'profile_renamed', params: { actorName: 'Ana', toName: 'Lucas' } }, 'en')!.title).toBe('Ana named a profile Lucas');
    });
    it('profile_age_changed: an age must be digits; a minor says where records go', () => {
        expect(renderNotification({ key: 'profile_age_changed', params: { actorName: 'Ana', personName: 'Lucas', age: 'doce' } }, 'es')).toBeNull();
        expect(renderNotification({ key: 'profile_age_changed', params: { actorName: 'Ana', personName: 'Lucas', age: '12', minor: '1' } }, 'es')!.body)
            .toBe('Ana indicó que Lucas tiene 12 años. Figura como menor de edad: los pedidos y las adopciones se registran en los adultos de su hogar.');
        expect(renderNotification({ key: 'profile_age_changed', params: { actorName: 'Ana', personName: 'Lucas' } }, 'pt')!.body).toBe('Ana removeu a idade de Lucas.');
    });
});
