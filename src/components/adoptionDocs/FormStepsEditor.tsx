'use client';

/**
 * «Formulario» tab: one switch per adoption-form question, grouped as the
 * form asks them. Terms consent and the identity steps are locked — they feed
 * the adopter record and duplicate detection (LOCKED_FORM_STEPS).
 */

import { useLanguage } from '@/context/LanguageContext';
import { FORM_STEP_GROUPS, FORM_STEP_IDS, LOCKED_FORM_STEPS } from '@/domain/adoptionDocs';

const LOCKED = new Set<string>(LOCKED_FORM_STEPS);

/** Steps without a petshield.fields label of their own. */
const OWN_LABEL_KEYS: Record<string, string> = {
    'identity-name': 'adoptionDocs.step_identity_name',
    'identity-email': 'adoptionDocs.step_identity_email',
    'identity-phone': 'adoptionDocs.step_identity_phone',
    'identity-address': 'adoptionDocs.step_identity_address',
    selfie: 'adoptionDocs.step_selfie',
};

function LockIcon() {
    return (
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
    );
}

/** «otra persona del grupo» can open a sentence. */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type StepConflictView = { by: string; theirs: 'hidden' | 'shown' };

type Props = {
    hidden: string[];
    onChange: (h: string[]) => void;
    /** A teammate saved this question while it was being edited. */
    conflicts?: Record<string, StepConflictView>;
    /** A teammate's choice was pulled in on the last save. */
    updatedBy?: Record<string, string>;
    saving?: boolean;
    onKeepMine?: (id: string) => void;
    onKeepTheirs?: (id: string) => void;
};

export default function FormStepsEditor({ hidden, onChange, conflicts = {}, updatedBy = {}, saving = false, onKeepMine, onKeepTheirs }: Props) {
    const { t } = useLanguage();
    const name = (by: string) => by || t('adoptionDocs.someone');
    const hiddenSet = new Set(hidden);
    const total = FORM_STEP_IDS.length;
    const shown = FORM_STEP_IDS.filter(id => !hiddenSet.has(id)).length;

    const label = (id: string) => t(OWN_LABEL_KEYS[id] ?? `petshield.fields.${id}`);

    const toggle = (id: string) => {
        const next = new Set(hiddenSet);
        if (next.has(id)) next.delete(id); else next.add(id);
        // Keep form order so the saved list is stable.
        onChange(FORM_STEP_IDS.filter(s => next.has(s)));
    };

    const row = (id: string) => {
        if (LOCKED.has(id)) {
            return (
                <li key={id} className="flex items-center justify-between gap-4 min-h-11 px-4 py-2" data-testid={`form-step-${id}`}>
                    <span className="text-sm font-medium text-stone-700">{label(id)}</span>
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-stone-500 shrink-0">
                        <LockIcon />
                        {t('adoptionDocs.always_asked')}
                    </span>
                </li>
            );
        }
        const on = !hiddenSet.has(id);
        const conflict = conflicts[id];
        return (
            <li key={id}>
                {conflict && (
                    <div role="alert" className="mx-2 mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 space-y-1" data-testid={`form-step-${id}-conflict`}>
                        <p className="text-xs text-amber-900">
                            {capitalize(t('adoptionDocs.step_conflict')
                                .replace('{name}', name(conflict.by))
                                .replace('{state}', t(conflict.theirs === 'hidden' ? 'adoptionDocs.step_state_hidden' : 'adoptionDocs.step_state_shown')))}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={saving} onClick={() => onKeepTheirs?.(id)} className="min-h-11 px-2 text-xs font-semibold text-teal-700 hover:underline disabled:opacity-40" data-testid={`form-step-${id}-keep-theirs`}>
                                {t('adoptionDocs.step_keep_theirs').replace('{name}', name(conflict.by))}
                            </button>
                            <button type="button" disabled={saving} onClick={() => onKeepMine?.(id)} className="min-h-11 px-2 text-xs font-semibold text-teal-700 hover:underline disabled:opacity-40" data-testid={`form-step-${id}-keep-mine`}>
                                {t('adoptionDocs.step_keep_mine')}
                            </button>
                        </div>
                    </div>
                )}
                {updatedBy[id] !== undefined && !conflict && (
                    <p className="px-4 pt-2 text-xs font-semibold text-teal-700" data-testid={`form-step-${id}-updated-by`}>
                        {t('adoptionDocs.updated_by').replace('{name}', name(updatedBy[id]))}
                    </p>
                )}
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(id)}
                    className="w-full flex items-center justify-between gap-4 min-h-11 px-4 py-2 text-left rounded-xl hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
                    data-testid={`form-step-${id}`}
                >
                    <span className={`text-sm font-medium ${on ? 'text-stone-900' : 'text-stone-500'}`}>{label(id)}</span>
                    <span
                        aria-hidden="true"
                        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${on ? 'bg-teal-600' : 'bg-stone-300'}`}
                    >
                        {/* 4px: half-grid exception (toggle thumb offset) */}
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${on ? 'translate-x-5' : 'translate-x-1'}`} />
                    </span>
                </button>
            </li>
        );
    };

    return (
        <div className="space-y-4">
            <p className="text-sm font-semibold text-stone-700" aria-live="polite" data-testid="form-steps-counter">
                {t('adoptionDocs.form_counter').replace('{shown}', String(shown)).replace('{total}', String(total))}
            </p>

            <ul className="rounded-2xl border border-stone-200 bg-white p-1">
                {row('legal')}
            </ul>

            {FORM_STEP_GROUPS.map(group => (
                <section key={group.key}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">
                        {t(`adoptionDocs.group_${group.key}`)}
                    </h3>
                    <ul className="rounded-2xl border border-stone-200 bg-white divide-y divide-stone-100 p-1">
                        {group.steps.map(id => row(id))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
