/**
 * v2.19.13 relative-time helper for the provenance cell. Compact strings —
 * "ahora", "hace 12 min", "hace 3 h", "hace 5 d", "hace 2 sem", "hace 4 mes",
 * "hace 1 año" — keep the cell at a glance and the tooltip carries the
 * absolute timestamp for precision. Shared with the homepage cards so a
 * date reads the same on both (moved out of /my-adopters, 2026-11-05).
 *
 * v2.19.14 PROD HOTFIX: input can also be a string. Drizzle columns with
 * `mode: 'timestamp'` return Date objects server-side, but
 * `NextResponse.json()` serialises Dates to ISO strings, so the client
 * receives `createdAt` / `updatedAt` as strings — not numbers, not Dates.
 * The Adopter interface previously typed these as `number | null` which
 * was the lie that crashed prod with "getTime is not a function". Now
 * we accept all three input shapes and normalise to seconds-epoch.
 */
export function timeAgoSeconds(input: number | Date | string | null | undefined): number {
    if (input === null || input === undefined || input === '') return 0;
    if (typeof input === 'number') return input;
    if (input instanceof Date) return Math.floor(input.getTime() / 1000);
    // string: try ISO first, then epoch-as-string
    const isoMs = Date.parse(input);
    if (Number.isFinite(isoMs)) return Math.floor(isoMs / 1000);
    const asNum = Number(input);
    return Number.isFinite(asNum) ? asNum : 0;
}

export function timeAgo(input: number | Date | string | null | undefined, isEs: boolean): string {
    const sec = timeAgoSeconds(input);
    if (!sec) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - sec);
    const mins = Math.floor(diff / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    if (mins < 1) return isEs ? 'ahora' : 'just now';
    if (mins < 60) return isEs ? `hace ${mins} min` : `${mins}m ago`;
    if (hrs < 24) return isEs ? `hace ${hrs} h` : `${hrs}h ago`;
    if (days < 7) return isEs ? `hace ${days} d` : `${days}d ago`;
    if (weeks < 5) return isEs ? `hace ${weeks} sem` : `${weeks}w ago`;
    if (months < 12) return isEs ? `hace ${months} mes` : `${months}mo ago`;
    return isEs ? `hace ${years} año${years === 1 ? '' : 's'}` : `${years}y ago`;
}
