import { describe, it, expect } from 'vitest';
import { isRecoverableHydrationError } from './clientErrors';

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
