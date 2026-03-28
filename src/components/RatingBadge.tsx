
import { getRatingColors } from '@/lib/ratingColors';

interface RatingBadgeProps {
    rating: number | string; // Supports '1'-'5' or 1-5 (including decimals like 4.2)
    size?: 'sm' | 'md' | 'lg';
    variant?: 'badge' | 'inline'; // badge = colored pill with number, inline = compact ⭐ + number
}

export function RatingBadge({ rating, size = 'md', variant = 'badge' }: RatingBadgeProps) {
    const numRating = Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    if (!isValid) return null;

    const colors = getRatingColors(numRating);
    const display = numRating % 1 !== 0 ? numRating.toFixed(1) : `${numRating}.0`;

    if (variant === 'inline') {
        const inlineSizes = {
            sm: 'text-xs',
            md: 'text-sm',
            lg: 'text-base',
        }[size];
        return (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${colors.text} ${inlineSizes}`}>
                <span>⭐</span>{display}
            </span>
        );
    }

    const sizeClasses = {
        sm: { pad: 'px-2 py-0.5', text: 'text-xs' },
        md: { pad: 'px-3 py-1', text: 'text-sm' },
        lg: { pad: 'px-4 py-1.5', text: 'text-base' },
    }[size];

    return (
        <div className={`inline-flex items-center gap-1 rounded-full font-semibold shadow-sm ${colors.bg} ${colors.text} ${colors.border} border ${sizeClasses.pad} ${sizeClasses.text}`}>
            <span>⭐</span><span>{display}</span>
        </div>
    );
}

