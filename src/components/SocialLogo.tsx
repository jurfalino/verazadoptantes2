import type { SocialPlatform } from '@/lib/contactEntries';

/**
 * Brand logo for a social network, as inline SVG (CSP blocks external images;
 * we favor inline SVG over emoji per the design system). Facebook + Instagram
 * carry their brand color; TikTok/X/Threads/Other use `currentColor` so they
 * invert correctly in dark mode. The Instagram gradient id is shared across
 * instances on purpose — every instance wants the identical gradient.
 */
export function SocialLogo({ platform, size = 18, className }: { platform: SocialPlatform; size?: number; className?: string }) {
    const p = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const };
    switch (platform) {
        case 'facebook':
            return (
                <svg {...p} fill="#1877F2">
                    <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.49 0-1.96.93-1.96 1.88v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07" />
                </svg>
            );
        case 'instagram':
            return (
                <svg {...p}>
                    <defs>
                        <linearGradient id="socialLogoIg" x1="0" y1="1" x2="1" y2="0">
                            <stop offset="0" stopColor="#feda75" />
                            <stop offset="0.45" stopColor="#d62976" />
                            <stop offset="1" stopColor="#4f5bd5" />
                        </linearGradient>
                    </defs>
                    <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#socialLogoIg)" />
                    <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="3.2" fill="none" stroke="#fff" strokeWidth="1.7" />
                    <circle cx="12" cy="12" r="2.7" fill="none" stroke="#fff" strokeWidth="1.7" />
                    <circle cx="16.4" cy="7.7" r="1.05" fill="#fff" />
                </svg>
            );
        case 'tiktok':
            return (
                <svg {...p} fill="currentColor">
                    <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.2v12.9a2.46 2.46 0 1 1-1.94-2.4V10.2a5.66 5.66 0 1 0 4.94 5.61V8.9a7.5 7.5 0 0 0 4.32 1.38V7.08a4.3 4.3 0 0 1-3.06-1.26z" />
                </svg>
            );
        case 'x':
            return (
                <svg {...p} fill="currentColor">
                    <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zM17.6 20.64h2.04L6.49 3.24H4.3z" />
                </svg>
            );
        case 'threads':
            return (
                <svg {...p} fill="currentColor">
                    <path d="M12.19 24h-.01c-3.58-.02-6.33-1.2-8.18-3.51C2.35 18.44 1.5 15.59 1.47 12.01v-.02c.03-3.58.88-6.43 2.53-8.48C5.85 1.2 8.6.02 12.18 0h.01c2.75.02 5.04.73 6.83 2.1 1.68 1.29 2.86 3.13 3.51 5.47l-2.04.57c-1.1-3.96-3.9-5.98-8.3-6.01-2.91.02-5.11.94-6.54 2.72C4.31 6.5 3.62 8.91 3.59 12c.03 3.09.72 5.5 2.06 7.17 1.43 1.78 3.63 2.7 6.54 2.72 2.62-.02 4.36-.63 5.8-2.05 1.65-1.61 1.62-3.59 1.09-4.8-.31-.71-.87-1.3-1.63-1.75-.19 1.35-.62 2.45-1.28 3.27-.89 1.1-2.14 1.7-3.73 1.79-1.2.07-2.36-.22-3.26-.8-1.06-.69-1.68-1.74-1.75-2.96-.07-1.19.41-2.29 1.33-3.08.88-.76 2.12-1.21 3.58-1.29a13.9 13.9 0 0 1 3.02.14c-.13-.74-.38-1.33-.75-1.76-.51-.59-1.31-.88-2.36-.89h-.03c-.84 0-1.99.23-2.72 1.32L7.73 7.85c.98-1.45 2.61-2.23 4.59-2.23h.03c3.3.02 5.26 2.04 5.46 5.56.11.05.22.1.33.15 1.55.73 2.68 1.83 3.28 3.19.83 1.88.9 4.96-1.6 7.41-1.92 1.88-4.24 2.72-7.53 2.74z" />
                </svg>
            );
        default: // 'other'
            return (
                <svg {...p} fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.6" />
                    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.6" />
                </svg>
            );
    }
}
