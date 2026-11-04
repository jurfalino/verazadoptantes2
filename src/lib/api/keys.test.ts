import { afterEach, describe, expect, it, vi } from 'vitest';
import { environmentForHost } from './keys';

// Every name production answers on (review of 2.56.232): the canonical one is not enough.
const PRODUCTION_NAMES = ['buenadoptante.org', 'www.buenadoptante.org', 'buenadoptante.org.', 'buenadoptante.org:8443', 'BuenAdoptante.org'];
const PAGES_NAMES = ['verazadoptantes2.pages.dev', 'a1b2c3d4.verazadoptantes2.pages.dev'];

describe('environmentForHost', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it('a production build is live on every name it is reached on', () => {
        vi.stubEnv('APP_ENVIRONMENT', 'production');
        for (const host of [...PRODUCTION_NAMES, ...PAGES_NAMES, 'staging.buenadoptante.org']) {
            expect(environmentForHost(host), host).toBe('live');
        }
    });

    it('a staging build is test, except on a production name (the floor)', () => {
        vi.stubEnv('APP_ENVIRONMENT', 'staging');
        for (const host of ['staging.buenadoptante.org', 'staging.verazadoptantes2.pages.dev', ...PAGES_NAMES]) {
            expect(environmentForHost(host), host).toBe('test');
        }
        for (const host of PRODUCTION_NAMES) expect(environmentForHost(host), host).toBe('live');
    });

    it('without the stamp (local dev), production names still read as live — trailing dot, port and case included', () => {
        vi.stubEnv('APP_ENVIRONMENT', '');
        for (const host of PRODUCTION_NAMES) expect(environmentForHost(host), host).toBe('live');
        for (const host of ['localhost:3000', '127.0.0.1:3000', 'staging.buenadoptante.org']) expect(environmentForHost(host), host).toBe('test');
    });
});
