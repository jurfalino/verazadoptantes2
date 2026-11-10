import { matchTypeLabel } from '@/lib/matchTypeLabels';

type T = (key: string) => string;

/**
 * A pending pair's «Marcado manualmente · Coinciden: … · Distintos: …», as the
 * closed row in «Pendientes de revisar» says it — and the homepage's pending
 * rows (one wording, Nielsen #4). Pure, so the home card needn't load PairRow.
 */
export function summaryLine(pair: { summary: { same: readonly string[]; diff: readonly string[]; flagged: boolean } }, t: T): string {
    const field = (f: string) => (t(`matchCompare.field_${f}`) || f).toLocaleLowerCase();
    const parts: string[] = [];
    if (pair.summary.flagged) parts.push(matchTypeLabel('flagged_by_user', t) || 'Marcado manualmente');
    if (pair.summary.same.length) parts.push(`${t('matchCompare.count_same') || 'Coinciden'}: ${pair.summary.same.map(field).join(', ')}`);
    if (pair.summary.diff.length) parts.push(`${t('matchCompare.count_diff') || 'Distintos'}: ${pair.summary.diff.map(field).join(', ')}`);
    return parts.join(' · ');
}
