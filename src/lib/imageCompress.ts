/**
 * Client-side image compression — max 1200px, JPEG q0.8.
 *
 * Extracted (v2.56.9) from the copy in /my-animals/new so the animal page's
 * event modal doesn't add a third one. Cellular-network friendliness is a
 * product requirement here: photos are taken in the field on phones.
 * (AdoptionFormWizard keeps its own variant — it also extracts video
 * thumbnails; folding those together is a separate change.)
 */
export function compressImage(file: File, maxSize = 1200, quality = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('Canvas context failed')); return; }
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
                } else {
                    if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
                }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}
