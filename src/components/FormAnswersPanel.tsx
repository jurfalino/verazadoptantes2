'use client';

import { Fragment, type ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { answerSignal, personSignal, type AnswerSignal } from '@/domain/answerSignals';
import { parseGiftRecipient, recipientFullName, type GiftRecipient } from '@/domain/giftRecipient';

/** Token per signal: the semantic status colours both themes define (style guide §1.2). */
const SIGNAL_COLOR: Record<AnswerSignal, string> = {
    ok: 'var(--status-success-text)',
    caution: 'var(--status-warning-text)',
    risk: 'var(--status-error-text)',
};

function SignalDot({ signal }: { signal: AnswerSignal }) {
    const { t } = useLanguage();
    return (
        <span
            role="img"
            aria-label={t(`formResults.signal_${signal}`)}
            title={t(`formResults.signal_${signal}`)}
            data-signal={signal}
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0 self-center"
            style={{ background: SIGNAL_COLOR[signal] }}
        />
    );
}

/**
 * `text` with a line-break opportunity (<wbr>) after each of `after`: an email
 * breaks as «diego.ruiz@ / ejemplo.com.ar», a label as «castración/ /
 * esterilización», instead of mid-word wherever the column ends.
 */
export function withBreaks(text: string, after: string): ReactNode {
    const parts: ReactNode[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (after.includes(text[i]) && i < text.length - 1) {
            parts.push(<Fragment key={i}>{text.slice(start, i + 1)}<wbr /></Fragment>);
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.length === 1 ? text : <>{parts}</>;
}

/** Break points for links and handles: after «/» and «.». */
export const LINK_BREAKS = './';

/**
 * An email with break opportunities after «@» and after the dots BEFORE it —
 * never inside the domain, so a narrow column shows «diego.ruiz@ /
 * ejemplo.com.ar», not «diego.ruiz@ejemplo.com. / ar».
 */
export function emailWithBreaks(email: string): ReactNode {
    const at = email.lastIndexOf('@');
    if (at <= 0) return withBreaks(email, '.');
    return <>{withBreaks(email.slice(0, at + 1), '.@')}<wbr />{email.slice(at + 1)}</>;
}

/**
 * One answer: label | value. Every row uses the same two-column template, so
 * values line up in one column across rows and sections. The LABEL wraps in its
 * own track (40% in a narrow card or the applicant panel, 14rem once the card
 * is ≥ 28rem wide — a container query, not the viewport) — a long label used to squeeze
 * its value until «No» broke into «N / o». Values break mid-word only when a
 * single word is wider than the whole column (`overflow-wrap: break-word`).
 */
export function AnswerRow({ label, children, testId, kind }: { label: string; children: ReactNode; testId?: string; kind?: string }) {
    return (
        <div className="@container" data-testid={testId ?? 'answer-row'}>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @md:grid-cols-[14rem_minmax(0,1fr)] gap-x-4 items-baseline text-xs">
                <span className="font-semibold text-stone-600 min-w-0 [overflow-wrap:break-word]">{withBreaks(label, '/')}:</span>
                <div className="min-w-0 text-stone-800 [overflow-wrap:break-word]" data-answer-kind={kind}>{children}</div>
            </div>
        </div>
    );
}

type FormPerson = { relationship: string; age: number; firstName?: string; lastName?: string };

/**
 * "¿Quiénes viven en la casa?" (spec 2026-10-04 §4): one line per person with
 * its own dot — under 5 red, 5–17 amber, adults green — or a single green
 * "Vive solo/a". Replaces the derived "Niños en el hogar" row.
 */
export function HouseholdPeopleAnswer({ people, livesAlone }: { people: FormPerson[]; livesAlone?: boolean }) {
    const { t } = useLanguage();
    if (!people.length) {
        return livesAlone ? (
            <span data-testid="household-people" className="inline-flex items-baseline gap-1.5 text-stone-800">
                <SignalDot signal="ok" />{t('formResults.household_alone')}
            </span>
        ) : null;
    }
    return (
        <ul data-testid="household-people" className="space-y-1 min-w-0">
            {people.map((p, i) => {
                const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
                return (
                    <li key={i} className="flex items-baseline gap-1.5 text-stone-800 min-w-0 [overflow-wrap:break-word]">
                        <SignalDot signal={personSignal(p.age)} />
                        <span>
                            {t(`adopter.hh_rel_${p.relationship}`)} · {t('formResults.household_years').replace('{n}', String(p.age))}
                            {name && <span className="text-stone-500"> · {name}</span>}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

/** The household row for a form that used the people list; null for older forms (they keep "Niños en el hogar"). */
export function householdPeopleRow(answers: Record<string, unknown>, label: string) {
    if (!Array.isArray(answers.householdPeople)) return null;
    return (
        <AnswerRow key="household" label={label}>
            <HouseholdPeopleAnswer people={answers.householdPeople as FormPerson[]} livesAlone={answers.livesAlone === true} />
        </AnswerRow>
    );
}

/** Who a gift form is for — null for any other form (spec Part 2 §10). */
export function giftRecipientOf(answers: Record<string, unknown>): GiftRecipient | null {
    return answers.intent === 'gift' ? parseGiftRecipient(answers.giftRecipient) : null;
}

/**
 * A field's label, about the recipient on a gift form ("Niños en el hogar de
 * Laura") where the plain label would read as the giver's own home.
 */
export function fieldLabel(field: string, answers: Record<string, unknown>, t: (path: string) => string): string {
    const recipient = giftRecipientOf(answers);
    if (recipient) {
        const key = `petshield.fields_gift.${field}`;
        const gift = t(key);
        if (gift !== key) return gift.replace('{n}', recipient.firstName);
    }
    return t(`petshield.fields.${field}`);
}

/** "Para quién es" — first row of the adopter's data on a gift form; null otherwise. */
export function giftRecipientRow(answers: Record<string, unknown>, t: (path: string) => string) {
    const r = giftRecipientOf(answers);
    if (!r) return null;
    return (
        <AnswerRow key="giftRecipient" label={t('formResults.gift_for')} testId="gift-recipient">
            <span className="text-stone-500">{t(`adopter.hh_rel_${r.relationship}`)} · </span>
            {recipientFullName(r) ?? r.firstName}
            {r.phone && <span className="text-stone-500"> · {r.phone}</span>}
        </AnswerRow>
    );
}

/**
 * An answer's value with its semáforo dot (src/domain/answerSignals.ts) in
 * front, so the dots line up in a column a rescuer can scan. Colour is never
 * the only signal: the dot carries a spoken/hover label ("Atención" …).
 */
export function AnswerValue({ field, raw, display }: { field: string; raw: unknown; display: string }) {
    const { t } = useLanguage();
    const signal = answerSignal(field, raw);
    return (
        <span className="inline-flex items-baseline gap-1.5 text-stone-800 min-w-0 max-w-full">
            {signal && (
                <span
                    role="img"
                    aria-label={t(`formResults.signal_${signal}`)}
                    title={t(`formResults.signal_${signal}`)}
                    data-signal={signal}
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0 self-center"
                    style={{ background: SIGNAL_COLOR[signal] }}
                />
            )}
            <span className="min-w-0">{LINK_FIELDS.has(field) ? (/^[^\s/@]+@[^\s@]+$/.test(display) ? emailWithBreaks(display) : withBreaks(display, LINK_BREAKS)) : display}</span>
        </span>
    );
}

/** Answers that are usually a link or a handle: they break at «@ . /», not mid-word. */
const LINK_FIELDS = new Set(['instagram', 'facebook', 'vetReference']);

/** "Datos del adoptante" on the form screen, after name/email/phone/address. */
export const ADOPTER_INFO_FIELDS = ['ageRange', 'carer', 'children', 'allergy', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied', 'instagram', 'facebook', 'vetReference', 'motivation', 'howHeard'];
/** "Otras mascotas" on the form screen. */
export const OTHER_PETS_FIELDS = ['lastAnimal', 'petExperience', 'gaveAway', 'gaveAwayWhy', 'existingPets', 'petsCare'];

/** Shared form-answer display logic (used by FormResultsContent for adopter info + other pets). */
export function renderFormAnswerValue(key: string, raw: any, t: (path: string) => string): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    // A question the rescuer asked as free text (release 3): the applicant's words, as written.
    if (typeof raw === 'object' && typeof raw.open === 'string') return raw.open || null;
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
        case 'children':
        // New questions (spec 2026-10-14) — closed answers.
        case 'carer':
        case 'allergy':
        case 'petsCare':
        case 'rental':
        case 'catOutdoor':
        case 'sleepPlace':
        case 'dogWalks':
        case 'dogTied':
        case 'lastAnimal':
        case 'gaveAway':
        case 'sterilizeHow':
        case 'movingIfNoPets':
        case 'returnReasons':
        case 'adaptPlan':
        case 'visitConsent': {
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
        { id: 'identity', titleKey: 'petshield.sections.identity', fields: ['ageRange', 'carer', 'lastAnimal', 'petExperience', 'gaveAway', 'gaveAwayWhy', 'instagram', 'facebook', 'vetReference', 'motivation', 'howHeard'] },
        { id: 'household', titleKey: 'petshield.sections.household', fields: ['children', 'allergy', 'existingPets', 'petsCare', 'housingType', 'rental', 'hasOutdoor', 'isSafe', 'catOutdoor', 'sleepPlace', 'hoursAlone', 'dogWalks', 'dogTied'] },
        { id: 'preferences', titleKey: 'petshield.sections.preferences', fields: ['species', 'speciesOther', 'lifeStage', 'intent'] },
        { id: 'commitments', titleKey: 'petshield.sections.commitments', fields: ['specialNeeds', 'willingToSterilize', 'sterilizeHow', 'vetCommitment', 'movingIfNoPets', 'movingPlans', 'vacationPlan', 'returnReasons', 'adaptPlan', 'visitConsent'] },
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
                                if (field === 'children') {
                                    const people = householdPeopleRow(fullAnswers, fieldLabel('household', fullAnswers, t));
                                    if (people) return people;
                                }
                                const raw = get(field);
                                const display = renderValue(field, raw);
                                if (!display) return null;
                                return (
                                    <AnswerRow key={field} label={fieldLabel(field, fullAnswers, t)}>
                                        <AnswerValue field={field} raw={raw} display={display} />
                                    </AnswerRow>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

