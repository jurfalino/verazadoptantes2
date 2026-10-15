'use client';

/**
 * «Where did this come from» tag on the profile and its activities
 * (ENABLE_ORIGIN_LABELS). Same look and words as the origin pill Mis
 * Adoptantes already shows next to each profile (SourcePill): 📝 Formulario,
 * ✍️ Contrato, 📥 Importado, API — plus the tool's name for an API activity.
 * Hand-made profiles and activities show nothing.
 */
import { useLanguage } from '@/context/LanguageContext';
import type { Origin } from '@/domain/recordOrigin';

const STYLE: Record<Origin['kind'], { icon: string; cls: string }> = {
    form: { icon: '📝', cls: 'bg-teal-50 text-teal-700' },
    contract: { icon: '✍️', cls: 'bg-amber-50 text-amber-800' },
    imported: { icon: '📥', cls: 'bg-stone-100 text-stone-600' },
    api: { icon: '', cls: 'bg-stone-100 text-stone-600' },
};

export default function OriginTag({ origin, className = '' }: { origin: Origin | null; className?: string }) {
    const { t } = useLanguage();
    if (!origin) return null;
    const { icon, cls } = STYLE[origin.kind];
    const label = origin.kind === 'api' && origin.tool
        ? t('origin.api_tool').replace('{tool}', origin.tool)
        : t(`myAdopters.source_${origin.kind}`);
    return (
        <span data-testid="origin-tag" title={t('origin.title')}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold align-middle max-w-[14rem] truncate ${cls} ${className}`}>
            {icon && <span aria-hidden>{icon}</span>}{label}
        </span>
    );
}
