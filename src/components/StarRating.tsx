'use client';

import { useLanguage } from '@/context/LanguageContext';
import { getRatingColors } from '@/lib/ratingColors';
import { getRatingLabelKey, getRatingDisplayLevel } from '@/domain/ratings';
import { StarIcon } from '@/components/StarIcon';

interface StarRatingProps {
    value: number;
    onChange?: (value: number) => void;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
}

const sizeConfig = {
    sm: { star: 'w-4 h-4', gap: 'gap-0.5', text: 'text-xs' },
    md: { star: 'w-6 h-6', gap: 'gap-1', text: 'text-sm' },
    lg: { star: 'w-8 h-8', gap: 'gap-1.5', text: 'text-base' },
};

export function StarRating({ value, onChange, size = 'md', showLabel = false }: StarRatingProps) {
    const { t } = useLanguage();
    const interactive = !!onChange;
    // 0 = not rated yet: five empty stars, no label (never clamp up to level 1).
    const level = getRatingDisplayLevel(value);
    const colors = getRatingColors(Math.max(1, level));
    const config = sizeConfig[size];

    // We use the text color from getRatingColors to fill the stars for consistency

    const label = level === 0 ? '' : (t(`ratings.${getRatingLabelKey(level)}` as any) || '');

    return (
        <div className={`inline-flex items-center ${config.gap}`}>
            <div className={`flex items-center ${config.gap}`}>
                {[1, 2, 3, 4, 5].map((star) => {
                    const filled = star <= level;
                    return (
                        <button
                            key={star}
                            type="button"
                            disabled={!interactive}
                            onClick={() => onChange?.(star)}
                            className={`${config.star} flex-shrink-0 transition-all ${interactive
                                    ? 'cursor-pointer hover:scale-110 active:scale-95'
                                    : 'cursor-default'
                                } ${filled ? colors.text : 'text-stone-300'}`}
                            aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        >
                            <StarIcon className="w-full h-full" filled={filled} />
                        </button>
                    );
                })}
            </div>
            {showLabel && label && (
                <span className={`${config.text} font-semibold ${colors.text} ml-1`}>
                    {label}
                </span>
            )}
        </div>
    );
}
