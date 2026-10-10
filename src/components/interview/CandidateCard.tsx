'use client';
import { useLanguage } from '@/context/LanguageContext';
import { RatingBadge } from '@/components/RatingBadge';
import type { CandidateSummary } from '@/domain/interview/types';

export default function CandidateCard({ c, selected = false, onSelect, selectLabel, badge }: {
    c: CandidateSummary;
    selected?: boolean;
    onSelect?: () => void;
    selectLabel?: string;
    badge?: string;
}) {
    const { t } = useLanguage();
    return (
        <div data-testid="interview-candidate" className={`rounded-xl border p-3 bg-white ${selected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-stone-200'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 break-words">{c.displayName}</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                        {c.relevancePercent > 0 && <span>{c.relevancePercent}% · </span>}
                        {t('interview.adoptions_count').replace('{n}', String(c.adoptionCount))}
                    </p>
                    {badge && <span className="mt-1 inline-flex text-[11px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-800">{badge}</span>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {c.avgRating != null && <RatingBadge rating={c.avgRating} size="sm" />}
                    <a href={`/adopter/${c.adopterId}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-teal-700 hover:underline">
                        {t('interview.view_profile')}
                    </a>
                </div>
            </div>
            {onSelect && (
                <button type="button" onClick={onSelect} aria-pressed={selected}
                    className={`mt-2 w-full px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${selected ? 'bg-teal-700 text-white' : 'text-teal-700 bg-teal-50 hover:bg-teal-100'}`}>
                    {selectLabel}
                </button>
            )}
        </div>
    );
}
