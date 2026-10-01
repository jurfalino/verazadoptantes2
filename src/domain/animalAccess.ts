/**
 * Pure decisions behind /my-animals/[id] when getAnimalProfile returns null,
 * plus the "publicly listed" rule shared with /api/showcase/animal/[id].
 * No DB, no server imports.
 */
import { RECORD_TYPES } from './constants';
import { normalizeSpecies } from './importRow';

export type AnimalAccessKind = 'allowed' | 'missing' | 'not_yours';

export function decideAnimalAccess(i: { exists: boolean; deleted: boolean; viewerCanSee: boolean }): AnimalAccessKind {
    if (!i.exists || i.deleted) return 'missing';
    return i.viewerCanSee ? 'allowed' : 'not_yours';
}

export type AnimalIllustration = 'cat' | 'dog' | 'bird' | 'tag';

export function illustrationForSpecies(species: string | null | undefined): AnimalIllustration {
    const s = normalizeSpecies(species ?? undefined)?.trim().toLowerCase();
    if (s === 'cat' || s === 'dog' || s === 'bird') return s;
    return 'tag';
}

/** Text engraved on the name-tag illustration: SVG text can't wrap, so cap it. */
export function tagLabel(name: string | null | undefined, max = 10): string {
    const n = (name ?? '').trim();
    const chars = [...n];
    return chars.length <= max ? n : chars.slice(0, max - 1).join('') + '…';
}

/** An animal has a public showcase page only while it is up for adoption with
 *  at least one photo. Single definition, also used by the showcase API. */
export function isPubliclyListed(
    row: { recordType: string | null; adopterId: string | null } | null | undefined,
    photoCount: number,
): boolean {
    return !!row && row.recordType === RECORD_TYPES.AVAILABLE && !row.adopterId && photoCount > 0;
}
