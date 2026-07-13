'use client';
import { useLanguage } from '@/context/LanguageContext';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import type { MetricCardData } from '@/app/actions/metrics';

export function MetricCard({ card, loading }: { card: MetricCardData; loading: boolean }) {
    const { t } = useLanguage();
    // Arrow is purely directional; color conveys good/bad relative to whether
    // this metric is "higher is better" (usage) or "lower is better" (errors).
    const isGood = card.trend.dir !== 'flat' && (card.trend.dir === 'up') === card.higherIsBetter;
    const trendColor = card.trend.dir === 'flat' ? 'text-stone-500' : isGood ? 'text-emerald-600' : 'text-rose-600';
    const arrow = card.trend.dir === 'up' ? '▲' : card.trend.dir === 'down' ? '▼' : '—';
    const unavailable = card.series === null;
    return (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2.5" aria-busy={loading}>
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-[12.5px] text-stone-600 font-medium">{t(card.labelKey)}</div>
                    <div className="text-2xl font-semibold text-stone-900 leading-none mt-1">{unavailable ? '—' : card.total}</div>
                </div>
                {!unavailable && card.trend.pct !== null && (
                    <span className={`text-xs font-semibold ${trendColor}`}>{arrow} {Math.abs(card.trend.pct)}%</span>
                )}
            </div>
            {unavailable ? (
                <p className="text-xs text-stone-400 py-4">{t('admin.metric_unavailable')}</p>
            ) : card.chart === 'line' ? (
                <LineChart points={card.series!} />
            ) : (
                <BarChart points={card.series!} />
            )}
            <div className="flex justify-between items-center text-[11px] text-stone-500">
                <span>{t(`admin.metric_${card.key}_sub`)}</span>
                {card.deepLink && <a href={card.deepLink} target="_blank" rel="noopener noreferrer" className="text-teal-700 font-medium">{t('admin.metric_view_axiom')} →</a>}
            </div>
        </div>
    );
}
