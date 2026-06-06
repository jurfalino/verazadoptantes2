/**
 * Mapping from the Google Contacts server response shape to the wizard's
 * canonical contact shape (v2.18.0).
 *
 * The server route at `/api/google-contacts/list` returns `TrimmedContact[]`
 * — name + phones + emails + addresses + an opaque id for React keying.
 * The wizard's `hydrateFromContact` expects `ParsedVcardContact` from
 * `src/lib/vcard.ts`. The two shapes are deliberately near-identical so
 * the wizard's fast-path code doesn't fork between picker sources; this
 * helper bridges the last small gap (Google has an `id`, vCard has a
 * `pickedFromMultiple` flag) so consumers stay terse.
 *
 * Lives separately from vcard.ts (which is the parser for `.vcf` text)
 * because the source/parser/normalizer split keeps responsibility clear:
 * vcard.ts owns the text-format parse; this file owns the Google-shape
 * adapter; the wizard owns the prefill itself.
 */

import type { ParsedVcardContact } from './vcard';

/**
 * Public contact shape returned by the People API endpoint. Mirrors the
 * `TrimmedContact` shape in the route (declared here in the lib so client
 * components can import the type without dragging the server route's
 * module graph along).
 */
export interface GoogleContact {
    id: string;
    name: string;
    phones: string[];
    emails: string[];
    addresses: Array<{
        streetAndNumber?: string;
        locality?: string;
        raw?: string;
    }>;
}

/**
 * Convert a picked Google contact into the wizard's canonical
 * `ParsedVcardContact` so `hydrateFromContact` consumes it unchanged.
 * Google's response gives one contact at a time at user pick, so
 * `pickedFromMultiple` is always false here (the multi-vCard semantics
 * only apply to file uploads that may contain several BEGIN:VCARD blocks).
 */
export function googleContactToParsed(g: GoogleContact): ParsedVcardContact {
    return {
        name: g.name,
        phones: g.phones,
        emails: g.emails,
        addresses: g.addresses,
        pickedFromMultiple: false,
    };
}
