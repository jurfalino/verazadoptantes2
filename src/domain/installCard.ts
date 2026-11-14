/**
 * The home «Instalá la app» card (option C, Jon 2026-11-12): when it shows.
 *
 * - `ios`: iPhone/iPad — no install prompt, the card explains «Agregar a inicio».
 * - `installable`: the browser handed us a `beforeinstallprompt` (Android /
 *   Chromium), so «Instalar» opens the browser's own install dialog.
 * - `none`: nothing to install from here (desktop without a prompt) — no card.
 *
 * «Ahora no» and ✕ hide it on this device for 30 days.
 */

export type InstallPlatform = 'ios' | 'installable' | 'none';

/** How long «Ahora no» / ✕ hide the card. */
export const INSTALL_CARD_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export function shouldShowInstallCard({ isStandalone, platform, dismissedAt, now }: {
    isStandalone: boolean;
    platform: InstallPlatform;
    /** When «Ahora no» / ✕ was last tapped on this device (ms), or null. */
    dismissedAt: number | null;
    now: number;
}): boolean {
    if (isStandalone || platform === 'none') return false;
    if (dismissedAt === null) return true;
    const elapsed = now - dismissedAt;
    // A stamp in the future (the device clock moved back) must not hide it for good.
    return elapsed < 0 || elapsed >= INSTALL_CARD_SNOOZE_MS;
}

/** The stored dismissal: a positive whole number of ms, anything else is «never dismissed». */
export function parseDismissedAt(raw: string | null): number | null {
    if (!raw || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The `platform` property of `install_card_action` (no event where there is no card). */
export function installCardEventPlatform(platform: InstallPlatform): 'android' | 'ios' | null {
    if (platform === 'ios') return 'ios';
    if (platform === 'installable') return 'android';
    return null;
}
