'use client';

import { useLanguage } from '@/context/LanguageContext';
import { getRatingColors } from '@/lib/ratingColors';

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

    // Color for filled stars — extract the raw color from Tailwind class
    const fillColorMap: Record<number, string> = {
        1: '#b91c1c', // red-700
        2: '#c2410c', // orange-700
        3: '#b45309', // amber-700
        4: '#4d7c0f', // lime-700
        5: '#15803d', // green-700
    };
    const fillColor = fillColorMap[clamped] || fillColorMap[3];

    const label = t(`ratings.${clamped}` as any) || '';

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
                                }`}
                            aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                className="w-full h-full"
                                fill={filled ? fillColor : 'none'}
                                stroke={filled ? fillColor : '#d1d5db'}
                                strokeWidth={filled ? 0 : 1.5}
                            >
                                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                            </svg>
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
