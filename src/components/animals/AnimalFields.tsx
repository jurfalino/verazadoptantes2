'use client';

/**
 * The animal's own fields — name, species, age, sex, neutered, colour,
 * microchip, details — as one component, so «Agregar animal» and each animal
 * of a post with several (a litter) show the SAME controls (guidelines §1.3).
 *
 * `nudge`: the fields were filled from a post. Age, sex and neutered status the
 * post didn't state are pointed out — amber, with a line saying so — but never
 * required (Jon 2026-11-14): the animal saves and goes public without them.
 */

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { WarningIcon } from '@/components/ui/Glyph';
import { missingNiceToHave, type NiceToHave } from '@/domain/animalImport';

export interface AnimalFieldsValue {
    animalName: string;
    species: string;
    details: string;
    sex: string;
    neutered: '' | '1' | '0';
    color: string;
    microchip: string;
    ageValue: string;
    ageUnit: 'months' | 'years';
}

export const EMPTY_ANIMAL_FIELDS: AnimalFieldsValue = {
    animalName: '', species: 'cat', details: '', sex: '', neutered: '', color: '', microchip: '', ageValue: '', ageUnit: 'months',
};

const KNOWN_SPECIES = ['cat', 'dog', 'bird'];

const LABEL = 'block text-xs font-semibold text-teal-800 mb-1.5 uppercase tracking-wider';
const INPUT = 'w-full h-10 px-4 rounded-lg border text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none text-sm';
const SELECT = 'w-full h-10 pl-4 pr-10 rounded-lg border text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-sm';
/** Themed status tokens, so the nudge reads in Azul Noche too (a raw bg-amber-50 went grey). */
const NUDGED = 'border-[var(--status-warning-text)] bg-[var(--status-warning-bg)]';

function Chevron({ small = false }: { small?: boolean }) {
    return (
        <div className={`absolute inset-y-0 right-0 flex items-center ${small ? 'px-2' : 'px-3'} pointer-events-none text-stone-500`}>
            <svg className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
    );
}

export default function AnimalFields({
    value, onChange, nudge = false, ageNote, idPrefix = '', showMicrochip = true,
}: {
    value: AnimalFieldsValue;
    onChange: (next: AnimalFieldsValue) => void;
    /** Filled from a post: point out the empty age / sex / neutered. */
    nudge?: boolean;
    /** Under the age, e.g. «Edad al 12 de agosto, cuando se publicó». */
    ageNote?: string;
    /** Several on one page (a litter): keeps ids unique. The single form keeps the bare ids. */
    idPrefix?: string;
    showMicrochip?: boolean;
}) {
    const { t } = useLanguage();
    // «Otro…» was picked (species still empty), or the value is a species the list doesn't have — e.g.
    // a post read after the form first showed. Derived, so the select never shows «Gato» for «conejo».
    const [pickedOther, setCustomSpecies] = useState(false);
    const customSpecies = pickedOther || (!!value.species && !KNOWN_SPECIES.includes(value.species.toLowerCase()));
    const set = <K extends keyof AnimalFieldsValue>(k: K, v: AnimalFieldsValue[K]) => onChange({ ...value, [k]: v });
    const missing: NiceToHave[] = nudge ? missingNiceToHave(value) : [];
    const id = (name: string) => `${idPrefix}${name}`;

    const Hint = ({ what, testId }: { what: string; testId: string }) => (
        <p data-testid={testId} className="mt-1.5 text-xs font-semibold flex items-start gap-1" style={{ color: 'var(--status-warning-text)' }}>
            <WarningIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{t('animalImport.nudge').replace('{what}', what)}</span>
        </p>
    );

    return (
        <>
            {/* Animal Name */}
            <div>
                <label htmlFor={id('animalName')} className={LABEL}>{t('adoption.animal_name') || 'Animal Name'} *</label>
                <input
                    id={id('animalName')}
                    required
                    className={`${INPUT} border-teal-200`}
                    value={value.animalName}
                    onChange={e => set('animalName', e.target.value)}
                    placeholder={t('adoption.animal_placeholder') || 'e.g. Luna'}
                />
            </div>

            {/* Species */}
            <div>
                <label htmlFor={id('species')} className={LABEL}>{t('adoption.species') || 'Species'} *</label>
                {customSpecies ? (
                    <div className="flex gap-2">
                        <input
                            id={id('species')}
                            required
                            autoFocus={!value.species}
                            className={`flex-1 min-w-0 ${INPUT.replace('w-full ', '')} border-teal-200`}
                            value={value.species}
                            onChange={e => set('species', e.target.value)}
                            placeholder={t('adoption.species_other_placeholder') || 'Enter species...'}
                        />
                        <button
                            type="button"
                            onClick={() => { setCustomSpecies(false); set('species', 'cat'); }}
                            className="px-3 h-10 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-xs font-medium hover:bg-teal-50 transition-colors whitespace-nowrap"
                        >
                            ↩ {t('adoption.species_presets') || 'Presets'}
                        </button>
                    </div>
                ) : (
                    <div className="relative">
                        <select
                            id={id('species')}
                            required
                            className={`${SELECT} border-teal-200 bg-teal-50`}
                            value={value.species.toLowerCase()}
                            onChange={e => {
                                if (e.target.value === '_other') { setCustomSpecies(true); set('species', ''); }
                                else set('species', e.target.value);
                            }}
                        >
                            {/* A post that didn't say: the rescuer must choose (required). */}
                            {!value.species && <option value="" disabled>{t('animalImport.species_pick')}</option>}
                            <option value="cat">{t('species.cat') || 'Cat'} 🐱</option>
                            <option value="dog">{t('species.dog') || 'Dog'} 🐶</option>
                            <option value="bird">{t('species.bird') || 'Bird'} 🐦</option>
                            <option value="_other">{t('species.other') || 'Other...'}</option>
                        </select>
                        <Chevron />
                    </div>
                )}
            </div>

            {/* Age, Sex & Neutered */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <label htmlFor={id('ageValue')} className={LABEL}>{t('adoption.age') || 'Approximate Age'}</label>
                    <div className="flex gap-2">
                        <input
                            id={id('ageValue')}
                            type="number"
                            min="0"
                            max="99"
                            step="1"
                            inputMode="numeric"
                            className={`flex-1 min-w-0 ${INPUT.replace('w-full ', '')} ${missing.includes('age') ? NUDGED : 'border-teal-200'}`}
                            value={value.ageValue}
                            onChange={e => set('ageValue', e.target.value.replace(/\D/g, ''))}
                            placeholder={t('adoption.age_placeholder') || 'e.g. 2'}
                        />
                        <div className="relative shrink-0">
                            <select
                                aria-label={t('animalImport.age_unit')}
                                className="h-10 pl-3 pr-8 rounded-lg border border-teal-200 bg-teal-50 text-teal-950 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none appearance-none text-sm"
                                value={value.ageUnit}
                                onChange={e => set('ageUnit', e.target.value as 'months' | 'years')}
                            >
                                <option value="months">{t('adoption.age_unit_months') || 'months'}</option>
                                <option value="years">{t('adoption.age_unit_years') || 'years'}</option>
                            </select>
                            <Chevron small />
                        </div>
                    </div>
                    {missing.includes('age') && <Hint what={t('animalImport.nudge_age')} testId={`${idPrefix}nudge-age`} />}
                    {!missing.includes('age') && ageNote && value.ageValue && (
                        <p data-testid={`${idPrefix}age-note`} className="mt-1.5 text-xs text-stone-500">{ageNote}</p>
                    )}
                </div>
                <div>
                    <label htmlFor={id('sex')} className={LABEL}>{t('adoption.sex') || 'Sex'}</label>
                    <select
                        id={id('sex')}
                        className={`${SELECT} ${missing.includes('sex') ? NUDGED : 'border-teal-200 bg-teal-50'}`}
                        value={value.sex}
                        onChange={e => set('sex', e.target.value)}
                    >
                        <option value="">{t('adoption.sex_unknown') || '—'}</option>
                        <option value="macho">{t('adoption.sex_male') || 'Male ♂'}</option>
                        <option value="hembra">{t('adoption.sex_female') || 'Female ♀'}</option>
                    </select>
                    {missing.includes('sex') && <Hint what={t('animalImport.nudge_sex')} testId={`${idPrefix}nudge-sex`} />}
                </div>
                <div>
                    <label htmlFor={id('neutered')} className={LABEL}>{t('adoption.neutered') || 'Neutered / Spayed'}</label>
                    <select
                        id={id('neutered')}
                        className={`${SELECT} ${missing.includes('neutered') ? NUDGED : 'border-teal-200 bg-teal-50'}`}
                        value={value.neutered}
                        onChange={e => set('neutered', e.target.value as '' | '1' | '0')}
                    >
                        <option value="">{t('adoption.neutered_unknown') || '—'}</option>
                        <option value="1">{t('adoption.neutered_yes') || 'Yes ✓'}</option>
                        <option value="0">{t('adoption.neutered_no') || 'No'}</option>
                    </select>
                    {missing.includes('neutered') && <Hint what={t('animalImport.nudge_neutered')} testId={`${idPrefix}nudge-neutered`} />}
                </div>
            </div>

            {/* Color & Microchip */}
            <div className={`grid grid-cols-1 ${showMicrochip ? 'sm:grid-cols-2' : ''} gap-4`}>
                <div>
                    <label htmlFor={id('color')} className={LABEL}>{t('adoption.color') || 'Color / Markings'}</label>
                    <input
                        id={id('color')}
                        className={`${INPUT} border-teal-200`}
                        value={value.color}
                        onChange={e => set('color', e.target.value)}
                        placeholder={t('adoption.color_placeholder') || 'e.g. Black with white spots'}
                    />
                </div>
                {showMicrochip && (
                    <div>
                        <label htmlFor={id('microchip')} className={LABEL}>{t('adoption.microchip') || 'Microchip N°'}</label>
                        <input
                            id={id('microchip')}
                            className={`${INPUT} border-teal-200`}
                            value={value.microchip}
                            onChange={e => set('microchip', e.target.value)}
                            placeholder={t('adoption.microchip_placeholder') || 'Optional'}
                        />
                    </div>
                )}
            </div>

            {/* Details */}
            <div>
                <label htmlFor={id('details')} className={LABEL}>{t('common.details') || 'Details'}</label>
                <textarea
                    id={id('details')}
                    className="w-full p-3 rounded-lg border border-teal-200 text-teal-950 placeholder-stone-500 font-medium focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all outline-none resize-none text-sm"
                    rows={4}
                    value={value.details}
                    onChange={e => set('details', e.target.value)}
                    placeholder={t('dashboard.animal_details_placeholder') || 'Age, color, personality, health status, any special needs...'}
                />
            </div>
        </>
    );
}
