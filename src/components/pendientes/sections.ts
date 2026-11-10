/**
 * «Pendientes de revisar» in sections, in order: each group's pairs still to
 * decide, then — in a section of their own, «Recién combinados» — the pairs
 * combined on this visit (D52's «✓ Combinados» rows). A combined pair used to
 * stay in its group, so «✓ Combinados» sat under «Necesitan tu respuesta»
 * (audit 2026-10-28, C7): it needs nothing more from anyone.
 */
export type SectionGroup = 'received' | 'sent' | 'declined' | 'pair';
/**
 * A section: a group, split by whether the next move is the viewer's (UX review 2026-11-10) —
 * a declined request the viewer filed waits on them («Rechazados»); one they declined doesn't
 * ('declined_done', listed with what waits on others). A possible duplicate the server deferred
 * because its person is being evaluated (Q6: needsViewer false) is 'pair_done', in the same place.
 */
export type SectionKey = SectionGroup | 'declined_done' | 'pair_done';
/** What waits on the viewer first, then what waits on others (the server pages in this order). */
export const SECTION_ORDER: readonly SectionKey[] = ['received', 'declined', 'pair', 'pair_done', 'sent', 'declined_done'];
/** The sections that don't wait on the viewer: the first one shown opens «No necesitan nada tuyo». */
export const OTHERS_SECTIONS: ReadonlySet<SectionKey> = new Set<SectionKey>(['pair_done', 'sent', 'declined_done']);
export const sectionOf = (p: { group: SectionGroup; needsViewer?: boolean }): SectionKey =>
    p.needsViewer !== false ? p.group
        : p.group === 'declined' ? 'declined_done'
        : p.group === 'pair' ? 'pair_done'
        : p.group;

export type PendientesSection<P, M> =
    | { kind: 'group'; group: SectionKey; pairs: P[] }
    | { kind: 'merged'; items: M[] };

export function pendientesSections<P extends { candidateId: string; group: SectionGroup; needsViewer?: boolean }, M extends { candidateId: string }>(
    pairs: ReadonlyArray<P>,
    merged: ReadonlyArray<M>,
    order: ReadonlyArray<SectionKey> = SECTION_ORDER,
): Array<PendientesSection<P, M>> {
    const done = new Set(merged.map(m => m.candidateId));
    const out: Array<PendientesSection<P, M>> = [];
    for (const group of order) {
        const live = pairs.filter(p => sectionOf(p) === group && !done.has(p.candidateId));
        if (live.length) out.push({ kind: 'group', group, pairs: live });
    }
    if (merged.length) out.push({ kind: 'merged', items: [...merged] });
    return out;
}
