/**
 * Free text from the public adoption form (spec 2026-10-14). The server
 * re-checks it: a hand-made POST can't store a novel or put junk on a profile.
 */
export function clampFreeText(v: unknown, max: number): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
}

const HOST: Record<'instagram' | 'facebook', RegExp> = {
    instagram: /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/i,
    facebook: /^(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.com\/[A-Za-z0-9.]{1,50}\/?$/i,
};
const HANDLE = /^@?[A-Za-z0-9._]{2,30}$/;

/** A handle (@user) or a profile URL of that network — anything else is not a contact. */
export function socialHandle(v: unknown, platform: 'instagram' | 'facebook'): { value: string; platform: 'instagram' | 'facebook' } | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t || t.length > 100) return null;
    if (HOST[platform].test(t)) return { value: t, platform };
    if (/[/:\s]/.test(t)) return null;
    if (!HANDLE.test(t) || !/[A-Za-z0-9]/.test(t)) return null;
    return { value: t.startsWith('@') ? t : `@${t}`, platform };
}
