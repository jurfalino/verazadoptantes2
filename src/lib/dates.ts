/**
 * Shared date formatting utilities.
 * All user-facing dates use 3-letter month abbreviations.
 */

/**
 * Format a date as "Feb 4 '26" — short month + day + 2-digit year.
 * Accepts Date objects, epoch-seconds (number), or ISO strings.
 */
export function formatShortDate(input: Date | number | string): string {
    const date = input instanceof Date ? input : new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
    if (isNaN(date.getTime())) return '—';
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    return `${month} ${day} '${year}`;
}

/**
 * Format a date-time as "9 feb 2026 14:30" — day + short month + year + HH:MM.
 * Uses es-AR locale for consistency with the app's Spanish-first approach.
 */
export function formatDateTime(input: Date | number | string): string {
    const date = input instanceof Date ? input : new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/**
 * Format a date-time with seconds: "9 feb 2026 14:30:05"
 */
export function formatDateTimeFull(input: Date | number | string): string {
    const date = input instanceof Date ? input : new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}
