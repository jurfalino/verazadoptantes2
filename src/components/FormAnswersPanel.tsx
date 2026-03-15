'use client';

import { useLanguage } from '@/context/LanguageContext';

/** Shared form-answer display logic (used by FormResultsContent for adopter info + other pets). */
export function renderFormAnswerValue(key: string, raw: any, t: (path: string) => string): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    switch (key) {
        case 'geo':
            return t(`petshield.options.geo.${raw === 'yes' ? 'yes' : 'no'}`);
        case 'ageRange':
        case 'hoursAlone':
        case 'petExperience':
        case 'movingPlans':
        case 'vacationPlan':
        case 'housingType':
        case 'hasOutdoor':
        case 'isSafe':
        case 'children': {
            const val = String(raw);
            return t(`petshield.options.${key}.${val}`);
        }
        case 'existingPets':
            if (typeof raw !== 'object') return null;
            const entries = Object.entries(raw as Record<string, number>)
                .filter(([, v]) => typeof v === 'number' && v > 0);
            if (entries.length === 0) return null;
            return entries
                .map(([type, count]) => {
                    const label = t(`petshield.options.existingPets.${type}`) !== `petshield.options.existingPets.${type}` ? t(`petshield.options.existingPets.${type}`) : type;
                    return `${count} ${label}`;
                })
                .join(', ');
        case 'specialNeeds':
        case 'vetCommitment':
            return t(`petshield.options.boolean.${raw ? 'yes' : 'no'}`);
        case 'willingToSterilize':
            return t(`petshield.options.willingToSterilize.${raw ? String(raw) : 'no'}`);
        case 'legal':
            return t(`petshield.options.boolean.${raw ? 'yes' : 'no'}`);
        case 'lifeStage': {
            const val = String(raw).toLowerCase();
            return t(`petshield.options.lifeStage.${val}`) !== `petshield.options.lifeStage.${val}` ? t(`petshield.options.lifeStage.${val}`) : String(raw);
        }
        case 'species': {
            const val = String(raw).toLowerCase();
            const out = t(`petshield.options.species.${val}`);
            return out !== `petshield.options.species.${val}` ? out : String(raw);
        }
        case 'intent':
            return raw === 'self' ? t('formResults.intent_self') : raw === 'gift' ? t('formResults.intent_gift') : String(raw);
        default:
            return String(raw);
    }
}

interface FormAnswersPanelProps {
    fullAnswers: Record<string, any>;
    /** Section ids to skip (e.g. ['identity', 'household'] when shown in form results as adopter info + other pets). */
    excludeSections?: string[];
}

export default function FormAnswersPanel({ fullAnswers, excludeSections = [] }: FormAnswersPanelProps) {
    const { t } = useLanguage();

    if (!fullAnswers || Object.keys(fullAnswers).length === 0) return null;

    const get = (key: string): any => fullAnswers[key];

    const sections: Array<{ id: string; titleKey: string; fields: string[] }> = [
        { id: 'identity', titleKey: 'petshield.sections.identity', fields: ['ageRange', 'petExperience'] },
        { id: 'household', titleKey: 'petshield.sections.household', fields: ['children', 'existingPets', 'housingType', 'hasOutdoor', 'isSafe', 'hoursAlone'] },
        { id: 'preferences', titleKey: 'petshield.sections.preferences', fields: ['species', 'speciesOther', 'lifeStage', 'intent'] },
        { id: 'commitments', titleKey: 'petshield.sections.commitments', fields: ['specialNeeds', 'willingToSterilize', 'vetCommitment', 'movingPlans', 'vacationPlan'] },
        { id: 'context', titleKey: 'petshield.sections.context', fields: ['geo', 'legal'] },
    ].filter((s) => !excludeSections.includes(s.id));

    const renderValue = (key: string, raw: any): string | null => renderFormAnswerValue(key, raw, t);

    return (
        <>
            {sections.map(section => {
                const visibleFields = section.fields.filter(field => get(field) !== undefined && get(field) !== null && get(field) !== '');
                if (visibleFields.length === 0) return null;

                return (
                    <div
                        key={section.id}
                        className="bg-white rounded-xl border border-stone-200 p-4 mb-4 shadow-sm"
                    >
                        <h2 className="text-sm font-semibold text-stone-700 mb-3">
                            {t(section.titleKey)}
                        </h2>
                        <div className="space-y-1">
                            {visibleFields.map(field => {
                                const raw = get(field);
                                const display = renderValue(field, raw);
                                if (!display) return null;
                                return (
                                    <div key={field} className="flex items-baseline gap-2 text-xs">
                                        <span className="font-semibold text-stone-600 min-w-[140px]">
                                            {t(`petshield.fields.${field}`)}:
                                        </span>
                                        <span className="text-stone-800">
                                            {display}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

