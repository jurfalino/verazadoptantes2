import { describe, it, expect } from 'vitest';
import { parseCoords, osmEmbedUrl, googleMapsUrl } from './mapUrls';

describe('parseCoords', () => {
    it('reads the strings form_submissions stores', () => {
        expect(parseCoords('-34.5185839099628', '-58.4854964873305')).toEqual({ lat: -34.5185839099628, lon: -58.4854964873305 });
    });

    it('rejects anything that is not a real position', () => {
        expect(parseCoords(null, '-58.4')).toBeNull();
        expect(parseCoords('', '')).toBeNull();
        expect(parseCoords('abc', '-58.4')).toBeNull();
        expect(parseCoords('-34.5', 'NaN')).toBeNull();
        expect(parseCoords('91', '0')).toBeNull();
        expect(parseCoords('0', '-181')).toBeNull();
        expect(parseCoords('Infinity', '0')).toBeNull();
    });

    it('accepts the edges of the valid range', () => {
        expect(parseCoords('90', '180')).toEqual({ lat: 90, lon: 180 });
        expect(parseCoords('-90', '-180')).toEqual({ lat: -90, lon: -180 });
    });
});

describe('osmEmbedUrl', () => {
    it('centres a street-level box on the point and drops a marker on it', () => {
        const url = new URL(osmEmbedUrl({ lat: -34.5, lon: -58.4 }));
        expect(url.origin + url.pathname).toBe('https://www.openstreetmap.org/export/embed.html');
        const [w, s, e, n] = url.searchParams.get('bbox')!.split(',').map(Number);
        expect(w).toBeLessThan(-58.4);
        expect(e).toBeGreaterThan(-58.4);
        expect(s).toBeLessThan(-34.5);
        expect(n).toBeGreaterThan(-34.5);
        expect((w + e) / 2).toBeCloseTo(-58.4, 6);
        expect((s + n) / 2).toBeCloseTo(-34.5, 6);
        expect(url.searchParams.get('marker')).toBe('-34.5,-58.4');
    });
});

describe('googleMapsUrl', () => {
    it('uses the same search URL the app already opens for addresses', () => {
        expect(googleMapsUrl({ lat: -34.5, lon: -58.4 })).toBe('https://www.google.com/maps/search/?api=1&query=-34.5%2C-58.4');
    });
});
