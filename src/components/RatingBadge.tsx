'use client';

import { getRatingColors } from '@/lib/ratingColors';
import { getRatingLabelKey } from '@/domain/ratings';
import { useLanguage } from '@/context/LanguageContext';

interface RatingBadgeProps {
    rating: number | string; // Supports '1'-'5' or 1-5 (including decimals like 4.2)
    size?: 'sm' | 'md' | 'lg';
    variant?: 'badge' | 'inline'; // badge = colored pill with number, inline = compact ⭐ + number
    label?: 'none' | 'short' | 'search'; // none = no label (default), short = "Bueno", search = "Buen Adoptante"
}

export function RatingBadge({ rating, size = 'md', variant = 'badge', label = 'none' }: RatingBadgeProps) {
    const { t } = useLanguage();
    const numRating = Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    if (!isValid) return null;

    const colors = getRatingColors(numRating);
    const display = numRating % 1 !== 0 ? numRating.toFixed(1) : `${numRating}.0`;

    const labelKey = getRatingLabelKey(numRating);
    const shortText = (t(`ratings.${labelKey}` as any) || '');             // "Peligroso"
    const searchText = (t(`ratings.search_label.${labelKey}` as any) || ''); // "Adoptante Peligroso"
    const labelText =
        label === 'short' ? shortText
        : label === 'search' ? searchText
        : '';

    if (variant === 'inline') {
        const inlineSizes = {
            sm: 'text-xs',
            md: 'text-sm',
            lg: 'text-base',
        }[size];
        return (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${colors.text} ${inlineSizes}`}>
                <span>⭐</span><span>{display}</span>
                {labelText && <span className="ml-1">{labelText}</span>}
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
            {label === 'search' ? (
                // Mobile: the short adjective ("Peligroso") so the name keeps room;
                // ≥sm: the full label ("Adoptante Peligroso").
                <span className="ml-0.5 whitespace-nowrap">· <span className="sm:hidden">{shortText}</span><span className="hidden sm:inline">{searchText}</span></span>
            ) : labelText ? (
                <span className="ml-0.5">· {labelText}</span>
            ) : null}
        </div>
    );
}
