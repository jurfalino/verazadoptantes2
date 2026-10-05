import type { QueueItem } from '@/domain/interview/types';

export function StateIcon({ state, added }: { state: QueueItem['state'] | 'current'; added?: boolean }) {
    const common = { className: 'w-4 h-4 flex-shrink-0', viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const;
    if (state === 'current') return <svg {...common}><path d="M7 5l6 5-6 5V5z" fill="currentColor" stroke="none" /></svg>;
    if (state === 'answered') return <svg {...common}><path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (state === 'skipped') return <svg {...common}><path d="M5 5l5 5-5 5M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (state === 'no_answer') return <svg {...common}><circle cx="10" cy="10" r="6" /><path d="M6 14L14 6" /></svg>;
    if (added) return <svg {...common}><path d="M10 4v12M4 10h12" strokeLinecap="round" /></svg>;
    return <svg {...common}><circle cx="10" cy="10" r="5" /></svg>;
}
