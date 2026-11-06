'use client';

import { ArrowRight, Search } from 'lucide-react';
import { ProfilePromptBanner } from '@/components/ProfilePromptBanner';
import { buttonClasses } from '@/components/ui/Button';
import { useLanguage } from '@/context/LanguageContext';
import { pairKey } from '@/domain/dedupPair';

export interface PendingDupBarPair {
    otherAdopterId: string;
    otherAdopterName: string;
    /** On the viewer's «Pendientes de revisar» list — only then is «Revisar» offered. */
    onViewerList?: boolean;
}

/**
 * «Posible duplicado de <name> (y N más) · Revisar» — ONE component for a person
 * with an open «same person?» question, wherever they show: the profile and the
 * /my-adopters card (spec 2026-11-05, Nielsen #4). The name opens the first
 * pair's other profile; «Revisar» (≥44px) opens «Pendientes de revisar» at the
 * first pair on the viewer's list. Without one, the bar only informs.
 * `stacked`: the action goes under the title — for a narrow card, so the name
 * is never cut.
 */
export function PendingDupBar({ adopterId, pairs, testId = 'profile-pending-dup', stacked = false }: {
    adopterId: string;
    /** In the order to show: the first one is named. */
    pairs: readonly PendingDupBarPair[];
    testId?: string;
    stacked?: boolean;
}) {
    const { t } = useLanguage();
    if (pairs.length === 0) return null;
    const top = pairs[0];
    const reviewable = pairs.find(c => c.onViewerList);
    const template = pairs.length === 1
        ? (t('myAdopters.profile_pending_dup_of') || 'Posible duplicado de {name}')
        : (t('myAdopters.profile_pending_dup_of_more') || 'Posible duplicado de {name} y {n} más').replace('{n}', String(pairs.length - 1));
    const [before, after = ''] = template.split('{name}');
    const title = (
        <>
            {before}
            <a href={`/adopter/${top.otherAdopterId}`} data-testid={`${testId}-link`} className="underline underline-offset-2">
                {top.otherAdopterName}
            </a>
            {after}
        </>
    );
    const actions = reviewable ? (
        <a href={`/my-adopters?pair=${encodeURIComponent(pairKey(adopterId, reviewable.otherAdopterId))}#pendientes`}
            data-testid={`${testId}-review`} className={buttonClasses({ variant: 'secondary', size: 'compact' })}>
            {t('myAdopters.profile_pending_dup_review') || 'Revisar'}<ArrowRight className="w-4 h-4" aria-hidden="true" />
        </a>
    ) : undefined;
    return (
        <ProfilePromptBanner tone={reviewable ? 'warning' : 'info'} icon={Search} testId={testId} singleLine={!stacked} title={title} actions={actions} />
    );
}
