import { Star } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface RatingBadgeProps {
    rating: number | string; // Supports '1'-'5' or 1-5
    size?: 'sm' | 'md' | 'lg';
}

export function RatingBadge({ rating, size = 'md' }: RatingBadgeProps) {
    const { t } = useLanguage();
    const numRating = Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    // Default to '5' styling if invalid or legacy "good" (though legacy should be handled elsewhere)
    // For this specific new UI, we assume we want to show *something* or nothing.
    if (!isValid) return null;

    // Unified Style: Always Emerald-50 background, Emerald-900 text.
    // Only the Label text changes, but the container style remains exactely the same.
    const config = {
        5: { label: t('ratings.excellent') },
        4: { label: t('ratings.good') },
        3: { label: t('ratings.average') },
        2: { label: t('ratings.poor') },
        1: { label: t('ratings.bad') },
    }[numRating] || { label: t('ratings.unknown') };

    const commonStyle = "bg-emerald-50 text-emerald-900 border border-emerald-100";

    const sizeClasses = {
        sm: { pad: 'px-2 py-0.5', text: 'text-xs', icon: 'w-3 h-3' },
        md: { pad: 'px-3 py-1', text: 'text-sm', icon: 'w-4 h-4' },
        lg: { pad: 'px-4 py-1.5', text: 'text-base', icon: 'w-5 h-5' },
    }[size];

    return (
        <div className={`inline-flex items-center gap-1.5 rounded-full font-bold shadow-sm ${commonStyle} ${sizeClasses.pad} ${sizeClasses.text}`}>
            <span>{numRating} - {config.label}</span>
            <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                        key={star}
                        className={`${sizeClasses.icon} ${star <= numRating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-100'}`}
                    />
                ))}
            </div>
        </div>
    );
}
