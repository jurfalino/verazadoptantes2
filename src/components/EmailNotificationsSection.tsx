'use client';

/**
 * «Avisos» in /settings (approved by Jon 2026-11-11). One row per thing that can
 * happen (src/domain/noticeRows.ts) with two columns: «Campanita», always ✓
 * (the bell shows everything and has no switches), and «Email»: «Siempre» for
 * the rows someone waits on, a switch for the others.
 *
 * - «Toca un control de seguimiento» switches followup_settings.emailReminders,
 *   the same value «Seguimientos de adopción» shows (kept in step on screen by
 *   src/lib/followupEmailSync.ts).
 * - Under the first group, «Formularios, contratos y controles de:» (the one way
 *   to get fewer bell notices, src/domain/animalNotices.ts).
 * - Under «Cambios en tus perfiles», «Avisame de cambios hechos por:» (bell AND
 *   email, src/domain/teamChangeAudience.ts).
 * - At the bottom, what we don't notify («No te avisamos»).
 *
 * Admin-only notices and api_access (always emailed) have no row. Every change
 * is optimistic and reverts on failure, with a toast carrying the errorId; a
 * stale tab gets only the «new version» notice.
 */

import { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { getEmailPrefs, saveEmailPref, saveProfileChangesFrom, type NoticePrefKey, type NoticeSettings } from '@/app/actions/settings';
import { handledAsStale } from '@/lib/errorMessage';
import { announceFollowupEmail, onFollowupEmail } from '@/lib/followupEmailSync';
import { NOTICE_GROUPS, NOTICE_ROWS, isNoticeEmailOn, type NoticeGroup, type NoticeRow } from '@/domain/noticeRows';
import { PROFILE_CHANGES_FROM, type ProfileChangesFrom } from '@/domain/teamChangeAudience';
import { ANIMALS_SCOPES, type AnimalsScope } from '@/domain/animalNotices';

/** The rows that carry a second line (the others are the label alone, as approved). */
const ROWS_WITH_DESC: ReadonlySet<string> = new Set([
    'merge_request', 'pii_request', 'pair_message', 'form', 'contract', 'followups',
    'content', 'rename', 'inaccuracy', 'duplicates', 'transfer', 'group',
]);

/** Label · Campanita · Email. The two narrow columns fit «Campanita» and a 44px switch at 390px. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_80px_56px] items-center gap-2';

const SWITCH_CLASS = 'shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';

function Switch({ on, label, onClick, testId }: { on: boolean; label: string; onClick: () => void; testId: string }) {
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={SWITCH_CLASS} data-testid={testId}>
            <span aria-hidden="true" className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-200 ${on ? 'bg-teal-600' : 'bg-stone-200'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : 'translate-x-1'}`} />
            </span>
        </button>
    );
}

/** A two-option choice (the same control for both choices on this card). */
function Choice<V extends string>({ label, name, options, value, optionLabel, onChoose, hint, testId }: {
    label: string;
    name: string;
    options: readonly V[];
    value: V;
    optionLabel: (v: V) => string;
    onChoose: (v: V) => void;
    hint: string;
    testId: string;
}) {
    const labelId = useId();
    return (
        <div className="border-t border-[var(--border-default)] pt-3 pb-1" data-testid={testId}>
            <p id={labelId} className="text-xs font-semibold text-stone-700">{label}</p>
            <div role="radiogroup" aria-labelledby={labelId} className="mt-1">
                {options.map(v => (
                    <label key={v} className="flex items-center gap-3 min-h-11 px-2 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors">
                        <input
                            type="radio"
                            name={name}
                            value={v}
                            checked={value === v}
                            onChange={() => onChoose(v)}
                            className="w-4 h-4 accent-teal-600"
                            data-testid={`${testId}-${v}`}
                        />
                        <span className="text-sm text-stone-800">{optionLabel(v)}</span>
                    </label>
                ))}
            </div>
            <p className="text-xs text-stone-500 mt-1" data-testid={`${testId}-hint`}>{hint}</p>
        </div>
    );
}

export default function EmailNotificationsSection() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [state, setState] = useState<NoticeSettings | null>(null);

    useEffect(() => {
        let cancelled = false;
        getEmailPrefs()
            .then(res => { if (!cancelled && res) setState(res); })
            .catch((e: unknown) => {
                // The section stays hidden (nothing to toggle), but reported.
                void reportClientError({
                    message: e instanceof Error ? e.message : String(e),
                    stack: e instanceof Error ? e.stack : undefined,
                    source: 'EmailNotificationsSection.load',
                    level: 'warn',
                });
            });
        // «Seguimientos de adopción» saved the same switch.
        const off = onFollowupEmail(on => setState(s => s && { ...s, followupEmail: on }));
        return () => { cancelled = true; off(); };
    }, []);

    if (!state) return null;

    /** Optimistic: `patch` now, `before` back on any failure (a stale tab: silently). */
    const persist = async (
        patch: Partial<NoticeSettings>,
        before: Partial<NoticeSettings>,
        save: () => Promise<{ success: boolean; errorId?: string }>,
        source: string,
        onSaved?: () => void,
    ) => {
        setState(s => s && { ...s, ...patch });
        let errorId: string | undefined;
        try {
            const res = await save();
            if (res?.success) { onSaved?.(); return; }
            errorId = res?.errorId || resolveErrorId(res, source);
        } catch (e) {
            if (handledAsStale(e)) {
                setState(s => s && { ...s, ...before });
                return;
            }
            errorId = resolveErrorId(e, source);
        }
        setState(s => s && { ...s, ...before });
        toast.error(t('errors.generic') || 'Error', t('settings.email_save_failed') || 'No se pudo guardar el cambio.', errorId);
    };

    const savePref = (key: NoticePrefKey, enabled: boolean) => () => saveEmailPref(key, enabled);

    const toggleRow = (row: NoticeRow) => {
        if (row.email === 'always') return;
        if (row.email === 'followups') {
            const enabled = !state.followupEmail;
            void persist({ followupEmail: enabled }, { followupEmail: state.followupEmail }, savePref('followups', enabled),
                'EmailNotificationsSection.followups', () => announceFollowupEmail(enabled));
            return;
        }
        const enabled = !isNoticeEmailOn(state.prefs, row.key);
        void persist({ prefs: { ...state.prefs, [row.key]: enabled } }, { prefs: state.prefs }, savePref(row.key, enabled), 'EmailNotificationsSection');
    };

    const chooseAnimals = (scope: AnimalsScope) => {
        if (scope === state.animalsScope) return;
        void persist({ animalsScope: scope }, { animalsScope: state.animalsScope }, savePref('animals_mine', scope === 'mine'), 'EmailNotificationsSection.animalsScope');
    };

    const chooseChangesFrom = (from: ProfileChangesFrom) => {
        if (from === state.profileChangesFrom) return;
        void persist({ profileChangesFrom: from }, { profileChangesFrom: state.profileChangesFrom }, () => saveProfileChangesFrom(from), 'EmailNotificationsSection.changesFrom');
    };

    const emailCell = (row: NoticeRow) => {
        if (row.email === 'always') {
            return <span className="justify-self-center text-center text-xs font-semibold text-stone-500">{t('settings.notices_always')}</span>;
        }
        const on = row.email === 'followups' ? state.followupEmail : isNoticeEmailOn(state.prefs, row.key);
        return (
            <span className="justify-self-center">
                <Switch
                    on={on}
                    label={`${t('settings.notices_col_email')}: ${t(`settings.notice_row_${row.key}`)}`}
                    onClick={() => toggleRow(row)}
                    testId={`email-pref-toggle-${row.key}`}
                />
            </span>
        );
    };

    const groupTitle = (group: NoticeGroup) => (
        <p className="mt-4 text-xs font-bold text-[var(--accent)]">
            {t(`settings.notices_group_${group}`)}
            {group === 'profile_changes' && <span className="font-medium text-stone-500"> {t('settings.notices_group_profile_changes_by')}</span>}
        </p>
    );

    return (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mt-6" data-testid="email-prefs-section">
            <h2 className="text-base font-bold text-stone-900">{t('settings.notices_title')}</h2>
            <p className="text-xs text-stone-500 mt-1 mb-2 max-w-prose">{t('settings.notices_hint')}</p>

            <div className={`${GRID} border-b border-[var(--border-default)] py-2 text-[11px] font-bold uppercase tracking-wide text-stone-500`} aria-hidden="true">
                <span />
                <span className="justify-self-center text-center">{t('settings.notices_col_bell')}</span>
                <span className="justify-self-center text-center">{t('settings.notices_col_email')}</span>
            </div>

            {NOTICE_GROUPS.map(group => (
                <section key={group} data-testid={`notice-group-${group}`}>
                    {groupTitle(group)}
                    <ul className="mt-1">
                        {NOTICE_ROWS.filter(r => r.group === group).map(row => (
                            <li key={row.key} className={`${GRID} border-t border-[var(--border-default)] first:border-t-0 py-2`} data-testid={`email-pref-${row.key}`}>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-stone-900 break-words">{t(`settings.notice_row_${row.key}`)}</p>
                                    {ROWS_WITH_DESC.has(row.key) && (
                                        <p className="text-xs text-stone-500 mt-0.5 break-words">{t(`settings.notice_row_${row.key}_desc`)}</p>
                                    )}
                                </div>
                                <span className="justify-self-center text-[var(--accent)]" role="img" aria-label={t('settings.notices_col_bell')}>
                                    <Check className="w-5 h-5" aria-hidden="true" />
                                </span>
                                {emailCell(row)}
                            </li>
                        ))}
                    </ul>
                    {group === 'waiting' && (
                        <Choice
                            label={t('settings.animals_scope_label')}
                            name="animals-scope"
                            options={ANIMALS_SCOPES}
                            value={state.animalsScope}
                            optionLabel={v => t(`settings.animals_scope_${v}`)}
                            onChoose={chooseAnimals}
                            hint={t('settings.animals_scope_hint')}
                            testId="animals-scope"
                        />
                    )}
                    {group === 'profile_changes' && (
                        <Choice
                            label={t('settings.changes_from_label')}
                            name="profile-changes-from"
                            options={PROFILE_CHANGES_FROM}
                            value={state.profileChangesFrom}
                            optionLabel={v => t(`settings.changes_from_${v}`)}
                            onChoose={chooseChangesFrom}
                            hint={t(`settings.changes_from_${state.profileChangesFrom}_hint`)}
                            testId="profile-changes-from"
                        />
                    )}
                </section>
            ))}

            <details className="mt-4 border-t border-[var(--border-default)] pt-3 text-xs" data-testid="notices-not-sent">
                <summary className="cursor-pointer py-3 font-semibold text-stone-500">{t('settings.notices_not_sent_summary')}</summary>
                <p className="mt-1 text-stone-500 max-w-prose">{t('settings.notices_not_sent_body')}</p>
            </details>
        </div>
    );
}
