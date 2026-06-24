// Guided-walkthrough step model (v2.21.0). Pure data — selectors target the
// `data-walkthrough` markers in SearchSection; copy is resolved via i18n keys
// at runtime in WalkthroughProvider. `gate` marks the single action-gated step:
//  - 'searchRan' → advance when a result card appears (MutationObserver)
// The first step highlights the whole search FORM (input + Buscar button) so the
// user can both type and submit through the spotlight (driver blocks clicks
// outside the highlight); it has no Next — running the real search advances it.
// The result steps (rating/flags/history) are skipped at runtime if their
// element is missing/zero-size (e.g. a result with no rating or no flags).

export type WalkthroughStepId = 'search' | 'rating' | 'flags' | 'history';

export interface WalkthroughStep {
    id: WalkthroughStepId;
    selector: string;
    titleKey: string;
    bodyKey: string;
    side: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    gate?: 'searchRan';
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
    {
        id: 'search',
        selector: '[data-walkthrough="search-form"]',
        titleKey: 'walkthrough.step_type_title',
        bodyKey: 'walkthrough.step_type_body',
        side: 'bottom',
        align: 'start',
        gate: 'searchRan',
    },
    {
        id: 'rating',
        selector: '[data-walkthrough="results"] [data-walkthrough="result-rating"]',
        titleKey: 'walkthrough.step_rating_title',
        bodyKey: 'walkthrough.step_rating_body',
        side: 'left',
        align: 'start',
    },
    {
        id: 'flags',
        selector: '[data-walkthrough="results"] [data-walkthrough="result-flags"]',
        titleKey: 'walkthrough.step_flags_title',
        bodyKey: 'walkthrough.step_flags_body',
        side: 'top',
        align: 'end',
    },
    {
        id: 'history',
        selector: '[data-walkthrough="results"] [data-walkthrough="result-history"]',
        titleKey: 'walkthrough.step_history_title',
        bodyKey: 'walkthrough.step_history_body',
        side: 'top',
        align: 'start',
    },
];

export const walkthroughKeys = (email: string | null) => {
    const e = email || 'anon';
    return { pending: `walkthrough_pending_${e}`, done: `walkthrough_done_${e}` };
};
