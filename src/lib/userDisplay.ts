/**
 * Privacy-safe fallback label for a user (rescuer) who has no display name set:
 * the email's local part (the "handle"), NEVER the domain or the full address.
 * e.g. `jonathan@gmail.com` → `jonathan`.
 *
 * Use this everywhere a rescuer's identity is shown to non-admins so we never
 * expose their email — replacing the older `maskEmail` (which leaked the full
 * domain) and raw-email renders. Admin/moderation surfaces intentionally keep the
 * full email and do NOT use this. Matches the `email.split('@')[0]` fallback the
 * server-side name resolvers already use (notifications.ts, piiAccess.ts, …).
 */
export function emailHandle(email: string | null | undefined): string {
    if (!email) return '';
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
}

/**
 * Non-email actor codes that system write paths stamp into `recorded_by` /
 * `updated_by` / `changed_by`, mapped to the i18n key that names them for users.
 * All three come from the public contract app (`/api/contract/[id]/submit` and
 * `_adopterFactory` with source='contract'). Resolving them at display time
 * means rows already written with these codes need no backfill.
 *
 * Deliberately a subset of `SENTINEL_ACTORS` in `piiAccess.ts` (not imported:
 * that module is server-side and this one ships to client components). Only
 * actors with approved copy belong here; 'anonymous' keeps its own handling at
 * each call site.
 */
// A Map, not an object literal: `obj[actor]` would resolve inherited keys
// ('constructor', 'toString', …) through the prototype and hand t() a function.
const SYSTEM_ACTOR_LABEL_KEYS: ReadonlyMap<string, string> = new Map([
    ['contract', 'common.actor_contract'],
    ['contract-signed-via-invitation', 'common.actor_contract'],
    ['contract-submission', 'common.actor_contract'],
    ['form-submission', 'common.actor_form_submission'],
]);

/**
 * How an actor (the person or system that recorded/changed something) is shown:
 * a known system actor → its localized label; otherwise the resolved display
 * name, else the email handle (unchanged from the `name || emailHandle(x)`
 * pattern it replaces). Use it on every "Agregado por / Actualizado por / por"
 * line so a system code never reaches the screen.
 *
 * `resolvedName` is whatever the caller already looked up for this actor
 * (`userNameMap?.[actor]`, `addedByName`, `lastUpdate.name`).
 */
export function actorLabel(
    actor: string | null | undefined,
    resolvedName: string | null | undefined,
    t: (path: string) => string,
): string {
    const systemKey = actor ? SYSTEM_ACTOR_LABEL_KEYS.get(actor) : undefined;
    if (systemKey) return t(systemKey);
    return resolvedName || emailHandle(actor);
}
