'use client';

/**
 * Photos an applicant sent with the adoption form (spec 2026-10-14 release 2):
 * the home's protection and where the animal will sleep. Links are the
 * access-checked /api/files/form-photo route — never storage keys.
 */
import { useLanguage } from '@/context/LanguageContext';

export type FormPhotoLinks = { protection: string[]; sleep: string | null };

export default function FormPhotos({ photos, compact = false }: { photos?: FormPhotoLinks | null; compact?: boolean }) {
    const { t } = useLanguage();
    if (!photos || (!photos.protection.length && !photos.sleep)) return null;
    const size = compact ? 'w-20 h-20' : 'w-24 h-24 sm:w-28 sm:h-28';
    const thumb = (src: string, i: number, label: string) => (
        <a key={src} href={src} target="_blank" rel="noopener noreferrer"
            className="block rounded-xl overflow-hidden border border-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            aria-label={t('formResults.photo_open').replace('{label}', label).replace('{n}', String(i + 1))}>
            <img src={src} alt="" loading="lazy" className={`${size} object-cover`} />
        </a>
    );
    return (
        <div className="space-y-3" data-testid="form-photos">
            {photos.protection.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-stone-600 mb-1.5">{t('formResults.photos_protection')}</p>
                    <div className="flex flex-wrap gap-2">{photos.protection.map((src, i) => thumb(src, i, t('formResults.photos_protection')))}</div>
                </div>
            )}
            {photos.sleep && (
                <div>
                    <p className="text-xs font-semibold text-stone-600 mb-1.5">{t('formResults.photo_sleep')}</p>
                    <div className="flex flex-wrap gap-2">{thumb(photos.sleep, 0, t('formResults.photo_sleep'))}</div>
                </div>
            )}
        </div>
    );
}
