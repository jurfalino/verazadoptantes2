import { describe, it, expect } from 'vitest';
import { parseDeployMap, decideSkew } from './deploySkew';

const MAP = { OLDSHA: 'https://38ff5995.verazadoptantes2.pages.dev' };
const base = { serverBuildId: 'NEWSHA', map: MAP, alreadyProxied: false };

describe('decideSkew — what to do with a request from another build', () => {
    it('passes a tab on the running build', () => {
        expect(decideSkew({ ...base, clientBuildId: 'NEWSHA', isServerAction: true })).toEqual({ kind: 'pass' });
    });

    it('passes when either side is unknown (external callers, local dev)', () => {
        expect(decideSkew({ ...base, clientBuildId: null, isServerAction: true })).toEqual({ kind: 'pass' });
        expect(decideSkew({ ...base, serverBuildId: '', clientBuildId: 'OLDSHA', isServerAction: true })).toEqual({ kind: 'pass' });
    });

    it('serves an old tab\'s save or search from the deployment it was loaded from', () => {
        // The CX requirement: the person notices nothing. No error, no reload.
        expect(decideSkew({ ...base, clientBuildId: 'OLDSHA', isServerAction: true }))
            .toEqual({ kind: 'proxy', origin: 'https://38ff5995.verazadoptantes2.pages.dev' });
    });

    it('rejects an old tab\'s page navigation, so Next upgrades the tab with a full load', () => {
        expect(decideSkew({ ...base, clientBuildId: 'OLDSHA', isServerAction: false })).toEqual({ kind: 'reject' });
    });

    it('rejects an action from a build too old to be in the map', () => {
        expect(decideSkew({ ...base, clientBuildId: 'ANCIENT', isServerAction: true })).toEqual({ kind: 'reject' });
    });

    it('does not treat inherited object keys as known builds', () => {
        for (const id of ['__proto__', 'constructor', 'toString']) {
            expect(decideSkew({ ...base, clientBuildId: id, isServerAction: true })).toEqual({ kind: 'reject' });
        }
    });

    it('never forwards a request that was already forwarded', () => {
        expect(decideSkew({ ...base, clientBuildId: 'OLDSHA', isServerAction: true, alreadyProxied: true })).toEqual({ kind: 'pass' });
    });
});

describe('parseDeployMap — only our own Pages deployments are valid targets', () => {
    it('reads the map CI bakes in', () => {
        expect(parseDeployMap(JSON.stringify(MAP))).toEqual(MAP);
    });

    it('drops anything that is not a verazadoptantes2 Pages deployment URL', () => {
        const raw = JSON.stringify({
            a: 'https://evil.example.com', b: 'http://38ff5995.verazadoptantes2.pages.dev',
            c: 'https://38ff5995.verazadoptantes2.pages.dev/path', d: 'https://x.verazadoptantes2.pages.dev.evil.com',
            e: 'https://abc12345.verazadoptantes2.pages.dev', f: 42,
        });
        expect(parseDeployMap(raw)).toEqual({ e: 'https://abc12345.verazadoptantes2.pages.dev' });
    });

    it('is empty for missing or broken input, which degrades to the reload notice', () => {
        expect(parseDeployMap(undefined)).toEqual({});
        expect(parseDeployMap('not json')).toEqual({});
        expect(parseDeployMap('[1,2]')).toEqual({});
    });

    it('accepts localhost only when explicitly allowed (tests)', () => {
        const raw = JSON.stringify({ a: 'http://localhost:3201' });
        expect(parseDeployMap(raw)).toEqual({});
        expect(parseDeployMap(raw, true)).toEqual({ a: 'http://localhost:3201' });
    });
});
