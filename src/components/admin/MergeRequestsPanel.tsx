'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveMergeRequest } from '@/app/actions/mergeRequests';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale, userFacingMessage } from '@/lib/errorMessage';
import type { MergeRequestAdminRow } from '@/lib/mergeRequests';
import type { MergeDisputeAdminRow } from '@/lib/mergeDisputes';
import { pairKey } from '@/domain/dedupPair';
import MergeDisputesSection from './MergeDisputesSection';
import { AdminSideCard, BADGE, PRIMARY_BTN, SECONDARY_BTN, waited, type T } from './mergeAdminUi';

/**
 * Admin «Pedidos de combinación»: open disputes about merges that already
 * happened («Disputas», D50) first, then the merge requests — both profiles,
 * who asked, who owns the target, how long it has waited. Approving merges
 * (the requester's survivor); a declined request can still be approved
 * ("Aprobar igual"). One row per pair (oneRowPerPair): a dispute after a
 * rejection («Disputa», D49) shows both rescuers' positions. A resolved row
 * leaves the list with a toast.
 */
export default function MergeRequestsPanel({ requests, disputes }: { requests: MergeRequestAdminRow[]; disputes: MergeDisputeAdminRow[] }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const [items, setItems] = useState<MergeRequestAdminRow[]>(requests);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => { setNow(Date.now()); }, []);

    async function resolve(row: MergeRequestAdminRow, decision: 'accept' | 'decline') {
        const failed = t('admin.merge_req_failed') || 'No se pudo resolver el pedido. Volvé a intentar.';
        setBusyId(row.id);
        try {
            const res = await resolveMergeRequest(row.id, decision);
            if (res.success) {
                // A dispute row stands for its whole pair (oneRowPerPair): nothing of it stays.
                const key = pairKey(row.primary.id, row.secondary.id);
                setItems(prev => prev.filter(r => r.id !== row.id && !(row.dispute && pairKey(r.primary.id, r.secondary.id) === key)));
                toast.success('✓', decision === 'accept' ? (t('admin.merge_req_merged') || 'Perfiles combinados') : (t('admin.merge_req_declined') || 'Pedido rechazado'));
            } else {
                toast.error(t('errors.generic') || 'Error', failed, res.errorId ?? resolveErrorId(new Error(`resolveMergeRequest: ${res.error}`), 'MergeRequestsPanel'));
            }
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', userFacingMessage(e, failed), resolveErrorId(e, 'MergeRequestsPanel'));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div className="max-w-3xl">
            <h1 className="text-2xl font-bold text-stone-900 mb-1">{t('admin.nav_merge_requests') || 'Pedidos de combinación'}</h1>
            <p className="text-sm text-stone-500 mb-6">
                {t('admin.merge_req_subtitle') || 'Pedidos para unir dos perfiles de adoptantes. Los pendientes primero, del más antiguo al más nuevo.'}
            </p>

            <MergeDisputesSection disputes={disputes} />

            {items.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">
                    {t('admin.merge_req_empty') || 'No hay pedidos de combinación pendientes.'}
                </div>
            ) : (
                <ul className="space-y-3">
                    {items.map(r => (
                        <RequestRow key={r.id} row={r} busy={busyId === r.id} locked={!!busyId} now={now} t={t} formatShortDate={formatShortDate} onResolve={resolve} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function RequestRow({ row: r, busy, locked, now, t, formatShortDate, onResolve }: {
    row: MergeRequestAdminRow;
    busy: boolean;
    locked: boolean;
    now: number | null;
    t: T;
    formatShortDate: (ms: number) => string;
    onResolve: (row: MergeRequestAdminRow, decision: 'accept' | 'decline') => void;
}) {
    const declined = r.status === 'declined';
    const badge = r.dispute
        ? { cls: 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]', label: t('admin.merge_req_status_dispute') || 'Disputa' }
        : declined
            ? { cls: 'bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-[var(--status-error-text)]', label: t('admin.merge_req_status_declined') || 'Rechazado' }
            : { cls: 'bg-[var(--surface-muted)] border-[var(--border-default)] text-[var(--text-muted)]', label: t('admin.merge_req_status_pending') || 'Pendiente' };
    const age = waited(r.createdAt, now, t);
    return (
        <li data-testid="merge-request-row" data-dispute={r.dispute ? '1' : undefined} className="rounded-xl border border-stone-200 bg-white p-4 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
                <span data-testid="merge-request-badge" className={`ml-auto order-last ${BADGE} ${badge.cls}`}>{badge.label}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                <AdminSideCard testId="merge-request-keep" side={r.primary} label={t('admin.merge_req_keep') || 'se conserva'} kept t={t} formatShortDate={formatShortDate} />
                <AdminSideCard testId="merge-request-absorb" side={r.secondary} label={t('admin.merge_req_absorb') || 'se absorbe'} kept={false} t={t} formatShortDate={formatShortDate} />
            </div>
            {/* A dispute (D49) carries both positions: who wants them combined, and who said they are not the same person. */}
            <div className="text-stone-600 break-all">
                <span className="font-medium">{r.dispute ? (t('admin.merge_req_review_by') || 'Pide revisión (quiere combinarlos)') : (t('admin.merge_req_requested_by') || 'Pidió')}: </span>{r.requesterEmail}
            </div>
            {r.createdAt != null && (
                <div className="text-xs text-stone-500">
                    {(t('admin.merge_req_requested_on') || 'Pedido el {date}').replace('{date}', formatShortDate(r.createdAt))}
                    {age && <> · {age}</>}
                </div>
            )}
            {r.dispute && r.rejected && (
                <div data-testid="merge-request-rejected" className="text-stone-600 break-all">
                    <span className="font-medium">{t('admin.merge_req_rejected_by') || 'Rechazó (no es la misma persona)'}: </span>
                    {r.rejected.byEmail ?? (t('admin.merge_dispute_unknown') || 'desconocido')}
                    {r.rejected.at != null && (
                        <span className="text-xs text-stone-500"> · {(t('admin.merge_req_rejected_on') || 'Rechazado el {date}').replace('{date}', formatShortDate(r.rejected.at))}</span>
                    )}
                </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" data-testid="merge-request-approve" onClick={() => onResolve(r, 'accept')} disabled={locked} className={PRIMARY_BTN}>
                    {busy ? (t('common.processing') || 'Procesando...') : declined ? (t('admin.merge_req_approve_anyway') || 'Aprobar igual') : (t('admin.merge_req_approve') || 'Aprobar')}
                </button>
                {!declined && (
                    <button type="button" data-testid="merge-request-decline" onClick={() => onResolve(r, 'decline')} disabled={locked} className={SECONDARY_BTN}>
                        {t('admin.merge_req_decline') || 'Rechazar'}
                    </button>
                )}
            </div>
        </li>
    );
}
