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

// Density flag shape — matches the existing AdopterFlags fields used by AdopterFlagging /
// AdminAdopterList. We accept a minimal subset since we only need count + actualSpanDays.
export interface DensityFlag {
    count: number;
    actualSpanDays?: number;
    periodDays: number;
}

interface AlertSpec {
    bodyKey: string;        // i18n path
    count: number;
    days: number;
}

function buildAlerts(
    recordType: RecordType,
    tooManyAdoptions: DensityFlag | null | undefined,
    tooManyRequests: DensityFlag | null | undefined,
): AlertSpec[] {
    if (recordType !== 'adoption' && recordType !== 'adoption_request') return [];
    const alerts: AlertSpec[] = [];
    // Order: adoptions first, then requests (per Q4 sign-off).
    if (tooManyAdoptions) {
        alerts.push({
            bodyKey: `wizard.guidance.alerts.too_many_adoptions.${recordType}`,
            count: tooManyAdoptions.count,
            // Use the actual densest window observed; fall back to the threshold window.
            days: tooManyAdoptions.actualSpanDays ?? tooManyAdoptions.periodDays,
        });
    }
    if (tooManyRequests) {
        alerts.push({
            bodyKey: `wizard.guidance.alerts.too_many_requests.${recordType}`,
            count: tooManyRequests.count,
            days: tooManyRequests.actualSpanDays ?? tooManyRequests.periodDays,
        });
    }
    return alerts;
}

function interpolateAlert(s: string, name: string, count: number, days: number): string {
    return s
        .replace(/\{name\}/g, name)
        .replace(/\{count\}/g, String(count))
        .replace(/\{days\}/g, String(days));
}

// Render an alert paragraph — supports newlines (split into lines) and **bold** tokens.
function renderAlert(text: string): React.ReactNode {
    return text.split('\n').map((line, i) => (
        <span key={i} className={i > 0 ? 'block mt-1' : 'block'}>
            {renderBody(line, '')}
        </span>
    ));
}

export default function RecordTypeGuidance({
    recordType,
    adopterName,
    avgRating,
    tooManyAdoptions = null,
    tooManyRequests = null,
    alertsAsCard = true,
}: {
    recordType: RecordType;
    adopterName: string;
    avgRating: number | null;
    /** Density flag — `null` when below threshold. */
    tooManyAdoptions?: DensityFlag | null;
    /** Density flag — `null` when below threshold. */
    tooManyRequests?: DensityFlag | null;
    /**
     * Layout for fired alerts:
     *   true  → each alert as its own warning card below the body
     *   false → alerts appended as additional paragraphs inside the body card
     * Driven by the WIZARD_ALERTS_AS_CARD admin feature flag (default true).
     */
    alertsAsCard?: boolean;
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

    const alerts = buildAlerts(recordType, tooManyAdoptions, tooManyRequests).map((a) => ({
        ...a,
        text: interpolateAlert(t(a.bodyKey), name, a.count, a.days),
    }));

    return (
        <>
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
                {/* Inline layout: append each alert as its own paragraph inside the body card. */}
                {!alertsAsCard && alerts.map((a, i) => (
                    <p key={i} className="text-sm text-stone-600 leading-relaxed mt-3">
                        {renderAlert(a.text)}
                    </p>
                ))}
            </div>
            {/* Card layout: each alert as its own warning card below the body. */}
            {alertsAsCard && alerts.map((a, i) => (
                <div
                    key={i}
                    className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 shadow-sm"
                    role="note"
                >
                    <span className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true">⚠</span>
                    <p className="text-sm text-amber-900 leading-relaxed">
                        {renderAlert(a.text)}
                    </p>
                </div>
            ))}
        </>
    );
}
