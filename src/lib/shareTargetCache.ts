/**
 * Client-side: the photos shared to the app from the phone's share sheet.
 * public/sw.js stores them in the `share-target-media` cache as
 * `/share-target-image-<i>`; reading them EMPTIES that cache (the person
 * import does the same in ImportWizard.loadSharedImages).
 */
export const SHARE_CACHE = 'share-target-media';

export async function takeSharedImages(): Promise<Array<{ data: string; mimeType: string }>> {
    if (typeof caches === 'undefined') return [];
    const cache = await caches.open(SHARE_CACHE);
    const keys = (await cache.keys()).filter(r => new URL(r.url).pathname.startsWith('/share-target-image-'));
    const out: Array<{ data: string; mimeType: string }> = [];
    for (const request of keys) {
        const response = await cache.match(request);
        if (!response) continue;
        const blob = await response.blob();
        const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        if (data) out.push({ data, mimeType: blob.type || 'image/jpeg' });
    }
    for (const request of keys) await cache.delete(request);
    return out;
}
