/**
 * The single rating-star glyph for the whole app. Replaces the mix of `⭐`
 * (emoji — renders differently per OS and can't take the rating color) and `★`
 * (unicode) that used to be scattered across display surfaces. This is the exact
 * SVG the rating INPUT (`StarRating`) already used, so "set" and "display" now
 * match. Colors via `currentColor` (inherit the rating's red→green text color);
 * size via `className` (e.g. `w-4 h-4` or `w-[1em] h-[1em]`).
 */
export function StarIcon({ className = '', filled = true }: { className?: string; filled?: boolean }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill={filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={filled ? 0 : 1.5}
            aria-hidden="true"
        >
            <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
    );
}
