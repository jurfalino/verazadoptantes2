/**
 * What the person hid on their homepage (`user_profiles.home_prefs`, JSON).
 * Per account, not per browser, so a hidden card stays hidden on every device.
 */
export type HomePrefs = {
    /** «Para empezar» / «También podés» dismissed with «Ocultar». */
    firstStepsHidden?: boolean;
};

/** Parse stored prefs JSON. Malformed input, unknown keys and non-boolean values are dropped. */
export function parseHomePrefs(raw: string | null | undefined): HomePrefs {
    if (!raw) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: HomePrefs = {};
    const hidden = (parsed as Record<string, unknown>).firstStepsHidden;
    if (typeof hidden === 'boolean') out.firstStepsHidden = hidden;
    return out;
}
