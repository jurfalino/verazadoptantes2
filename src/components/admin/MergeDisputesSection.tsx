'use client';

/**
 * «Combinaciones cuestionadas» (D50; «Disputas» before audit A4): merges a rescuer says are not the same person
 * (listMergeDisputesForAdmin). For each: the profile that stayed and the one
 * absorbed (owner, date), who merged them and when, who disputed it and when.
 * «Deshacer combinación» runs the shared undo (resolveMergeDispute →
 * unmergeAdopters by the merge's audit id) and keeps the pair separate;
 * «Mantener» leaves the merge. Both rescuers hear the outcome. Each row shows
 * «Qué coincide y qué no» — the survivor as it was before the merge — and
 * each decision is confirmed first (audit A4). A resolved dispute leaves the
 * list with a toast.
 */

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveMergeDispute } from '@/app/actions/mergeDisputes';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale, userFacingMessage } from '@/lib/errorMessage';
import type { MergeDisputeAdminRow } from '@/lib/mergeDisputes';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { BreakableEmail } from '@/components/ui/BreakableEmail';
import { fill } from '@/lib/householdCopy';
import { AdminPairCompare, BADGE, PRIMARY_BTN, SECONDARY_BTN, type T } from './mergeAdminUi';

export default function MergeDisputesSection({ disputes }: { disputes: MergeDisputeAdminRow[] }) {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const [items, setItems] = useState<MergeDisputeAdminRow[]>(disputes);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<{ row: MergeDisputeAdminRow; decision: 'undo' | 'keep' } | null>(null);

    async function resolve(row: MergeDisputeAdminRow, decision: 'undo' | 'keep') {
        const failed = t('admin.merge_dispute_failed') || 'No se pudo resolver la disputa. Volvé a intentar.';
        setBusyId(row.id);
        try {
            const res = await resolveMergeDispute(row.id, decision);
            if (res.success) {
                setItems(prev => prev.filter(d => d.id !== row.id));
                toast.success('✓', res.status === 'closed'
                    // Moot: the merge was undone elsewhere or its survivor merged away since.
                    ? (t('admin.merge_dispute_closed') || 'Esa combinación ya se había deshecho o cambió: cerramos la disputa')
                    : res.status === 'undone'
                        ? (t('admin.merge_dispute_undone') || 'Combinación deshecha: vuelven a ser dos perfiles')
                        : (t('admin.merge_dispute_kept') || 'Se mantuvo la combinación'));
            } else if (res.error === 'not_open') {
                // Another admin answered first: nothing left to do here.
                setItems(prev => prev.filter(d => d.id !== row.id));
                toast.success(t('common.updated') || 'Actualizado', t('admin.merge_dispute_not_open') || 'Otro administrador ya la resolvió.');
            } else {
                toast.error(t('errors.generic') || 'Error', failed, res.errorId ?? resolveErrorId(new Error(`resolveMergeDispute: ${res.error}`), 'MergeDisputesSection'));
            }
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic') || 'Error', userFacingMessage(e, failed), resolveErrorId(e, 'MergeDisputesSection'));
        } finally {
            setBusyId(null);
            setConfirming(null);
        }
    }

    if (items.length === 0) return null;
    const c = confirming;

    return (
        <section data-testid="merge-disputes" className="mb-8">
            <h2 className="text-lg font-semibold text-stone-900 mb-1">
                {t('admin.merge_disputes_title')} <span className="text-stone-500 font-normal">· {items.length}</span>
            </h2>
            <p className="text-sm text-stone-500 mb-3">
                {t('admin.merge_disputes_subtitle') || 'Combinaciones que un rescatista dice que no son la misma persona.'}
            </p>
            <ul className="space-y-3">
                {items.map(d => (
                    <DisputeRow key={d.id} row={d} busy={busyId === d.id} locked={!!busyId} t={t} formatShortDate={formatShortDate} onResolve={(row, decision) => setConfirming({ row, decision })} />
                ))}
            </ul>
            <ConfirmDialog
                open={!!c}
                testId="merge-dispute-confirm"
                title={c?.decision === 'undo' ? t('admin.merge_confirm_undo_title') : t('admin.merge_confirm_keep_title')}
                message={c ? (c.decision === 'undo'
                    ? fill(t('admin.merge_confirm_undo_body'), { absorbed: c.row.absorbed.name })
                    : fill(t('admin.merge_confirm_keep_body'), { survivor: c.row.survivor.name })) : undefined}
                confirmLabel={c?.decision === 'undo' ? t('admin.merge_dispute_undo') : t('admin.merge_dispute_keep')}
                destructive={false}
                busy={!!busyId}
                onCancel={() => setConfirming(null)}
                onConfirm={() => { if (c) void resolve(c.row, c.decision); }}
            />
        </section>
    );
}

function DisputeRow({ row: d, busy, locked, t, formatShortDate, onResolve }: {
    row: MergeDisputeAdminRow;
    busy: boolean;
    locked: boolean;
    t: T;
    formatShortDate: (ms: number) => string;
    onResolve: (row: MergeDisputeAdminRow, decision: 'undo' | 'keep') => void;
}) {
    const unknown = t('admin.merge_dispute_unknown') || 'desconocido';
    const line = (label: string, who: string | null, at: number | null) => (
        <div className="min-w-0 text-stone-600">
            <span className="font-medium">{label}: </span>{who ? <BreakableEmail email={who} /> : unknown}
            {at != null && <span className="text-xs text-stone-500"> · {formatShortDate(at)}</span>}
        </div>
    );
    return (
        <li data-testid="merge-dispute-row" className="rounded-xl border border-[var(--status-warning-border)] bg-white p-4 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`ml-auto ${BADGE} bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]`}>
                    {t('admin.merge_dispute_badge')}
                </span>
            </div>
            {/* «Qué coincide y qué no» (audit A4): the survivor as it was before the merge, the absorbed profile as it is. */}
            <AdminPairCompare kept={d.survivor} absorbed={d.absorbed} matchTypes={d.matchTypes} testIdPrefix="merge-dispute"
                keptLabel={t('admin.merge_dispute_kept_side') || 'se conservó'} absorbedLabel={t('admin.merge_dispute_absorbed_side') || 'se absorbió'} t={t} formatShortDate={formatShortDate} />
            {line(t('admin.merge_dispute_merged_by') || 'Combinó', d.mergedBy, d.mergedAt)}
            {line(t('admin.merge_dispute_raised_by') || 'Disputó', d.raisedBy, d.createdAt)}
            <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" data-testid="merge-dispute-undo" onClick={() => onResolve(d, 'undo')} disabled={locked} className={PRIMARY_BTN}>
                    {busy ? (t('common.processing') || 'Procesando...') : (t('admin.merge_dispute_undo') || 'Deshacer combinación')}
                </button>
                <button type="button" data-testid="merge-dispute-keep" onClick={() => onResolve(d, 'keep')} disabled={locked} className={SECONDARY_BTN}>
                    {t('admin.merge_dispute_keep') || 'Mantener'}
                </button>
            </div>
        </li>
    );
}
