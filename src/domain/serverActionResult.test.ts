import { describe, it, expect } from 'vitest';
import { didPersist } from './serverActionResult';

/**
 * A mutating server action in this codebase either throws or returns the saved
 * record's id. A resolved-but-empty result therefore means the write never
 * happened — most often because the tab outlived the deployment its bundle
 * came from. Treating that as success is silent data loss.
 */
describe('didPersist', () => {
    it('accepts the shape saveAdoption returns on success', () => {
        expect(didPersist({ success: true, id: 'abc123' })).toBe(true);
    });

    it('rejects a result that never arrived', () => {
        expect(didPersist(undefined)).toBe(false);
        expect(didPersist(null)).toBe(false);
    });

    it('rejects a success flag with no record behind it', () => {
        expect(didPersist({ success: true })).toBe(false);
        expect(didPersist({})).toBe(false);
    });

    it('rejects an empty id rather than trusting the key exists', () => {
        expect(didPersist({ success: true, id: '' })).toBe(false);
        expect(didPersist({ id: null })).toBe(false);
    });

    it('rejects primitives a broken transport might hand back', () => {
        expect(didPersist('ok')).toBe(false);
        expect(didPersist(0)).toBe(false);
        expect(didPersist(true)).toBe(false);
    });
});
