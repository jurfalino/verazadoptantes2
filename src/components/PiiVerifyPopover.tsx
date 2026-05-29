'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { verifyKnownInfo } from '@/app/actions/piiAccess';
import { useOneTimeNotice } from '@/hooks/useOneTimeNotice';
import { formatShortDate } from '@/lib/dates';
import type { ContactEntryType } from '@/lib/contactEntries';

/** Footer state for the request-access secondary action. */
export type PiiPopoverRequestState =
    | { kind: 'available' }
    | { kind: 'pending' }
    | { kind: 'cooldown'; cooldownUntil: number };

interface Props {
    open: boolean;
    onClose: () => void;
    adopterId: string;
    /** Type of the masked field the user clicked. Drives the type-specific
     * placeholder; the matcher itself stays adopter-scoped. */
    entryType?: ContactEntryType;
    requestState: PiiPopoverRequestState;
    /** Trigger to open the explicit-request modal (owned by the parent so
     * its single instance can be reused across many popover opens). */
    onRequestAccess?: () => void;
}

/**
 * Click-on-masked-field reveal UI. Replaces the always-visible protected-
 * contact banner that used to sit at the top of every gated profile.
 * Mobile: bottom sheet with backdrop + body scroll lock. Desktop: small
 * centered card. One-time "Novedad" notice surfaces inline the first time
 * the popover opens on a given account, then dismisses for good.
 */
export default function PiiVerifyPopover({
    open,
    onClose,
    adopterId,
    entryType,
    requestState,
    onRequestAccess,
}: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    // Always start blank. v2.15.0-18 had a `?q=` pre-fill via an `initialValue`
    // prop, but the seed often didn't match the field the user actually
    // clicked and looked like a bug (v2.16.0-7 ripped it out).
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { dismissed: noticeDismissed, dismiss: dismissNotice } = useOneTimeNotice('pii-access-gating-v1');

    // Clear input on close (transition from open → closed). Stale per-entry
    // input across reopen attempts would be confusing.
    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (wasOpenRef.current && !open) {
            setInput('');
            setError(null);
        }
        wasOpenRef.current = open;
    }, [open]);

    // Body scroll lock on mobile only. Same pattern as NotificationBell.
    useEffect(() => {
        if (!open) return;
        if (typeof window === 'undefined') return;
        if (window.matchMedia('(min-width: 640px)').matches) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Esc to close (desktop convenience).
    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    async function submit() {
        const value = input.trim();
        if (!value) return;
        setBusy(true);
        setError(null);
        try {
            const res = await verifyKnownInfo(adopterId, value);
            if (res.ok && res.revealed > 0) {
                toast.success('✓', t('adopter.pii_verify_unlocked'));
                onClose();
                router.refresh();
                return;
            } else if (res.ok) {
                setError(t('adopter.pii_verify_no_match'));
            } else {
                setError(res.error || t('adopter.pii_request_error'));
            }
        } catch {
            setError(t('adopter.pii_request_error'));
        } finally {
            setBusy(false);
        }
    }

    const placeholderKey = entryType ? `adopter.pii_verify_ph_${entryType}` : 'adopter.pii_verify_prompt_ph';
    const placeholder = t(placeholderKey) || t('adopter.pii_verify_prompt_ph');

    // Type-specific body — names the exact attribute the viewer clicked, so the
    // prompt doesn't list every possible field. Falls back to the generic copy
    // when the popover opens without a known entry type.
    const bodyKey = entryType ? `adopter.pii_verify_body_${entryType}` : 'adopter.pii_protected_body';
    const bodyText = t(bodyKey) || t('adopter.pii_protected_body');

    const inputType = entryType === 'phone' ? 'tel' : entryType === 'email' ? 'email' : 'text';

    return (
        <>
            {/* Backdrop — mobile + desktop. Click-outside to dismiss. */}
            <div
                className="fixed inset-0 z-40 bg-black/30"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Panel — mobile: bottom sheet pinned to bottom. Desktop: centered
                card with max-width. Inline styles use the project's theme vars
                for dark-mode safety. */}
            <div
                className="
                    fixed z-50 flex flex-col overflow-hidden shadow-2xl
                    inset-x-0 bottom-0 max-h-[85svh] rounded-t-2xl
                    sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                    sm:w-[min(28rem,calc(100vw-2rem))] sm:max-h-[80svh] sm:rounded-2xl
                "
                style={{
                    background: 'var(--surface-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    paddingBottom: 'env(safe-area-inset-bottom)',
                }}
                role="dialog"
                aria-modal="true"
                aria-label={t('adopter.pii_protected_title')}
                onClick={e => e.stopPropagation()}
            >
                {/* Drag-handle (mobile only) — visual affordance, not draggable. */}
                <div className="sm:hidden flex justify-center pt-2 pb-1">
                    <div className="h-1.5 w-12 rounded-full" style={{ background: 'var(--border-default)' }} />
                </div>

                <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
                    {/* One-time notice — shown once per account, then dismissed forever. */}
                    {!noticeDismissed && (
                        <div
                            className="rounded-lg p-3 text-sm"
                            style={{ background: 'var(--accent-subtle-bg)', color: 'var(--text-primary)' }}
                        >
                            <p>
                                <span className="font-semibold">{t('adopter.pii_whatsnew_label')}: </span>
                                {t('adopter.pii_whatsnew_body')}
                            </p>
                            <button
                                type="button"
                                onClick={dismissNotice}
                                className="mt-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
                                style={{ color: 'var(--brand)' }}
                            >
                                {t('adopter.pii_whatsnew_dismiss')}
                            </button>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <p className="text-sm font-semibold text-teal-900">{t('adopter.pii_protected_title')}</p>
                        <p className="text-sm text-teal-800">{bodyText}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type={inputType}
                            value={input}
                            onChange={e => { setInput(e.target.value); setError(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                            placeholder={placeholder}
                            disabled={busy}
                            autoFocus
                            aria-label={placeholder}
                            className="flex-1 min-w-0 rounded-lg border border-teal-300 bg-white text-teal-900 placeholder-stone-500 text-sm px-3 py-1.5 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all disabled:opacity-50"
                        />
                        <button
                            type="button"
                            onClick={submit}
                            disabled={busy || !input.trim()}
                            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                        >
                            {busy ? '…' : t('adopter.pii_verify_check')}
                        </button>
                    </div>
                    {error && <p className="text-xs text-rose-600">{error}</p>}

                    {/* Footer — request-access state. Verify is independent of
                        the cooldown, so the input above is ALWAYS available;
                        only the secondary request CTA reflects the cooldown. */}
                    <div className="pt-1">
                        {requestState.kind === 'pending' ? (
                            <p className="text-sm font-medium text-teal-700">{t('adopter.pii_request_pending')}</p>
                        ) : requestState.kind === 'cooldown' ? (
                            <p className="text-sm text-stone-500">
                                {t('adopter.pii_request_cooldown').replace(
                                    '{date}',
                                    formatShortDate(new Date(requestState.cooldownUntil)),
                                )}
                            </p>
                        ) : onRequestAccess ? (
                            <button
                                type="button"
                                onClick={() => { onClose(); onRequestAccess(); }}
                                className="text-sm text-stone-600 hover:text-teal-700 transition-colors"
                            >
                                {t('adopter.pii_request_cta_fallback')}
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </>
    );
}
