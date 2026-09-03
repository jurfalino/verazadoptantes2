import type { MessagingApp } from '@/lib/contactEntries';

/**
 * Brand logo for a phone messaging app (WhatsApp / Telegram), as inline SVG
 * (CSP blocks external images; inline SVG over emoji per the design system).
 */
export function MessagingLogo({ app, size = 18, className }: { app: MessagingApp; size?: number; className?: string }) {
    const p = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true as const };
    if (app === 'whatsapp') {
        return (
            <svg {...p}>
                <circle cx="12" cy="12" r="11" fill="#25D366" />
                <path d="M12 5.5a6.4 6.4 0 0 0-5.5 9.7L5.7 18l2.9-.8A6.4 6.4 0 1 0 12 5.5zm3.6 8.9c-.15.42-.87.8-1.2.85-.31.05-.7.07-1.13-.07-.26-.08-.6-.19-1.03-.37-1.8-.78-2.98-2.6-3.07-2.72-.09-.12-.73-.97-.73-1.85s.46-1.31.63-1.49c.16-.18.36-.22.48-.22h.34c.11 0 .26-.04.4.31.15.36.5 1.24.54 1.33.04.09.07.2.01.31-.06.12-.09.19-.18.29l-.27.31c-.09.09-.18.19-.08.37.1.18.44.73.95 1.18.65.58 1.2.76 1.38.85.18.09.28.08.39-.05.11-.12.44-.51.56-.69.12-.18.24-.15.4-.09.16.06 1.03.49 1.2.58.18.09.3.13.34.2.04.08.04.42-.11.84z" fill="#fff" />
            </svg>
        );
    }
    return (
        <svg {...p}>
            <circle cx="12" cy="12" r="11" fill="#26A5E4" />
            <path d="M5.5 11.7l11-4.25c.5-.18.94.12.78.9l-1.87 8.8c-.13.6-.5.75-1 .47l-2.75-2.03-1.33 1.28c-.15.15-.27.27-.55.27l.2-2.8 5.1-4.6c.22-.2-.05-.3-.34-.11l-6.3 3.97-2.72-.85c-.6-.18-.6-.6.13-.9z" fill="#fff" />
        </svg>
    );
}
