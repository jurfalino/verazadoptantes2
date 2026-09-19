import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./serviceStatus', () => ({ checkCloudflareStatus: vi.fn(async () => ({ degraded: false })) }));
vi.mock('./staleDeploy', () => ({ attemptStaleReload: vi.fn() }));

import { notifyRequestError } from './notifyError';
import { attemptStaleReload } from './staleDeploy';
import { checkCloudflareStatus } from './serviceStatus';
import { DEPLOYMENT_SKEW_SENTINEL } from '@/domain/clientErrors';

const t = (k: string) => k;
const fallback = { title: 'toast.search_failed_title', message: 'errors.search_failed' };

beforeEach(() => { vi.mocked(attemptStaleReload).mockReset(); vi.mocked(checkCloudflareStatus).mockClear(); });

describe('notifyRequestError', () => {
    it('reloads a stale tab instead of reporting a failed search', async () => {
        vi.mocked(attemptStaleReload).mockReturnValue(true);
        const toast = vi.fn();
        await notifyRequestError(toast, t, new Error(DEPLOYMENT_SKEW_SENTINEL), fallback);
        expect(attemptStaleReload).toHaveBeenCalledTimes(1);
        expect(toast).not.toHaveBeenCalled();
        // No status round-trip in front of a reload.
        expect(checkCloudflareStatus).not.toHaveBeenCalled();
    });

    it('asks for a reload, with no error code, when a reload is not allowed', async () => {
        vi.mocked(attemptStaleReload).mockReturnValue(false);
        const toast = vi.fn();
        await notifyRequestError(toast, t, new Error(DEPLOYMENT_SKEW_SENTINEL), fallback);
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith('errors.stale_deploy_title', 'errors.stale_page_body');
    });

    it('still reports a genuine failure with an error code', async () => {
        const toast = vi.fn();
        await notifyRequestError(toast, t, new Error('Failed to fetch'), fallback);
        expect(attemptStaleReload).not.toHaveBeenCalled();
        const [title, message, id] = toast.mock.calls[0];
        expect([title, message]).toEqual([fallback.title, fallback.message]);
        // Before this change a thrown client error reached the toast with no id
        // and was never logged.
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });
});
