/**
 * What happens to an animal when one of its records is deleted.
 *
 * Deleting an "adoption" used to destroy the animal outright: the `adoptions`
 * compat view UNIONs animal-backed rows (id = animals.id) with event-backed
 * rows (id = adopter_events.id), and the delete fired at every table on that
 * one id. So removing a duplicate adoption from an adopter profile hard-deleted
 * the animal, its images and — because the placement delete carried no adopter
 * filter — every other rescuer's custody span for it too. That is how two cats
 * disappeared from production on 2026-09-07.
 *
 * The rule now: deleting a record removes THAT record. The animal only goes if
 * nothing else refers to it, and then only as a soft delete.
 */

/** Everything that can still refer to an animal. Each is a COUNT(*). */
export interface AnimalLinks {
    /** Other custody spans — another adopter, or an earlier ended span here. */
    otherPlacements: number;
    /** follow_up / returned_pet rows carrying this animal_id. */
    adopterEvents: number;
    /** The animal's own care log: vaccination, deworming, vet visit, neuter, note. */
    animalEvents: number;
    /** form_submissions + contract_invitations pointing at this animal. */
    formsAndContracts: number;
}

export const NO_LINKS: AnimalLinks = {
    otherPlacements: 0,
    adopterEvents: 0,
    animalEvents: 0,
    formsAndContracts: 0,
};

export type AnimalFate = 'keep' | 'soft-delete';

/**
 * Whether anything still refers to the animal once this record is gone.
 *
 * Non-positive and non-finite counts read as "no link from this category", but
 * see `decideAnimalFate` — a malformed count is never allowed to *cause* a
 * deletion.
 */
export function hasRemainingLinks(links: AnimalLinks): boolean {
    return (Object.values(links) as number[]).some(n => Number.isFinite(n) && n > 0);
}

/**
 * Decide the animal's fate. Pure: the server action counts, this decides.
 *
 * Fails safe. A count that is negative or NaN means the query misbehaved, and
 * an unreliable answer must never be the reason an animal is deleted — so any
 * malformed input resolves to 'keep'.
 */
export function decideAnimalFate(input: { links: AnimalLinks; keepAnimal?: boolean }): AnimalFate {
    const values = Object.values(input.links) as number[];
    const malformed = values.some(n => !Number.isFinite(n) || n < 0);
    if (malformed) return 'keep';

    if (hasRemainingLinks(input.links)) return 'keep';
    if (input.keepAnimal) return 'keep';
    return 'soft-delete';
}
