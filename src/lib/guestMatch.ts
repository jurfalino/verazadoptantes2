/**
 * A search result as it leaves the server for a logged-out visitor while
 * ENABLE_GUEST_NAME_MASK is on. The name is masked (see
 * `src/domain/guestNameMask.ts`), the same name words are masked in the contact
 * line, and every field the result card does not show is dropped, so the name
 * can't be read from the response either — not just from the screen.
 *
 * The card shows: name, contact line, photo, visibility badge, rating, counts,
 * flags, dates and a "matched on <field>" chip (no value, for a guest).
 */

import type { adopters } from '@/db/schema';
import type { DiscoveryMatch } from '@/app/actions/types';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { guestNameWords, maskGuestName, maskNameWordsInText, typedWords } from '@/domain/guestNameMask';

type AdopterRow = typeof adopters.$inferSelect;

/**
 * @param match the result as assembled for this (logged-out) viewer
 * @param raw   the unmasked row it came from — its name and aliases decide which
 *              words to mask (the viewer-masked copy may have lost them)
 * @param query what the visitor typed
 */
export function toGuestMatch(match: DiscoveryMatch, raw: AdopterRow, query: string): DiscoveryMatch {
    const typed = typedWords(query);
    const aliases = deserializeContactEntries(raw.contactEntries)
        .filter(e => e.type === 'alias')
        .map(e => e.value || '');
    const words = guestNameWords(raw.name || '', aliases);
    const name = maskGuestName(raw.name || '', typed);
    const maskText = (v: string | null) => (v ? maskNameWordsInText(v, words, typed) : v);

    return {
        ...match,
        adopterName: name,
        matchValues: [],
        // A guest's card names the matched field, never its value.
        matchSnippet: match.matchSnippet ? { ...match.matchSnippet, snippet: '', highlights: [] } : null,
        adopter: {
            ...match.adopter,
            name,
            contactInfo: maskText(match.adopter.contactInfo),
            // Not shown on the card; each can carry the name or a relative's.
            contactEntries: null,
            addressInfo: null,
            familyMembers: null,
            householdMembers: null,
            notes: null,
            sourceUrl: null,
            addedBy: '',
        },
    };
}
