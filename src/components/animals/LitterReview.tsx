'use client';

/**
 * A post with several animals (a litter) — Jon 2026-11-14. One row each: its
 * photo, what's known, and «Sin completar: sexo» when the post didn't say.
 * Tapping a row opens the SAME fields as «Agregar animal» (AnimalFields).
 * A photo can belong to more than one animal; the tile names who else uses it.
 * One button saves every ticked animal.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { zarazTrack } from '@/lib/zaraz';
import AnimalFields, { EMPTY_ANIMAL_FIELDS, type AnimalFieldsValue } from '@/components/animals/AnimalFields';
import PostPhotoGrid from '@/components/animals/PostPhotoGrid';
import { SameNameNotice } from '@/components/animals/ImportMatchNotices';
import { createAnimal, storePostPhotos, mergeIntoAnimal, type PostPhoto } from '@/components/animals/importSave';
import { missingNiceToHave, type ImportedAnimal } from '@/domain/animalImport';
import type { AnimalMatch } from '@/app/actions/animalImport';

export function fieldsFromImported(a: ImportedAnimal): AnimalFieldsValue {
    return { ...EMPTY_ANIMAL_FIELDS, animalName: a.name, species: a.species, sex: a.sex, neutered: a.neutered, ageValue: a.ageValue, ageUnit: a.ageUnit, color: a.color, details: a.details };
}

interface Item {
    fields: AnimalFieldsValue;
    included: boolean;
    photos: Set<number>;
    /** «Sí, es el mismo»: added to an animal already loaded — not created again. */
    mergedInto: string | null;
    nameMatchAnswered: boolean;
}

export default function LitterReview({ animals, photos, sourceUrl, postDate, sameName, ageNote }: {
    animals: ImportedAnimal[];
    photos: PostPhoto[];
    sourceUrl: string;
    postDate: string | null;
    sameName: Array<AnimalMatch | null>;
    ageNote?: string;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const [items, setItems] = useState<Item[]>(() => animals.map(a => ({
        fields: fieldsFromImported(a), included: true, photos: new Set(a.photos), mergedInto: null, nameMatchAnswered: false,
    })));
    const [open, setOpen] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const patch = (i: number, p: Partial<Item>) => setItems(xs => xs.map((x, j) => j === i ? { ...x, ...p } : x));
    const nameOf = (x: Item) => x.fields.animalName.trim() || t('animalImport.unnamed');
    const list = (names: string[]) => names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${t('animalImport.and')} ${names[names.length - 1]}`;

    const toSave = items.map((x, i) => ({ x, i })).filter(({ x }) => x.included && !x.mergedInto);
    const missingWord = (k: string) => t(`animalImport.litter_missing_${k}`);

    const merge = async (i: number) => {
        const m = sameName[i];
        if (!m) return;
        setBusy(true);
        try {
            const x = items[i];
            const r = await mergeIntoAnimal(m, x.fields, [...x.photos].map(p => photos[p]), { sourceUrl, postDate });
            patch(i, { mergedInto: m.id, nameMatchAnswered: true });
            if (r.photosFailed > 0) toast.error(t('animalImport.merged').replace('{name}', m.name || nameOf(x)), t('animalImport.photos_not_saved').replace('{n}', String(r.photosFailed)), r.errorIds[0]);
            else toast.success(t('toast.saved_title'), t('animalImport.merged').replace('{name}', m.name || nameOf(x)));
        } catch (e) {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('animalImport.merge_failed').replace('{name}', m.name || ''), resolveErrorId(e, 'LitterReview.merge'));
        } finally {
            setBusy(false);
        }
    };

    const saveAll = async () => {
        if (toSave.some(({ x }) => !x.fields.animalName.trim())) {
            const first = toSave.find(({ x }) => !x.fields.animalName.trim());
            if (first) setOpen(first.i);
            toast.warning(t('animalImport.name_needed'));
            return;
        }
        setBusy(true);
        const saved: string[] = [];
        const savedIdx = new Set<number>();
        const failed: string[] = [];
        let photosFailed = 0;
        let photoErrorId: string | undefined;
        let lastErrorId: string | undefined;
        for (const { x, i } of toSave) {
            try {
                const id = await createAnimal(x.fields, { sourceUrl, postDate });
                const r = await storePostPhotos(id, x.fields.animalName, [...x.photos].map(p => photos[p]));
                photosFailed += r.failed;
                photoErrorId = photoErrorId ?? r.errorIds[0];
                saved.push(nameOf(x));
                savedIdx.add(i);
            } catch (e) {
                if (handledAsStale(e)) { setBusy(false); return; }
                lastErrorId = resolveErrorId(e, 'LitterReview.save');
                failed.push(nameOf(x));
            }
        }
        setBusy(false);
        zarazTrack('animal_imported', { count: saved.length, litter: 1, failed: failed.length });
        if (failed.length > 0) {
            toast.error(t('errors.generic'), t('animalImport.litter_saved_partial').replace('{saved}', String(saved.length)).replace('{total}', String(toSave.length)).replace('{names}', list(failed)), lastErrorId);
            // Keep only what failed on screen, so «Agregar» retries just those.
            setItems(xs => xs.map((x, j) => savedIdx.has(j) ? { ...x, included: false, mergedInto: 'saved' } : x));
            return;
        }
        if (photosFailed > 0) toast.error(t('animalImport.litter_saved').replace('{names}', list(saved)), t('animalImport.photos_not_saved').replace('{n}', String(photosFailed)), photoErrorId);
        else if (saved.length) toast.success(t('toast.saved_title'), t('animalImport.litter_saved').replace('{names}', list(saved)));
        router.push('/my-animals');
    };

    return (
        <div data-testid="litter" className="bg-white p-5 rounded-xl border-2 border-teal-400/50 shadow-lg ring-4 ring-teal-50/50">
            <h2 className="text-base font-bold text-stone-900">{t('animalImport.litter_title').replace('{n}', String(animals.length))}</h2>
            <p className="text-sm text-stone-500 mt-1 mb-4">{t('animalImport.litter_hint')}</p>
            <ul className="space-y-2">
                {items.map((x, i) => {
                    const miss = missingNiceToHave(x.fields);
                    const isOpen = open === i;
                    const lead = [...x.photos][0];
                    const match = sameName[i];
                    const done = !!x.mergedInto;
                    const usedBy: Record<number, string[]> = {};
                    photos.forEach((_, p) => { usedBy[p] = items.filter((o, j) => j !== i && o.included && !o.mergedInto && o.photos.has(p)).map(nameOf); });
                    return (
                        <li key={i} data-testid={`litter-row-${i}`} className={`rounded-xl border ${isOpen ? 'border-teal-300' : 'border-stone-200'} ${x.included || done ? '' : 'opacity-60'}`}>
                            <div className="flex items-center gap-2 p-2">
                                <label className="w-11 h-11 flex items-center justify-center shrink-0 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={x.included && !done}
                                        disabled={done || busy}
                                        onChange={() => patch(i, { included: !x.included })}
                                        className="w-5 h-5 accent-teal-600"
                                        aria-label={t('animalImport.litter_include').replace('{name}', nameOf(x))}
                                        data-testid={`litter-include-${i}`}
                                    />
                                </label>
                                <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} data-testid={`litter-toggle-${i}`}
                                    className="flex-1 min-w-0 flex items-center gap-3 text-left min-h-11">
                                    {lead !== undefined && photos[lead]
                                        ? <img src={photos[lead].preview} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                                        : <span className="w-12 h-12 rounded-lg bg-stone-100 shrink-0" aria-hidden />}
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-bold text-stone-900 break-words">{nameOf(x)}</span>
                                        <span className="block text-xs text-stone-500">
                                            {[
                                                ['cat', 'dog', 'bird'].includes(x.fields.species) ? t(`species.${x.fields.species}`) : x.fields.species,
                                                x.fields.sex === 'macho' ? t('adoption.sex_male') : x.fields.sex === 'hembra' ? t('adoption.sex_female') : '',
                                                x.fields.ageValue ? `${x.fields.ageValue} ${t(x.fields.ageUnit === 'years' ? 'adoption.age_unit_years' : 'adoption.age_unit_months')}` : '',
                                            ].filter(Boolean).join(' · ')}
                                        </span>
                                        {done && x.mergedInto !== 'saved' && (
                                            <span className="mt-1 inline-block px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold">
                                                {t('animalImport.merged').replace('{name}', match?.name || nameOf(x))}
                                            </span>
                                        )}
                                        {!done && miss.length > 0 && (
                                            <span className="mt-1 inline-block px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }}>
                                                {t('animalImport.litter_missing').replace('{what}', list(miss.map(missingWord)))}
                                            </span>
                                        )}
                                    </span>
                                    <svg className={`w-4 h-4 text-stone-500 shrink-0 mr-2 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                            </div>
                            {isOpen && !done && (
                                <div className="border-t border-stone-100 p-3 space-y-4">
                                    {match && !x.nameMatchAnswered && (
                                        <SameNameNotice match={match} busy={busy} onYes={() => void merge(i)} onNo={() => patch(i, { nameMatchAnswered: true })} />
                                    )}
                                    <AnimalFields value={x.fields} onChange={f => patch(i, { fields: f })} nudge ageNote={ageNote} idPrefix={`litter-${i}-`} showMicrochip={false} />
                                    <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
                                        <span className="block text-xs font-semibold text-teal-800 mb-2 uppercase tracking-wider">{t('common.photos_title')}</span>
                                        <PostPhotoGrid photos={photos} selected={x.photos} usedBy={usedBy} testId={`litter-${i}-photos`}
                                            onToggle={p => { const n = new Set(x.photos); if (n.has(p)) n.delete(p); else n.add(p); patch(i, { photos: n }); }} />
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-stone-100">
                <Link href="/my-animals" className="min-h-[44px] inline-flex items-center px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">{t('common.cancel')}</Link>
                <button type="button" data-testid="litter-save" disabled={toSave.length === 0 || busy} onClick={() => void saveAll()}
                    className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-xl hover:bg-teal-600 shadow-lg shadow-teal-700/20 disabled:opacity-50">
                    {busy ? t('common.processing') : toSave.length === 1 ? t('animalImport.litter_save_one') : t('animalImport.litter_save_many').replace('{n}', String(toSave.length))}
                </button>
            </div>
        </div>
    );
}
