'use client';

import type { ComponentProps } from 'react';
import { Logo } from '@/components/Logo';
import UserMenu from '@/components/UserMenu';
import NotificationBell from '@/components/NotificationBell';
import { useEditActionsState } from '@/context/EditActionsContext';
import { useLanguage } from '@/context/LanguageContext';

/**
 * The global app nav's inner content. Normally: logo + notifications + user menu.
 * While an existing profile is being edited (AdopterForm publishes via
 * EditActionsContext), on MOBILE it swaps to Cancelar / Guardar — the nav is
 * already sticky at top-0 and keyboard-proof, so this is the "actions live in the
 * nav" pattern with no extra bar. Desktop always shows the normal nav (it keeps
 * its own inline form buttons), so this swap is `md:hidden`.
 */
export function NavBar({ user, isAdmin }: ComponentProps<typeof UserMenu>) {
    const actions = useEditActionsState();
    const { t } = useLanguage();
    const editing = !!actions?.active;

    return (
        <div className="container mx-auto px-4 h-16 flex items-center">
            {editing && actions && (
                <div className="md:hidden flex-1 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={actions.onCancel}
                        className="px-3 py-2 text-sm font-semibold rounded-lg transition-colors"
                        style={{ color: 'var(--btn-primary-bg)' }}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={actions.onSave}
                        disabled={actions.loading}
                        className="px-5 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                        style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                    >
                        {actions.loading ? t('common.loading') : t('common.save')}
                    </button>
                </div>
            )}
            <div className={`${editing ? 'hidden md:flex' : 'flex'} flex-1 items-center justify-between`}>
                <Logo />
                <div className="flex items-center gap-1 sm:gap-2">
                    <NotificationBell />
                    <UserMenu user={user} isAdmin={isAdmin} />
                </div>
            </div>
        </div>
    );
}
