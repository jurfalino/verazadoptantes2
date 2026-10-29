'use client';

/**
 * «Pendientes de revisar» on /my-adopters (layout D, spec
 * docs/superpowers/specs/2026-10-25-pendientes-d-design.md D21–D35, D40, D43):
 * one card of inbox rows, grouped Necesitan tu respuesta → Enviados →
 * Rechazados → Posibles duplicados. The first row that needs the viewer's
 * answer opens on load; the section opens itself on #pendientes or when such a
 * row exists.
 *
 * After a rejection nobody merges one-sidedly (D49): keeping the other's
 * profile asks the admins («Pedir revisión a un administrador»). A pair
 * combined here stays, until the page reloads, as «✓ Combinados — se conservó
 * …» with «Ver perfil» (D52, pendientes/MergedRow).
 *
 * This file loads the feed and runs the actions; the row (pendientes/PairRow)
 * and the dialogs (ConfirmCombine, IdentityChoice, WriteMessage) only render.
 * Every choice offered comes from the feed, and the server re-decides each
 * click (pairChoices, decideMergeRequestAnswer).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { formatRelativeTime } from '@/lib/dates';
import { pairKey } from '@/domain/dedupPair';
import { HOUSEHOLD_NOT_CONVERTED } from '@/domain/households';
import { householdErrorCopy } from '@/lib/householdCopy';
import { resolveMergeRequest, cancelMergeRequest } from '@/app/actions/mergeRequests';
import { sendPairMessage } from '@/app/actions/pairMessages';
import {
    getPendingDuplicatesForUser,
    dismissDuplicateCandidate,
    hidePendingPair,
    mergePendingDedupPair,
    type PendingDedupPair,
    type PendingDedupSide,
} from '@/app/actions/duplicates';
import RequestPiiAccessModal from '@/components/RequestPiiAccessModal';
import PairRow, { GROUP_ORDER, groupLabel, type RowAction } from '@/components/pendientes/PairRow';
import ConfirmCombine, { type ConfirmMode } from '@/components/pendientes/ConfirmCombine';
import IdentityChoice from '@/components/pendientes/IdentityChoice';
import WriteMessage from '@/components/pendientes/WriteMessage';
import MergedRow, { keptSentence, mergedInfo, type MergedInfo } from '@/components/pendientes/MergedRow';
import { pendientesSections } from '@/components/pendientes/sections';
import { fill, movesToOtherList, otherSide, ownerName, sideById, sideOf, T_MUTED, type KeepSide } from '@/components/pendientes/ui';

/** The section's anchor: request notifications link to /my-adopters#pendientes. */
const SECTION_ID = 'pendientes';
const PAGE_SIZE = 10;
/** Room above a focused pair: the sticky nav (64px) plus a gap. */
const FOCUS_ROW_OFFSET = 80;

type Identity = 'same' | 'household';

/** What a confirmation will run once accepted. */
type Pending =
    | { kind: 'combine'; pair: PendingDedupPair; keep: KeepSide; identity?: Identity }
    | { kind: 'accept'; pair: PendingDedupPair }
    | { kind: 'flip'; pair: PendingDedupPair };

/** Refusals that mean the row on screen is stale: say why, then reload. */
const STALE_REFUSALS: Record<string, { key: string; fallback: string }> = {
    declined_before: { key: 'myAdopters.pending_d_err_declined_before', fallback: 'Ya te rechazaron este pedido. Podés escribirle o combinar conservando su perfil.' },
    request_pending: { key: 'myAdopters.pending_d_err_request_pending', fallback: 'Ya hay un pedido abierto sobre estos perfiles. Actualizamos la lista.' },
    keep_not_allowed: { key: 'myAdopters.pending_d_err_keep_not_allowed', fallback: 'Ese perfil ya no se puede conservar. Actualizamos la lista.' },
    identity_not_applicable: { key: 'myAdopters.pending_d_err_identity_not_applicable', fallback: 'Estos perfiles cambiaron. Actualizamos la lista.' },
};

export default function PendingDedup() {
    const { t, locale } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const { data: session } = useSession();
    // «View as» reports isAdmin false, so the row gauge hides there too (D22).
    const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
    const [pairs, setPairs] = useState<PendingDedupPair[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    // Collapsed by default: production carries hundreds of pending pairs, and a
    // wall of them above the actual adopter list buries the page. It opens
    // itself once, after the first load (never at render — the server HTML is
    // closed), when the link says #pendientes or someone is waiting on the
    // viewer's answer to a merge request.
    const [open, setOpen] = useState(false);
    const autoOpened = useRef(false);
    const scrollToSection = useRef(false);
    const sectionRef = useRef<HTMLElement | null>(null);
    /** One row open at a time (D21). */
    const [openId, setOpenId] = useState<string | null>(null);
    /** «¿Cuál se conserva?» per row; absent = the feed's defaultKeep. */
    const [keepChoice, setKeepChoice] = useState<Record<string, KeepSide>>({});
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
    const [accessTarget, setAccessTarget] = useState<PendingDedupSide | null>(null);
    const [confirm, setConfirm] = useState<Pending | null>(null);
    const [identityAsk, setIdentityAsk] = useState<{ pair: PendingDedupPair; keep: KeepSide } | null>(null);
    const [writeTo, setWriteTo] = useState<PendingDedupPair | null>(null);
    /**
     * D52: pairs combined on this page, shown as «✓ Combinados — se conservó …»
     * until the page reloads. Their own state, so a list reload after another
     * row's action keeps them.
     */
    const [merged, setMerged] = useState<MergedInfo[]>([]);
    /** The pair a profile's «Revisar» linked to (?pair=): opened, scrolled to and outlined. */
    const [focusId, setFocusId] = useState<string | null>(null);
    /** The page the focused pair's load already fetched, so moving to it doesn't load it twice. */
    const loadedByFocus = useRef<number | null>(null);

    const load = useCallback(async () => {
        if (loadedByFocus.current === page) { loadedByFocus.current = null; return; }
        try {
            const focusPair = !autoOpened.current ? new URLSearchParams(window.location.search).get('pair') ?? undefined : undefined;
            const data = await getPendingDuplicatesForUser(page, PAGE_SIZE, false, focusPair);
            if (data.page && data.page !== page) { loadedByFocus.current = data.page; setPage(data.page); }
            setPairs(data.pairs);
            setTotal(data.total);
            // A reload after an action keeps the row the viewer is working on
            // open while it's still listed (a request just filed moves it to «Enviados»).
            setOpenId(id => (id && data.pairs.some(p => p.candidateId === id) ? id : null));
            // Decided here, batched with the pairs, so the section never
            // renders closed first; and only once, so a reload after an
            // action never reopens a section the user closed.
            if (!autoOpened.current) {
                autoOpened.current = true;
                const linked = window.location.hash === `#${SECTION_ID}`;
                // The group, not request.direction: a declined row seen by the
                // decliner also reads direction 'received'.
                const firstReceived = data.pairs.find(p => p.group === 'received');
                const focused = data.focusCandidateId;
                if (focused) setFocusId(focused);
                if (focused ?? firstReceived) setOpenId((focused ?? firstReceived!.candidateId));
                if (linked || focused || firstReceived) {
                    setOpen(true);
                    scrollToSection.current = linked || !!focused;
                }
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', t('errors.load_duplicates_failed') || undefined, resolveErrorId(e, 'PendingDedup'));
            setPairs([]);
            setTotal(0);
        }
    }, [t, toast, page]);

    useEffect(() => { load(); }, [load]);

    // The section renders only once loaded, so the browser's own #pendientes
    // scroll has nothing to land on: scroll once it is there and open.
    useEffect(() => {
        if (!open || !scrollToSection.current || !sectionRef.current) return;
        scrollToSection.current = false;
        const row = focusId ? sectionRef.current.querySelector(`[data-candidate-id="${CSS.escape(focusId)}"]`) : null;
        // The focused pair: its top just below the sticky nav (h-16) — scrollIntoView left it under the nav.
        if (row) window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - FOCUS_ROW_OFFSET });
        else sectionRef.current.scrollIntoView({ block: 'start' });
    }, [open, pairs, focusId]);

    // A #pendientes link followed while already on the page.
    useEffect(() => {
        const onHash = () => {
            if (window.location.hash !== `#${SECTION_ID}`) return;
            scrollToSection.current = true;
            setOpen(true);
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const keepOf = (pair: PendingDedupPair): KeepSide => {
        const chosen = keepChoice[pair.candidateId];
        return chosen && pair.keepOptions[chosen] ? chosen : pair.defaultKeep;
    };

    const dropRow = (pair: PendingDedupPair) => {
        setPairs(prev => prev?.filter(p => p.candidateId !== pair.candidateId) || []);
        setTotal(n => Math.max(0, n - 1));
    };

    /** D52: the row turns into its confirmation, and the toast offers the kept profile. */
    const markMerged = (pair: PendingDedupPair, kept: KeepSide, title: string) => {
        const info = mergedInfo(pair, sideOf(pair, kept), t);
        setMerged(prev => [...prev.filter(m => m.candidateId !== pair.candidateId), info]);
        setTotal(n => Math.max(0, n - 1));
        setOpenId(id => (id === pair.candidateId ? null : id));
        toast.success(title, keptSentence(info, t), { label: t('adopter.dup_action_view') || 'Ver perfil', href: `/adopter/${encodeURIComponent(info.keptId)}` });
    };

    /** One action on a row, with the row marked busy; a thrown call gets the shared toast. */
    const run = async (pair: PendingDedupPair, failKey: string, failFallback: string, fn: () => Promise<void>) => {
        if (busyCandidateId) return;
        setBusyCandidateId(pair.candidateId);
        try {
            await fn();
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', t(failKey) || failFallback, resolveErrorId(e, 'PendingDedup'));
        } finally {
            setBusyCandidateId(null);
        }
    };

    const merge = (pair: PendingDedupPair, keep: KeepSide, identity?: Identity) => run(pair, 'errors.merge_failed', 'No se pudieron combinar los perfiles.', async () => {
        // Always the chosen survivor's id: the server re-decides with it
        // (pairChoices) and never falls back to rules the row didn't show.
        const result = await mergePendingDedupPair(pair.candidateId, { keepId: sideOf(pair, keep).id, ...(identity ? { identity } : {}) });
        setConfirm(null);
        setIdentityAsk(null);
        if (result.success && result.outcome === 'merged') {
            markMerged(pair, keep, t('myAdopters.pending_dedup_merged') || 'Perfiles combinados');
        } else if (result.success && result.outcome === 'disputed') {
            // D49: after a rejection (or an admin's ruling) nothing merges here;
            // the admins decide. The reload shows the row under «Enviados».
            toast.success(t('myAdopters.pending_d_disputed') || 'Se lo pasamos a un administrador para que decida');
            await load();
        } else if (result.success && result.outcome === 'household') {
            toast.success(t('myAdopters.pending_d_household_done') || 'Quedaron separados: lo agregamos a su hogar');
            dropRow(pair);
        } else if (result.success) {
            // It went to the other profile's owner (or the admins) as a request:
            // the reload shows the row under «Enviados».
            toast.success(result.outcome === 'requested' && !result.toAdmins && result.toName
                ? fill(t('myAdopters.pending_dedup_request_sent_to') || 'Pedido enviado a {name}', { name: result.toName })
                : (t('myAdopters.pending_dedup_request_sent_admins') || 'Pedido enviado a un administrador'));
            await load();
        } else if (result.error === 'identity_required') {
            // The row didn't know to ask (a rescan changed the match): ask now.
            setIdentityAsk({ pair, keep });
        } else if (result.error === 'household_refused') {
            // «alguien de su hogar» refused by the household rules (full, too many homes…): say why; the row stays.
            toast.warning(householdErrorCopy(t, result.reason).message, result.errorId ? `ID: ${result.errorId}` : undefined);
        } else if (result.error === HOUSEHOLD_NOT_CONVERTED) {
            // Retryable: some old household data of the two isn't in the new shape yet. The row stays.
            toast.error(t('errors.generic') || 'Error', t('errors.merge_household_not_converted'),
                result.errorId ?? resolveErrorId(new Error(`mergePendingDedupPair: ${result.error}`), 'PendingDedup'));
        } else if (STALE_REFUSALS[result.error]) {
            const { key, fallback } = STALE_REFUSALS[result.error];
            toast.error(t('errors.generic') || 'Error', t(key) || fallback,
                result.errorId ?? resolveErrorId(new Error(`mergePendingDedupPair: ${result.error}`), 'PendingDedup'));
            await load();
        } else {
            toast.error(t('errors.generic') || 'Error', t('errors.merge_failed') || 'No se pudieron combinar los perfiles.',
                result.errorId ?? resolveErrorId(new Error(`mergePendingDedupPair: ${result.error}`), 'PendingDedup'));
        }
    });

    /** Accept / decline / flip / cancel a request. Success or not, reload: the row may be stale. */
    const answer = (pair: PendingDedupPair, call: () => Promise<{ success: boolean; error?: string; errorId?: string }>, okKey: string, okFallback: string) =>
        run(pair, 'myAdopters.pending_dedup_request_failed', 'No se pudo completar la acción.', async () => {
            const result = await call();
            setConfirm(null);
            if (result.success) {
                toast.success(t(okKey) || okFallback);
            } else {
                toast.error(t('errors.generic') || 'Error', t('myAdopters.pending_dedup_request_failed') || 'No se pudo completar la acción.',
                    result.errorId ?? resolveErrorId(new Error(`mergeRequest: ${result.error}`), 'PendingDedup'));
            }
            await load();
        });

    /**
     * Accept (the requester's survivor) or flip (the viewer's stays): both
     * merge, so a success turns the row into its confirmation (D52). A failure
     * reloads — the row may be stale.
     */
    const answerMerge = (pair: PendingDedupPair, decision: 'accept' | 'flip') =>
        run(pair, 'myAdopters.pending_dedup_request_failed', 'No se pudo completar la acción.', async () => {
            const r = pair.request;
            const requesterKeep = r ? sideById(pair, r.keepId) : null;
            if (!r || !requesterKeep) {
                // The row no longer carries the request it shows (or names a
                // survivor outside the pair): don't guess — log, say so, reload.
                setConfirm(null);
                void reportClientError({
                    level: 'warn', source: 'PendingDedup', message: `answerMerge: row without a usable request (${decision})`,
                    extra: { candidateId: pair.candidateId, requestId: r?.id ?? null, hasKeep: !!requesterKeep },
                });
                toast.success(t('common.updated') || 'Actualizado', t('myAdopters.pending_d_err_identity_not_applicable') || 'Estos perfiles cambiaron. Actualizamos la lista.');
                await load();
                return;
            }
            const result = await resolveMergeRequest(r.id, decision);
            setConfirm(null);
            if (result.success) {
                markMerged(pair, decision === 'accept' ? requesterKeep : otherSide(requesterKeep), decision === 'accept'
                    ? (t('myAdopters.pending_dedup_merged') || 'Perfiles combinados')
                    : (t('myAdopters.pending_d_flipped') || 'Perfiles combinados: se conservó el tuyo'));
                return;
            }
            toast.error(t('errors.generic') || 'Error', t('myAdopters.pending_dedup_request_failed') || 'No se pudo completar la acción.',
                result.errorId ?? resolveErrorId(new Error(`mergeRequest: ${result.error}`), 'PendingDedup'));
            await load();
        });

    /** After «¿Es la misma persona?» (or when it isn't asked): confirm if the adopter moves, then combine. */
    const afterIdentity = (pair: PendingDedupPair, keep: KeepSide, identity?: Identity) => {
        if (identity === 'household') return void merge(pair, keep, 'household'); // nothing moves (D35)
        setIdentityAsk(null);
        if (movesToOtherList(pair, keep)) setConfirm({ kind: 'combine', pair, keep, identity });
        else void merge(pair, keep, identity);
    };

    const startCombine = (pair: PendingDedupPair, keep: KeepSide) => {
        if (pair.identityChoice) setIdentityAsk({ pair, keep });
        else afterIdentity(pair, keep);
    };

    const keepSeparate = (pair: PendingDedupPair) => run(pair, 'errors.dedup_dismiss_failed', 'No se pudo descartar.', async () => {
        const result = await dismissDuplicateCandidate(pair.candidateId);
        if (result?.success) return dropRow(pair);
        // 'already_resolved' / 'not_found': something else settled the pair
        // after the page loaded — what the user wanted. Refresh instead of
        // leaving a row that looks like the click did nothing.
        const stale = result?.code === 'already_resolved' || result?.code === 'not_found';
        const message = result?.code === 'already_resolved' ? t('errors.dedup_already_resolved')
            : result?.code === 'not_found' ? t('errors.dedup_not_found')
                : result?.code === 'not_authorized' ? t('errors.dedup_not_authorized')
                    : t('errors.dedup_dismiss_failed');
        if (stale) {
            toast.success(t('common.updated') || 'Actualizado', message);
            await load();
        } else {
            toast.error(t('errors.generic') || 'Error', message, resolveErrorId(new Error(`dismissDuplicateCandidate: ${result?.code ?? 'failed'}`), 'PendingDedup'));
        }
    });

    const hide = (pair: PendingDedupPair) => run(pair, 'myAdopters.pending_dedup_request_failed', 'No se pudo completar la acción.', async () => {
        const result = await hidePendingPair(pairKey(pair.newAdopter.id, pair.existingAdopter.id));
        if (result.success) {
            toast.success(t('myAdopters.pending_d_hidden') || 'Quitado de tu lista');
            dropRow(pair);
        } else {
            toast.error(t('errors.generic') || 'Error', t('myAdopters.pending_dedup_request_failed') || 'No se pudo completar la acción.',
                result.errorId ?? resolveErrorId(new Error('hidePendingPair failed'), 'PendingDedup'));
        }
    });

    const send = (pair: PendingDedupPair, text: string) => run(pair, 'myAdopters.pending_d_write_failed', 'No se pudo enviar el mensaje.', async () => {
        const r = pair.request;
        if (!r) return;
        const result = await sendPairMessage(r.id, text);
        if (result.success) {
            setWriteTo(null);
            toast.success(fill(t('myAdopters.pending_d_write_sent') || 'Mensaje enviado a {name}', { name: r.counterpartName || (t('myAdopters.pending_dedup_a_user') || 'Un usuario') }));
        } else {
            // The box stays open with the text, so nothing typed is lost.
            toast.error(t('errors.generic') || 'Error', t('myAdopters.pending_d_write_failed') || 'No se pudo enviar el mensaje.',
                result.errorId ?? resolveErrorId(new Error(`sendPairMessage: ${result.error}`), 'PendingDedup'));
        }
    });

    const onAction = (pair: PendingDedupPair, action: RowAction, keep?: KeepSide) => {
        if (busyCandidateId) return;
        const r = pair.request;
        switch (action) {
            case 'combine':
            case 'combine_theirs':
                return startCombine(pair, keep ?? keepOf(pair));
            case 'keep_separate': return void keepSeparate(pair);
            case 'hide': return void hide(pair);
            case 'write': return setWriteTo(pair);
            // Accepting folds the viewer's adopter into the requester's list (D25); the flip shows who keeps what.
            case 'accept': return setConfirm({ kind: 'accept', pair });
            case 'flip': return setConfirm({ kind: 'flip', pair });
            case 'decline':
                if (r) void answer(pair, () => resolveMergeRequest(r.id, 'decline'), 'myAdopters.pending_dedup_request_declined', 'Pedido rechazado');
                return;
            case 'cancel':
                if (r) void answer(pair, () => cancelMergeRequest(r.id), 'myAdopters.pending_dedup_request_cancelled', 'Pedido cancelado');
                return;
        }
    };

    const runConfirmed = (c: Pending) => {
        if (c.kind === 'combine') return void merge(c.pair, c.keep, c.identity);
        // answerMerge reports and reloads a row whose request is gone.
        return void answerMerge(c.pair, c.kind);
    };

    const requestAge = (epochS: number): string => {
        if (!epochS) return '';
        const lang = locale === 'en' ? 'en' : 'es';
        return (locale !== 'pt' && formatRelativeTime(epochS * 1000, lang)) || formatShortDate(epochS * 1000);
    };

    /** Who keeps what in the confirmation: the row's survivor (combine) or the request's (accept / flip). */
    const confirmView = (c: Pending): { mode: ConfirmMode; entriesOnly: boolean; kept: PendingDedupSide; absorbed: PendingDedupSide; toName: string } | null => {
        if (c.kind === 'combine') {
            const kept = sideOf(c.pair, c.keep);
            return { mode: 'moves', entriesOnly: !isAdmin, kept, absorbed: sideOf(c.pair, otherSide(c.keep)), toName: ownerName(kept, t) };
        }
        const r = c.pair.request;
        const requesterKeep = r ? sideById(c.pair, r.keepId) : null;
        if (!r || !requesterKeep) return null;
        const keep = c.kind === 'accept' ? requesterKeep : otherSide(requesterKeep);
        return {
            mode: c.kind === 'accept' ? 'moves' : 'flip',
            entriesOnly: false,
            kept: sideOf(c.pair, keep),
            absorbed: sideOf(c.pair, otherSide(keep)),
            toName: r.counterpartName || (t('myAdopters.pending_dedup_a_user') || 'Un usuario'),
        };
    };

    if (pairs === null) return null; // not loaded yet
    // A pair just combined keeps the section on screen (D52), even the last one.
    if (total === 0 && merged.length === 0) return null;

    const confirmShown = confirm ? confirmView(confirm) : null;

    return (
        <section id={SECTION_ID} ref={sectionRef} className="mb-8 scroll-mt-20">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls="pending-dedup-list"
                className="w-full min-h-[44px] flex items-center gap-2 text-left group"
            >
                <svg className={`w-4 h-4 text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 5l6 5-6 5" />
                </svg>
                <h2 className="text-lg font-semibold text-stone-800 flex items-center gap-2 group-hover:text-stone-900">
                    {t('myAdopters.pending_dedup_title') || 'Pendientes de revisar'}
                    <span className="text-sm font-semibold px-2 py-0.5 rounded-full bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]">{total}</span>
                </h2>
            </button>
            <p className="text-sm text-stone-500 mt-1 mb-3 ml-6">
                {t('myAdopters.pending_dedup_subtitle') || 'Encontramos perfiles que podrían ser la misma persona. Decidí si combinarlos.'}
            </p>
            {open && (
                <>
                    {/* Rows are the list's direct <div> children; group headers are <h3>s between them. */}
                    <div id="pending-dedup-list" className="rounded-2xl bg-white border border-[var(--border-default)] shadow-sm overflow-hidden">
                        {pendientesSections(pairs, merged, GROUP_ORDER).flatMap(section => {
                            // Combined on this visit (D52): their own section at the end, never under
                            // «Necesitan tu respuesta» — nothing is left to answer (audit C7).
                            if (section.kind === 'merged') return [
                                <h3 key="h-merged" data-testid="dedup-merged-heading"
                                    className={`px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider border-t border-[var(--border-default)] first:border-t-0 ${T_MUTED}`}>
                                    {t('myAdopters.pending_d_group_merged')}
                                </h3>,
                                ...section.items.map(info => <MergedRow key={info.candidateId} info={info} t={t} />),
                            ];
                            const { group, pairs: list } = section;
                            return [
                                <h3 key={`h-${group}`}
                                    className={`px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider border-t border-[var(--border-default)] first:border-t-0 ${group === 'received' ? 'text-[var(--status-warning-text)]' : T_MUTED}`}>
                                    {groupLabel(group, t)} · {list.length}
                                </h3>,
                                ...list.map(pair => (
                                    <PairRow
                                        key={pair.candidateId}
                                        pair={pair}
                                        open={openId === pair.candidateId}
                                        highlight={focusId === pair.candidateId}
                                        onToggle={() => setOpenId(id => (id === pair.candidateId ? null : pair.candidateId))}
                                        keep={keepOf(pair)}
                                        onKeep={s => setKeepChoice(prev => ({ ...prev, [pair.candidateId]: s }))}
                                        busy={busyCandidateId === pair.candidateId}
                                        locked={!!busyCandidateId}
                                        isAdmin={isAdmin}
                                        t={t}
                                        formatShortDate={formatShortDate}
                                        age={requestAge}
                                        onAction={onAction}
                                        onRequestAccess={setAccessTarget}
                                    />
                                )),
                            ];
                        })}
                    </div>

                    {pageCount > 1 && (
                        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                            <button
                                type="button"
                                onClick={() => { setOpenId(null); setMerged([]); setPage(n => Math.max(1, n - 1)); }}
                                disabled={page <= 1 || !!busyCandidateId}
                                className="min-h-[44px] px-4 rounded-xl border border-[var(--text-faint)] text-[var(--text-primary)] font-semibold hover:bg-[var(--accent-subtle-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                ← {t('common.previous') || 'Anterior'}
                            </button>
                            <span className="text-stone-500 tabular-nums">
                                {page} / {pageCount}
                            </span>
                            <button
                                type="button"
                                onClick={() => { setOpenId(null); setMerged([]); setPage(n => Math.min(pageCount, n + 1)); }}
                                disabled={page >= pageCount || !!busyCandidateId}
                                className="min-h-[44px] px-4 rounded-xl border border-[var(--text-faint)] text-[var(--text-primary)] font-semibold hover:bg-[var(--accent-subtle-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {t('common.next') || 'Siguiente'} →
                            </button>
                        </div>
                    )}
                </>
            )}

            {identityAsk && (
                <IdentityChoice
                    nameA={identityAsk.pair.newAdopter.name}
                    nameB={identityAsk.pair.existingAdopter.name}
                    busy={busyCandidateId === identityAsk.pair.candidateId}
                    onSame={() => afterIdentity(identityAsk.pair, identityAsk.keep, 'same')}
                    onHousehold={() => afterIdentity(identityAsk.pair, identityAsk.keep, 'household')}
                    onCancel={() => setIdentityAsk(null)}
                    t={t}
                />
            )}
            {confirm && confirmShown && (
                <ConfirmCombine
                    {...confirmShown}
                    busy={busyCandidateId === confirm.pair.candidateId}
                    onConfirm={() => runConfirmed(confirm)}
                    onCancel={() => setConfirm(null)}
                    t={t}
                    formatShortDate={formatShortDate}
                />
            )}
            {writeTo?.request && (
                <WriteMessage
                    toName={writeTo.request.counterpartName || (t('myAdopters.pending_dedup_a_user') || 'Un usuario')}
                    aboutName={writeTo.existingAdopter.name}
                    busy={busyCandidateId === writeTo.candidateId}
                    onSend={text => send(writeTo, text)}
                    onCancel={() => setWriteTo(null)}
                    t={t}
                />
            )}

            {/* Reuses the existing owner-approval flow rather than a mailto: the
                owner gets a real request in PiiAccessRequestPanel and can grant
                it there. */}
            <RequestPiiAccessModal
                open={!!accessTarget}
                adopterId={accessTarget?.id || ''}
                adopterName={accessTarget?.name || ''}
                onClose={() => setAccessTarget(null)}
                onRequested={() => { setAccessTarget(null); load(); }}
            />
        </section>
    );
}
