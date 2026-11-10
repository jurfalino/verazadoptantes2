import { describe, it, expect } from 'vitest';
import { contractHref, contractResultsHref } from './contractLink';

describe('contractHref', () => {
    it('a privately stored contract opens through the checked route', () => {
        expect(contractHref('a1', 1, null)).toBe('/api/files/contract/a1');
        expect(contractHref('a1', true, null, 'p9')).toBe('/api/files/contract/a1?placement=p9');
    });
    it('a contractKey typed into comments is NOT a contract (only the server column counts)', () => {
        expect(contractHref('a1', 0, JSON.stringify({ contractKey: 'contracts/x.pdf' }))).toBeNull();
    });
    it('an older record keeps its genuine old contract link — and nothing else typed into comments', () => {
        const real = 'https://pub-bb28dd8b1e674fc189252b0000a7b573.r2.dev/contracts/a1/signed-contract.pdf';
        expect(contractHref('a1', 0, JSON.stringify({ contractScreenshot: real }))).toBe(real);
        expect(contractHref('a1', 0, JSON.stringify({ contractScreenshot: 'https://evil.example/phish.pdf' }))).toBeNull();
        expect(contractHref('a1', 0, JSON.stringify({ contractScreenshot: real.replace('/a1/', '/other/') }))).toBeNull();
    });
    it('no contract, or a plain note → no link', () => {
        expect(contractHref('a1', null, null)).toBeNull();
        expect(contractHref('a1', 0, 'una nota')).toBeNull();
        expect(contractHref('a1', 0, '{}')).toBeNull();
    });
});

describe('contractResultsHref (H1)', () => {
    it('opens the result kept with the signature, naming where it was opened from', () => {
        expect(contractResultsHref('sc-1', { adopter: 'ad-1' })).toBe('/contract-results/sc-1?from=adopter%3Aad-1');
        expect(contractResultsHref('sc-1', { animal: 'an-1' })).toBe('/contract-results/sc-1?from=animal%3Aan-1');
    });

    it('no signed_contracts row (an older contract): no link, only the PDF', () => {
        expect(contractResultsHref(null, { adopter: 'ad-1' })).toBeNull();
        expect(contractResultsHref(undefined, { animal: 'an-1' })).toBeNull();
    });
});
