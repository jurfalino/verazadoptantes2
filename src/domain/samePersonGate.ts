/**
 * «¿Es la misma persona?» must be answered before an animal is given (Jon
 * 2026-11-12). While a form is evaluated, «Enviar contrato» / «Reenviar
 * contrato» / «Proponer un animal» wait until every possible duplicate of the
 * profile the form created has an answer. «Sí» and «No» settle the pair (it
 * leaves the list); «No sé» counts as an answer: the profiles stay separate
 * and the other profile's owner is asked.
 *
 * ONE rule for the panel and the server, so the server never refuses over a
 * pair the rescuer can't see or answer:
 *   - only on a profile the form created (on an existing profile the cards
 *     are a read-only compare);
 *   - only a pair the viewer may answer (their team loaded a side, not hidden);
 *   - not once someone answered «No sé».
 * The caller passes only pending pairs. «No avanzar» never waits: nobody gets
 * an animal. Pure; no `@/` imports.
 */
export interface GatePair {
    /** The viewer may answer it here (loadOpenPairs' onViewerList). */
    viewerMayAnswer: boolean;
    /** Who answered «No sé», if anyone. */
    unsureBy: string | null;
}

export function pairBlocksGiving(pair: GatePair, formCreatedProfile: boolean): boolean {
    return formCreatedProfile && pair.viewerMayAnswer && !pair.unsureBy;
}

export function blockingPairCount(pairs: readonly GatePair[], formCreatedProfile: boolean): number {
    return pairs.filter(p => pairBlocksGiving(p, formCreatedProfile)).length;
}
