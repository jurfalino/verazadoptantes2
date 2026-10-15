import { describe, it, expect } from 'vitest';
import { looksLike } from './contractStorage';

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;

describe('looksLike', () => {
    it('accepts files that start like their type', () => {
        expect(looksLike('application/pdf', buf([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
        expect(looksLike('image/png', buf([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(true);
        expect(looksLike('image/jpeg', buf([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
        expect(looksLike('image/webp', buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(true);
    });
    it('refuses a mislabelled file (HTML sent as a PDF) and unknown types', () => {
        expect(looksLike('application/pdf', buf([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBe(false);
        expect(looksLike('image/png', buf([0xff, 0xd8, 0xff]))).toBe(false);
        expect(looksLike('image/gif', buf([0x47, 0x49, 0x46]))).toBe(false);
    });
});
