/**
 * Base64-encode an ArrayBuffer in linear time.
 *
 * The previous inline encoders did
 *   new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), '')
 * which builds a fresh, ever-growing string per byte — O(n²) — and can spike
 * an edge worker's memory/CPU on a multi-MB scraped image. This chunks the
 * bytes (32k at a time, under the String.fromCharCode argument cap), builds an
 * array, and joins + btoa's once. Edge-runtime safe (uses the global btoa).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000; // 32768
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
        parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
}
