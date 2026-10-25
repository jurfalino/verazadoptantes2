/**
 * Notification texts in the reader's language (D38). Every notification is
 * created with a template — a key plus plain-string params resolved at
 * creation (names, dates, counts, codes) — stored in `metadata.template`. The
 * bell, /notificaciones and the email twin render it in the reader's language;
 * the stored title/body stay the Spanish render, so a row without a template
 * (older rows, direct inserts) or one that no longer renders still shows its
 * stored text. Never a raw key, never an empty hole.
 *
 * Params never carry Spanish words: a missing name is an absent/empty param and
 * each language picks its own fallback; kinds and outcomes travel as codes.
 * Params never carry emails for non-admin recipients (admin-only templates keep
 * the email they show today).
 *
 * Pure: no DB, no server imports.
 */
import { DEFAULT_TIMEZONE, formatShortDate } from '@/lib/dates';
import { formSubmissionOwnerTitle } from '@/domain/formNotification';

export type NotificationLocale = 'es' | 'en' | 'pt';

export interface NotificationText { title: string; body: string }

/** One side of a merge (D31): its name, its owner's display name and its creation date (ISO). */
export type MergeSides = {
    survivorName: string; survivorOwner?: string; survivorDate?: string;
    absorbedName: string; absorbedOwner?: string; absorbedDate?: string;
};

/** The params each template takes. Optional params change the wording, never leave a hole. */
export interface NotificationTemplateParams {
    member_joined: { memberName: string; orgName?: string };
    contact_entry_added: { actorName: string; adopterName?: string; entryType: string };
    /** `role`: 'to' (the new owner) or 'from' (the previous one). */
    ownership_transferred: { role: string; adopterName?: string; actorName: string; toName: string };
    pii_access_approved: { adopterName?: string };
    pii_access_denied: { adopterName?: string; note?: string };
    pii_access_revoked: { adopterName?: string };
    /** `kind`: 'contribution' (auto-fired after adding a detail) or 'direct'. */
    pii_access_request: { requesterName: string; adopterName?: string; kind: string };
    deletion_request: { requesterName: string };
    /** `reason` is the FLAG_REASONS code (admins read it as is today). */
    adopter_flagged: { reporterName: string; reason: string };
    contract_attached: { actorName: string; profileName: string; animalName?: string };
    form_attached: { actorName: string; profileName: string };
    form_submission_owner: { submitterName: string; animalName?: string; matchCount: string };
    form_submission_teammate: { submitterName: string; animalName?: string; matchCount: string; sharedByName: string };
    contract_result_matches: { adopterName: string; animalName?: string; matchCount: string };
    contract_result_clear: { adopterName: string; animalName?: string };
    contract_result_teammate: { adopterName: string; animalName?: string };
    /** `decision`: approve | deny | block. `exact`/`fuzzy`: daily caps (approve, deny). */
    api_access: { decision: string; exact?: string; fuzzy?: string; note?: string };
    /** `context`: activity type code; `outcome`: found | best_match | ambiguous | created; `contactsAdded`: comma-separated field codes. */
    api_record: { personName: string; context: string; keyName: string; outcome: string; contactsAdded?: string };
    /** Admin-only: keeps the requester's email, as today. */
    api_access_requested: { requesterEmail: string; tool: string };
    merge_request: { requesterName: string } & MergeSides;
    /** `byAdmin`: '1' when an admin answered (then `actorName` is not shown). */
    merge_request_accepted: { actorName?: string; byAdmin?: string } & MergeSides;
    merge_request_flipped: { actorName?: string; byAdmin?: string } & MergeSides;
    merge_request_declined: { actorName?: string; byAdmin?: string } & MergeSides;
    /** The owner's copy when a teammate answered (D26). `outcome`: accepted | flipped | declined. */
    merge_request_answered_by_teammate: { actorName: string; requesterName: string; outcome: string } & MergeSides;
    adopter_merged_by_rescuer: { actorName: string } & MergeSides;
    adopter_merged_by_admin: MergeSides;
    pair_message: { fromName: string; profileName?: string; message: string };
}

export type NotificationTemplateKey = keyof NotificationTemplateParams;

export type NotificationTemplate = {
    [K in NotificationTemplateKey]: { key: K; params: NotificationTemplateParams[K] }
}[NotificationTemplateKey];

type Render<P> = (p: P) => NotificationText | null;
interface TemplateDef<P> {
    required: readonly (keyof P & string)[];
    es: Render<P>; en: Render<P>; pt: Render<P>;
}

// ── Shared wording ───────────────────────────────────────────────

const NO_NAME: Record<NotificationLocale, string> = { es: 'sin nombre', en: 'no name', pt: 'sem nome' };
const AN_ADMIN: Record<NotificationLocale, string> = { es: 'Un administrador', en: 'An administrator', pt: 'Um administrador' };
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** «Julieta Paz (de María, 22 oct '26)» — the owner and date tell same-name profiles apart (D31). */
function profileLabel(name: string | undefined, owner: string | undefined, date: string | undefined, l: NotificationLocale): string {
    const day = date ? formatShortDate(date, DEFAULT_TIMEZONE, l) : '';
    const shownDay = day && day !== '—' ? day : '';
    const by = owner ? (l === 'en' ? `from ${owner}` : `de ${owner}`) : '';
    const extra = [by, shownDay].filter(Boolean).join(', ');
    const base = name?.trim() || NO_NAME[l];
    const label = extra ? `${base} (${extra})` : base;
    return l === 'en' ? `“${label}”` : `«${label}»`;
}
const survivorLabel = (p: MergeSides, l: NotificationLocale) => profileLabel(p.survivorName, p.survivorOwner, p.survivorDate, l);
const absorbedLabel = (p: MergeSides, l: NotificationLocale) => profileLabel(p.absorbedName, p.absorbedOwner, p.absorbedDate, l);
const plainName = (name: string | undefined, l: NotificationLocale) => name?.trim() || NO_NAME[l];

const MERGED_TITLE: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => `Se unieron dos perfiles: ${plainName(p.absorbedName, 'es')} → ${plainName(p.survivorName, 'es')}`,
    en: p => `Two profiles were merged: ${plainName(p.absorbedName, 'en')} → ${plainName(p.survivorName, 'en')}`,
    pt: p => `Dois perfis foram combinados: ${plainName(p.absorbedName, 'pt')} → ${plainName(p.survivorName, 'pt')}`,
};
/** «se conserva X y se absorbe Y» — which one stays (D31). */
const KEEPS: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => `se conserva ${survivorLabel(p, 'es')} y se absorbe ${absorbedLabel(p, 'es')}`,
    en: p => `${survivorLabel(p, 'en')} stays and ${absorbedLabel(p, 'en')} is folded into it`,
    pt: p => `fica ${survivorLabel(p, 'pt')} e ${absorbedLabel(p, 'pt')} é incorporado a ele`,
};
const KEPT_APART: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => `${absorbedLabel(p, 'es')} y ${survivorLabel(p, 'es')} siguen como perfiles separados.`,
    en: p => `${absorbedLabel(p, 'en')} and ${survivorLabel(p, 'en')} remain separate profiles.`,
    pt: p => `${absorbedLabel(p, 'pt')} e ${survivorLabel(p, 'pt')} continuam como perfis separados.`,
};
const answeredBy = (p: { actorName?: string; byAdmin?: string }, l: NotificationLocale): string | null =>
    p.byAdmin === '1' ? AN_ADMIN[l] : (p.actorName?.trim() || null);

const ENTRY_TYPE: Record<NotificationLocale, Record<string, string>> = {
    es: { phone: 'un teléfono', email: 'un email', social: 'una red social', id: 'un documento', address: 'una dirección', alias: 'un nombre alternativo', other: 'un dato de contacto' },
    en: { phone: 'a phone number', email: 'an email', social: 'a social profile', id: 'an ID document', address: 'an address', alias: 'an alternative name', other: 'a contact detail' },
    pt: { phone: 'um telefone', email: 'um e-mail', social: 'uma rede social', id: 'um documento', address: 'um endereço', alias: 'um nome alternativo', other: 'um dado de contato' },
};
const entryTypeLabel = (code: string, l: NotificationLocale) =>
    Object.hasOwn(ENTRY_TYPE[l], code) ? ENTRY_TYPE[l][code] : ENTRY_TYPE[l].other;

const API_CONTEXT: Record<NotificationLocale, Record<string, string>> = {
    es: { adoption_request: 'solicitud de adopción', adoption: 'adopción', foster: 'tránsito', follow_up: 'seguimiento', returned_pet: 'devolución', observation: 'observación' },
    en: { adoption_request: 'adoption request', adoption: 'adoption', foster: 'foster', follow_up: 'follow-up', returned_pet: 'return', observation: 'observation' },
    pt: { adoption_request: 'solicitação de adoção', adoption: 'adoção', foster: 'lar temporário', follow_up: 'acompanhamento', returned_pet: 'devolução', observation: 'observação' },
};
const API_FIELD: Record<NotificationLocale, Record<string, string>> = {
    es: { email: 'email', phone: 'teléfono', documentId: 'documento' },
    en: { email: 'email', phone: 'phone', documentId: 'ID document' },
    pt: { email: 'e-mail', phone: 'telefone', documentId: 'documento' },
};
const lookup = (table: Record<string, string>, code: string) => (Object.hasOwn(table, code) ? table[code] : code);
const fieldList = (codes: string | undefined, l: NotificationLocale) =>
    (codes ?? '').split(',').map(c => c.trim()).filter(Boolean).map(c => lookup(API_FIELD[l], c)).join(', ');

const count = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

// ── Templates ────────────────────────────────────────────────────

const TEMPLATES: { [K in NotificationTemplateKey]: TemplateDef<NotificationTemplateParams[K]> } = {
    member_joined: {
        required: ['memberName'],
        es: p => ({ title: '👋 Nuevo miembro', body: `${p.memberName} se unió a ${p.orgName || 'la organización'}.` }),
        en: p => ({ title: '👋 New member', body: `${p.memberName} joined ${p.orgName || 'the organization'}.` }),
        pt: p => ({ title: '👋 Novo membro', body: p.orgName ? `${p.memberName} entrou em ${p.orgName}.` : `${p.memberName} entrou na organização.` }),
    },
    contact_entry_added: {
        required: ['actorName', 'entryType'],
        es: p => ({ title: 'Nuevo dato de contacto', body: `${p.actorName} agregó ${entryTypeLabel(p.entryType, 'es')} ${p.adopterName ? `a ${p.adopterName}` : 'al adoptante'}.` }),
        en: p => ({ title: 'New contact detail', body: `${p.actorName} added ${entryTypeLabel(p.entryType, 'en')} to ${p.adopterName || 'the adopter'}.` }),
        pt: p => ({ title: 'Novo dado de contato', body: `${p.actorName} adicionou ${entryTypeLabel(p.entryType, 'pt')} ${p.adopterName ? `a ${p.adopterName}` : 'ao adotante'}.` }),
    },
    ownership_transferred: {
        required: ['role', 'actorName', 'toName'],
        es: p => {
            const label = p.adopterName?.trim() || 'un adoptante';
            if (p.role === 'to') return { title: 'Cambio de propietario', body: `Ahora sos el propietario de "${label}" (transferido por ${p.actorName}).` };
            if (p.role === 'from') return { title: 'Cambio de propietario', body: `Un administrador transfirió "${label}" a ${p.toName}.` };
            return null;
        },
        en: p => {
            const label = p.adopterName?.trim() || 'an adopter';
            if (p.role === 'to') return { title: 'Owner changed', body: `You are now the owner of "${label}" (transferred by ${p.actorName}).` };
            if (p.role === 'from') return { title: 'Owner changed', body: `An administrator transferred "${label}" to ${p.toName}.` };
            return null;
        },
        pt: p => {
            const label = p.adopterName?.trim() || 'um adotante';
            if (p.role === 'to') return { title: 'Mudança de responsável', body: `Agora você é o responsável por "${label}" (transferido por ${p.actorName}).` };
            if (p.role === 'from') return { title: 'Mudança de responsável', body: `Um administrador transferiu "${label}" para ${p.toName}.` };
            return null;
        },
    },
    pii_access_approved: {
        required: [],
        es: p => ({ title: 'Acceso a contacto aprobado', body: `Ya podés ver los datos de contacto ${p.adopterName ? `de ${p.adopterName}` : 'del adoptante'}.` }),
        en: p => ({ title: 'Contact access approved', body: `You can now see the contact details of ${p.adopterName || 'the adopter'}.` }),
        pt: p => ({ title: 'Acesso ao contato aprovado', body: `Agora você pode ver os dados de contato ${p.adopterName ? `de ${p.adopterName}` : 'do adotante'}.` }),
    },
    pii_access_denied: {
        required: [],
        es: p => ({ title: 'Solicitud de acceso no aprobada', body: `Tu solicitud de acceso ${p.adopterName ? `a ${p.adopterName}` : 'al adoptante'} no fue aprobada.${p.note ? ` Nota: ${p.note}` : ''}` }),
        en: p => ({ title: 'Access request not approved', body: `Your request to access ${p.adopterName || 'the adopter'} was not approved.${p.note ? ` Note: ${p.note}` : ''}` }),
        pt: p => ({ title: 'Solicitação de acesso não aprovada', body: `Sua solicitação de acesso ${p.adopterName ? `a ${p.adopterName}` : 'ao adotante'} não foi aprovada.${p.note ? ` Nota: ${p.note}` : ''}` }),
    },
    pii_access_revoked: {
        required: [],
        es: p => ({ title: 'Acceso a contacto removido', body: `Tu acceso a los datos de contacto de ${p.adopterName || 'un adoptante'} fue removido.` }),
        en: p => ({ title: 'Contact access removed', body: `Your access to the contact details of ${p.adopterName || 'an adopter'} was removed.` }),
        pt: p => ({ title: 'Acesso ao contato removido', body: `Seu acesso aos dados de contato de ${p.adopterName || 'um adotante'} foi removido.` }),
    },
    pii_access_request: {
        required: ['requesterName', 'kind'],
        es: p => {
            // «al / del adoptante» without a name, never «a el / de el».
            return {
                title: 'Solicitud de acceso a contacto',
                body: p.kind === 'contribution'
                    ? `${p.requesterName} agregó un dato ${p.adopterName ? `a ${p.adopterName}` : 'al adoptante'} y solicita acceso a los datos de contacto.`
                    : `${p.requesterName} solicitó acceso a los datos de contacto ${p.adopterName ? `de ${p.adopterName}` : 'del adoptante'}.`,
            };
        },
        en: p => {
            const a = p.adopterName || 'the adopter';
            return {
                title: 'Contact access request',
                body: p.kind === 'contribution'
                    ? `${p.requesterName} added a detail to ${a} and is asking for access to the contact details.`
                    : `${p.requesterName} asked for access to the contact details of ${a}.`,
            };
        },
        pt: p => {
            const a = p.adopterName || 'o adotante';
            return {
                title: 'Solicitação de acesso ao contato',
                body: p.kind === 'contribution'
                    ? `${p.requesterName} adicionou um dado ${p.adopterName ? `a ${a}` : 'ao adotante'} e solicita acesso aos dados de contato.`
                    : `${p.requesterName} solicitou acesso aos dados de contato ${p.adopterName ? `de ${a}` : 'do adotante'}.`,
            };
        },
    },
    deletion_request: {
        required: ['requesterName'],
        es: p => ({ title: '🗑️ Solicitud de eliminación', body: `${p.requesterName} solicitó eliminar un registro de adoptante.` }),
        en: p => ({ title: '🗑️ Deletion request', body: `${p.requesterName} asked to delete an adopter record.` }),
        pt: p => ({ title: '🗑️ Solicitação de exclusão', body: `${p.requesterName} pediu para excluir um registro de adotante.` }),
    },
    adopter_flagged: {
        required: ['reporterName', 'reason'],
        es: p => ({ title: '🚩 Adoptante reportado', body: `${p.reporterName} reportó un adoptante. Motivo: ${p.reason}` }),
        en: p => ({ title: '🚩 Adopter reported', body: `${p.reporterName} reported an adopter. Reason: ${p.reason}` }),
        pt: p => ({ title: '🚩 Adotante denunciado', body: `${p.reporterName} denunciou um adotante. Motivo: ${p.reason}` }),
    },
    contract_attached: {
        required: ['actorName', 'profileName'],
        es: p => ({
            title: `${p.actorName} adjuntó un contrato a tu perfil ${p.profileName}`,
            body: p.animalName ? `Adopción de ${p.animalName} atribuida a este perfil. Tocá para revisar.` : 'Tocá para revisar.',
        }),
        en: p => ({
            title: `${p.actorName} attached a contract to your profile ${p.profileName}`,
            body: p.animalName ? `Adoption of ${p.animalName} credited to this profile. Tap to review.` : 'Tap to review.',
        }),
        pt: p => ({
            title: `${p.actorName} anexou um contrato ao seu perfil ${p.profileName}`,
            body: p.animalName ? `Adoção de ${p.animalName} atribuída a este perfil. Toque para revisar.` : 'Toque para revisar.',
        }),
    },
    form_attached: {
        required: ['actorName', 'profileName'],
        es: p => ({ title: `${p.actorName} vinculó una solicitud de adopción a tu perfil ${p.profileName}`, body: 'Tocá para revisar.' }),
        en: p => ({ title: `${p.actorName} linked an adoption request to your profile ${p.profileName}`, body: 'Tap to review.' }),
        pt: p => ({ title: `${p.actorName} vinculou uma solicitação de adoção ao seu perfil ${p.profileName}`, body: 'Toque para revisar.' }),
    },
    form_submission_owner: {
        required: ['submitterName', 'matchCount'],
        es: p => formOwner(p, 'es'),
        en: p => formOwner(p, 'en'),
        pt: p => formOwner(p, 'pt'),
    },
    form_submission_teammate: {
        required: ['submitterName', 'matchCount', 'sharedByName'],
        es: p => formTeammate(p, 'es'),
        en: p => formTeammate(p, 'en'),
        pt: p => formTeammate(p, 'pt'),
    },
    contract_result_matches: {
        required: ['adopterName', 'matchCount'],
        es: p => {
            const n = count(p.matchCount);
            if (n === null) return null;
            return {
                title: `${n} ${plural(n, 'coincidencia', 'coincidencias')} para ${p.adopterName}`,
                body: `${p.animalName || 'Animal'} fue adoptado por ${p.adopterName}. Se encontraron posibles registros previos. Tocá para revisar.`,
            };
        },
        en: p => {
            const n = count(p.matchCount);
            if (n === null) return null;
            return {
                title: `${n} ${plural(n, 'match', 'matches')} for ${p.adopterName}`,
                body: `${p.animalName || 'The animal'} was adopted by ${p.adopterName}. Possible earlier records were found. Tap to review.`,
            };
        },
        pt: p => {
            const n = count(p.matchCount);
            if (n === null) return null;
            return {
                title: `${n} ${plural(n, 'coincidência', 'coincidências')} para ${p.adopterName}`,
                body: `${p.animalName || 'O animal'} foi adotado por ${p.adopterName}. Foram encontrados possíveis registros anteriores. Toque para revisar.`,
            };
        },
    },
    contract_result_clear: {
        required: ['adopterName'],
        es: p => ({ title: `${p.animalName || 'Animal'} adoptado por ${p.adopterName}`, body: `No se encontraron registros previos para ${p.adopterName}. Todo en orden.` }),
        en: p => ({ title: `${p.animalName || 'Animal'} adopted by ${p.adopterName}`, body: `No earlier records were found for ${p.adopterName}. All clear.` }),
        pt: p => ({ title: `${p.animalName || 'Animal'} adotado por ${p.adopterName}`, body: `Não foram encontrados registros anteriores para ${p.adopterName}. Tudo certo.` }),
    },
    contract_result_teammate: {
        required: ['adopterName'],
        es: p => ({ title: `Contrato firmado: ${p.animalName || 'Animal'}`, body: `${p.adopterName} firmó el contrato de adopción de ${p.animalName || 'un animal'}.` }),
        en: p => ({ title: `Contract signed: ${p.animalName || 'Animal'}`, body: `${p.adopterName} signed the adoption contract for ${p.animalName || 'an animal'}.` }),
        pt: p => ({ title: `Contrato assinado: ${p.animalName || 'Animal'}`, body: `${p.adopterName} assinou o contrato de adoção de ${p.animalName || 'um animal'}.` }),
    },
    api_access: {
        required: ['decision'],
        es: p => apiAccess(p, {
            approve: ['Tu acceso a la API fue aprobado', (e, f) => `Tus claves pasan a ${e} búsquedas exactas y ${f} fuzzy por día.`],
            deny: ['Tu pedido de acceso a la API no fue aprobado', (e, f) => `Tus claves siguen con ${e} búsquedas exactas y ${f} fuzzy por día.`],
            block: ['Tu acceso a la API fue bloqueado', 'Si tenés dudas, escribinos.'],
        }),
        en: p => apiAccess(p, {
            approve: ['Your API access was approved', (e, f) => `Your keys now get ${e} exact and ${f} fuzzy searches per day.`],
            deny: ['Your API access request was not approved', (e, f) => `Your keys stay at ${e} exact and ${f} fuzzy searches per day.`],
            block: ['Your API access was blocked', 'If you have questions, write to us.'],
        }),
        pt: p => apiAccess(p, {
            approve: ['Seu acesso à API foi aprovado', (e, f) => `Suas chaves passam a ${e} buscas exatas e ${f} fuzzy por dia.`],
            deny: ['Seu pedido de acesso à API não foi aprovado', (e, f) => `Suas chaves continuam com ${e} buscas exatas e ${f} fuzzy por dia.`],
            block: ['Seu acesso à API foi bloqueado', 'Se tiver dúvidas, escreva para nós.'],
        }),
    },
    api_record: {
        required: ['personName', 'context', 'keyName', 'outcome'],
        es: p => apiRecord(p, 'es', {
            via: 'vía',
            found: added => `Se agregó a un perfil existente.${added ? ` También se agregó a su perfil: ${added}.` : ''}`,
            best_match: 'Coincide con más de un perfil: se agregó al que mejor coincide. Revisá si es la misma persona.',
            ambiguous: 'Coincide con más de un perfil: se creó uno nuevo para que revises si es la misma persona.',
            created: 'No había registros previos: se creó un perfil nuevo.',
        }),
        en: p => apiRecord(p, 'en', {
            via: 'via',
            found: added => `Added to an existing profile.${added ? ` Also added to their profile: ${added}.` : ''}`,
            best_match: 'Matches more than one profile: added to the best match. Check whether it is the same person.',
            ambiguous: 'Matches more than one profile: a new one was created so you can check whether it is the same person.',
            created: 'No earlier records: a new profile was created.',
        }),
        pt: p => apiRecord(p, 'pt', {
            via: 'via',
            found: added => `Adicionado a um perfil existente.${added ? ` Também foi adicionado ao perfil: ${added}.` : ''}`,
            best_match: 'Coincide com mais de um perfil: foi adicionado ao que mais coincide. Verifique se é a mesma pessoa.',
            ambiguous: 'Coincide com mais de um perfil: foi criado um novo para você verificar se é a mesma pessoa.',
            created: 'Não havia registros anteriores: foi criado um perfil novo.',
        }),
    },
    api_access_requested: {
        required: ['requesterEmail', 'tool'],
        es: p => ({ title: 'Pedido de acceso a la API', body: `${p.requesterEmail} pidió acceso a la API (${p.tool}). Su clave ya funciona con el límite inicial; aprobalo para subirlo.` }),
        en: p => ({ title: 'API access request', body: `${p.requesterEmail} asked for API access (${p.tool}). Their key already works with the starting limit; approve it to raise it.` }),
        pt: p => ({ title: 'Pedido de acesso à API', body: `${p.requesterEmail} pediu acesso à API (${p.tool}). A chave já funciona com o limite inicial; aprove para aumentá-lo.` }),
    },
    merge_request: {
        required: ['requesterName', 'survivorName', 'absorbedName'],
        es: p => ({ title: `${p.requesterName} pidió combinar dos perfiles`, body: `Pidió combinar dos perfiles porque serían la misma persona: ${KEEPS.es(p)}. Podés aceptar o rechazar el pedido.` }),
        en: p => ({ title: `${p.requesterName} asked to merge two profiles`, body: `They asked to merge two profiles because they would be the same person: ${KEEPS.en(p)}. You can accept or decline the request.` }),
        pt: p => ({ title: `${p.requesterName} pediu para combinar dois perfis`, body: `Pediu para combinar dois perfis porque seriam a mesma pessoa: ${KEEPS.pt(p)}. Você pode aceitar ou recusar o pedido.` }),
    },
    merge_request_accepted: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: MERGED_TITLE.es(p), body: `${who} aceptó combinar los perfiles: ${KEEPS.es(p)}. Todo quedó en un solo perfil.` })),
        en: p => withWho(p, 'en', who => ({ title: MERGED_TITLE.en(p), body: `${who} accepted merging the profiles: ${KEEPS.en(p)}. Everything is now in one profile.` })),
        pt: p => withWho(p, 'pt', who => ({ title: MERGED_TITLE.pt(p), body: `${who} aceitou combinar os perfis: ${KEEPS.pt(p)}. Tudo ficou em um só perfil.` })),
    },
    merge_request_flipped: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: MERGED_TITLE.es(p), body: `${who} aceptó combinar los perfiles conservando ${survivorLabel(p, 'es')}: ${absorbedLabel(p, 'es')} quedó en ese perfil.` })),
        en: p => withWho(p, 'en', who => ({ title: MERGED_TITLE.en(p), body: `${who} accepted merging the profiles but kept ${survivorLabel(p, 'en')}: ${absorbedLabel(p, 'en')} is now part of that profile.` })),
        pt: p => withWho(p, 'pt', who => ({ title: MERGED_TITLE.pt(p), body: `${who} aceitou combinar os perfis mantendo ${survivorLabel(p, 'pt')}: ${absorbedLabel(p, 'pt')} ficou nesse perfil.` })),
    },
    merge_request_declined: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: `${who} rechazó combinar dos perfiles`, body: KEPT_APART.es(p) })),
        en: p => withWho(p, 'en', who => ({ title: `${who} declined to merge two profiles`, body: KEPT_APART.en(p) })),
        pt: p => withWho(p, 'pt', who => ({ title: `${who} recusou combinar dois perfis`, body: KEPT_APART.pt(p) })),
    },
    merge_request_answered_by_teammate: {
        required: ['actorName', 'requesterName', 'outcome', 'survivorName', 'absorbedName'],
        es: p => teammateAnswer(p, {
            accepted: [`${p.actorName} aceptó el pedido de ${p.requesterName}`, `Se combinaron los perfiles: ${KEEPS.es(p)}.`],
            flipped: [`${p.actorName} aceptó el pedido de ${p.requesterName}`, `Se combinaron los perfiles conservando ${survivorLabel(p, 'es')}: ${absorbedLabel(p, 'es')} quedó en ese perfil.`],
            declined: [`${p.actorName} rechazó el pedido de ${p.requesterName}`, KEPT_APART.es(p)],
        }),
        en: p => teammateAnswer(p, {
            accepted: [`${p.actorName} accepted ${p.requesterName}'s request`, `The profiles were merged: ${KEEPS.en(p)}.`],
            flipped: [`${p.actorName} accepted ${p.requesterName}'s request`, `The profiles were merged keeping ${survivorLabel(p, 'en')}: ${absorbedLabel(p, 'en')} is now part of that profile.`],
            declined: [`${p.actorName} declined ${p.requesterName}'s request`, KEPT_APART.en(p)],
        }),
        pt: p => teammateAnswer(p, {
            accepted: [`${p.actorName} aceitou o pedido de ${p.requesterName}`, `Os perfis foram combinados: ${KEEPS.pt(p)}.`],
            flipped: [`${p.actorName} aceitou o pedido de ${p.requesterName}`, `Os perfis foram combinados mantendo ${survivorLabel(p, 'pt')}: ${absorbedLabel(p, 'pt')} ficou nesse perfil.`],
            declined: [`${p.actorName} recusou o pedido de ${p.requesterName}`, KEPT_APART.pt(p)],
        }),
    },
    adopter_merged_by_rescuer: {
        required: ['actorName', 'survivorName', 'absorbedName'],
        es: p => ({ title: MERGED_TITLE.es(p), body: `${p.actorName} combinó su perfil ${absorbedLabel(p, 'es')} con el tuyo ${survivorLabel(p, 'es')} porque son la misma persona. Todo quedó en tu perfil.` }),
        en: p => ({ title: MERGED_TITLE.en(p), body: `${p.actorName} merged their profile ${absorbedLabel(p, 'en')} into yours, ${survivorLabel(p, 'en')}, because they are the same person. Everything is now in your profile.` }),
        pt: p => ({ title: MERGED_TITLE.pt(p), body: `${p.actorName} combinou o perfil ${absorbedLabel(p, 'pt')} com o seu ${survivorLabel(p, 'pt')} porque são a mesma pessoa. Tudo ficou no seu perfil.` }),
    },
    adopter_merged_by_admin: {
        required: ['survivorName', 'absorbedName'],
        es: p => ({ title: MERGED_TITLE.es(p), body: `Un administrador los unió porque son la misma persona: ${KEEPS.es(p)}. Todo lo registrado en los dos quedó en este perfil.` }),
        en: p => ({ title: MERGED_TITLE.en(p), body: `An administrator merged them because they are the same person: ${KEEPS.en(p)}. Everything recorded in both is now in this profile.` }),
        pt: p => ({ title: MERGED_TITLE.pt(p), body: `Um administrador os combinou porque são a mesma pessoa: ${KEEPS.pt(p)}. Tudo o que foi registrado nos dois ficou neste perfil.` }),
    },
    pair_message: {
        required: ['fromName', 'message'],
        es: p => ({ title: `${p.fromName} te escribió sobre «${p.profileName ?? ''}»`, body: p.message }),
        en: p => ({ title: `${p.fromName} wrote to you about “${p.profileName ?? ''}”`, body: p.message }),
        pt: p => ({ title: `${p.fromName} escreveu para você sobre «${p.profileName ?? ''}»`, body: p.message }),
    },
};

// ── Template helpers ─────────────────────────────────────────────

type FormOwnerParams = NotificationTemplateParams['form_submission_owner'];
const FORM_WORDS: Record<Exclude<NotificationLocale, 'es'>, {
    appliedFor: (s: string, a: string) => string; filledIn: (s: string) => string; match: [string, string];
    withMatches: string; noMatches: string; teammateTitle: string; sharedBy: (s: string, by: string) => string;
}> = {
    en: {
        appliedFor: (s, a) => `${s} applied for ${a}`, filledIn: s => `${s} filled in the form`, match: ['match', 'matches'],
        withMatches: 'Possible earlier records were found. Tap to review the answers and link them.',
        noMatches: 'No earlier records were found. Review the answers to continue.',
        teammateTitle: 'New form response',
        sharedBy: (s, by) => `${s} filled in the adoption form shared by ${by}.`,
    },
    pt: {
        appliedFor: (s, a) => `${s} se candidatou para ${a}`, filledIn: s => `${s} preencheu o formulário`, match: ['coincidência', 'coincidências'],
        withMatches: 'Foram encontrados possíveis registros anteriores. Toque para revisar as respostas e vincular.',
        noMatches: 'Não foram encontrados registros anteriores. Revise as respostas para continuar.',
        teammateTitle: 'Nova resposta ao formulário',
        sharedBy: (s, by) => `${s} preencheu o formulário de adoção compartilhado por ${by}.`,
    },
};

function formTitle(p: FormOwnerParams, n: number, l: NotificationLocale): string {
    const input = { submitterName: p.submitterName, animalName: p.animalName || null, matchCount: n };
    if (l === 'es') return formSubmissionOwnerTitle(input);
    const w = FORM_WORDS[l];
    const prefix = p.animalName?.trim() ? w.appliedFor(p.submitterName, p.animalName) : w.filledIn(p.submitterName);
    return n > 0 ? `${prefix} — ${n} ${plural(n, w.match[0], w.match[1])}` : prefix;
}

function formOwner(p: FormOwnerParams, l: NotificationLocale): NotificationText | null {
    const n = count(p.matchCount);
    if (n === null) return null;
    const body = l === 'es'
        ? (n > 0 ? 'Se encontraron posibles registros previos. Tocá para revisar las respuestas y vincular.' : 'No se encontraron registros previos. Revisá las respuestas para continuar.')
        : (n > 0 ? FORM_WORDS[l].withMatches : FORM_WORDS[l].noMatches);
    return { title: formTitle(p, n, l), body };
}

function formTeammate(p: NotificationTemplateParams['form_submission_teammate'], l: NotificationLocale): NotificationText | null {
    const n = count(p.matchCount);
    if (n === null) return null;
    // With an animal the team reads the owner's title word for word; without one it stays generic.
    const title = p.animalName?.trim()
        ? formTitle(p, n, l)
        : l === 'es' ? 'Nueva respuesta al formulario' : FORM_WORDS[l].teammateTitle;
    const body = l === 'es'
        ? `${p.submitterName} completó el formulario de adopción compartido por ${p.sharedByName}.`
        : FORM_WORDS[l].sharedBy(p.submitterName, p.sharedByName);
    return { title, body };
}

function apiAccess(
    p: NotificationTemplateParams['api_access'],
    words: { approve: [string, (e: string, f: string) => string]; deny: [string, (e: string, f: string) => string]; block: [string, string] },
): NotificationText | null {
    const note = p.note?.trim();
    if (p.decision === 'block') return { title: words.block[0], body: note || words.block[1] };
    if (p.decision !== 'approve' && p.decision !== 'deny') return null;
    if (!p.exact || !p.fuzzy) return null;
    const [title, body] = words[p.decision];
    return { title, body: `${body(p.exact, p.fuzzy)}${p.decision === 'deny' && note ? ` ${note}` : ''}` };
}

function apiRecord(
    p: NotificationTemplateParams['api_record'],
    l: NotificationLocale,
    words: { via: string; found: (added: string) => string; best_match: string; ambiguous: string; created: string },
): NotificationText | null {
    const body = p.outcome === 'found' ? words.found(fieldList(p.contactsAdded, l))
        : p.outcome === 'best_match' ? words.best_match
            : p.outcome === 'ambiguous' ? words.ambiguous
                : p.outcome === 'created' ? words.created
                    : null;
    if (body === null) return null;
    return { title: `${p.personName}: ${lookup(API_CONTEXT[l], p.context)} (${words.via} ${p.keyName})`, body };
}

function withWho<P extends { actorName?: string; byAdmin?: string }>(p: P, l: NotificationLocale, build: (who: string) => NotificationText): NotificationText | null {
    const who = answeredBy(p, l);
    return who ? build(who) : null;
}

function teammateAnswer(
    p: NotificationTemplateParams['merge_request_answered_by_teammate'],
    byOutcome: Record<'accepted' | 'flipped' | 'declined', [string, string]>,
): NotificationText | null {
    if (!Object.hasOwn(byOutcome, p.outcome)) return null;
    const [title, body] = byOutcome[p.outcome as keyof typeof byOutcome];
    return { title, body };
}

// ── Public API ───────────────────────────────────────────────────

export const NOTIFICATION_TEMPLATE_KEYS = Object.keys(TEMPLATES) as NotificationTemplateKey[];

const LOCALES: readonly NotificationLocale[] = ['es', 'en', 'pt'];

/**
 * The notification's title/body in `locale`, or null when the key is unknown,
 * a required param is missing, a param is not a string, or the params don't
 * fit the template (an unknown code) — the caller then shows the stored text.
 */
export function renderNotification(
    template: { key: string; params: Record<string, unknown> },
    locale: NotificationLocale,
): NotificationText | null {
    if (!template || typeof template.key !== 'string' || !Object.hasOwn(TEMPLATES, template.key)) return null;
    const params = template.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    if (Object.values(params).some(v => v !== undefined && typeof v !== 'string')) return null;
    const def = TEMPLATES[template.key as NotificationTemplateKey] as TemplateDef<Record<string, string | undefined>>;
    if (def.required.some(name => typeof params[name] !== 'string')) return null;
    const lang: NotificationLocale = LOCALES.includes(locale) ? locale : 'es';
    const out = def[lang](params as Record<string, string | undefined>);
    return out && out.title ? out : null;
}

/**
 * Title, body and template for a notification being created: title/body are
 * the Spanish render (what the row stores, D38), the template rides along.
 * Throws only on a programming error (a required param left undefined).
 */
export function notificationContent(template: NotificationTemplate): NotificationText & { template: NotificationTemplate } {
    const es = renderNotification(template, 'es');
    if (!es) throw new Error(`notification template did not render: ${template.key}`);
    return { ...es, template };
}

/** The template stored in a notification's metadata (a JSON string or an object), or null. */
export function templateFromMetadata(metadata: unknown): { key: string; params: Record<string, unknown> } | null {
    let meta: unknown = metadata;
    if (typeof meta === 'string') {
        // A row whose metadata is not JSON simply has no template: the stored text shows.
        try { meta = JSON.parse(meta); } catch { return null; }
    }
    if (!meta || typeof meta !== 'object') return null;
    const t = (meta as { template?: unknown }).template;
    if (!t || typeof t !== 'object') return null;
    const { key, params } = t as { key?: unknown; params?: unknown };
    if (typeof key !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) return null;
    return { key, params: params as Record<string, unknown> };
}

/**
 * What a reader sees: the template rendered in their language, else the
 * stored (Spanish) title/body. Used by the bell, /notificaciones and the email.
 */
export function localizedNotification(
    item: { title: string; body: string; metadata?: unknown },
    locale: NotificationLocale,
): NotificationText {
    const template = templateFromMetadata(item.metadata);
    const rendered = template ? renderNotification(template, locale) : null;
    return rendered ?? { title: item.title, body: item.body };
}
