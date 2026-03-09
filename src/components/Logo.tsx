'use client';

import Link from 'next/link';

export function ShieldPawIcon({ className = "w-8 h-8" }: { className?: string }) {
    return (
        <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
            <path
                d="M256 38 C256 38 432 100 432 100 C432 100 432 270 432 270 C432 362 354 432 256 478 C158 432 80 362 80 270 C80 270 80 100 80 100 C80 100 256 38 256 38 Z"
                fill="var(--brand)"
            />
            <ellipse cx="256" cy="310" rx="52" ry="46" fill="#ffffff" />
            <ellipse cx="198" cy="238" rx="28" ry="34" fill="#ffffff" transform="rotate(-12 198 238)" />
            <ellipse cx="314" cy="238" rx="28" ry="34" fill="#ffffff" transform="rotate(12 314 238)" />
            <ellipse cx="158" cy="278" rx="22" ry="28" fill="#ffffff" transform="rotate(-28 158 278)" />
            <ellipse cx="354" cy="278" rx="22" ry="28" fill="#ffffff" transform="rotate(28 354 278)" />
        </svg>
    );
}

export function Logo() {
    return (
        <Link href="/" className="font-semibold text-xl text-teal-800 tracking-tight flex items-center gap-2">
            <ShieldPawIcon className="w-8 h-8" />
            <span className="hidden sm:inline">Buen Adoptante</span>
        </Link>
    );
}
