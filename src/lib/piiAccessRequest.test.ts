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
        // Shared by addContactEntry and the household actions (D54).
        const helper = read('src/lib/contributionSideEffects.ts');
        expect(helper).not.toMatch(/^\s*['"]use server['"]/m);
        expect(helper).toMatch(/fileAccessRequestFor\(actor,/);
        expect(helper).not.toMatch(/requestPiiAccess\(|getUser\(/);
        const contact = read('src/app/actions/addContactEntry.ts');
        expect(contact).toMatch(/fileContributionAccessRequest\([^)]*actor, adopterId\)/);
        expect(contact).not.toMatch(/requestPiiAccess\(/);
        // Households as profiles: the household add files on the person it made, with the actor it has.
        const households = read('src/app/actions/households.ts');
        expect(households).toMatch(/fileContributionAccessRequest\([^)]*actor, person\.id\)/);
        expect(households).not.toMatch(/requestPiiAccess\(/);
    });
});
