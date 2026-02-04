
import { useLanguage } from '@/context/LanguageContext';

interface RatingBadgeProps {
    rating: number | string; // Supports '1'-'5' or 1-5
    size?: 'sm' | 'md' | 'lg';
}

export function RatingBadge({ rating, size = 'md' }: RatingBadgeProps) {
    const { t } = useLanguage();

    // Rating is always 1-5 (numeric string)
    const numRating = Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    if (!isValid) return null;

    // Unified Style: Always Emerald-50 background, Emerald-900 text.
    // Only the Label text changes, but the container style remains exactely the same.
    const label = t(`ratings.${numRating}` as any) || t('ratings.unknown');

    const commonStyle = "bg-emerald-50 text-emerald-900 border border-emerald-100";

    const sizeClasses = {
        sm: { pad: 'px-2 py-0.5', text: 'text-xs', icon: 'w-3 h-3' },
        md: { pad: 'px-3 py-1', text: 'text-sm', icon: 'w-4 h-4' },
        lg: { pad: 'px-4 py-1.5', text: 'text-base', icon: 'w-5 h-5' },
    }[size];

    return (
        <div className={`inline-flex items-center gap-1.5 rounded-full font-bold shadow-sm ${commonStyle} ${sizeClasses.pad} ${sizeClasses.text}`}>
            <span>{label}</span>
        </div>
    );
}
