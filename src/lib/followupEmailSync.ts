/**
 * «Toca un control de seguimiento» (Avisos) and «Recibir recordatorios también
 * por e-mail» (Seguimientos de adopción) are one stored value
 * (`followup_settings.emailReminders`) shown by two sections of /settings. Each
 * announces a saved change so the other's on-screen copy follows it; without
 * this, Seguimientos' staged «Guardar» would write back a stale value.
 * Client-only.
 */

const EVENT = 'buenadoptante:followup-email';

export function announceFollowupEmail(on: boolean): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: on }));
}

/** Calls `cb` with each announced value; returns the unsubscribe. */
export function onFollowupEmail(cb: (on: boolean) => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const listener = (e: Event) => {
        const on = (e as CustomEvent<unknown>).detail;
        if (typeof on === 'boolean') cb(on);
    };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
}
