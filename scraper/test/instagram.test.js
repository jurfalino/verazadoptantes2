// Pure Instagram helpers (run: npm run build && npm test, from scraper/).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    mergeImagesPreferFullRes, captionFromOgDescription, harvestInstagramCaption, chooseInstagramCaption,
} = require('../dist/instagram.js');

const CROPPED_OG = 'https://scontent-gru2-1.cdninstagram.com/v/t51.2885-15/512345678_18012345678901234_1234567890123456789_n.jpg?stp=c0.135.1080.1080a_dst-jpg_e35_s640x640_tt6&_nc_cat=1';
const FULL_RES = 'https://instagram.fgru2-1.fna.fbcdn.net/v/t51.2885-15/512345678_18012345678901234_1234567890123456789_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=1';
const SLIDE_2 = 'https://instagram.fgru2-1.fna.fbcdn.net/v/t51.2885-15/598765432_18012345678909999_1234567890123456780_n.jpg?stp=dst-jpg_e35';

test('the full-size copy of a photo wins over the cropped preview of the same photo', () => {
    assert.deepEqual(mergeImagesPreferFullRes([FULL_RES, SLIDE_2], [CROPPED_OG]), [FULL_RES, SLIDE_2]);
});

test('the preview photo is kept when the page gave nothing', () => {
    assert.deepEqual(mergeImagesPreferFullRes([], [CROPPED_OG]), [CROPPED_OG]);
});

test('the caption is taken out of Instagram\'s preview text (English and Spanish headers)', () => {
    assert.equal(captionFromOgDescription('12 likes, 3 comments - refugio_luna on November 10, 2026: "Se busca hogar para Luna, cachorra de 3 meses"'), 'Se busca hogar para Luna, cachorra de 3 meses');
    assert.equal(captionFromOgDescription('12 Me gusta, 3 comentarios - refugio_luna el 10 de noviembre de 2026: "Texto del post"'), 'Texto del post');
});

test('preview text without that header is returned as is', () => {
    assert.equal(captionFromOgDescription('Un texto cualquiera'), 'Un texto cualquiera');
    assert.equal(captionFromOgDescription(''), '');
});

test('the full caption is read from the page\'s embedded data, escapes decoded', () => {
    const html = '<script>{"items":[{"caption":{"pk":"1799","text":"Ojo con esta persona\\nTel 11 5555-1234 \\u00e9xito","created_at":1}}]}</script>';
    assert.equal(harvestInstagramCaption(html), 'Ojo con esta persona\nTel 11 5555-1234 éxito');
});

test('no embedded caption → undefined', () => {
    assert.equal(harvestInstagramCaption('<html>nothing here</html>'), undefined);
});

test('caption choice: the embedded caption first; else the longer of the page text and the preview caption', () => {
    assert.equal(chooseInstagramCaption({ embedded: 'Completo', pageText: 'Un comentario largo de otra persona', preview: 'Corto' }), 'Completo');
    assert.equal(chooseInstagramCaption({ pageText: 'El texto completo del post', preview: 'El texto…' }), 'El texto completo del post');
    assert.equal(chooseInstagramCaption({ pageText: '', preview: 'Solo el preview' }), 'Solo el preview');
});
