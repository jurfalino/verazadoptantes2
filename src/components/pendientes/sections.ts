/**
 * «Pendientes de revisar» in sections, in order: each group's pairs still to
 * decide, then — in a section of their own, «Recién combinados» — the pairs
 * combined on this visit (D52's «✓ Combinados» rows). A combined pair used to
 * stay in its group, so «✓ Combinados» sat under «Necesitan tu respuesta»
 * (audit 2026-10-28, C7): it needs nothing more from anyone.
 */
export type SectionGroup = 'received' | 'sent' | 'declined' | 'pair';

export type PendientesSection<P, M> =
    | { kind: 'group'; group: SectionGroup; pairs: P[] }
    | { kind: 'merged'; items: M[] };

export function pendientesSections<P extends { candidateId: string; group: SectionGroup }, M extends { candidateId: string }>(
    pairs: ReadonlyArray<P>,
    merged: ReadonlyArray<M>,
    order: ReadonlyArray<SectionGroup>,
): Array<PendientesSection<P, M>> {
    const done = new Set(merged.map(m => m.candidateId));
    const out: Array<PendientesSection<P, M>> = [];
    for (const group of order) {
        const live = pairs.filter(p => p.group === group && !done.has(p.candidateId));
        if (live.length) out.push({ kind: 'group', group, pairs: live });
    }
    if (merged.length) out.push({ kind: 'merged', items: [...merged] });
    return out;
}
