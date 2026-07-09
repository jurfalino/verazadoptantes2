/**
 * Placement transitions — pure domain logic.
 *
 * When an animal moves between homes, the prior foster/adoption placement ENDS.
 * `deriveEndedPlacement` decides, given the prior placement and the incoming
 * update, whether a foster/adoption placement is ending and returns the
 * placement record to close out (with its `endedAt`), or null.
 *
 * No DB or server imports here. Reused by the `animals`/`placements`
 * normalization: the transition write layer persists the returned entry as an
 * ended row in the `placements` table (endedAt set). See
 * .agents/plans/animals-placements-normalization.md.
 */

/** Physical-custody record types that constitute a "placement" worth preserving. */
export const PLACEMENT_RECORD_TYPES = ['foster', 'adoption'] as const;

export interface PlacementRowLike {
    id: string;
    adopterId: string | null;
    recordType: string | null;
    animalName: string | null;
    species: string | null;
    date: Date | number | null;
}

export interface EndedPlacement {
    animalRowId: string;
    adopterId: string;
    recordType: string;
    animalName: string | null;
    species: string | null;
    startedAt: Date | number | null;
    endedAt: Date;
    recordedBy: string;
}

function isPlacementType(t: string | null): boolean {
    return !!t && (PLACEMENT_RECORD_TYPES as readonly string[]).includes(t);
}

/**
 * Return the ledger entry to append when `existing` (the prior live row) was a
 * foster/adoption placement that is now ending because the incoming update moves
 * the animal to a different holder or placement type. Returns null when the prior
 * row wasn't a placement, or when nothing custody-relevant changed (e.g. a rating
 * or address edit) — so unrelated edits never write a ledger row.
 *
 * `next` fields may be undefined, meaning "unchanged" — they fall back to the
 * existing values (so an update that omits adopterId doesn't look like a move).
 */
export function deriveEndedPlacement(
    existing: PlacementRowLike,
    next: { adopterId?: string | null; recordType?: string | null },
    endedAt: Date,
    recordedBy: string,
): EndedPlacement | null {
    const priorAdopter = existing.adopterId;
    const priorType = existing.recordType;

    // The prior row must itself have been a live placement (held by someone).
    if (!priorAdopter || !isPlacementType(priorType)) return null;

    const nextAdopter = next.adopterId !== undefined ? next.adopterId : existing.adopterId;
    const nextType = next.recordType !== undefined ? next.recordType : existing.recordType;

    // Ends only if the holder or the placement type actually changes.
    if (nextAdopter === priorAdopter && nextType === priorType) return null;

    return {
        animalRowId: existing.id,
        adopterId: priorAdopter,
        recordType: priorType as string,
        animalName: existing.animalName ?? null,
        species: existing.species ?? null,
        startedAt: existing.date ?? null,
        endedAt,
        recordedBy,
    };
}
