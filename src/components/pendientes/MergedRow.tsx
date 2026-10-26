'use client';

/**
 * D52: after combining in «Pendientes de revisar» the row stays, until the
 * page is reloaded, as «✓ Combinados — se conservó {nombre} (de {dueño}) ·
 * Ver perfil ↗», so the rescuer sees where the adopter went instead of a row
 * that just vanished. Not a `dedup-row`: nothing on it can be acted on again.
 */

import Link from 'next/link';
import { Check, ExternalLink } from 'lucide-react';
import type { PendingDedupPair, PendingDedupSide } from '@/app/actions/duplicates';
import { fill, ownerName, T_MUTED, T_PRIMARY, type T } from './ui';

/** What the confirmation names: the profile that stayed, and whose it is. */
export interface MergedInfo {
    candidateId: string;
    /** The group the row sat in, so it stays under the same heading after a list reload. */
    group: PendingDedupPair['group'];
    keptId: string;
    keptName: string;
    /** The viewer's own profile stayed («el tuyo»). */
    keptIsMine: boolean;
    /** Who the kept profile belongs to, by name (never an email); unused when keptIsMine. */
    keptOwner: string;
}

export function mergedInfo(pair: PendingDedupPair, kept: PendingDedupSide, t: T): MergedInfo {
    return {
        candidateId: pair.candidateId,
        group: pair.group,
        keptId: kept.id,
        keptName: kept.name,
        keptIsMine: kept.isMine,
        keptOwner: ownerName(kept, t),
    };
}

/** «Se conservó {name} (de {owner})» / «… (el tuyo)» — the row's line and the toast's message. */
export function keptSentence(info: MergedInfo, t: T): string {
    const name = info.keptName || (t('adopter.nameless') || 'Sin nombre');
    return info.keptIsMine
        ? fill(t('myAdopters.pending_d_merged_kept_mine') || 'Se conservó {name} (el tuyo)', { name })
        : fill(t('myAdopters.pending_d_merged_kept') || 'Se conservó {name} (de {owner})', { name, owner: info.keptOwner });
}

export default function MergedRow({ info, t }: { info: MergedInfo; t: T }) {
    return (
        <div data-testid="dedup-merged-row" role="status"
            className="border-t border-[var(--border-default)] first:border-t-0 min-h-[64px] flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 pr-2 py-3">
            <span className="w-10 h-10 shrink-0 rounded-full border flex items-center justify-center bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]">
                <Check className="w-5 h-5" strokeWidth={3} aria-hidden="true" />
            </span>
            <span className={`flex-1 min-w-0 text-[14px] break-words ${T_PRIMARY}`}>
                <span className="font-bold text-[var(--status-success-text)]">{t('myAdopters.pending_d_merged_done') || 'Combinados'}</span>
                <span className={T_MUTED}> — </span>
                {keptSentence(info, t)}
            </span>
            {/* New tab, like the row's other «Ver perfil»: the list stays as it is. */}
            <Link href={`/adopter/${encodeURIComponent(info.keptId)}`} target="_blank" rel="noopener noreferrer" data-testid="dedup-merged-view"
                className="inline-flex items-center gap-1 min-h-[44px] px-2 text-[13px] font-semibold text-[var(--accent)] hover:underline underline-offset-2">
                {t('adopter.dup_action_view') || 'Ver perfil'}
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t('common.opens_new_tab') || '(abre en una pestaña nueva)'}</span>
            </Link>
        </div>
    );
}
