import { checkCloudflareStatus } from './serviceStatus';
import { extractErrorId } from './errorUtils';

type ErrorToast = (title: string, message?: string, errorId?: string) => void;

/**
 * Show a degradation-aware error toast for a failed request.
 *
 * If the failure coincides with a live upstream incident, we replace the bare
 * error with an honest "it's on our side, not you, your data is safe" message.
 * Otherwise we show the caller's normal fallback copy. The errorId is preserved
 * either way so support can still trace it — we never HIDE a real app bug
 * behind a false "it's a service disruption".
 *
 * Use this only for infra-smelling failures (5xx / network / thrown server
 * actions), not for validation errors.
 */
export async function notifyRequestError(
    toastError: ErrorToast,
    t: (key: string) => string,
    err: unknown,
    fallback: { title: string; message: string },
): Promise<void> {
    const errorId = extractErrorId(err);
    const status = await checkCloudflareStatus();
    if (status.degraded) {
        toastError(t('errors.service_degraded_title'), t('errors.service_degraded_body'), errorId);
        return;
    }
    toastError(fallback.title, fallback.message, errorId);
}
