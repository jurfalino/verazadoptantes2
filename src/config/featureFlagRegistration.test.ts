/**
 * Guards the feature-flag plumbing against half-registration.
 *
 * Adding a flag to `FEATURE_FLAGS` is not enough to make it usable: the admin
 * config surface is a hand-maintained duplication that nothing iterates (the
 * route has carried a "known wart" note about it since v2.14.3). A flag missing
 * from the toggle list never appears in /admin/config, and one missing from the
 * API's echoed response hydrates as `undefined === 'true'` → renders OFF and
 * flips the wrong way on first click (the v2.19.48 incident).
 *
 * v2.55.16 shipped ENABLE_FOLLOWUPS registered in the code defaults but in
 * neither admin surface, so an entire feature could not be switched on at all.
 * This test reads the source files and fails the build instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FEATURE_FLAGS } from './features';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ADMIN_PAGE = 'src/app/admin/(admin-only)/config/page.tsx';
const CONFIG_API = 'src/app/api/admin/config/route.ts';

describe('feature-flag registration parity', () => {
    const flags = Object.keys(FEATURE_FLAGS);

    it('every flag is in the admin toggle list (else it cannot be switched on)', () => {
        const page = read(ADMIN_PAGE);
        const missing = flags.filter(f => !page.includes(`key: '${f}'`));
        expect(missing, `add these to FEATURE_FLAGS in ${ADMIN_PAGE}`).toEqual([]);
    });

    it('every flag is hydrated by the admin page (else the toggle renders stale)', () => {
        const page = read(ADMIN_PAGE);
        const missing = flags.filter(f => !page.includes(`data.config?.${f}`));
        expect(missing, `add hydration lines in ${ADMIN_PAGE}`).toEqual([]);
    });

    it("every flag is echoed by the config API (else it hydrates as OFF and flips wrong)", () => {
        const api = read(CONFIG_API);
        const missing = flags.filter(f => !api.includes(`${f}: config['${f}']`));
        expect(missing, `add these to the GET response in ${CONFIG_API}`).toEqual([]);
    });

    it('client-visible flags are in PUBLIC_FLAG_KEYS', async () => {
        const { PUBLIC_FLAG_KEYS } = await import('@/lib/publicConfig');
        // Flags whose UI is rendered client-side; a miss here means the browser
        // never learns the value and the feature stays invisible.
        for (const f of ['ENABLE_ANIMALS_FOR_ADOPTION', 'ENABLE_FOLLOWUPS', 'ENABLE_EMAIL_OTP']) {
            expect(PUBLIC_FLAG_KEYS as readonly string[]).toContain(f);
        }
    });
});
