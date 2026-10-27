'use client';

/**
 * «Es menor de edad» — ONE behaviour wherever an age is edited (the profile's
 * own age editor and the household person forms; final fix P7): always shown;
 * with an age typed it follows the age (ticked under MINOR_AGE_LIMIT) and is
 * locked — kept readable (teal, as the approved A5/E1), never greyed out.
 * Themed: the unchecked box follows dark mode (`themed-checkbox`, globals.css)
 * instead of the browser's white.
 */
import { useLanguage } from '@/context/LanguageContext';
import { MINOR_AGE_LIMIT } from '@/domain/households';

/** What the box shows for this typed age: by the age when one is typed, else the box. */
export function minorShown(age: string, box: boolean): { checked: boolean; byAge: boolean } {
    const n = age.trim() === '' ? null : Number(age);
    const byAge = n !== null && Number.isFinite(n);
    return { checked: byAge ? (n as number) < MINOR_AGE_LIMIT : box, byAge };
}

export function MinorCheckbox({ age, value, onChange, testId }: { age: string; value: boolean; onChange: (v: boolean) => void; testId: string }) {
    const { t } = useLanguage();
    const { checked, byAge } = minorShown(age, value);
    return (
        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-stone-700 cursor-pointer" data-testid={testId}>
            <input type="checkbox" checked={checked} aria-readonly={byAge || undefined}
                onChange={e => { if (!byAge) onChange(e.target.checked); }} className="themed-checkbox w-4 h-4 accent-teal-600" />
            {t('adopter.age_minor_box')}
        </label>
    );
}
