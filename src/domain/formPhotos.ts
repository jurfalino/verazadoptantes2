/**
 * Photos sent with an adoption form (spec 2026-10-14 §4, release 2): up to 3
 * of the protection, 1 of where the animal sleeps. The server re-checks what
 * the form sends, and the client only ever sees access-checked links — the
 * storage keys stay in form_submissions.photo_keys (src/lib/selfieLink.ts rule).
 */

/** Same ceiling as the selfie (src/lib/contractStorage.ts). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PROTECTION_PHOTOS = 3;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const accepted = (v: unknown): v is string =>
    typeof v === 'string' && DATA_URL.test(v) && Math.floor((v.length - v.indexOf(',') - 1) * 3 / 4) <= PHOTO_MAX_BYTES;

export function parsePhotoInputs(body: { protectionPhotos?: unknown; sleepPhoto?: unknown }): { protection: string[]; sleep: string | null; dropped: number } {
    const sent = Array.isArray(body.protectionPhotos) ? body.protectionPhotos : [];
    const ok = sent.filter(accepted);
    const protection = ok.slice(0, MAX_PROTECTION_PHOTOS);
    const sleep = accepted(body.sleepPhoto) ? body.sleepPhoto : null;
    const sleepDropped = body.sleepPhoto !== undefined && body.sleepPhoto !== null && body.sleepPhoto !== '' && !sleep ? 1 : 0;
    return { protection, sleep, dropped: sent.length - protection.length + sleepDropped };
}

export type StoredPhoto = { kind: 'protection' | 'sleep'; key: string };

/** form_submissions.photo_keys → the links the results page shows. */
export function photoLinks(submissionId: string, keysJson: string | null | undefined): { protection: string[]; sleep: string | null } {
    let stored: unknown = [];
    try { stored = keysJson ? JSON.parse(keysJson) : []; } catch { stored = []; }
    const list = Array.isArray(stored) ? stored as StoredPhoto[] : [];
    const link = (i: number) => `/api/files/form-photo/${submissionId}/${i}`;
    const protection: string[] = [];
    let sleep: string | null = null;
    list.forEach((p, i) => {
        if (p?.kind === 'protection') protection.push(link(i));
        else if (p?.kind === 'sleep' && !sleep) sleep = link(i);
    });
    return { protection, sleep };
}
