import { describe, it, expect } from 'vitest';
import { rowsAffected } from './rowsAffected';

describe('rowsAffected', () => {
    it('reads better-sqlite3 and D1 run results', () => {
        expect(rowsAffected({ changes: 1, lastInsertRowid: 3 })).toBe(1);
        expect(rowsAffected({ success: true, meta: { changes: 0 } })).toBe(0);
    });
    it('is null when the driver reports neither', () => {
        expect(rowsAffected(undefined)).toBeNull();
        expect(rowsAffected({ meta: {} })).toBeNull();
        expect(rowsAffected([])).toBeNull();
    });
});
