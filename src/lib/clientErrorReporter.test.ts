import { describe, it, expect, vi } from 'vitest';

vi.mock('./staleDeploy', () => ({ attemptStaleReload: vi.fn() }));

import { resolveErrorId } from './clientErrorReporter';
import { attemptStaleReload } from './staleDeploy';
import { DEPLOYMENT_SKEW_SENTINEL } from '@/domain/clientErrors';

describe('resolveErrorId on a stale tab', () => {
    it('never hands the skew sentinel to a toast as if it were an error code', () => {
        // When the reload is declined the caller still shows its toast. It used
        // to print "DEPLOYMENT_SKEW" where the error code goes.
        vi.mocked(attemptStaleReload).mockReturnValue(false);
        expect(resolveErrorId(new Error(DEPLOYMENT_SKEW_SENTINEL), 'test')).toBe('');
    });
});
