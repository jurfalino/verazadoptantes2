/**
 * Identifiers typed into a free-text search box (identity verdict, spec 2026-11-02).
 * Pure: no DB, no server imports.
 *
 * Only what is unmistakably an identifier is read: an email, a DNI (dotted `30.123.456`, or a
 * plain 7-8 digit run) and an `@handle`. Phones are NOT read here (the search box's phone path
 * owns them), and a phone such as `11 6585-1333` must never be taken for a DNI: its digit runs
 * are 2 and 4 long, and a longer run (`1165851333`) is not 7-8.
 */
export interface QueryIdentifiers { emails: string[]; documentIds: string[]; handles: string[]; rest: string }

const EMAIL = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const HANDLE = /(?<![\w.@])@([a-zA-Z0-9._]{2,})/g;
// Dotted: 1-2 digits, then two groups of 3. Plain: exactly 7-8 digits. Neither may touch another digit.
const DNI = /(?<![\d.\-+])(?:\d{1,2}\.\d{3}\.\d{3}|\d{7,8})(?![\d]|[.\-]\d)/g;

export function extractQueryIdentifiers(q: string): QueryIdentifiers {
    let rest = q ?? '';
    const emails = [...new Set(rest.match(EMAIL) ?? [])];
    rest = rest.replace(EMAIL, ' ');
    const handles = [...new Set([...rest.matchAll(HANDLE)].map(m => m[1].replace(/\.+$/, '')).filter(h => h.length >= 2))];
    rest = rest.replace(HANDLE, ' ');
    const documentIds = [...new Set(rest.match(DNI) ?? [])];
    rest = rest.replace(DNI, ' ');
    return { emails, documentIds, handles, rest: rest.replace(/\s+/g, ' ').trim() };
}
