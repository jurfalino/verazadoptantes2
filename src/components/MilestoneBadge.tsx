'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';

const MILESTONES = [5, 10, 25, 50, 100, 250, 500];

export default function MilestoneBadge() {
    const { t } = useLanguage();
    const { data: session } = useSession();
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        if (!session?.user) return;
        fetch('/api/dashboard/milestone')
            .then(res => res.json())
            .then(raw => {
                const data = raw as { count?: number };
                if (typeof data.count === 'number') setCount(data.count);
            })
            .catch(() => {});
    }, [session]);

    if (!session?.user || count === null || count < 1) return null;

    const currentMilestone = MILESTONES.filter(m => m <= count).pop() || 0;
    const nextMilestone = MILESTONES.find(m => m > count) || MILESTONES[MILESTONES.length - 1];
    const prevMilestone = MILESTONES[MILESTONES.indexOf(nextMilestone) - 1] || 0;
    const progress = nextMilestone > prevMilestone
        ? Math.min(((count - prevMilestone) / (nextMilestone - prevMilestone)) * 100, 100)
        : 100;

    const trophyIcon = <svg className="milestone-icon" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.996.178-1.768.563-2.123 1.107a3.186 3.186 0 00-.354 2.107 2.164 2.164 0 001.07 1.31A4.196 4.196 0 005.97 9.75M18.75 4.236c.996.178 1.768.563 2.123 1.107.355.544.393 1.32.354 2.107a2.164 2.164 0 01-1.07 1.31 4.196 4.196 0 01-2.127.99M12 2.25a4.876 4.876 0 00-4.853 4.396A7.5 7.5 0 0012 15.75a7.5 7.5 0 004.853-9.104A4.876 4.876 0 0012 2.25z" /></svg>;

    return (
        <div className="milestone-badge animate-slideDown">
            <div className="milestone-header">
                <p className="milestone-title">
                    {trophyIcon}
                    {currentMilestone > 0
                        ? `${t('milestone.completed')} ${currentMilestone} ${t('milestone.adoptions')}`
                        : `${count} ${t('milestone.adoptions')}`}
                </p>
                {count < MILESTONES[MILESTONES.length - 1] && (
                    <span className="milestone-next">
                        {t('milestone.next')}: {nextMilestone}
                    </span>
                )}
            </div>
            <div className="milestone-track">
                <div
                    className="milestone-progress"
                    style={{ width: `${progress}%` }}
                />
            </div>
            {count < 5 && (
                <p className="milestone-hint">
                    {t('milestone.first')}
                </p>
            )}

            <style>{`
                .milestone-badge {
                    background: var(--status-warning-bg);
                    border: 1px solid var(--status-warning-border);
                    border-radius: 0.75rem;
                    padding: 0.75rem 1rem;
                }
                .milestone-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 0.5rem;
                }
                .milestone-title {
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: var(--status-warning-text);
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin: 0;
                }
                .milestone-next {
                    font-size: 0.75rem;
                    color: var(--status-warning-text);
                    opacity: 0.8;
                }
                .milestone-track {
                    width: 100%;
                    background: var(--status-warning-border);
                    border-radius: 9999px;
                    height: 0.5rem;
                    overflow: hidden;
                }
                .milestone-progress {
                    background: var(--status-warning-text);
                    height: 100%;
                    border-radius: 9999px;
                    transition: width 0.7s ease;
                    opacity: 0.7;
                }
                .milestone-hint {
                    font-size: 0.75rem;
                    color: var(--status-warning-text);
                    margin: 0.375rem 0 0;
                    opacity: 0.8;
                }
            `}</style>
        </div>
    );
}
