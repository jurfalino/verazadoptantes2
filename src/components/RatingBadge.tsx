'use client';

import { getRatingColors } from '@/lib/ratingColors';
import { getRatingLabelKey } from '@/domain/ratings';
import { useLanguage } from '@/context/LanguageContext';
import { StarIcon } from '@/components/StarIcon';

interface RatingBadgeProps {
    rating: number | string; // Supports '1'-'5' or 1-5 (including decimals like 4.2)
    size?: 'sm' | 'md' | 'lg';
    variant?: 'badge' | 'inline'; // badge = colored pill with number, inline = compact ⭐ + number
    /** none = the number only (default); short = «★ 4.0 · Bueno». One label set everywhere (audit B1). */
    label?: 'none' | 'short';
}

/**
 * The rating, one way everywhere (audit B1): «★ 4.0 · Bueno» — the star, the
 * number, a «·» and the short word, as a pill (`badge`: the profile header,
 * lists) or inline (`inline`: a household row, a card's household line, the
 * picker). Colour is never the only signal: the word is always there when a
 * label is asked for.
 */

export function RatingBadge({ rating, size = 'md', variant = 'badge', label = 'none' }: RatingBadgeProps) {
    const { t } = useLanguage();
    const numRating = Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    if (!isValid) return null;

    const colors = getRatingColors(numRating);
    const display = numRating % 1 !== 0 ? numRating.toFixed(1) : `${numRating}.0`;

    const labelKey = getRatingLabelKey(numRating);
    const labelText = label === 'short' ? (t(`ratings.${labelKey}` as any) || '') : ''; // "Peligroso"
    const labelEl = labelText ? <span className="ml-0.5 whitespace-nowrap"><span aria-hidden="true">·</span> {labelText}</span> : null;

    if (variant === 'inline') {
        const inlineSizes = {
            sm: 'text-xs',
            md: 'text-sm',
            lg: 'text-base',
        }[size];
        return (
            <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-semibold ${colors.text} ${inlineSizes}`}>
                <StarIcon className="w-[1em] h-[1em]" /><span>{display}</span>
                {labelEl}
            </span>
        );
    }

    const sizeClasses = {
        sm: { pad: 'px-2 py-0.5', text: 'text-xs' },
        md: { pad: 'px-3 py-1', text: 'text-sm' },
        lg: { pad: 'px-4 py-1.5', text: 'text-base' },
    }[size];

    return (
        <div data-testid="rating-value" className={`inline-flex items-center gap-1 rounded-full font-semibold shadow-sm ${colors.bg} ${colors.text} ${colors.border} border ${sizeClasses.pad} ${sizeClasses.text}`}>
            <StarIcon className="w-[1em] h-[1em]" /><span>{display}</span>
            {labelEl}
        </div>
    );
}
