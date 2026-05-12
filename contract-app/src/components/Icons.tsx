/**
 * Inline SVG icons for showcase/empty/error states.
 *
 * Inline (not external files) so they pick up `color: currentColor` from
 * the surrounding text and integrate with the design tokens. All sized
 * via the `size` prop and styleable through CSS color.
 */

interface IconProps {
    size?: number
    className?: string
}

/** Paw — empty-state marker for animal placeholders & catalogs */
export function PawIcon({ size = 56, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 64 64"
            fill="currentColor"
            aria-hidden="true"
            className={className}
        >
            {/* 4 toes (back row + main pads + front toes) + central palm */}
            <ellipse cx="20" cy="20" rx="5" ry="7" />
            <ellipse cx="32" cy="14" rx="5" ry="7" />
            <ellipse cx="44" cy="20" rx="5" ry="7" />
            <ellipse cx="52" cy="34" rx="4.5" ry="6" />
            <ellipse cx="12" cy="34" rx="4.5" ry="6" />
            <path d="M32 28c-8 0-14 7-14 14 0 5 5 9 14 9s14-4 14-9c0-7-6-14-14-14z" />
        </svg>
    )
}

/** Alert — error / "we couldn't load this" state */
export function AlertIcon({ size = 56, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={className}
        >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    )
}
