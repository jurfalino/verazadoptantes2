/**
 * Which signed_contracts row is the one behind a placement's contract (H1).
 * Since H1 the row names its placement (`placementId`); older rows only carry
 * the stored file (`fileKey`, the same key as placements.contract_key). The
 * newest matching signature wins. Pure: the loaders read the rows.
 */
export interface SignedContractRow {
    id: string;
    animalId: string;
    placementId: string | null;
    fileKey: string | null;
    signedAt: number | null;
}

export interface PlacementContractRef {
    id: string;
    animalId: string;
    /** placements.contract_key — NULL means no stored contract, so no result either. */
    contractKey: string | null;
}

export function matchSignedContract(placement: PlacementContractRef, rows: readonly SignedContractRow[]): string | null {
    if (!placement.contractKey) return null;
    let best: SignedContractRow | null = null;
    for (const r of rows) {
        if (r.animalId !== placement.animalId) continue;
        const same = r.placementId ? r.placementId === placement.id : r.fileKey === placement.contractKey;
        if (!same) continue;
        if (!best || (r.signedAt ?? 0) > (best.signedAt ?? 0)) best = r;
    }
    return best?.id ?? null;
}
