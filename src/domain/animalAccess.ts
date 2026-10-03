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
 *  at least one photo. Single definition, also used by the showcase API.
 *
 *  v2.56.127: a VIDEO does not count on its own. The catalog is a grid of
 *  stills, and a video-only animal would be listed as a blank tile — worse
 *  than not being listed, because the rescuer sees it published and assumes
 *  people can see the animal. Count a video only when it has a poster, which
 *  is the still the grid would actually draw. */
export function isPubliclyListed(
    row: { recordType: string | null; adopterId: string | null; listed?: number | null } | null | undefined,
    photoCount: number,
): boolean {
    if (!row || photoCount <= 0) return false;
    // v2.56.128: the rescuer's switch. NULL is listed — every animal that
    // existed before the switch keeps appearing.
    if (row.listed === 0) return false;
    // An animal in a foster home is still looking for a permanent one.
    if (row.recordType === 'foster') return true;
    return row.recordType === RECORD_TYPES.AVAILABLE && !row.adopterId;
}

/** How many of an animal's media items the catalog can actually draw: a photo,
 *  or a video that has a poster. Pass the result to `isPubliclyListed`. */
export function showableCount(
    media: { mediaType?: string | null; thumbnailUrl?: string | null }[],
): number {
    return media.filter(m => (m.mediaType === 'video' ? !!m.thumbnailUrl : true)).length;
}
