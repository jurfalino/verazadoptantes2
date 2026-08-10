'use client';

import { useLanguage } from '@/context/LanguageContext';
import { getRatingColors } from '@/lib/ratingColors';
import { getRatingLabelKey } from '@/domain/ratings';
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
    const numValue = Math.round(Number(value) || 0);
    const clamped = Math.max(1, Math.min(5, numValue));
    const colors = getRatingColors(clamped);
    const config = sizeConfig[size];

    // We use the text color from getRatingColors to fill the stars for consistency

    const labelKey = getRatingLabelKey(clamped);
    const label = t(`ratings.${labelKey}` as any) || '';

    return (
        <div className={`inline-flex items-center ${config.gap}`}>
            <div className={`flex items-center ${config.gap}`}>
                {[1, 2, 3, 4, 5].map((star) => {
                    const filled = star <= clamped;
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
