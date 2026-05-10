'use client';

import { useLanguage } from '@/context/LanguageContext';
import { getRecordTypeColors, type RecordType } from '@/lib/recordTypeColors';

const TYPE_META: Record<RecordType, { icon: string; labelKey: string }> = {
    adoption: { icon: '🏠', labelKey: 'adoption.type_adoption' },
    adoption_request: { icon: '📝', labelKey: 'adoption.type_request' },
    observation: { icon: '👁️', labelKey: 'adoption.type_observation' },
    follow_up: { icon: '📞', labelKey: 'adoption.type_followup' },
    returned_pet: { icon: '↩️', labelKey: 'adoption.type_returned' },
};

type RatingBucket = 'none' | '1' | '2' | '3' | '4_5';

function ratingBucket(avg: number | null | undefined): RatingBucket {
    if (avg === null || avg === undefined || avg <= 0) return 'none';
    const r = Math.round(avg);
    if (r <= 1) return '1';
    if (r === 2) return '2';
    if (r === 3) return '3';
    return '4_5';
}

function needsRatingVariant(rt: RecordType): boolean {
    return rt === 'adoption' || rt === 'adoption_request';
}

function scrollToHistory() {
    document.getElementById('adoption-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Parse a body string into React nodes, handling **bold** and {historyLink}…{/historyLink} tokens.
function renderBody(body: string, historyLinkLabel: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    const pattern = /\*\*([^*]+)\*\*|\{historyLink\}([\s\S]*?)\{\/historyLink\}/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(body)) !== null) {
        if (m.index > cursor) nodes.push(body.slice(cursor, m.index));
        if (m[1] !== undefined) {
            nodes.push(<strong key={key++} className="font-semibold text-stone-900">{m[1]}</strong>);
        } else if (m[2] !== undefined) {
            nodes.push(
                <button
                    key={key++}
                    type="button"
                    onClick={scrollToHistory}
                    className="text-teal-700 hover:text-teal-800 underline underline-offset-2 font-medium"
                >
                    {m[2] || historyLinkLabel}
                </button>
            );
        }
        cursor = m.index + m[0].length;
    }
    if (cursor < body.length) nodes.push(body.slice(cursor));
    return nodes;
}

export default function RecordTypeGuidance({
    recordType,
    adopterName,
    avgRating,
}: {
    recordType: RecordType;
    adopterName: string;
    avgRating: number | null;
}) {
    const { t, locale } = useLanguage();
    const name = adopterName?.trim() || (locale === 'en' ? 'this person' : 'esta persona');
    const bucket = ratingBucket(avgRating);

    const titleRaw = t(`wizard.guidance.${recordType}.title`);
    const bodyKey = needsRatingVariant(recordType)
        ? `wizard.guidance.${recordType}.body.${bucket}`
        : `wizard.guidance.${recordType}.body`;
    const bodyRaw = t(bodyKey);

    const interpolate = (s: string) => s.replace(/\{name\}/g, name);
    const title = interpolate(titleRaw);
    const body = interpolate(bodyRaw);

    const colors = getRecordTypeColors(recordType);
    const meta = TYPE_META[recordType];
    const chipLabel = t(meta.labelKey);

    return (
        <div className="bg-white border border-teal-100 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-stone-900 leading-snug flex-1">
                    {title}
                </h3>
                <div
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border whitespace-nowrap ${colors.bg} ${colors.border} ${colors.text}`}
                    aria-label={chipLabel}
                >
                    <span aria-hidden="true">{meta.icon}</span>
                    <span>{chipLabel}</span>
                </div>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">
                {renderBody(body, '')}
            </p>
        </div>
    );
}
