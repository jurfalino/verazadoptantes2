/**
 * Map links for a device-reported position (the adoption form's "Ubicación
 * verificada": the applicant's browser geolocation, stored as two strings).
 *
 * The embed is OpenStreetMap's own — no API key, no library, and allowed by a
 * single `frame-src` entry in next.config.ts. "Open" goes to Google Maps, the
 * same search URL the app already uses for addresses (ContactEntriesDisplay).
 */

export interface Coords {
    lat: number;
    lon: number;
}

/** Null unless both values are finite and inside the valid lat/lon range. */
export function parseCoords(latitude: string | null | undefined, longitude: string | null | undefined): Coords | null {
    if (!latitude?.trim() || !longitude?.trim()) return null;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
}

/** Half-size of the embedded box, in degrees: roughly six blocks across. */
const HALF_LAT = 0.004;
const HALF_LON = 0.006;

export function osmEmbedUrl({ lat, lon }: Coords): string {
    const bbox = [lon - HALF_LON, lat - HALF_LAT, lon + HALF_LON, lat + HALF_LAT].join(',');
    const params = new URLSearchParams({ bbox, layer: 'mapnik', marker: `${lat},${lon}` });
    return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

export function googleMapsUrl({ lat, lon }: Coords): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}
