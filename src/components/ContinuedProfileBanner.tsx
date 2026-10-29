'use client';

/**
 * «Listo: {name} ahora es este perfil. Sus datos y registros quedaron acá.»
 * — the green notice on the profile «Continuar con este perfil» lands on
 * (DuplicateHint, Jon 2026-10-29), plus who was told.
 *
 * One-shot, handed over in sessionStorage — never in the URL: names in the
 * URL would reach analytics with $current_url. Written right before the
 * navigation, read once in an effect (never in a useState initializer: SSR
 * has no storage) and removed at once, so a reload doesn't show it again.
 * Storage that is blocked or full just means no notice (logged).
 *
 * No «Deshacer»: a rescuer can't undo their own merge — only the admins
 * (unmerge) or the other owner asking them («¿No es la misma persona?», D50).
 */
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { joinNames } from '@/lib/householdCopy';

const KEY = (adopterId: string) => `dupHintContinued:${adopterId}`;

export type ContinuedNotice = { name: string; told: string[] };

/** Before navigating to the profile that stayed. */
export function rememberContinued(adopterId: string, notice: ContinuedNotice): void {
    try {
        window.sessionStorage.setItem(KEY(adopterId), JSON.stringify(notice));
    } catch (e) {
        console.warn('[ContinuedProfileBanner] notice not stored, the profile opens without it', { adopterId, error: e instanceof Error ? e.message : String(e) });
    }
}

/** Reads and removes the notice for this profile (null when there is none). */
export function takeContinued(adopterId: string): ContinuedNotice | null {
    try {
        const raw = window.sessionStorage.getItem(KEY(adopterId));
        if (!raw) return null;
        window.sessionStorage.removeItem(KEY(adopterId));
        const v = JSON.parse(raw) as Partial<ContinuedNotice>;
        if (typeof v?.name !== 'string') return null;
        return { name: v.name, told: Array.isArray(v.told) ? v.told.filter((n): n is string => typeof n === 'string') : [] };
    } catch (e) {
        console.warn('[ContinuedProfileBanner] notice unreadable, not shown', { adopterId, error: e instanceof Error ? e.message : String(e) });
        return null;
    }
}

export function ContinuedProfileNotice({ notice }: { notice: ContinuedNotice }) {
    const { t } = useLanguage();
    const told = notice.told.length === 0 ? ''
        : notice.told.length === 1 ? t('adopter.dup_hint_done_told_one').replace('{name}', notice.told[0])
            : t('adopter.dup_hint_done_told_many').replace('{names}', joinNames(t, notice.told));
    return (
        <p role="status" data-testid="continued-profile-banner"
            className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] [overflow-wrap:anywhere]"
            style={{ background: 'var(--status-success-bg)', borderColor: 'var(--status-success-border)', color: 'var(--status-success-text)' }}>
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
                <b>{t('adopter.dup_hint_done').replace('{name}', notice.name || t('adopter.nameless'))}</b>
                {told && <> {told}</>}
            </span>
        </p>
    );
}

export function ContinuedProfileBanner({ adopterId }: { adopterId: string }) {
    // Keyed by profile: a notice taken here never shows on another profile, and a
    // second effect run (React's dev double-invoke) that finds it gone keeps it.
    const [shown, setShown] = useState<{ adopterId: string; notice: ContinuedNotice } | null>(null);
    useEffect(() => {
        const notice = takeContinued(adopterId);
        if (notice) setShown({ adopterId, notice });
    }, [adopterId]);
    return shown && shown.adopterId === adopterId ? <ContinuedProfileNotice notice={shown.notice} /> : null;
}
