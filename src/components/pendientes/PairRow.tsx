'use client';

/**
 * One pair in «Pendientes de revisar» (layout D, D21–D23, D27, D29).
 *
 * Closed: a state icon, the names («A ×2» when equal, «A / B»), the state line
 * and the summary line «Coinciden: … · Distintos: …» (or «Marcado
 * manualmente»); admins also get the match gauge. Opened: the header keeps
 * only the state line (the names live in the comparison blocks, D23), then
 * «¿Cuál se conserva?» for a possible duplicate, the «Qué coincide y qué no»
 * card with the kept block outlined, one line saying what will happen, and
 * the row's buttons.
 *
 * Decides nothing: every choice offered comes from the feed (keepOptions,
 * actionByKeep, request.canMessage), and every click goes up as an action.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ChevronDown, Copy, ExternalLink, Inbox, Mail, Send, XCircle } from 'lucide-react';
import type { PendingDedupPair, PendingDedupSide } from '@/app/actions/duplicates';
import MatchCompare, { AdminScore, entriesAsShown } from '@/components/MatchCompare';
import { matchTypeLabel } from '@/lib/matchTypeLabels';
import { MinorTag } from '@/components/MinorTag';
import { CardHouseholdLine } from '@/components/CardHouseholdLine';
import {
    AbsorbedBadge, KeptBadge, T_MUTED, T_PRIMARY,
    combineTheirsSide, fill, otherSide, ownerName, sideById, sideOf, movesToOtherList, type KeepSide, type T,
} from './ui';

export type RowAction =
    | 'combine' | 'keep_separate' | 'accept' | 'decline' | 'flip' | 'cancel' | 'hide' | 'write'
    /**
     * Declined, requester side: keep the asked owner's profile — merged now by
     * an admin (D43), or for a rescuer «Pedir revisión a un administrador» (D49).
     */
    | 'combine_theirs';

type Group = PendingDedupPair['group'];

const ROW_META: Record<Group, { groupKey: string; groupFallback: string; icon: React.ReactNode; dot: string }> = {
    received: {
        groupKey: 'myAdopters.pending_d_group_received', groupFallback: 'Necesitan tu respuesta',
        icon: <Inbox className="w-5 h-5" aria-hidden="true" />,
        dot: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]',
    },
    sent: {
        groupKey: 'myAdopters.pending_d_group_sent', groupFallback: 'Enviados',
        icon: <Send className="w-5 h-5" aria-hidden="true" />,
        dot: `bg-transparent ${T_MUTED} border-[var(--border-default)]`,
    },
    declined: {
        groupKey: 'myAdopters.pending_d_group_declined', groupFallback: 'Rechazados',
        icon: <XCircle className="w-5 h-5" aria-hidden="true" />,
        dot: 'bg-[var(--status-error-bg)] text-[var(--status-error-text)] border-[var(--status-error-border)]',
    },
    pair: {
        groupKey: 'myAdopters.pending_d_group_pair', groupFallback: 'Posibles duplicados',
        icon: <Copy className="w-5 h-5" aria-hidden="true" />,
        dot: 'bg-[var(--accent-subtle-bg)] text-[var(--accent)] border-[var(--border-accent)]',
    },
};

export const GROUP_ORDER: Group[] = ['received', 'sent', 'declined', 'pair'];

export function groupLabel(group: Group, t: T): string {
    return t(ROW_META[group].groupKey) || ROW_META[group].groupFallback;
}

const SOURCE_KEYS: Record<string, string> = {
    form: 'myAdopters.source_form', contract: 'myAdopters.source_contract',
    imported: 'myAdopters.source_imported', api: 'myAdopters.source_api',
};

/** «A ×2» only when the names are written the same: «Lucia» vs «Lucía» is worth seeing. */
const sameName = (a: string, b: string) => a.trim() === b.trim();

/** The side that isn't the viewer's or their team's — whose owner the row talks about. */
function foreignSide(pair: PendingDedupPair): PendingDedupSide | null {
    if (!pair.newAdopter.teamOwned) return pair.newAdopter;
    if (!pair.existingAdopter.teamOwned) return pair.existingAdopter;
    return null;
}

/** «Tuyo y de María» for a possible duplicate (D22). */
function ownershipLine(pair: PendingDedupPair, t: T): string {
    const { newAdopter: a, existingAdopter: b } = pair;
    if (a.isMine && b.isMine) return t('myAdopters.pending_d_line_both_mine') || 'Los dos son tuyos';
    if (a.isMine || b.isMine) {
        return fill(t('myAdopters.pending_d_line_mine_and') || 'Tuyo y de {name}', { name: ownerName(a.isMine ? b : a, t) });
    }
    const [na, nb] = [ownerName(a, t), ownerName(b, t)];
    return na === nb
        ? fill(t('myAdopters.pending_d_line_both_of') || 'Los dos de {name}', { name: na })
        : fill(t('myAdopters.pending_d_line_of_and') || 'De {a} y de {b}', { a: na, b: nb });
}

function stateLine(pair: PendingDedupPair, t: T, age: (epochS: number) => string): string {
    const r = pair.request;
    const someone = t('myAdopters.pending_dedup_a_user') || 'Un usuario';
    if (!r || pair.group === 'pair') return ownershipLine(pair, t);
    if (pair.group === 'received') {
        return fill(t('myAdopters.pending_d_line_received') || '{name} te pide combinar · {when}', { name: r.counterpartName || someone, when: age(r.createdAt) });
    }
    if (pair.group === 'sent') {
        if (r.dispute) return fill(t('myAdopters.pending_d_line_sent_dispute') || 'Revisión pedida a un administrador · {when}', { when: age(r.createdAt) });
        return r.toAdmins || !r.counterpartName
            ? fill(t('myAdopters.pending_d_line_sent_admins') || 'Enviado a un administrador · {when}', { when: age(r.createdAt) })
            : fill(t('myAdopters.pending_d_line_sent') || 'Esperando a {name} · {when}', { name: r.counterpartName, when: age(r.createdAt) });
    }
    const when = age(r.declinedAt ?? r.createdAt);
    return r.declinedByName
        ? fill(t('myAdopters.pending_d_line_declined_by') || 'Rechazado por {name} · {when}', { name: r.declinedByName, when })
        : fill(t('myAdopters.pending_d_line_declined_by_you') || 'Lo rechazaste · {when}', { when });
}

/** «Coinciden: nombre, teléfono · Distintos: email», or «Marcado manualmente» (D22). */
function summaryLine(pair: PendingDedupPair, t: T): string {
    const field = (f: string) => (t(`matchCompare.field_${f}`) || f).toLocaleLowerCase();
    const parts: string[] = [];
    if (pair.summary.flagged) parts.push(matchTypeLabel('flagged_by_user', t) || 'Marcado manualmente');
    if (pair.summary.same.length) parts.push(`${t('matchCompare.count_same') || 'Coinciden'}: ${pair.summary.same.map(field).join(', ')}`);
    if (pair.summary.diff.length) parts.push(`${t('matchCompare.count_diff') || 'Distintos'}: ${pair.summary.diff.map(field).join(', ')}`);
    return parts.join(' · ');
}

/** What the open row will do, in one line (D23). */
function explanation(pair: PendingDedupPair, keep: KeepSide, isAdmin: boolean, t: T): string | null {
    const r = pair.request;
    const other = r?.counterpartName || (t('myAdopters.pending_dedup_a_user') || 'Un usuario');
    if (pair.group === 'received' && r) {
        return fill(t('myAdopters.pending_d_explain_received') || 'Si aceptás, tu perfil pasa a la lista de {name}. Con «Conservar el mío», el de {name} se suma al tuyo.', { name: other });
    }
    if (pair.group === 'sent' && r) {
        if (r.dispute) return t('myAdopters.pending_d_explain_sent_dispute') || 'Un administrador va a decidir si son la misma persona.';
        return r.toAdmins || !r.counterpartName
            ? (t('myAdopters.pending_d_explain_sent_admins') || 'Se conserva el tuyo cuando un administrador lo apruebe.')
            : fill(t('myAdopters.pending_d_explain_sent') || 'Se conserva el tuyo cuando {name} acepte.', { name: other });
    }
    if (pair.group === 'declined' && r) {
        if (r.direction === 'received') return t('myAdopters.pending_d_explain_declined_owner') || 'Siguen separados. Si cambiaste de idea, podés aceptar ahora.';
        const theirs = combineTheirsSide(pair);
        if (theirs && pair.actionByKeep[theirs] === 'dispute') {
            return fill(t('myAdopters.pending_d_explain_declined_requester_dispute') || '{name} prefirió no combinarlos: no podés volver a pedirlo. Si creés que son la misma persona, un administrador puede revisarlo.', { name: other });
        }
        return theirs
            ? fill(t('myAdopters.pending_d_explain_declined_requester') || '{name} prefirió no combinarlos: no podés volver a pedirlo, pero podés combinar conservando su perfil.', { name: other })
            : fill(t('myAdopters.pending_d_explain_declined_requester_nocombine') || '{name} prefirió no combinarlos. Siguen separados.', { name: other });
    }
    const action = pair.actionByKeep[keep];
    if (!action) return null;
    // D49/D50: a rejection or an admin's ruling stands between this pair and a merge.
    if (action === 'dispute') return t('myAdopters.pending_d_explain_dispute') || 'Ya se dijo que no son la misma persona: un administrador va a decidir si se combinan.';
    const absorbed = sideOf(pair, otherSide(keep));
    if (action === 'request') {
        return absorbed.createdByName
            ? fill(t('myAdopters.pending_d_explain_request') || 'Se conserva el tuyo: {name} tiene que aceptar.', { name: absorbed.createdByName })
            : (t('myAdopters.pending_d_explain_request_admins') || 'Se conserva el tuyo: un administrador tiene que aprobarlo.');
    }
    if (movesToOtherList(pair, keep)) {
        // A non-admin keeping the other rescuer's profile without their consent keeps
        // access only to the contact values they entered (mergeAccess absorbed_entries);
        // an admin's merge keeps full access.
        if (!isAdmin) {
            return fill(t('myAdopters.pending_d_explain_moves_entries') || 'Tu perfil pasa a la lista de {name}. Vas a seguir viendo los datos que cargaste.', { name: ownerName(sideOf(pair, keep), t) });
        }
        return fill(t('myAdopters.pending_d_explain_moves') || 'Tu perfil pasa a la lista de {name}. Vas a seguir viendo sus datos.', { name: ownerName(sideOf(pair, keep), t) });
    }
    return t('myAdopters.pending_d_explain_merge') || 'Los datos del otro perfil se suman al que se conserva.';
}

/** A comparison block's title: what happens to it, whose it is, source, date, and the ways out (D23, D33). */
function SideHead({ side, badge, t, formatShortDate, onRequestAccess }: {
    side: PendingDedupSide;
    badge: 'kept' | 'absorbed' | null;
    t: T;
    formatShortDate: (v: number) => string;
    onRequestAccess: (side: PendingDedupSide) => void;
}) {
    const sourceKey = SOURCE_KEYS[side.source];
    const meta = [sourceKey ? t(sourceKey) : null, side.createdAt ? formatShortDate(side.createdAt) : null].filter(Boolean).join(' · ');
    const createdBy = side.createdByName
        ? fill(t('myAdopters.pending_dedup_created_by') || 'Cargado por {name}', { name: side.createdByName })
        : side.createdByAnonymous ? (t('myAdopters.pending_dedup_created_by_anonymous') || 'Cargado por un usuario anónimo') : null;
    return (
        <div className="min-w-0 normal-case tracking-normal font-normal space-y-1">
            {badge === 'kept' && <div><KeptBadge t={t} /></div>}
            {badge === 'absorbed' && <div><AbsorbedBadge t={t} /></div>}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
                {side.isMine
                    ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent-badge-bg)] text-[var(--accent)]">{t('myAdopters.pending_d_mine_tag') || 'Tuyo'}</span>
                    : createdBy && <span data-testid="dedup-created-by" className={`font-semibold ${T_MUTED}`}>{createdBy}</span>}
                {meta && <span className={T_MUTED}>· {meta}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 text-[12px]">
                {/* New tab: the comparison you are mid-way through stays on screen. */}
                <Link href={`/adopter/${side.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 min-h-[44px] font-semibold text-[var(--accent)] hover:underline underline-offset-2">
                    {t('adopter.dup_action_view') || 'Ver perfil'}
                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{t('common.opens_new_tab') || '(abre en una pestaña nueva)'}</span>
                </Link>
                {/* Locked values in this block belong to whoever added this profile. */}
                {!side.canSeeContact && (
                    <button type="button" onClick={() => onRequestAccess(side)}
                        className="inline-flex items-center min-h-[44px] font-semibold text-[var(--accent)] underline underline-offset-2 text-left">
                        {t('myAdopters.pending_dedup_request_access') || 'Pedir acceso a quien lo cargó'}
                    </button>
                )}
            </div>
            {/* Who they live with, as everywhere (final fix P2). «Menor de edad» sits under the name, in the
                rating slot (audit B5/B6) — MatchCompare's nameStanding. */}
            <CardHouseholdLine lines={side.households} className="mt-1" />
        </div>
    );
}

/** «¿Cuál se conserva?» (D24): a side the viewer may not keep is shown but not selectable (D42, D43). */
function KeepSwitch({ pair, keep, onKeep, t, formatShortDate }: {
    pair: PendingDedupPair;
    keep: KeepSide;
    onKeep: (s: KeepSide) => void;
    t: T;
    formatShortDate: (v: number) => string;
}) {
    const label = (s: PendingDedupSide) => s.isMine ? (t('myAdopters.pending_d_keep_mine') || 'El tuyo')
        : s.createdByName ? fill(t('myAdopters.pending_d_keep_of') || 'El de {name}', { name: s.createdByName })
            : (t('myAdopters.pending_d_keep_anonymous') || 'El anónimo');
    const question = t('myAdopters.pending_d_keep_question') || '¿Cuál se conserva?';
    return (
        <div className="mb-3">
            <p id={`keep-q-${pair.candidateId}`} className={`text-[12px] font-bold uppercase tracking-wider mb-2 ${T_MUTED}`}>{question}</p>
            <div role="radiogroup" aria-labelledby={`keep-q-${pair.candidateId}`} className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-[var(--border-default)]">
                {(['new', 'existing'] as const).map(s => {
                    const side = sideOf(pair, s);
                    const on = keep === s;
                    const allowed = pair.keepOptions[s];
                    return (
                        <button key={s} type="button" role="radio" aria-checked={on} disabled={!allowed}
                            data-testid={`dedup-keep-${s}`}
                            onClick={() => onKeep(s)}
                            className={`min-h-[44px] min-w-0 px-2 py-1 rounded-lg text-[13px] font-bold leading-tight break-words disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-teal-700 text-white' : `${T_PRIMARY} hover:bg-[var(--accent-subtle-bg)]`}`}>
                            {label(side)}
                            <span className={`block text-[11px] font-semibold ${on ? 'text-white' : T_MUTED}`}>
                                {allowed ? (side.createdAt ? formatShortDate(side.createdAt) : '') : (t('myAdopters.pending_d_keep_unavailable') || 'No se puede conservar')}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default function PairRow({ pair, open, highlight = false, onToggle, keep, onKeep, busy, locked, isAdmin, t, formatShortDate, age, onAction, onRequestAccess }: {
    pair: PendingDedupPair;
    open: boolean;
    /** The pair a profile's «Revisar» linked to: outlined so it's found at a glance. */
    highlight?: boolean;
    onToggle: () => void;
    /** «¿Cuál se conserva?» for a possible duplicate (the feed's default until changed). */
    keep: KeepSide;
    onKeep: (s: KeepSide) => void;
    /** This row's action is in flight. */
    busy: boolean;
    /** Some row's action is in flight: no second click anywhere. */
    locked: boolean;
    isAdmin: boolean;
    t: T;
    formatShortDate: (v: number) => string;
    age: (epochS: number) => string;
    onAction: (pair: PendingDedupPair, action: RowAction, keep?: KeepSide) => void;
    onRequestAccess: (side: PendingDedupSide) => void;
}) {
    const { group, request: r } = pair;
    const meta = ROW_META[group];
    const names = sameName(pair.newAdopter.name, pair.existingAdopter.name)
        ? <>{pair.newAdopter.name}<span className={`ml-1 text-[12px] font-semibold ${T_MUTED}`}>×2</span></>
        : `${pair.newAdopter.name} / ${pair.existingAdopter.name}`;
    const summary = summaryLine(pair, t);
    // The survivor the blocks mark: the switch for a possible duplicate, the
    // request's choice while it's open, none once it was declined (D27).
    const survivor: KeepSide | null = group === 'pair' ? keep
        : (group === 'received' || group === 'sent') && r ? sideById(pair, r.keepId) : null;
    const badge = (s: KeepSide) => (survivor === null ? null : survivor === s ? 'kept' : 'absorbed');
    const theirs = combineTheirsSide(pair);
    const mainAction = group === 'pair' ? pair.actionByKeep[keep] : null;
    const writeTo = r?.counterpartName || (t('myAdopters.pending_dedup_a_user') || 'Un usuario');
    const otherOwner = foreignSide(pair);
    const theirsName = r?.counterpartName || (otherOwner ? ownerName(otherOwner, t) : '');
    const explain = open ? explanation(pair, keep, isAdmin, t) : null;
    const showScore = isAdmin && typeof pair.adminScore === 'number';

    const write = r?.canMessage && (
        <Button variant="secondary" size="compact" data-testid="dedup-write" disabled={locked} onClick={() => onAction(pair, 'write')}>
            <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
            {fill(t('myAdopters.pending_d_action_write') || 'Escribirle a {name}', { name: writeTo })}
        </Button>
    );

    return (
        <div data-testid="dedup-row" data-group={group} data-candidate-id={pair.candidateId} data-highlight={highlight || undefined}
            className={`border-t border-[var(--border-default)] first:border-t-0 ${open ? 'bg-[var(--accent-subtle-bg)]' : ''} ${highlight ? 'ring-2 ring-inset ring-[var(--status-warning-border)]' : ''}`}>
            <div className="flex items-center">
                <button type="button" aria-expanded={open} onClick={onToggle}
                    className="flex-1 min-w-0 min-h-[64px] flex items-center gap-3 pl-4 pr-2 py-3 text-left">
                    <span className={`w-10 h-10 shrink-0 rounded-full border flex items-center justify-center ${meta.dot}`}>{meta.icon}</span>
                    <span className="flex-1 min-w-0">
                        {/* Open, the names sit in the comparison blocks (D23). */}
                        {!open && <span className={`block text-[15px] font-bold truncate ${T_PRIMARY}`}>{names}</span>}
                        <span data-testid={r ? 'dedup-request-status' : undefined}
                            className={`block text-[13px] ${group === 'received' ? 'font-bold text-[var(--status-warning-text)]' : group === 'declined' ? 'text-[var(--status-error-text)]' : T_MUTED}`}>
                            {stateLine(pair, t, age)}
                        </span>
                        {!open && summary && <span className={`block text-[12px] mt-0.5 ${T_MUTED}`}>{summary}</span>}
                    </span>
                    {group === 'received' && !open && (
                        <span className="hidden sm:inline text-[12px] font-bold px-2 py-1 rounded-full bg-teal-700 text-white">
                            {t('myAdopters.pending_d_respond') || 'Responder'}
                        </span>
                    )}
                    <ChevronDown className={`w-5 h-5 shrink-0 ${T_MUTED} transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {/* Admins only (D22): the same gauge as inside the card. Outside the
                    toggle — a button can't hold a button. */}
                {showScore && (
                    <span className="flex items-center justify-center min-w-[44px] min-h-[44px] pr-2">
                        <AdminScore score={pair.adminScore!} t={t} />
                    </span>
                )}
            </div>

            {open && (
                <div className="px-4 pb-4">
                    {group === 'pair' && <KeepSwitch pair={pair} keep={keep} onKeep={onKeep} t={t} formatShortDate={formatShortDate} />}
                    <MatchCompare
                        bare
                        adopterId={pair.existingAdopter.id}
                        matchTypes={pair.matchTypes}
                        profileName={pair.existingAdopter.name}
                        source={{ kind: 'new', name: pair.newAdopter.name, entries: entriesAsShown(pair.newAdopter) }}
                        profileEntries={entriesAsShown(pair.existingAdopter)}
                        target="existing"
                        score={pair.adminScore}
                        kept={survivor === 'new' ? 'source' : survivor === 'existing' ? 'target' : null}
                        sourceHead={<SideHead side={pair.newAdopter} badge={badge('new')} t={t} formatShortDate={formatShortDate} onRequestAccess={onRequestAccess} />}
                        targetHead={<SideHead side={pair.existingAdopter} badge={badge('existing')} t={t} formatShortDate={formatShortDate} onRequestAccess={onRequestAccess} />}
                        nameStanding={{
                            source: pair.newAdopter.isMinor ? <MinorTag testId="dedup-minor-new" /> : undefined,
                            target: pair.existingAdopter.isMinor ? <MinorTag testId="dedup-minor-existing" /> : undefined,
                        }}
                        t={t}
                    />
                    {explain && <p data-testid="dedup-explain" className={`mt-3 text-[13px] ${T_MUTED}`}>{explain}</p>}

                    <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                        {group === 'received' && <>
                            {write}
                            <Button variant="secondary" size="compact" data-testid="dedup-decline-request" disabled={locked} onClick={() => onAction(pair, 'decline')}>
                                {t('myAdopters.pending_dedup_action_decline') || 'Rechazar'}
                            </Button>
                            <Button variant="secondary" size="compact" data-testid="dedup-flip" disabled={locked} onClick={() => onAction(pair, 'flip')}>
                                {t('myAdopters.pending_d_action_flip') || 'Conservar el mío'}
                            </Button>
                            <Button variant="primary" size="compact" data-testid="dedup-accept-request" disabled={locked} onClick={() => onAction(pair, 'accept')}>
                                {busy ? (t('common.processing') || 'Procesando...') : (t('myAdopters.pending_dedup_action_accept') || 'Aceptar')}
                            </Button>
                        </>}
                        {group === 'sent' && <>
                            {write}
                            <Button variant="secondary" size="compact" data-testid="dedup-cancel-request" disabled={locked} onClick={() => onAction(pair, 'cancel')}>
                                {t('myAdopters.pending_dedup_action_cancel_request') || 'Cancelar pedido'}
                            </Button>
                        </>}
                        {group === 'declined' && <>
                            <Button variant="secondary" size="compact" data-testid="dedup-hide" disabled={locked} onClick={() => onAction(pair, 'hide')}>
                                {t('myAdopters.pending_d_action_hide') || 'Quitar de la lista'}
                            </Button>
                            {write}
                            {theirs && (
                                <Button variant="primary" size="compact" data-testid="dedup-merge" disabled={locked} onClick={() => onAction(pair, 'combine_theirs', theirs)}>
                                    {busy ? (t('common.processing') || 'Procesando...')
                                        : pair.actionByKeep[theirs] === 'dispute'
                                            ? (t('myAdopters.pending_d_action_dispute') || 'Pedir revisión a un administrador')
                                            : fill(t('myAdopters.pending_d_action_combine_theirs') || 'Combinar conservando el de {name}', { name: theirsName })}
                                </Button>
                            )}
                            {r?.direction === 'received' && (
                                <Button variant="primary" size="compact" data-testid="dedup-accept-request" disabled={locked} onClick={() => onAction(pair, 'accept')}>
                                    {busy ? (t('common.processing') || 'Procesando...') : (t('myAdopters.pending_d_action_accept_now') || 'Aceptar ahora')}
                                </Button>
                            )}
                        </>}
                        {group === 'pair' && <>
                            {/* Dismiss writes to duplicate_candidates; a hand-flagged pair has no row there. */}
                            {pair.source === 'detected' && (
                                <Button variant="secondary" size="compact" data-testid="dedup-keep-separate" disabled={locked} onClick={() => onAction(pair, 'keep_separate')}>
                                    {t('myAdopters.pending_dedup_action_keep') || 'Mantener separados'}
                                </Button>
                            )}
                            {mainAction && (
                                <Button variant="primary" size="compact" data-testid="dedup-merge" disabled={locked} onClick={() => onAction(pair, 'combine', keep)}>
                                    {busy ? (t('common.processing') || 'Procesando...')
                                        : mainAction === 'request'
                                            ? (t('myAdopters.pending_dedup_action_request') || 'Pedir combinar')
                                            : mainAction === 'dispute'
                                                ? (t('myAdopters.pending_d_action_dispute') || 'Pedir revisión a un administrador')
                                                : (t('myAdopters.pending_dedup_action_merge') || 'Combinar perfiles')}
                                </Button>
                            )}
                        </>}
                    </div>
                </div>
            )}
        </div>
    );
}
