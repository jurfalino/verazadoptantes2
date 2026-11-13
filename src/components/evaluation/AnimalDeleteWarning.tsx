'use client';

/**
 * Inside the animal-delete confirm (Jon 2026-11-11): deleting closes the animal's open applications for good
 * (restoring the animal does not reopen them), so say how many — the people's profiles stay.
 * `count` null = the read failed: the generic warning, never a claim of zero.
 */
import { useLanguage } from '@/context/LanguageContext';

/** The warning sentence for `count` candidates (null = unknown); '' when there are none. Shared by the dialog and the edit page's window.confirm. */
export function animalDeleteWarningText(t: (key: string) => string, animalName: string, count: number | null): string {
    if (count === 0) return '';
    const raw = count == null ? t('evaluation.delete_animal_candidates_unknown')
        : count === 1 ? t('evaluation.delete_animal_candidates_one')
            : t('evaluation.delete_animal_candidates_many').replace('{n}', String(count));
    return raw.replace(/\{animal\}/g, animalName || 'Animal');
}

export default function AnimalDeleteWarning({ animalName, count }: { animalName: string; count: number | null }) {
    const { t } = useLanguage();
    const text = animalDeleteWarningText(t, animalName, count);
    if (!text) return null;
    return (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="delete-animal-candidates">
            {text}
        </p>
    );
}
