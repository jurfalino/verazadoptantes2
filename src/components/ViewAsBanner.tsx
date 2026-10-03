'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { stopViewAs } from '@/app/actions/viewAs';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { viewingAsOf } from '@/lib/viewAsClient';

/**
 * Shown on every page, inside the sticky nav, while an admin is viewing the app
 * as another user (src/domain/viewAs.ts) — so it can never be forgotten.
 */
export function ViewAsBanner() {
    const { data: session } = useSession();
    const { t } = useLanguage();
    const toast = useShowToast();
    const [leaving, setLeaving] = useState(false);

    if (!viewingAsOf(session)) return null;
    const name = session?.user?.name || session?.user?.email || '';

    const exit = async () => {
        setLeaving(true);
        try {
            const res = await stopViewAs();
            if (res.ok) {
                // A full load, so nothing rendered for the viewed user survives.
                window.location.assign('/admin/users');
                return;
            }
            toast.error(t('admin.view_as_exit_failed'), undefined, res.errorId);
        } catch (e) {
            toast.error(t('admin.view_as_exit_failed'), undefined, resolveErrorId(e, 'view-as-exit'));
        }
        setLeaving(false);
    };

    return (
        <div
            role="status"
            data-testid="view-as-banner"
            className="border-t py-2"
            style={{
                background: 'var(--status-warning-bg)',
                borderColor: 'var(--status-warning-border)',
                color: 'var(--status-warning-text)',
            }}
        >
            <div className="container mx-auto px-4 flex items-center gap-3">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <p className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="font-semibold break-words">{t('admin.view_as_banner').replace('{name}', name)}</span>
                    <span className="hidden sm:inline"> · {t('admin.view_as_read_only')}</span>
                </p>
                <button
                    type="button"
                    onClick={exit}
                    disabled={leaving}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-bold border transition-all duration-200 disabled:opacity-60"
                    style={{ borderColor: 'currentColor' }}
                >
                    {t('admin.view_as_exit')}
                </button>
            </div>
        </div>
    );
}
