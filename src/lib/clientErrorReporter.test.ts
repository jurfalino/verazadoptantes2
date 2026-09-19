import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./staleDeploy', () => ({
    attemptStaleReload: vi.fn(),
    markDeploymentStale: vi.fn(),
    STALE_DEPLOY_ERROR_ID: 'stale-deploy',
}));

import { resolveErrorId } from './clientErrorReporter';
import { attemptStaleReload, markDeploymentStale } from './staleDeploy';
import { DEPLOYMENT_SKEW_SENTINEL } from '@/domain/clientErrors';

beforeEach(() => { vi.mocked(attemptStaleReload).mockClear(); vi.mocked(markDeploymentStale).mockClear(); });

describe('resolveErrorId on a stale tab', () => {
    it('does NOT reload: nearly every caller is a save, and a reload destroys what was typed', () => {
        resolveErrorId(new Error(DEPLOYMENT_SKEW_SENTINEL), 'AdoptionFormEditV2');
        expect(attemptStaleReload).not.toHaveBeenCalled();
        expect(markDeploymentStale).toHaveBeenCalledTimes(1);
    });

    it('returns the id the toast layer drops, so the banner is the only message', () => {
        expect(resolveErrorId(new Error(DEPLOYMENT_SKEW_SENTINEL), 'x')).toBe('stale-deploy');
    });

    it('leaves ordinary errors alone', () => {
        expect(resolveErrorId(new Error('boom'), 'x')).toMatch(/^[0-9a-f]{8}$/);
        expect(markDeploymentStale).not.toHaveBeenCalled();
    });
});
