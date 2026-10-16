/**
 * A photo from the phone, shrunk and re-encoded as JPEG (≤1600 px, quality 0.8):
 * the server keeps PNG / JPEG / WebP up to 5 MB, and phones hand over 10 MB
 * photos and HEIC files. Rejects with 'not-image' / 'unreadable'.
 */
export function shrinkImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) { reject(new Error('not-image')); return }
        const reader = new FileReader()
        reader.onload = () => {
            const img = new Image()
            img.onload = () => {
                const max = 1600
                let w = img.width, h = img.height
                if (w > max || h > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k) }
                const canvas = document.createElement('canvas')
                canvas.width = w; canvas.height = h
                const ctx = canvas.getContext('2d')
                if (!ctx) { reject(new Error('unreadable')); return }
                ctx.drawImage(img, 0, 0, w, h)
                resolve(canvas.toDataURL('image/jpeg', 0.8))
            }
            // A format this browser can't decode (e.g. HEIC outside Safari).
            img.onerror = () => reject(new Error('unreadable'))
            img.src = reader.result as string
        }
        reader.onerror = () => reject(new Error('unreadable'))
        reader.readAsDataURL(file)
    })
}
