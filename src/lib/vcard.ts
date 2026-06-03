/**
 * vCard parser — minimal, edge-runtime safe. Used by the contact-import flow
 * (homepage CTA + PWA share-target) to turn an OS-exported .vcf into the
 * neutral shape that feeds the ImportWizard's Step 3 prefill.
 *
 * Covers vCard 2.1 / 3.0 / 4.0 surfaces we see in practice from Android
 * Contacts, iOS Contacts and Outlook exports. PHOTO and other base64 blobs
 * are ignored. Multi-contact files pick the first BEGIN:VCARD block and
 * surface `pickedFromMultiple` so the caller can warn the user.
 *
 * NOT a general-purpose vCard library — we cherry-pick the FN / N / TEL /
 * EMAIL / ADR fields and the QUOTED-PRINTABLE encoding the wild Android
 * exports use for Spanish names. If a sharper edge case appears, prefer a
 * targeted fix here over pulling in an npm dep (keep edge bundle tight).
 */

export interface ParsedVcardAddress {
    streetAndNumber?: string;
    locality?: string;
    raw?: string;
}

export interface ParsedVcardContact {
    name: string;
    phones: string[];
    emails: string[];
    addresses: ParsedVcardAddress[];
    pickedFromMultiple: boolean;
}

interface RawLine {
    key: string;
    params: Record<string, string>;
    value: string;
}

/**
 * Unfold a vCard text body. RFC 2425 §5.8.1: a CRLF followed by whitespace
 * continues the previous logical line. Android ADR fields routinely fold.
 */
function unfoldLines(text: string): string[] {
    const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out: string[] = [];
    for (const line of raw) {
        if (line.length && (line[0] === ' ' || line[0] === '\t') && out.length) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }
    return out;
}

/**
 * Decode quoted-printable into UTF-8. Android Contacts exports Spanish names
 * as `Jos=C3=A9` (José) — this is the common case, not a corner. `=` at end
 * of line is a soft line break and emits nothing.
 */
function decodeQuotedPrintable(input: string): string {
    const bytes: number[] = [];
    let i = 0;
    while (i < input.length) {
        const ch = input.charCodeAt(i);
        if (ch === 0x3d /* = */) {
            const next = input.slice(i + 1, i + 3);
            if (next === '\n' || next === '\r\n' || next === '\r') {
                i += next.length + 1;
                continue;
            }
            if (/^[0-9A-Fa-f]{2}$/.test(next)) {
                bytes.push(parseInt(next, 16));
                i += 3;
                continue;
            }
            bytes.push(ch);
            i += 1;
        } else {
            bytes.push(ch);
            i += 1;
        }
    }
    try {
        return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch {
        return input;
    }
}

/** Parse `KEY[;PARAM=VALUE]*:VALUE` into key/params/value. Returns null on shape mismatch. */
function parseLine(line: string): RawLine | null {
    const colon = line.indexOf(':');
    if (colon < 0) return null;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts = head.split(';');
    const key = parts[0].toUpperCase();
    const params: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const eq = p.indexOf('=');
        if (eq < 0) {
            // vCard 2.1 allows bare type params (`;CELL`) — treat as TYPE.
            const existing = params['TYPE'] ? params['TYPE'] + ',' : '';
            params['TYPE'] = (existing + p).toUpperCase();
        } else {
            params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
        }
    }
    return { key, params, value };
}

/** Apply ENCODING=QUOTED-PRINTABLE / unescape vCard escape sequences. */
function decodeValue(value: string, params: Record<string, string>): string {
    let v = value;
    if ((params['ENCODING'] || '').toUpperCase() === 'QUOTED-PRINTABLE') {
        v = decodeQuotedPrintable(v);
    }
    // vCard 3.0 / 4.0 escape sequences inside text values.
    v = v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    return v.trim();
}

/**
 * Map a vCard structured ADR value (`;;street;locality;region;postal;country`)
 * to our two-field address shape. Falls back to a `raw` blob if the field is
 * unstructured (no semicolons at all).
 */
function parseAddress(value: string): ParsedVcardAddress | null {
    if (!value) return null;
    if (!value.includes(';')) {
        return { raw: value.trim() };
    }
    const parts = value.split(';').map(p => p.trim());
    // RFC 6350 ADR component order:
    //   0: post office box
    //   1: extended address (apt / unit)
    //   2: street address
    //   3: locality
    //   4: region
    //   5: postal code
    //   6: country
    const street = [parts[2], parts[1]].filter(Boolean).join(' ').trim();
    const locality = [parts[3], parts[4], parts[5], parts[6]].filter(Boolean).join(', ').trim();
    if (!street && !locality) return null;
    return {
        ...(street ? { streetAndNumber: street } : {}),
        ...(locality ? { locality } : {}),
    };
}

/** Pick a display name from FN (preferred) or fall back to N's joined parts. */
function pickName(fn: string | null, n: string | null): string {
    if (fn && fn.trim()) return fn.trim();
    if (!n) return '';
    // N is structured: family;given;additional;prefix;suffix
    const parts = n.split(';').map(p => p.trim());
    const given = parts[1] || '';
    const family = parts[0] || '';
    return [given, family].filter(Boolean).join(' ').trim();
}

/** True if the TEL params suggest a mobile/cell line. */
function isMobileTel(params: Record<string, string>): boolean {
    const type = (params['TYPE'] || '').toUpperCase();
    return /\b(CELL|MOBILE|IPHONE)\b/.test(type);
}

/**
 * Parse a single VCARD block (lines between BEGIN:VCARD and END:VCARD,
 * exclusive). The lines are assumed already unfolded.
 */
function parseBlock(lines: string[]): ParsedVcardContact {
    let fn: string | null = null;
    let n: string | null = null;
    const mobilePhones: string[] = [];
    const otherPhones: string[] = [];
    const emails: string[] = [];
    const addresses: ParsedVcardAddress[] = [];

    for (const raw of lines) {
        if (!raw.trim()) continue;
        const parsed = parseLine(raw);
        if (!parsed) continue;
        // Drop the type-group prefix (some clients use `item1.TEL`).
        const key = parsed.key.includes('.') ? parsed.key.split('.').pop()! : parsed.key;
        const value = decodeValue(parsed.value, parsed.params);
        if (!value) continue;

        switch (key) {
            case 'FN':
                fn = value;
                break;
            case 'N':
                n = value;
                break;
            case 'TEL':
                if (isMobileTel(parsed.params)) mobilePhones.push(value);
                else otherPhones.push(value);
                break;
            case 'EMAIL':
                emails.push(value);
                break;
            case 'ADR': {
                const addr = parseAddress(value);
                if (addr) addresses.push(addr);
                break;
            }
            default:
                break;
        }
    }

    // Mobile-first ordering so the wizard's "first phone" preview shows the
    // line the user is most likely to reach the adopter on.
    const phones = [...mobilePhones, ...otherPhones];

    return {
        name: pickName(fn, n),
        phones,
        emails,
        addresses,
        pickedFromMultiple: false,
    };
}

/**
 * Parse a `.vcf` body. Returns the first VCARD block; sets
 * `pickedFromMultiple=true` when the file contained more than one. Returns
 * `null` only when nothing parseable is found at all — never throws.
 */
export function parseVcard(text: string): ParsedVcardContact | null {
    if (!text || !text.trim()) return null;
    const lines = unfoldLines(text);

    const blocks: string[][] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        const stripped = line.trim();
        if (/^BEGIN:VCARD$/i.test(stripped)) {
            current = [];
            continue;
        }
        if (/^END:VCARD$/i.test(stripped)) {
            if (current) blocks.push(current);
            current = null;
            continue;
        }
        if (current) current.push(line);
    }

    if (blocks.length === 0) return null;
    const first = parseBlock(blocks[0]);
    // Discard empty parse — a file with BEGIN/END but no recognized fields
    // is not useful to surface as a "successfully imported contact."
    if (!first.name && first.phones.length === 0 && first.emails.length === 0 && first.addresses.length === 0) {
        return null;
    }
    first.pickedFromMultiple = blocks.length > 1;
    return first;
}
