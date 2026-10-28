'use client';

import { getRatingColors } from '@/lib/ratingColors';
import { getRatingLabelKey } from '@/domain/ratings';
import { useLanguage } from '@/context/LanguageContext';
import { StarIcon } from '@/components/StarIcon';

/**
 * The pill's box: AlertPill `sm`'s box exactly (padding, 11px semibold, full
 * radius, 1px border, 12px icon) with the line-height pinned, so a rating and
 * an alert in one row are the same height whatever the parent's font
 * (Jon, 2026-10-28: «the rating for the main profile and the rating for
 * household members is displayed quite differently.. why?»).
 */
export const PILL_BOX = 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] leading-4 rounded-full border font-semibold whitespace-nowrap';

/**
 * A rating, ONE look everywhere: the pill «★ 4.0 · Bueno» — the star, the
 * number, a «·» and the short word, in the rating's colour (colour is never
 * the only signal). No rating (null, 0, anything outside 1–5): the neutral
 * pill «Sin calificación». No size or variant: a second look is not possible.
 *
 * Used for a person's rating (profile header, household rows, cards, the
 * picker, lists, applicants, form results, interview cards) and for one
 * record's own rating (the activity timeline, /my-adoptions). Callers that
 * show nothing for an unrated RECORD guard before rendering.
 */
export function RatingBadge({ rating }: { rating: number | string | null | undefined }) {
    const { t } = useLanguage();
    const numRating = rating == null || rating === '' ? NaN : Number(rating);
    const isValid = !isNaN(numRating) && numRating >= 1 && numRating <= 5;

    if (!isValid) {
        return (
            <span data-testid="person-unrated" className={`${PILL_BOX} bg-stone-50 text-stone-500 border-stone-200`}>
                {t('adopter.hh_link_unrated')}
            </span>
        );
    }

    const colors = getRatingColors(numRating);
    const display = numRating % 1 !== 0 ? numRating.toFixed(1) : `${numRating}.0`;
    const labelText = t(`ratings.${getRatingLabelKey(numRating)}` as any) || ''; // "Peligroso"

    return (
        <span data-testid="rating-value" className={`${PILL_BOX} ${colors.bg} ${colors.text} ${colors.border}`}>
            <StarIcon className="w-3 h-3 shrink-0" /><span>{display}</span>
            {labelText && <span className="ml-0.5"><span aria-hidden="true">·</span> {labelText}</span>}
        </span>
    );
}
