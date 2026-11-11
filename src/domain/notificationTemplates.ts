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
import { additionFromParams, type ProfileAdditionParams } from '@/domain/profileAdditions';

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
    /** F6, to the removed person only: `actorName` (the remover's display name) took them out of `orgName`. */
    member_removed: { actorName: string; orgName?: string };
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
    /** To whoever added each profile when someone flags them as one person; a missing name reads «un perfil». */
    duplicate_flagged: { reporterName: string; nameA?: string; nameB?: string };
    /** To everyone who can edit the profile (owner, their team, admins) when someone else says something on it is wrong. */
    /** `details`: what the reporter wrote (trimmed to NOTICE_DETAILS_MAX), so the people who can fix it know what to fix. */
    inaccuracy_reported: { reporterName: string; adopterName?: string; details?: string };
    /** `disputable`: '1' when attaching folded another profile in and the notice links to «¿No es la misma persona?» (D50). */
    contract_attached: { actorName: string; profileName: string; animalName?: string; disputable?: string };
    form_attached: { actorName: string; profileName: string; disputable?: string };
    form_submission_owner: { submitterName: string; animalName?: string; matchCount: string };
    form_submission_teammate: { submitterName: string; animalName?: string; matchCount: string; sharedByName: string };
    contract_result_matches: { adopterName: string; animalName?: string; matchCount: string };
    contract_result_clear: { adopterName: string; animalName?: string };
    /** A personal contract link: the signer is a known profile and no search ran (D2) — never «Todo en orden». */
    contract_result_signed: { adopterName: string; animalName?: string };
    contract_result_teammate: { adopterName: string; animalName?: string };
    /** `decision`: approve | deny | block. `exact`/`fuzzy`: daily caps (approve, deny). */
    api_access: { decision: string; exact?: string; fuzzy?: string; note?: string };
    /** `context`: activity type code; `outcome`: found | best_match | ambiguous | created; `contactsAdded`: comma-separated field codes. */
    api_record: { personName: string; context: string; keyName: string; outcome: string; contactsAdded?: string };
    /** Admin-only: keeps the requester's email, as today. */
    api_access_requested: { requesterEmail: string; tool: string };
    /** `dispute`: '1' when the requester asks the admins after the owner rejected the pair (D49; admins only). */
    merge_request: { requesterName: string; dispute?: string } & MergeSides;
    /** `byAdmin`: '1' when an admin answered (then `actorName` is not shown). */
    merge_request_accepted: { actorName?: string; byAdmin?: string } & MergeSides;
    merge_request_flipped: { actorName?: string; byAdmin?: string } & MergeSides;
    merge_request_declined: { actorName?: string; byAdmin?: string } & MergeSides;
    /** The owner's copy when a teammate answered (D26). `outcome`: accepted | flipped | declined. */
    merge_request_answered_by_teammate: { actorName: string; requesterName: string; outcome: string } & MergeSides;
    /** `disputable`: '1' when the notice links to «¿No es la misma persona?» on the profile (D50). */
    adopter_merged_by_rescuer: { actorName: string; disputable?: string } & MergeSides;
    adopter_merged_by_admin: { disputable?: string } & MergeSides;
    /** Admins only (D50): `raiserName` says a merge that already happened is not the same person. */
    merge_disputed: { raiserName: string } & MergeSides;
    /** D50, both owners: `outcome` undone | kept. */
    merge_dispute_resolved: { outcome: string } & MergeSides;
    pair_message: { fromName: string; profileName?: string; message: string };
    /** D45: someone recorded that the reader's profile `linkedName` lives with `hostName`. */
    household_linked: { actorName: string; hostName?: string; linkedName?: string };
    /**
     * D54, the owner + editors: someone with no standing on `adopterName` added to its
     * household. `what`: 'member' (a person) or 'contact' (a contact on a member;
     * `entryType` is its ContactEntry type).
     */
    household_contribution: { actorName: string; adopterName?: string; what: string; entryType?: string;
        /** what='member': who was added (audit C2: «agregó a Marta Paez», not «a alguien»). Absent on notices stored before. */
        personName?: string };
    /**
     * Households as profiles: the teams of a household `personName` already lived in hear that
     * `actorName` recorded them as also living with `hostName` (nothing changes in their household).
     */
    household_also_lives_with: { actorName: string; personName?: string; hostName?: string };
    /** The household's teams: `actorName` set `personName`'s relationship (a RELATIONSHIPS code) relative to `relativeName`. */
    household_relationship_changed: { actorName: string; personName?: string; relationship: string; relativeName?: string };
    /** The household's teams: `actorName` took `personName` out of `hostName`'s household. `reason`: mistake | not_living. */
    household_member_removed: { actorName: string; personName?: string; hostName?: string; reason: string };
    /** Admins only (D48): `actorName` put `personName` back in `hostName`'s household after someone said they don't live there. */
    household_member_disputed: { actorName: string; personName?: string; hostName?: string; viaMerge?: string };
    /**
     * Households as profiles, Task 3 — the owner's team: `actorName` renamed one of their profiles
     * from `fromName` to `toName`. The old name stays as «Conocido/a como»; the notice carries
     * `metadata.undo` («Deshacer»).
     */
    profile_renamed: { actorName: string; fromName?: string; toName: string;
        /** '1': the person changed their own name signing a contract (final fix S7) — the title names no rescuer. */
        viaContract?: string };
    /** The renamer: `actorName` (the owner's team) undid their rename — back to `restoredName`; `revertedName` stays as «Conocido/a como». */
    profile_rename_undone: { actorName: string; restoredName?: string; revertedName?: string };
    /** The owner's team: what `actorName` added to the profile in one go (src/domain/profileAdditions.ts params). */
    profile_content_added: { actorName: string; adopterName?: string } & ProfileAdditionParams;
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

/** Both profiles under one name: «Carla Ruiz → Carla Ruiz» says nothing — name it once (audit C8). */
const sameMergedName = (p: MergeSides) => {
    const a = p.absorbedName?.trim().replace(/\s+/g, ' '), b = p.survivorName?.trim().replace(/\s+/g, ' ');
    return !!a && a === b;
};
const MERGED_TITLE: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => sameMergedName(p) ? `Se unieron dos perfiles de ${plainName(p.survivorName, 'es')}` : `Se unieron dos perfiles: ${plainName(p.absorbedName, 'es')} → ${plainName(p.survivorName, 'es')}`,
    en: p => sameMergedName(p) ? `Two profiles of ${plainName(p.survivorName, 'en')} were joined` : `Two profiles were joined: ${plainName(p.absorbedName, 'en')} → ${plainName(p.survivorName, 'en')}`,
    pt: p => sameMergedName(p) ? `Dois perfis de ${plainName(p.survivorName, 'pt')} foram unidos` : `Dois perfis foram unidos: ${plainName(p.absorbedName, 'pt')} → ${plainName(p.survivorName, 'pt')}`,
};
/**
 * «se conserva X y Y se suma al otro» — which one stays (D31), in the words of the
 * Pendientes and admin badges «SE CONSERVA» / «SE SUMA AL OTRO» (audit B11; fix round 2, item 13).
 */
const KEEPS: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => `se conserva ${survivorLabel(p, 'es')} y ${absorbedLabel(p, 'es')} se suma al otro`,
    en: p => `${survivorLabel(p, 'en')} stays and ${absorbedLabel(p, 'en')} joins the other`,
    pt: p => `fica ${survivorLabel(p, 'pt')} e ${absorbedLabel(p, 'pt')} se junta ao outro`,
};
const KEPT_APART: Record<NotificationLocale, (p: MergeSides) => string> = {
    es: p => `${absorbedLabel(p, 'es')} y ${survivorLabel(p, 'es')} siguen como perfiles separados.`,
    en: p => `${absorbedLabel(p, 'en')} and ${survivorLabel(p, 'en')} remain separate profiles.`,
    pt: p => `${absorbedLabel(p, 'pt')} e ${survivorLabel(p, 'pt')} continuam como perfis separados.`,
};
/** The way back from an «adopter_merged» notice to a dispute (D50). */
const DISPUTE_HINT: Record<NotificationLocale, string> = {
    es: ' ¿No es la misma persona? Avisale a un administrador desde el perfil.',
    en: ' Not the same person? Let an administrator know from the profile.',
    pt: ' Não é a mesma pessoa? Avise um administrador pelo perfil.',
};
const disputeHint = (p: { disputable?: string }, l: NotificationLocale) => (p.disputable === '1' ? DISPUTE_HINT[l] : '');
const answeredBy = (p: { actorName?: string; byAdmin?: string }, l: NotificationLocale): string | null =>
    p.byAdmin === '1' ? AN_ADMIN[l] : (p.actorName?.trim() || null);

const ENTRY_TYPE: Record<NotificationLocale, Record<string, string>> = {
    es: { phone: 'un teléfono', email: 'un email', social: 'una red social', id: 'un documento', address: 'una dirección', alias: 'un nombre alternativo', other: 'un dato de contacto' },
    en: { phone: 'a phone number', email: 'an email', social: 'a social profile', id: 'an ID document', address: 'an address', alias: 'an alternative name', other: 'a contact detail' },
    pt: { phone: 'um telefone', email: 'um e-mail', social: 'uma rede social', id: 'um documento', address: 'um endereço', alias: 'um nome alternativo', other: 'um dado de contato' },
};
/** A relationship code as a word, lower case (the RELATIONSHIPS of src/lib/householdMembers). */
const RELATIONSHIP_WORD: Record<NotificationLocale, Record<string, string>> = {
    es: { partner: 'pareja', child: 'hijo/a', parent: 'padre/madre', sibling: 'hermano/a', other_relative: 'otro familiar', housemate: 'conviviente', unknown: 'sin parentesco' },
    en: { partner: 'partner', child: 'child', parent: 'parent', sibling: 'sibling', other_relative: 'other relative', housemate: 'housemate', unknown: 'no relationship' },
    pt: { partner: 'parceiro/a', child: 'filho/a', parent: 'pai/mãe', sibling: 'irmão/irmã', other_relative: 'outro familiar', housemate: 'convivente', unknown: 'sem parentesco' },
};
const relationshipWord = (code: string, l: NotificationLocale): string | null =>
    Object.hasOwn(RELATIONSHIP_WORD[l], code) ? RELATIONSHIP_WORD[l][code] : null;
/** «de Pedro» / «del adoptante»: whose household (D54); never a hole when the name is missing. */
const householdOf = (name: string | undefined, l: NotificationLocale): string => {
    const n = name?.trim();
    if (l === 'en') return n ? `${n}'s` : "the adopter's";
    if (l === 'pt') return n ? `de ${n}` : 'do adotante';
    return n ? `de ${n}` : 'del adoptante';
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

/** A record type as the notice names it (capitalized, inside the parentheses). */
const ADDED_RECORD: Record<NotificationLocale, Record<string, string>> = {
    es: { adoption: 'Adopción', adoption_request: 'Solicitud', observation: 'Observación', follow_up: 'Seguimiento', returned_pet: 'Devolución', foster: 'Tránsito' },
    en: { adoption: 'Adoption', adoption_request: 'Request', observation: 'Note', follow_up: 'Follow-up', returned_pet: 'Return', foster: 'Foster' },
    pt: { adoption: 'Adoção', adoption_request: 'Solicitação', observation: 'Observação', follow_up: 'Acompanhamento', returned_pet: 'Devolução', foster: 'Lar temporário' },
};
const ADDED_WORDS: Record<NotificationLocale, {
    record: [string, string]; photo: [string, string]; video: [string, string]; address: string; and: string;
    title: { record: [string, string]; photo: [string, string]; video: [string, string]; address: string };
    added: string; to: (name: string | undefined) => string;
}> = {
    es: {
        record: ['un registro', 'registros'], photo: ['una foto', 'fotos'], video: ['un video', 'videos'], address: 'una dirección de entrega', and: 'y',
        title: { record: ['Nuevo registro', 'Nuevos registros'], photo: ['Nueva foto', 'Nuevas fotos'], video: ['Nuevo video', 'Nuevos videos'], address: 'Nueva dirección de entrega' },
        added: 'agregó', to: n => (n ? `a ${n}` : 'al adoptante'),
    },
    en: {
        record: ['a record', 'records'], photo: ['a photo', 'photos'], video: ['a video', 'videos'], address: 'a delivery address', and: 'and',
        title: { record: ['New record', 'New records'], photo: ['New photo', 'New photos'], video: ['New video', 'New videos'], address: 'New delivery address' },
        added: 'added', to: n => `to ${n || 'the adopter'}`,
    },
    pt: {
        record: ['um registro', 'registros'], photo: ['uma foto', 'fotos'], video: ['um vídeo', 'vídeos'], address: 'um endereço de entrega', and: 'e',
        title: { record: ['Novo registro', 'Novos registros'], photo: ['Nova foto', 'Novas fotos'], video: ['Novo vídeo', 'Novos vídeos'], address: 'Novo endereço de entrega' },
        added: 'adicionou', to: n => (n ? `a ${n}` : 'ao adotante'),
    },
};
function profileContentAdded(p: NotificationTemplateParams['profile_content_added'], l: NotificationLocale): NotificationText | null {
    const add = additionFromParams(p);
    const w = ADDED_WORDS[l];
    const items: string[] = [];
    const records = add.records ?? [];
    if (records.length) {
        const labels = records.map(r => {
            const label = Object.hasOwn(ADDED_RECORD[l], r.type) ? ADDED_RECORD[l][r.type] : null;
            return label && r.rating ? `${label}, ${r.rating}★` : label;
        });
        // A code this text doesn't know shows no labels (never a raw code).
        const shown = labels.every(Boolean) ? ` (${labels.join('; ')})` : '';
        items.push(records.length === 1 ? `${w.record[0]}${shown}` : `${records.length} ${w.record[1]}${shown}`);
    }
    const counted = (n: number | undefined, pair: [string, string]) => { if (n) items.push(n === 1 ? pair[0] : `${n} ${pair[1]}`); };
    counted(add.photos, w.photo);
    counted(add.videos, w.video);
    if (add.address) items.push(w.address);
    if (!items.length) return null;
    const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} ${w.and} ${items[items.length - 1]}`;
    const t = w.title;
    const head = records.length ? t.record[records.length === 1 ? 0 : 1]
        : add.photos ? t.photo[add.photos === 1 && !add.videos ? 0 : 1]
            : add.videos ? t.video[add.videos === 1 ? 0 : 1]
                : t.address;
    const name = p.adopterName?.trim() || undefined;
    return { title: name ? `${head}: ${name}` : head, body: `${p.actorName} ${w.added} ${list} ${w.to(name)}.` };
}

// ── Templates ────────────────────────────────────────────────────

const TEMPLATES: { [K in NotificationTemplateKey]: TemplateDef<NotificationTemplateParams[K]> } = {
    member_joined: {
        required: ['memberName'],
        es: p => ({ title: '👋 Nuevo miembro', body: `${p.memberName} se unió a ${p.orgName || 'la organización'}.` }),
        en: p => ({ title: '👋 New member', body: `${p.memberName} joined ${p.orgName || 'the organization'}.` }),
        pt: p => ({ title: '👋 Novo membro', body: p.orgName ? `${p.memberName} entrou em ${p.orgName}.` : `${p.memberName} entrou na organização.` }),
    },
    member_removed: {
        required: ['actorName'],
        es: p => ({ title: p.orgName ? `Ya no estás en «${p.orgName}»` : 'Ya no estás en el grupo', body: `${p.actorName} te quitó del grupo. Lo que cargaste sigue a tu nombre.` }),
        en: p => ({ title: p.orgName ? `You're no longer in «${p.orgName}»` : "You're no longer in the group", body: `${p.actorName} removed you from the group. What you added stays under your name.` }),
        pt: p => ({ title: p.orgName ? `Você não está mais em «${p.orgName}»` : 'Você não está mais no grupo', body: `${p.actorName} removeu você do grupo. O que você cadastrou continua no seu nome.` }),
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
    duplicate_flagged: {
        required: ['reporterName'],
        es: p => ({ title: 'Posible duplicado en tu perfil', body: `${p.reporterName} cree que ${p.nameA || 'un perfil'} y ${p.nameB || 'otro perfil'} son la misma persona.` }),
        en: p => ({ title: 'Possible duplicate on your profile', body: `${p.reporterName} thinks ${p.nameA || 'a profile'} and ${p.nameB || 'another profile'} are the same person.` }),
        pt: p => ({ title: 'Possível duplicado no seu perfil', body: `${p.reporterName} acha que ${p.nameA || 'um perfil'} e ${p.nameB || 'outro perfil'} são a mesma pessoa.` }),
    },
    inaccuracy_reported: {
        required: ['reporterName'],
        es: p => ({ title: 'Información incorrecta en un perfil', body: `${p.reporterName} dice que hay información incorrecta en ${p.adopterName ? `el perfil de ${p.adopterName}` : 'un perfil'}${p.details ? `: «${p.details}»` : '.'}` }),
        en: p => ({ title: 'Wrong information on a profile', body: `${p.reporterName} says some information on ${p.adopterName ? `${p.adopterName}’s profile` : 'a profile'} is wrong${p.details ? `: “${p.details}”` : '.'}` }),
        pt: p => ({ title: 'Informação incorreta em um perfil', body: `${p.reporterName} diz que há informação incorreta ${p.adopterName ? `no perfil de ${p.adopterName}` : 'em um perfil'}${p.details ? `: «${p.details}»` : '.'}` }),
    },
    contract_attached: {
        required: ['actorName', 'profileName'],
        es: p => ({
            title: `${p.actorName} adjuntó un contrato a tu perfil ${p.profileName}`,
            body: (p.animalName ? `Adopción de ${p.animalName} atribuida a este perfil. Tocá para revisar.` : 'Tocá para revisar.') + disputeHint(p, 'es'),
        }),
        en: p => ({
            title: `${p.actorName} attached a contract to your profile ${p.profileName}`,
            body: (p.animalName ? `Adoption of ${p.animalName} credited to this profile. Tap to review.` : 'Tap to review.') + disputeHint(p, 'en'),
        }),
        pt: p => ({
            title: `${p.actorName} anexou um contrato ao seu perfil ${p.profileName}`,
            body: (p.animalName ? `Adoção de ${p.animalName} atribuída a este perfil. Toque para revisar.` : 'Toque para revisar.') + disputeHint(p, 'pt'),
        }),
    },
    form_attached: {
        required: ['actorName', 'profileName'],
        es: p => ({ title: `${p.actorName} vinculó una solicitud de adopción a tu perfil ${p.profileName}`, body: `Tocá para revisar.${disputeHint(p, 'es')}` }),
        en: p => ({ title: `${p.actorName} linked an adoption request to your profile ${p.profileName}`, body: `Tap to review.${disputeHint(p, 'en')}` }),
        pt: p => ({ title: `${p.actorName} vinculou uma solicitação de adoção ao seu perfil ${p.profileName}`, body: `Toque para revisar.${disputeHint(p, 'pt')}` }),
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
    contract_result_signed: {
        required: ['adopterName'],
        es: p => ({ title: `${p.animalName || 'Animal'} adoptado por ${p.adopterName}`, body: `${p.adopterName} firmó el contrato de adopción de ${p.animalName || 'un animal'}.` }),
        en: p => ({ title: `${p.animalName || 'Animal'} adopted by ${p.adopterName}`, body: `${p.adopterName} signed the adoption contract for ${p.animalName || 'an animal'}.` }),
        pt: p => ({ title: `${p.animalName || 'Animal'} adotado por ${p.adopterName}`, body: `${p.adopterName} assinou o contrato de adoção de ${p.animalName || 'um animal'}.` }),
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
        es: p => p.dispute === '1'
            ? { title: `${p.requesterName} pide que un administrador revise dos perfiles`, body: `El otro rescatista rechazó unirlos, pero ${p.requesterName} cree que son la misma persona: ${KEEPS.es(p)}. Podés aprobar o rechazar el pedido.` }
            : { title: `${p.requesterName} pidió unir dos perfiles`, body: `Pidió unir dos perfiles porque serían la misma persona: ${KEEPS.es(p)}. Podés aceptar o rechazar el pedido.` },
        en: p => p.dispute === '1'
            ? { title: `${p.requesterName} asks an administrator to review two profiles`, body: `The other rescuer declined to join them, but ${p.requesterName} believes they are the same person: ${KEEPS.en(p)}. You can approve or decline the request.` }
            : { title: `${p.requesterName} asked to join two profiles`, body: `They asked to join two profiles because they would be the same person: ${KEEPS.en(p)}. You can accept or decline the request.` },
        pt: p => p.dispute === '1'
            ? { title: `${p.requesterName} pede que um administrador revise dois perfis`, body: `O outro resgatista recusou uni-los, mas ${p.requesterName} acredita que são a mesma pessoa: ${KEEPS.pt(p)}. Você pode aprovar ou recusar o pedido.` }
            : { title: `${p.requesterName} pediu para unir dois perfis`, body: `Pediu para unir dois perfis porque seriam a mesma pessoa: ${KEEPS.pt(p)}. Você pode aceitar ou recusar o pedido.` },
    },
    merge_request_accepted: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: MERGED_TITLE.es(p), body: `${who} aceptó unir los perfiles: ${KEEPS.es(p)}. Todo quedó en un solo perfil.` })),
        en: p => withWho(p, 'en', who => ({ title: MERGED_TITLE.en(p), body: `${who} accepted joining the profiles: ${KEEPS.en(p)}. Everything is now in one profile.` })),
        pt: p => withWho(p, 'pt', who => ({ title: MERGED_TITLE.pt(p), body: `${who} aceitou unir os perfis: ${KEEPS.pt(p)}. Tudo ficou em um só perfil.` })),
    },
    merge_request_flipped: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: MERGED_TITLE.es(p), body: `${who} aceptó unir los perfiles conservando ${survivorLabel(p, 'es')}: ${absorbedLabel(p, 'es')} quedó en ese perfil.` })),
        en: p => withWho(p, 'en', who => ({ title: MERGED_TITLE.en(p), body: `${who} accepted joining the profiles but kept ${survivorLabel(p, 'en')}: ${absorbedLabel(p, 'en')} is now part of that profile.` })),
        pt: p => withWho(p, 'pt', who => ({ title: MERGED_TITLE.pt(p), body: `${who} aceitou unir os perfis mantendo ${survivorLabel(p, 'pt')}: ${absorbedLabel(p, 'pt')} ficou nesse perfil.` })),
    },
    merge_request_declined: {
        required: ['survivorName', 'absorbedName'],
        es: p => withWho(p, 'es', who => ({ title: `${who} rechazó unir dos perfiles`, body: KEPT_APART.es(p) })),
        en: p => withWho(p, 'en', who => ({ title: `${who} declined to join two profiles`, body: KEPT_APART.en(p) })),
        pt: p => withWho(p, 'pt', who => ({ title: `${who} recusou unir dois perfis`, body: KEPT_APART.pt(p) })),
    },
    merge_request_answered_by_teammate: {
        required: ['actorName', 'requesterName', 'outcome', 'survivorName', 'absorbedName'],
        es: p => teammateAnswer(p, {
            accepted: [`${p.actorName} aceptó el pedido de ${p.requesterName}`, `Se unieron los perfiles: ${KEEPS.es(p)}.`],
            flipped: [`${p.actorName} aceptó el pedido de ${p.requesterName}`, `Se unieron los perfiles conservando ${survivorLabel(p, 'es')}: ${absorbedLabel(p, 'es')} quedó en ese perfil.`],
            declined: [`${p.actorName} rechazó el pedido de ${p.requesterName}`, KEPT_APART.es(p)],
        }),
        en: p => teammateAnswer(p, {
            accepted: [`${p.actorName} accepted ${p.requesterName}'s request`, `The profiles were joined: ${KEEPS.en(p)}.`],
            flipped: [`${p.actorName} accepted ${p.requesterName}'s request`, `The profiles were joined keeping ${survivorLabel(p, 'en')}: ${absorbedLabel(p, 'en')} is now part of that profile.`],
            declined: [`${p.actorName} declined ${p.requesterName}'s request`, KEPT_APART.en(p)],
        }),
        pt: p => teammateAnswer(p, {
            accepted: [`${p.actorName} aceitou o pedido de ${p.requesterName}`, `Os perfis foram unidos: ${KEEPS.pt(p)}.`],
            flipped: [`${p.actorName} aceitou o pedido de ${p.requesterName}`, `Os perfis foram unidos mantendo ${survivorLabel(p, 'pt')}: ${absorbedLabel(p, 'pt')} ficou nesse perfil.`],
            declined: [`${p.actorName} recusou o pedido de ${p.requesterName}`, KEPT_APART.pt(p)],
        }),
    },
    adopter_merged_by_rescuer: {
        required: ['actorName', 'survivorName', 'absorbedName'],
        es: p => ({ title: MERGED_TITLE.es(p), body: `${p.actorName} unió su perfil ${absorbedLabel(p, 'es')} con el tuyo ${survivorLabel(p, 'es')} porque son la misma persona. Todo quedó en tu perfil.${disputeHint(p, 'es')}` }),
        en: p => ({ title: MERGED_TITLE.en(p), body: `${p.actorName} joined their profile ${absorbedLabel(p, 'en')} with yours, ${survivorLabel(p, 'en')}, because they are the same person. Everything is now in your profile.${disputeHint(p, 'en')}` }),
        pt: p => ({ title: MERGED_TITLE.pt(p), body: `${p.actorName} uniu o perfil ${absorbedLabel(p, 'pt')} com o seu ${survivorLabel(p, 'pt')} porque são a mesma pessoa. Tudo ficou no seu perfil.${disputeHint(p, 'pt')}` }),
    },
    adopter_merged_by_admin: {
        required: ['survivorName', 'absorbedName'],
        es: p => ({ title: MERGED_TITLE.es(p), body: `Un administrador los unió porque son la misma persona: ${KEEPS.es(p)}. Todo lo registrado en los dos quedó en este perfil.${disputeHint(p, 'es')}` }),
        en: p => ({ title: MERGED_TITLE.en(p), body: `An administrator joined them because they are the same person: ${KEEPS.en(p)}. Everything recorded in both is now in this profile.${disputeHint(p, 'en')}` }),
        pt: p => ({ title: MERGED_TITLE.pt(p), body: `Um administrador os uniu porque são a mesma pessoa: ${KEEPS.pt(p)}. Tudo o que foi registrado nos dois ficou neste perfil.${disputeHint(p, 'pt')}` }),
    },
    merge_disputed: {
        required: ['raiserName', 'survivorName', 'absorbedName'],
        es: p => ({ title: `${p.raiserName} dice que no son la misma persona`, body: `Pide revisar dos perfiles que ya se unieron: ${KEEPS.es(p)}. Podés deshacer la unión o mantenerla.` }),
        en: p => ({ title: `${p.raiserName} says they are not the same person`, body: `They ask to review two profiles that were already joined: ${KEEPS.en(p)}. You can undo the join or keep it.` }),
        pt: p => ({ title: `${p.raiserName} diz que não são a mesma pessoa`, body: `Pede para revisar dois perfis que já foram unidos: ${KEEPS.pt(p)}. Você pode desfazer a união ou mantê-la.` }),
    },
    merge_dispute_resolved: {
        required: ['outcome', 'survivorName', 'absorbedName'],
        es: p => disputeOutcome(p, {
            undone: ['Un administrador separó dos perfiles', `Revisó si eran la misma persona y deshizo la unión: ${KEPT_APART.es(p)}`],
            kept: ['Un administrador mantuvo una unión', `Revisó si eran la misma persona y la unión queda: ${KEEPS.es(p)}.`],
        }),
        en: p => disputeOutcome(p, {
            undone: ['An administrator separated two profiles', `They reviewed whether it was the same person and undid the join: ${KEPT_APART.en(p)}`],
            kept: ['An administrator kept a join', `They reviewed whether it was the same person and the join stands: ${KEEPS.en(p)}.`],
        }),
        pt: p => disputeOutcome(p, {
            undone: ['Um administrador separou dois perfis', `Revisou se era a mesma pessoa e desfez a união: ${KEPT_APART.pt(p)}`],
            kept: ['Um administrador manteve uma união', `Revisou se era a mesma pessoa e a união continua: ${KEEPS.pt(p)}.`],
        }),
    },
    pair_message: {
        required: ['fromName', 'message'],
        es: p => ({ title: `${p.fromName} te escribió sobre «${p.profileName ?? ''}»`, body: p.message }),
        en: p => ({ title: `${p.fromName} wrote to you about “${p.profileName ?? ''}”`, body: p.message }),
        pt: p => ({ title: `${p.fromName} escreveu para você sobre «${p.profileName ?? ''}»`, body: p.message }),
    },
    household_linked: {
        required: ['actorName'],
        es: p => ({ title: `${plainName(p.linkedName, 'es')} convive con ${plainName(p.hostName, 'es')}`, body: `${p.actorName} indicó que ${plainName(p.linkedName, 'es')} vive con ${plainName(p.hostName, 'es')}. Tu perfil ahora lo muestra en «Convive con».` }),
        en: p => ({ title: `${plainName(p.linkedName, 'en')} lives with ${plainName(p.hostName, 'en')}`, body: `${p.actorName} noted that ${plainName(p.linkedName, 'en')} lives with ${plainName(p.hostName, 'en')}. Your profile now shows it under “Lives with”.` }),
        pt: p => ({ title: `${plainName(p.linkedName, 'pt')} mora com ${plainName(p.hostName, 'pt')}`, body: `${p.actorName} indicou que ${plainName(p.linkedName, 'pt')} mora com ${plainName(p.hostName, 'pt')}. Seu perfil agora mostra isso em «Mora com».` }),
    },
    household_contribution: {
        required: ['actorName', 'what'],
        es: p => p.what === 'member'
            ? { title: 'Alguien nuevo en el hogar', body: `${p.actorName} agregó a ${p.personName?.trim() || 'alguien'} al hogar ${householdOf(p.adopterName, 'es')}.` }
            : p.what === 'contact'
                ? { title: 'Nuevo dato de alguien del hogar', body: `${p.actorName} agregó ${entryTypeLabel(p.entryType ?? '', 'es')} de alguien del hogar ${householdOf(p.adopterName, 'es')}.` }
                : null,
        en: p => p.what === 'member'
            ? { title: 'New household member', body: `${p.actorName} added ${p.personName?.trim() || 'someone'} to ${householdOf(p.adopterName, 'en')} household.` }
            : p.what === 'contact'
                ? { title: 'New household contact detail', body: `${p.actorName} added ${entryTypeLabel(p.entryType ?? '', 'en')} for someone in ${householdOf(p.adopterName, 'en')} household.` }
                : null,
        pt: p => p.what === 'member'
            ? { title: 'Alguém novo no lar', body: `${p.actorName} adicionou ${p.personName?.trim() || 'alguém'} ao lar ${householdOf(p.adopterName, 'pt')}.` }
            : p.what === 'contact'
                ? { title: 'Novo dado de alguém do lar', body: `${p.actorName} adicionou ${entryTypeLabel(p.entryType ?? '', 'pt')} de alguém do lar ${householdOf(p.adopterName, 'pt')}.` }
                : null,
    },
    household_also_lives_with: {
        required: ['actorName'],
        es: p => ({ title: `${plainName(p.personName, 'es')} también vive en otro hogar`, body: `${p.actorName} indicó que ${plainName(p.personName, 'es')} también vive con ${plainName(p.hostName, 'es')}. Sigue apareciendo en el hogar de tu perfil.` }),
        en: p => ({ title: `${plainName(p.personName, 'en')} also lives elsewhere`, body: `${p.actorName} noted that ${plainName(p.personName, 'en')} also lives with ${plainName(p.hostName, 'en')}. They still show in your profile's household.` }),
        pt: p => ({ title: `${plainName(p.personName, 'pt')} também mora em outro lar`, body: `${p.actorName} indicou que ${plainName(p.personName, 'pt')} também mora com ${plainName(p.hostName, 'pt')}. Continua aparecendo no lar do seu perfil.` }),
    },
    household_relationship_changed: {
        required: ['actorName', 'relationship'],
        es: p => {
            const word = relationshipWord(p.relationship, 'es');
            if (!word) return null;
            const to = p.relativeName?.trim() ? ` (respecto de ${p.relativeName.trim()})` : '';
            return { title: `Parentesco cambiado: ${plainName(p.personName, 'es')}`, body: `${p.actorName} cambió el parentesco de ${plainName(p.personName, 'es')} a «${word}»${to}.` };
        },
        en: p => {
            const word = relationshipWord(p.relationship, 'en');
            if (!word) return null;
            const to = p.relativeName?.trim() ? ` (relative to ${p.relativeName.trim()})` : '';
            return { title: `Relationship changed: ${plainName(p.personName, 'en')}`, body: `${p.actorName} changed ${plainName(p.personName, 'en')}'s relationship to “${word}”${to}.` };
        },
        pt: p => {
            const word = relationshipWord(p.relationship, 'pt');
            if (!word) return null;
            const to = p.relativeName?.trim() ? ` (em relação a ${p.relativeName.trim()})` : '';
            return { title: `Parentesco alterado: ${plainName(p.personName, 'pt')}`, body: `${p.actorName} mudou o parentesco de ${plainName(p.personName, 'pt')} para «${word}»${to}.` };
        },
    },
    household_member_removed: {
        required: ['actorName', 'reason'],
        es: p => p.reason === 'not_living'
            ? { title: `No vive ahí: ${plainName(p.personName, 'es')}`, body: `${p.actorName} indicó que ${plainName(p.personName, 'es')} no vive con ${plainName(p.hostName, 'es')}. Se quitó de ese hogar y queda en el historial. Si no es así, podés volver a agregarlo y un administrador lo revisa.` }
            : p.reason === 'mistake'
                ? { title: `Quitado del hogar: ${plainName(p.personName, 'es')}`, body: `${p.actorName} quitó a ${plainName(p.personName, 'es')} del hogar ${householdOf(p.hostName, 'es')} porque se había cargado por error.` }
                : null,
        en: p => p.reason === 'not_living'
            ? { title: `Doesn't live there: ${plainName(p.personName, 'en')}`, body: `${p.actorName} said ${plainName(p.personName, 'en')} doesn't live with ${plainName(p.hostName, 'en')}. They were removed from that household; the history shows it. If that's wrong, you can add them again and an administrator will review it.` }
            : p.reason === 'mistake'
                ? { title: `Removed from a household: ${plainName(p.personName, 'en')}`, body: `${p.actorName} removed ${plainName(p.personName, 'en')} from ${householdOf(p.hostName, 'en')} household because they were added by mistake.` }
                : null,
        pt: p => p.reason === 'not_living'
            ? { title: `Não mora lá: ${plainName(p.personName, 'pt')}`, body: `${p.actorName} indicou que ${plainName(p.personName, 'pt')} não mora com ${plainName(p.hostName, 'pt')}. Foi removido desse lar e fica no histórico. Se não for assim, você pode adicioná-lo de novo e um administrador vai revisar.` }
            : p.reason === 'mistake'
                ? { title: `Removido do lar: ${plainName(p.personName, 'pt')}`, body: `${p.actorName} removeu ${plainName(p.personName, 'pt')} do lar ${householdOf(p.hostName, 'pt')} porque tinha sido adicionado por engano.` }
                : null,
    },
    profile_renamed: {
        required: ['actorName', 'toName'],
        es: p => ({
            title: p.viaContract && p.fromName?.trim()
                ? `Al firmar el contrato, ${p.fromName.trim()} cambió su nombre a ${p.toName}`
                : p.fromName?.trim() ? `${p.actorName} cambió el nombre de ${p.fromName.trim()} a ${p.toName}` : `${p.actorName} le puso nombre a un perfil: ${p.toName}`,
            body: p.fromName?.trim()
                ? `El nombre anterior quedó como «Conocido/a como», así que buscar «${p.fromName.trim()}» lo sigue encontrando. Si el cambio no corresponde, deshacelo.`
                : 'Si el cambio no corresponde, deshacelo.',
        }),
        en: p => ({
            title: p.viaContract && p.fromName?.trim()
                ? `Signing the contract, ${p.fromName.trim()} changed their name to ${p.toName}`
                : p.fromName?.trim() ? `${p.actorName} renamed ${p.fromName.trim()} to ${p.toName}` : `${p.actorName} named a profile ${p.toName}`,
            body: p.fromName?.trim()
                ? `The previous name is kept as “Also known as”, so searching “${p.fromName.trim()}” still finds them. If the change is wrong, undo it.`
                : 'If the change is wrong, undo it.',
        }),
        pt: p => ({
            title: p.viaContract && p.fromName?.trim()
                ? `Ao assinar o contrato, ${p.fromName.trim()} mudou o nome para ${p.toName}`
                : p.fromName?.trim() ? `${p.actorName} mudou o nome de ${p.fromName.trim()} para ${p.toName}` : `${p.actorName} deu nome a um perfil: ${p.toName}`,
            body: p.fromName?.trim()
                ? `O nome anterior ficou como «Também conhecido/a como», então buscar «${p.fromName.trim()}» continua encontrando. Se a mudança não estiver certa, desfaça.`
                : 'Se a mudança não estiver certa, desfaça.',
        }),
    },
    profile_rename_undone: {
        required: ['actorName'],
        es: p => ({
            title: `Se deshizo tu cambio de nombre: ${plainName(p.restoredName, 'es')}`,
            body: `${p.actorName} deshizo el cambio: el perfil vuelve a llamarse ${plainName(p.restoredName, 'es')}.${p.revertedName?.trim() ? ` «${p.revertedName.trim()}» quedó como «Conocido/a como».` : ''}`,
        }),
        en: p => ({
            title: `Your name change was undone: ${plainName(p.restoredName, 'en')}`,
            body: `${p.actorName} undid the change: the profile is called ${plainName(p.restoredName, 'en')} again.${p.revertedName?.trim() ? ` “${p.revertedName.trim()}” is kept as “Also known as”.` : ''}`,
        }),
        pt: p => ({
            title: `Sua mudança de nome foi desfeita: ${plainName(p.restoredName, 'pt')}`,
            body: `${p.actorName} desfez a mudança: o perfil volta a se chamar ${plainName(p.restoredName, 'pt')}.${p.revertedName?.trim() ? ` «${p.revertedName.trim()}» ficou como «Também conhecido/a como».` : ''}`,
        }),
    },
    profile_content_added: {
        required: ['actorName'],
        es: p => profileContentAdded(p, 'es'),
        en: p => profileContentAdded(p, 'en'),
        pt: p => profileContentAdded(p, 'pt'),
    },
    household_member_disputed: {
        required: ['actorName'],
        es: p => ({ title: `Convivencia en disputa: ${plainName(p.personName, 'es')}`, body: `${p.viaMerge === '1' ? `Al unir perfiles, ${p.actorName} volvió a dejar a ${plainName(p.personName, 'es')} en el` : `${p.actorName} volvió a agregar a ${plainName(p.personName, 'es')} al`} hogar ${householdOf(p.hostName, 'es')}, después de que alguien indicara que no vive ahí. Revisá quién tiene razón.` }),
        en: p => ({ title: `Household disputed: ${plainName(p.personName, 'en')}`, body: `${p.viaMerge === '1' ? `By joining profiles, ${p.actorName} put ${plainName(p.personName, 'en')} back in` : `${p.actorName} added ${plainName(p.personName, 'en')} back to`} ${householdOf(p.hostName, 'en')} household after someone said they don't live there. Please review who is right.` }),
        pt: p => ({ title: `Convivência em disputa: ${plainName(p.personName, 'pt')}`, body: `${p.viaMerge === '1' ? `Ao unir perfis, ${p.actorName} colocou de novo ${plainName(p.personName, 'pt')} no` : `${p.actorName} adicionou de novo ${plainName(p.personName, 'pt')} ao`} lar ${householdOf(p.hostName, 'pt')}, depois que alguém indicou que não mora lá. Revise quem tem razão.` }),
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

function disputeOutcome(p: { outcome: string }, byOutcome: Record<'undone' | 'kept', [string, string]>): NotificationText | null {
    if (p.outcome !== 'undone' && p.outcome !== 'kept') return null;
    const [title, body] = byOutcome[p.outcome];
    return { title, body };
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
