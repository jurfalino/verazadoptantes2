/**
 * WhatsApp / Telegram deep links for follow-up messages
 * (v2.55.16, animal-timeline PR3 — per the followup-communications plan).
 *
 * wa.me needs full international digits with NO plus sign. Argentine mobiles
 * are the tricky case: WhatsApp requires `54 9 <area> <number>` (the `9`
 * infix), while people write numbers as `011 15-1234-5678`, `+54 11 ...`,
 * `54911...`, etc. Rules applied for AR:
 *   - strip everything non-digit, then a leading `00`
 *   - already `549…` → keep (no double-prefix)
 *   - `54…` (no 9) → insert the 9: `549` + rest
 *   - local: drop the leading `0` (long-distance prefix) and a `15` mobile
 *     prefix right after the area code can't be detected reliably, so a
 *     leading `15` is dropped only when it starts the local number; then
 *     prefix `549`.
 * Non-AR numbers that already carry a country code (11+ digits, not starting
 * with 0) are passed through as-is.
 */

const MIN_LOCAL_DIGITS = 8;

export function normalizePhoneForWa(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length < MIN_LOCAL_DIGITS) return null;

    if (digits.startsWith('549')) return digits;
    if (digits.startsWith('54')) return `549${digits.slice(2)}`;

    // Looks like a full non-AR international number — leave it alone.
    if (digits.length >= 11 && !digits.startsWith('0')) return digits;

    // Local AR number.
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.startsWith('15')) digits = digits.slice(2);
    if (digits.length < MIN_LOCAL_DIGITS) return null;
    return `549${digits}`;
}

/** wa.me deep link with the message prefilled. Null when the phone is unusable. */
export function buildWaMeUrl(rawPhone: string | null | undefined, text: string): string | null {
    const phone = normalizePhoneForWa(rawPhone);
    if (!phone) return null;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * Telegram can NOT prefill text to a specific person — t.me/+<E164> merely
 * opens the chat (the UI copies the message to the clipboard alongside).
 */
export function buildTelegramUrl(rawPhone: string | null | undefined): string | null {
    const phone = normalizePhoneForWa(rawPhone);
    if (!phone) return null;
    return `https://t.me/+${phone}`;
}
