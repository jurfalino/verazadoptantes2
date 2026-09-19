import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Structural guarantees for the access-request core. It runs AFTER the response
 * (src/lib/background.ts), where re-resolving the signed-in user from request
 * headers is unproven on Cloudflare — and a failure there is silent. So the
 * caller passes the user it already resolved.
 */
describe('fileAccessRequestFor', () => {
    it('is NOT a server action: a client must never be able to name the requester', () => {
        // Anything exported from a 'use server' file is callable from the browser.
        expect(read('src/lib/piiAccessRequest.ts')).not.toMatch(/^\s*['"]use server['"]/m);
        expect(read('src/lib/piiAccessRequest.ts')).toMatch(/export async function fileAccessRequestFor\(\s*viewer: string/);
    });

    it('never looks the user up again', () => {
        // Code only: the file's doc comment explains WHY by naming these calls.
        const core = read('src/lib/piiAccessRequest.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(core).not.toMatch(/getUser\(|\bauth\(\)|headers\(\)|cookies\(\)/);
    });

    it('the public action resolves the session itself and delegates', () => {
        const action = read('src/app/actions/piiAccess.ts');
        const fn = action.slice(action.indexOf('export async function requestPiiAccess'));
        const body = fn.slice(0, fn.indexOf('\n}\n'));
        expect(body).toMatch(/getUser\(\)/);
        expect(body).toMatch(/fileAccessRequestFor\(viewer,/);
    });

    it('the contribution path passes the actor it already has, not a fresh lookup', () => {
        const src = read('src/app/actions/addContactEntry.ts');
        expect(src).toMatch(/fileAccessRequestFor\(actor,/);
        expect(src).not.toMatch(/requestPiiAccess\(/);
    });
});
