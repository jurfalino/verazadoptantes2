'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_PREFIX = 'notice-seen:';

/**
 * Reusable one-time dismissible notice, persisted in `localStorage`.
 *
 * `dismissed` is `false` through SSR and the first client paint, then hydrated
 * from storage in an effect — so a notice is shown until we positively know it
 * was dismissed (a dismissed user sees at most a one-frame flash, never a
 * notice that's silently missed). Per-device by design: informational "what's
 * new" notices don't need cross-device sync.
 *
 * Use a versioned `noticeKey` (e.g. `pii-access-gating-v1`) — bump the suffix
 * to re-surface a materially-changed notice to everyone.
 */
export function useOneTimeNotice(noticeKey: string): { dismissed: boolean; dismiss: () => void } {
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        try {
            if (window.localStorage.getItem(STORAGE_PREFIX + noticeKey) === '1') {
                setDismissed(true);
            }
        } catch {
            // localStorage unavailable (private mode / disabled) — treat as not dismissed.
        }
    }, [noticeKey]);

    const dismiss = useCallback(() => {
        setDismissed(true);
        try {
            window.localStorage.setItem(STORAGE_PREFIX + noticeKey, '1');
        } catch {
            // Best-effort — the notice still hides for the rest of this session.
        }
    }, [noticeKey]);

    return { dismissed, dismiss };
}
