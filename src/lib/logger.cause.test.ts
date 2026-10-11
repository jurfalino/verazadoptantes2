import { describe, it, expect } from 'vitest';
import { causeChain } from './logger';

describe('causeChain', () => {
    it("keeps the database's reason that Drizzle wraps in `cause`", () => {
        const d1 = new Error('D1_ERROR: Network connection lost.');
        const wrapped = new Error('Failed query: update "adopters" set "token_hash" = ?', { cause: d1 });
        expect(causeChain(wrapped)).toEqual({ cause: [{ name: 'Error', message: 'D1_ERROR: Network connection lost.' }] });
    });
    it('is empty when there is no cause', () => {
        expect(causeChain(new Error('plain'))).toEqual({});
    });
    it('stops after 3 levels', () => {
        let e = new Error('root');
        for (let i = 0; i < 5; i++) e = new Error(`level ${i}`, { cause: e });
        expect(causeChain(e).cause).toHaveLength(3);
    });
});
