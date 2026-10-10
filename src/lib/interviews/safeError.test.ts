import { describe, it, expect } from 'vitest';
import { safeError } from './safeError';

describe('safeError', () => {
    it('drops bound params from the error and its cause', () => {
        const cause = new Error('SQLITE_ERROR: boom\nparams: Juan,1165851333');
        const e = new Error('Failed query: insert into interviews\nparams: Juan,1165851333', { cause });
        e.name = 'DrizzleQueryError';
        const out = safeError(e);
        expect(out.message).not.toMatch(/Juan|1165851333/);
        expect(out.message).toContain('Failed query');
        expect(out.message).toContain('cause: SQLITE_ERROR: boom');
        expect(out.name).toBe('DrizzleQueryError');
    });
});
