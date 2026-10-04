/**
 * Grammatical gender of an animal, for copy that agrees with it
 * («¡Nina publicada!», «Quiero adoptarla»).
 *
 * The app's form stores `hembra` / `macho`; imports may carry `female` / `male`.
 * Anything else — including unknown/empty — is NOT female, so callers fall
 * back to the existing (masculine/neutral) wording.
 *
 * The contract-app keeps its own copy (`isFemale` in contract-app/src/lib/
 * animalLabels.ts) because it is a separate Vite build that cannot import src/.
 */
export function isFemaleAnimal(sex: string | null | undefined): boolean {
    const v = (sex ?? '').trim().toLowerCase();
    return v === 'hembra' || v === 'female';
}
