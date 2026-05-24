'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { verifyKnownInfo } from '@/app/actions/piiAccess';

/**
 * One shared "type anything you know to unlock matching info" input, used at
 * the top of the protected-contact banner on a masked adopter profile. The
 * matcher is already adopter-scoped, so a single input matches across every
 * masked entry — whatever the typed value matches, unlocks. Replaces the
 * earlier per-row "I know this" UI (one click instead of one-per-field, no
 * layout shift).
 */
export default function PiiVerifyKnownInfo({ adopterId }: { adopterId: string }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit() {
        const value = input.trim();
        if (!value) return;
        setBusy(true);
        setError(null);
        try {
            const res = await verifyKnownInfo(adopterId, value);
            if (res.ok && res.revealed > 0) {
                toast.success('✓', t('adopter.pii_verify_unlocked'));
                setInput('');
                // `router.refresh()` re-fetches the page's server data and
                // re-renders. The earlier bug where the unmasked rows didn't
                // appear until a manual reload was a stale `useState` in
                // AdopterForm (see the sync effect there) — not a refresh
                // issue. Smooth in-place update; no full reload.
                router.refresh();
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

    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={e => { setInput(e.target.value); setError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                    placeholder={t('adopter.pii_verify_prompt_ph')}
                    disabled={busy}
                    aria-label={t('adopter.pii_verify_prompt_ph')}
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
        </div>
    );
}
