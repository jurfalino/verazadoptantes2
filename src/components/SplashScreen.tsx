'use client';

import { useEffect, useState } from 'react';

/**
 * Browser first-paint splash. The OS PWA splash only covers the *installed*
 * app's cold start; in a normal browser tab there's a brief blank/unstyled
 * flash before React hydrates. This overlay is server-rendered (so it's in the
 * very first paint) — a brand-teal screen with the white shield-paw logo, the
 * wordmark, and a subtle pulse — then fades out as soon as the app hydrates.
 * Matches the iOS launch image (scripts/gen-splash.js) for a consistent look.
 */
export default function SplashScreen() {
    const [visible, setVisible] = useState(true);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        // Hydrated → reveal the app. rAF ensures the browser painted the splash
        // at least once before we start fading, so it never flickers.
        const raf = requestAnimationFrame(() => setVisible(false));
        return () => cancelAnimationFrame(raf);
    }, []);

    if (gone) return null;

    return (
        <div
            aria-hidden="true"
            onTransitionEnd={() => { if (!visible) setGone(true); }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: '#0f766e',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '18px',
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? 'auto' : 'none',
                transition: 'opacity 350ms ease',
                // JS-less backstop: if hydration never runs (JS error/disabled),
                // auto-hide after 4s so the overlay can't permanently mask the page.
                animation: 'ba-splash-fail 400ms ease 4000ms forwards',
            }}
        >
            <style>{`
                @keyframes ba-splash-fail { to { opacity:0; visibility:hidden; pointer-events:none } }
                @keyframes ba-splash-pulse { 0%,80%,100%{opacity:.25;transform:scale(.85)} 40%{opacity:1;transform:scale(1)} }
                .ba-splash-dot{ width:8px;height:8px;border-radius:50%;background:#fff;opacity:.35;animation:ba-splash-pulse 1s infinite ease-in-out }
                .ba-splash-dot:nth-child(2){ animation-delay:.15s }
                .ba-splash-dot:nth-child(3){ animation-delay:.3s }
                @media (prefers-reduced-motion: reduce){ .ba-splash-dot{ animation:none;opacity:.6 } }
            `}</style>
            <svg width="88" height="88" viewBox="0 0 512 512" aria-hidden="true">
                <path d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z" fill="#ffffff" />
                <ellipse cx="256" cy="310" rx="52" ry="46" fill="#0f766e" />
                <ellipse cx="198" cy="238" rx="28" ry="34" fill="#0f766e" transform="rotate(-12 198 238)" />
                <ellipse cx="314" cy="238" rx="28" ry="34" fill="#0f766e" transform="rotate(12 314 238)" />
                <ellipse cx="158" cy="278" rx="22" ry="28" fill="#0f766e" transform="rotate(-28 158 278)" />
                <ellipse cx="354" cy="278" rx="22" ry="28" fill="#0f766e" transform="rotate(28 354 278)" />
            </svg>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: '18px', letterSpacing: '-0.01em' }}>Buen Adoptante</div>
            <div style={{ display: 'flex', gap: '5px', marginTop: '4px' }}>
                <span className="ba-splash-dot" /><span className="ba-splash-dot" /><span className="ba-splash-dot" />
            </div>
        </div>
    );
}
