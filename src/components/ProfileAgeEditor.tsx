'use client';

/**
 * Age and «Es menor de edad» on a profile (households as profiles, Task 3).
 * Open to anyone signed in, like the name; the owner's team is told. The box
 * is always shown; with an age entered it follows the age and is locked
 * (ticked under 18, unticked from 18) — the ledger's ruling: a known age
 * decides, the box only counts with no age.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { changeProfileAge } from '@/app/actions';
import { resolveErrorId, reportClientError } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { MINOR_AGE_LIMIT } from '@/domain/households';
import { isValidAge, type ProfileIdentityView } from '@/domain/profileIdentity';

export default function ProfileAgeEditor({ adopterId, identity, onClose }: { adopterId: string; identity: ProfileIdentityView; onClose: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [age, setAge] = useState(identity.age !== null ? String(identity.age) : '');
    const [box, setBox] = useState(identity.age === null ? identity.minorBox : identity.isMinor);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const typed = age.trim();
    const n = typed === '' ? null : Number(typed);
    const byAge = n !== null && Number.isFinite(n);
    const checked = byAge ? (n as number) < MINOR_AGE_LIMIT : box;

    async function save() {
        if (n !== null && !isValidAge(n)) { setProblem(t('adopter.age_invalid')); return; }
        setProblem(null);
        setBusy(true);
        try {
            // What this form showed: changed since (a teammate) → conflict, nothing written (final fix P1).
            const res = await changeProfileAge({ adopterId, age: n, isMinor: checked, expected: { age: identity.age, isMinor: identity.isMinor } });
            if (res.ok) {
                onClose();
                router.refresh();
                return;
            }
            if (res.error === 'conflict') {
                toast.warning(t('adopter.hh_err_conflict'));
                onClose();
                router.refresh();
                return;
            }
            if (res.error === 'has_activity') { setProblem(t('adopter.age_has_activity')); return; }
            if (res.error === 'invalid') { setProblem(t('adopter.age_invalid')); return; }
            const errorId = res.errorId ?? await reportClientError({ message: `changeProfileAge failed: ${res.error}`, source: 'ProfileAgeEditor', extra: { adopterId } });
            toast.error(t('toast.save_error_title'), res.error === 'busy' ? t('collab.busy') : t('adopter.age_failed'), errorId);
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('toast.save_error_title'), t('adopter.age_failed'), resolveErrorId(e, 'ProfileAgeEditor'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 space-y-2 max-w-sm" data-testid="profile-age-editor">
            <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                    <span className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.age_label')}</span>
                    <input type="number" inputMode="numeric" min={0} max={120} value={age} onChange={e => setAge(e.target.value)}
                        data-testid="profile-age-input"
                        className="w-24 px-2.5 py-2 border border-stone-300 rounded bg-white text-base outline-none focus:border-teal-500" />
                </label>
                <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-stone-700 cursor-pointer" data-testid="profile-minor-box">
                    <input type="checkbox" checked={checked} disabled={byAge} onChange={e => setBox(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                    {t('adopter.age_minor_box')}
                </label>
            </div>
            <p className="text-[11px] text-stone-500">{t('adopter.age_hint')}</p>
            {problem && <p className="text-xs text-rose-700" role="alert">{problem}</p>}
            <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={onClose} disabled={busy}
                    className="min-h-[44px] px-3 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg">{t('adopter.age_cancel')}</button>
                <button type="button" onClick={save} disabled={busy} data-testid="profile-age-save"
                    className="min-h-[44px] px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-600 rounded-lg disabled:opacity-60">{t('adopter.age_save')}</button>
            </div>
        </div>
    );
}
