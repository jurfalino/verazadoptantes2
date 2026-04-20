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

/**
 * Return a human-readable relative time string for recent dates (within 30 days).
 * Returns null for dates older than 30 days so callers can conditionally display it.
 * @param lang - 'es' or 'en'
 */
export function formatRelativeTime(input: Date | number | string, lang: 'es' | 'en' = 'es'): string | null {
    const date = input instanceof Date ? input : new Date(typeof input === 'number' && input < 1e12 ? input * 1000 : input);
    if (isNaN(date.getTime())) return null;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return null; // future dates

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays > 30) return null;

    if (lang === 'es') {
        if (diffMins < 1) return 'justo ahora';
        if (diffMins < 60) return `hace ${diffMins} min`;
        if (diffHours < 24) return diffHours === 1 ? 'hace 1 hora' : `hace ${diffHours} horas`;
        if (diffDays === 0) return 'hoy';
        if (diffDays === 1) return 'ayer';
        return `hace ${diffDays} días`;
    }

    // English
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    return `${diffDays} days ago`;
}

/**
 * Mask an email address for privacy: "jurfalino@gmail.com" → "j***o@gmail.com"
 */
export function maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 1) return email; // too short to mask
    const local = email.substring(0, atIndex);
    const domain = email.substring(atIndex);
    if (local.length <= 2) return local[0] + '*' + domain;
    return local[0] + '***' + local[local.length - 1] + domain;
}
