import { aliasForMerge, matchedOnName } from './importInput';

/**
 * «¿Es la misma persona?» (D35, B6): a pair that matched on a contact (phone,
 * email, address) but NOT on the name, with names that differ, may be two
 * people of one household — so combining asks first. The same test the post
 * import uses before merging into a match (Jon, 2026-10-22).
 */
export function needsIdentityChoice(input: { matchTypes: string[]; nameA: string; nameB: string }): boolean {
    return !matchedOnName(input.matchTypes) && !!aliasForMerge(input.nameA, input.nameB);
}
