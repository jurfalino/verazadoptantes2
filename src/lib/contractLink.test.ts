import { describe, it, expect } from 'vitest';
import { contractHref } from './contractLink';

describe('contractHref', () => {
    it('a privately stored contract opens through the checked route', () => {
        expect(contractHref('a1', JSON.stringify({ contractKey: 'contracts/x.pdf' }))).toBe('/api/files/contract/a1');
        expect(contractHref('a1', JSON.stringify({ contractKey: 'contracts/x.pdf' }), 'p9')).toBe('/api/files/contract/a1?placement=p9');
    });
    it('an older record keeps the link it was saved with', () => {
        expect(contractHref('a1', JSON.stringify({ contractScreenshot: 'https://x.r2.dev/contracts/a1/signed-contract.pdf' }))).toBe('https://x.r2.dev/contracts/a1/signed-contract.pdf');
    });
    it('no contract, or a plain note → no link', () => {
        expect(contractHref('a1', null)).toBeNull();
        expect(contractHref('a1', 'una nota')).toBeNull();
        expect(contractHref('a1', '{}')).toBeNull();
    });
});
