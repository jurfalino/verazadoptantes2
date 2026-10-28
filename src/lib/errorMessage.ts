import { isProfileIsMinorError } from '@/domain/profileIdentity';
import { isDeploymentSkewError } from '@/domain/clientErrors';
import { markDeploymentStale } from './staleDeploy';

/**
 * The text to show a user for a caught error.
 *
 * Replaces the `err instanceof Error ? err.message : fallback` idiom that ~26
 * handlers used. Since 2.56.61 a stale tab's server call throws with the
 * internal marker "DEPLOYMENT_SKEW" as its message, and that idiom printed it
 * verbatim (audit 2026-09-19, P0-2). A stale tab instead raises the "new
 * version" banner and the handler shows its own fallback text.
 */
export function userFacingMessage(err: unknown, fallback: string): string {
    if (isDeploymentSkewError(err)) {
        markDeploymentStale({ userInitiated: true });
        return fallback;
    }
    return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * True when the caught error means "this tab predates the running deployment",
 * after raising the "new version" notice. Guard a handler's own alert/toast with
 * it — `if (!handledAsStale(e)) toast.error(…)` — so the notice is the only message.
 */
export function handledAsStale(err: unknown): boolean {
    if (!isDeploymentSkewError(err)) return false;
    markDeploymentStale({ userInitiated: true });
    return true;
}

/**
 * A record, rating or alert refused because the profile is a minor's
 * (PROFILE_IS_MINOR): an expected rule, not a failure — the caller shows this
 * text as a warning (validation message), never an error toast with an Error
 * ID (audit 2026-10-28, A3). Null for any other error.
 */
export function minorRefusalMessage(err: unknown, t: (key: string) => string, what: 'record' | 'alert'): string | null {
    if (!isProfileIsMinorError(err)) return null;
    return t(what === 'alert' ? 'adopter.minor_refused_alert' : 'adopter.minor_note');
}
