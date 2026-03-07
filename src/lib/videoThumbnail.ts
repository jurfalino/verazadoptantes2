'use client';

/**
 * Core: draw a video frame onto a canvas and return a JPEG data URL.
 */
function captureFrame(video: HTMLVideoElement): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed');

    // Scale to max 400px on longest side
    const maxSize = 400;
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
        if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
    } else {
        if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
    }

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.7);
}

/**
 * Extract a thumbnail frame from a local video File.
 */
export function extractVideoThumbnail(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);

        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 10000);

        function cleanup() {
            clearTimeout(timeout);
            URL.revokeObjectURL(url);
            video.removeAttribute('src');
            video.load();
        }

        video.onloadedmetadata = () => {
            video.currentTime = Math.min(1, video.duration * 0.25);
        };

        video.onseeked = () => {
            try { const dataUrl = captureFrame(video); cleanup(); resolve(dataUrl); }
            catch (e) { cleanup(); reject(e); }
        };

        video.onerror = () => { cleanup(); reject(new Error('Video failed to load')); };
        video.src = url;
    });
}

/**
 * Extract a thumbnail from a remote video URL.
 * For cross-origin videos, pass them through the proxy first:
 *   extractVideoThumbnailFromUrl(`/api/proxy-image?url=${encodeURIComponent(remoteUrl)}`)
 */
export function extractVideoThumbnailFromUrl(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');

        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';

        const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 15000);

        function cleanup() {
            clearTimeout(timeout);
            video.removeAttribute('src');
            video.load();
        }

        video.onloadedmetadata = () => {
            video.currentTime = Math.min(1, video.duration * 0.25);
        };

        video.onseeked = () => {
            try { const dataUrl = captureFrame(video); cleanup(); resolve(dataUrl); }
            catch (e) { cleanup(); reject(e); }
        };

        video.onerror = () => { cleanup(); reject(new Error('Video URL failed to load')); };
        video.src = videoUrl;
    });
}

