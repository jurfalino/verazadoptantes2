import { describe, it, expect } from 'vitest';
import {
    isRecoverableHydrationError,
    isChunkLoadError,
    isOpaqueCrossOriginError,
    classifyWindowError,
    isDeploymentSkewError,
    DEPLOYMENT_SKEW_SENTINEL,
} from './clientErrors';

describe('isRecoverableHydrationError', () => {
    it('recognises the production error that toasted a user (errorId 43d67f9e)', () => {
        const actual = 'Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]= '
            + 'for the full message or use the non-minified dev environment for full errors and additional helpful warnings.';
        expect(isRecoverableHydrationError(actual)).toBe(true);
    });

    it('covers the other recoverable hydration codes', () => {
        expect(isRecoverableHydrationError('Minified React error #423')).toBe(true);
        expect(isRecoverableHydrationError('Minified React error #425')).toBe(true);
    });

    it('recognises un-minified hydration messages', () => {
        expect(isRecoverableHydrationError(
            "Hydration failed because the server rendered HTML didn't match the client."
        )).toBe(true);
        expect(isRecoverableHydrationError(
            'Text content does not match server-rendered HTML'
        )).toBe(true);
    });

    it('does NOT swallow React errors the user must be told about', () => {
        // #419 is a Suspense boundary that failed on the server — a real
        // failure, not something React silently repaired.
        expect(isRecoverableHydrationError('Minified React error #419')).toBe(false);
        expect(isRecoverableHydrationError('Minified React error #185')).toBe(false);
    });

    it('does not match ordinary runtime errors', () => {
        expect(isRecoverableHydrationError("Cannot read properties of undefined (reading 'map')")).toBe(false);
        expect(isRecoverableHydrationError('NetworkError when attempting to fetch resource')).toBe(false);
        expect(isRecoverableHydrationError('')).toBe(false);
    });
});

describe('isChunkLoadError', () => {
    it('recognises the production error that dead-ended a user (errorId 7092aed7)', () => {
        // Real payload from Axiom, 2026-09-10. Note `name` is 'Error', NOT
        // 'ChunkLoadError' — only the stack carries the real name, which is
        // exactly why a name-only check is not enough.
        expect(isChunkLoadError({
            name: 'Error',
            message: 'Loading chunk 2117 failed.\n(error: https://staging.buenadoptante.org/_next/static/chunks/2117-c6301391cd111ecb.js)',
            stack: 'ChunkLoadError\n    at r.f.j (https://staging.buenadoptante.org/_next/static/chunks/webpack-aa7b61c725343685.js:1:4484)',
        })).toBe(true);
    });

    it('recognises it by name alone', () => {
        expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'whatever' })).toBe(true);
    });

    it('recognises it by stack alone when the name was flattened', () => {
        expect(isChunkLoadError({ name: 'Error', message: 'boom', stack: 'ChunkLoadError\n    at x' })).toBe(true);
    });

    it('recognises CSS chunk failures', () => {
        expect(isChunkLoadError({ message: 'Loading CSS chunk 481 failed.' })).toBe(true);
    });

    it('does not match ordinary runtime errors', () => {
        expect(isChunkLoadError({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'ok')" })).toBe(false);
        expect(isChunkLoadError({ message: 'Failed to fetch' })).toBe(false);
        expect(isChunkLoadError({ message: '' })).toBe(false);
    });

    it('tolerates a missing or empty error object', () => {
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError(undefined)).toBe(false);
        expect(isChunkLoadError({})).toBe(false);
    });
});

describe('isOpaqueCrossOriginError', () => {
    it('recognises the production event that toasted an Instagram visitor (errorId b1f16983)', () => {
        // Real payload from Axiom, 2026-09-17: a throw inside a cross-origin
        // script, sanitised by the browser to nothing the page can act on.
        expect(isOpaqueCrossOriginError({
            message: 'Script error.',
            filename: '',
            lineno: 0,
            colno: 0,
        })).toBe(true);
    });

    it('accepts the period-less spelling some browsers use', () => {
        expect(isOpaqueCrossOriginError({ message: 'Script error', filename: '', lineno: 0, colno: 0 })).toBe(true);
    });

    it('does NOT swallow a real error that merely mentions a script error', () => {
        expect(isOpaqueCrossOriginError({
            message: 'Script error. handler threw',
            filename: 'https://buenadoptante.org/_next/static/chunks/main.js',
            lineno: 120,
            colno: 8,
        })).toBe(false);
    });

    it('does NOT match when the browser gave us a real location', () => {
        // Same message but with a source location: the browser is NOT hiding
        // anything, so this is a genuine same-origin failure worth surfacing.
        expect(isOpaqueCrossOriginError({
            message: 'Script error.',
            filename: 'https://buenadoptante.org/app.js',
            lineno: 42,
            colno: 3,
        })).toBe(false);
    });

    it('does not match ordinary errors', () => {
        expect(isOpaqueCrossOriginError({ message: 'Failed to fetch', filename: '', lineno: 0, colno: 0 })).toBe(false);
        expect(isOpaqueCrossOriginError({ message: '', filename: '', lineno: 0, colno: 0 })).toBe(false);
    });
});

/**
 * The ordering test. Each predicate above is honest in isolation; what actually
 * shipped a bug twice is which branch a real event reaches first. These feed
 * verbatim production payloads through the classifier the handler dispatches on.
 */
describe('classifyWindowError', () => {
    it('sends the Instagram visitor event to the silent branch (errorId b1f16983)', () => {
        expect(classifyWindowError({
            message: 'Script error.',
            filename: '',
            lineno: 0,
            colno: 0,
        })).toBe('opaque');
    });

    it('sends a missing lazy chunk to the reload branch (errorId 7092aed7)', () => {
        expect(classifyWindowError({
            message: 'Loading chunk 2117 failed.\n(error: https://staging.buenadoptante.org/_next/static/chunks/2117-c6301391cd111ecb.js)',
            name: 'Error',
            stack: 'ChunkLoadError\n    at r.f.j (https://staging.buenadoptante.org/_next/static/chunks/webpack-aa7b61c725343685.js:1:4484)',
            filename: 'https://staging.buenadoptante.org/_next/static/chunks/webpack-aa7b61c725343685.js',
            lineno: 1,
            colno: 4484,
        })).toBe('chunk');
    });

    it('sends a recovered hydration mismatch to the silent branch (errorId 43d67f9e)', () => {
        expect(classifyWindowError({
            message: 'Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]= for the full message',
            filename: 'https://buenadoptante.org/_next/static/chunks/main.js',
            lineno: 1,
            colno: 900,
        })).toBe('hydration');
    });

    it('still reports an ordinary crash to the user', () => {
        expect(classifyWindowError({
            message: "Cannot read properties of undefined (reading 'map')",
            name: 'TypeError',
            filename: 'https://buenadoptante.org/_next/static/chunks/page.js',
            lineno: 2,
            colno: 41,
        })).toBe('report');
    });

    it('treats a chunk failure as a chunk failure even with an empty location', () => {
        // Ordering guard: 'Script error.' must not be able to claim a real
        // chunk failure, and a chunk failure must not fall through to a toast.
        expect(classifyWindowError({
            message: 'Loading chunk 481 failed.',
            filename: '',
            lineno: 0,
            colno: 0,
        })).toBe('chunk');
    });
});

describe('isDeploymentSkewError', () => {
    it('recognises the error Next builds from the middleware rejection', () => {
        // middleware answers a mismatched x-deployment-id with 409 +
        // text/plain; Next's action reducer throws `new Error(await res.text())`,
        // so the body arrives verbatim as the message.
        expect(isDeploymentSkewError(new Error(DEPLOYMENT_SKEW_SENTINEL))).toBe(true);
    });

    it('recognises it when a caller has wrapped the message', () => {
        expect(isDeploymentSkewError(new Error(`Failed: ${DEPLOYMENT_SKEW_SENTINEL} (retry)`))).toBe(true);
    });

    it('does not fire on ordinary failures', () => {
        expect(isDeploymentSkewError(new Error('Failed to fetch'))).toBe(false);
        expect(isDeploymentSkewError(new Error('An unexpected response was received from the server.'))).toBe(false);
        expect(isDeploymentSkewError(undefined)).toBe(false);
        expect(isDeploymentSkewError(null)).toBe(false);
        expect(isDeploymentSkewError('DEPLOYMENT')).toBe(false);
    });

    it('accepts a bare string carrying the sentinel', () => {
        expect(isDeploymentSkewError(DEPLOYMENT_SKEW_SENTINEL)).toBe(true);
    });
});
