import { describe, it, expect } from 'vitest';
import { matchSignedContract, type SignedContractRow } from './signedContractMatch';

const row = (over: Partial<SignedContractRow>): SignedContractRow => ({ id: 's', animalId: 'a1', placementId: null, fileKey: null, signedAt: 1, ...over });

describe('matchSignedContract', () => {
    it('a row that names the placement is that placement\'s', () => {
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: 'k1' }, [row({ id: 's1', placementId: 'p1', fileKey: 'k1' })])).toBe('s1');
    });

    it('an older row without a placement matches by its stored file', () => {
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: 'k1' }, [row({ id: 's1', fileKey: 'k1' })])).toBe('s1');
    });

    it('returned and re-adopted: each placement gets its own signature, never the other one', () => {
        const rows = [
            row({ id: 'sA', placementId: 'pA', fileKey: 'kA', signedAt: 10 }),
            row({ id: 'sB', placementId: 'pB', fileKey: 'kB', signedAt: 20 }),
        ];
        expect(matchSignedContract({ id: 'pA', animalId: 'a1', contractKey: 'kA' }, rows)).toBe('sA');
        expect(matchSignedContract({ id: 'pB', animalId: 'a1', contractKey: 'kB' }, rows)).toBe('sB');
    });

    it('a row naming another placement does not match even with the same file', () => {
        expect(matchSignedContract({ id: 'p2', animalId: 'a1', contractKey: 'k1' }, [row({ id: 's1', placementId: 'p1', fileKey: 'k1' })])).toBeNull();
    });

    it('no stored contract, another animal, or no file on an old row: no result (PDF only)', () => {
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: null }, [row({ id: 's1', placementId: 'p1' })])).toBeNull();
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: 'k1' }, [row({ id: 's1', animalId: 'a2', fileKey: 'k1' })])).toBeNull();
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: 'k1' }, [row({ id: 's1', fileKey: null })])).toBeNull();
    });

    it('two signatures of one file: the newest', () => {
        expect(matchSignedContract({ id: 'p1', animalId: 'a1', contractKey: 'k1' }, [row({ id: 'old', fileKey: 'k1', signedAt: 1 }), row({ id: 'new', fileKey: 'k1', signedAt: 5 })])).toBe('new');
    });
});
