import { describe, it, expect } from 'vitest';
import { parsePhotoInputs, photoLinks, PHOTO_MAX_BYTES } from './formPhotos';

const img = (type = 'jpeg', bytes = 10) => `data:image/${type};base64,${Buffer.alloc(bytes).toString('base64')}`;

describe('photos sent with a form', () => {
    it('keeps up to 3 protection photos and 1 sleep photo, in order', () => {
        const out = parsePhotoInputs({ protectionPhotos: [img(), img('png'), img('webp'), img(), img()], sleepPhoto: img() });
        expect(out.protection).toHaveLength(3);
        expect(out.protection[1].startsWith('data:image/png')).toBe(true);
        expect(out.sleep).not.toBeNull();
        expect(out.dropped).toBe(2);
    });
    it('refuses anything that is not a JPEG/PNG/WebP data URL, or too big', () => {
        const huge = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((PHOTO_MAX_BYTES + 10) * 4 / 3))}`;
        const out = parsePhotoInputs({ protectionPhotos: ['https://x/y.jpg', 'data:image/gif;base64,AAAA', 42, huge, img()], sleepPhoto: 'nope' });
        expect(out.protection).toHaveLength(1);
        expect(out.sleep).toBeNull();
        expect(out.dropped).toBe(5);
    });
    it('nothing sent → nothing', () => {
        expect(parsePhotoInputs({})).toEqual({ protection: [], sleep: null, dropped: 0 });
    });
});

describe('links to stored photos (never the storage keys)', () => {
    it('one access-checked route per photo, by position', () => {
        const keys = JSON.stringify([{ kind: 'protection', key: 'form-photos/a.jpg' }, { kind: 'sleep', key: 'form-photos/b.jpg' }, { kind: 'protection', key: 'form-photos/c.jpg' }]);
        expect(photoLinks('sub1', keys)).toEqual({
            protection: ['/api/files/form-photo/sub1/0', '/api/files/form-photo/sub1/2'],
            sleep: '/api/files/form-photo/sub1/1',
        });
    });
    it('none stored or malformed → none', () => {
        expect(photoLinks('s', null)).toEqual({ protection: [], sleep: null });
        expect(photoLinks('s', '{bad')).toEqual({ protection: [], sleep: null });
    });
});
