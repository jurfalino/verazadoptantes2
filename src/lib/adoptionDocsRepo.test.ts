import { describe, it, expect } from 'vitest';
import { sha256Hex } from './adoptionDocsRepo';

describe('sha256Hex', () => {
    it('matches the known sha256("abc") vector', async () => {
        expect(await sha256Hex('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});
