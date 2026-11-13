'use client';

/**
 * The answers that need a look (spec 2026-11-10 «Answers summary»): every
 * answer with a red («Atención») or amber («Para conversar») dot, red first,
 * each as «{question}: {answer}» in the same row and dot «Todas las
 * respuestas» uses; then «N respuestas sin observaciones · Ver todas». A form
 * with nothing red or amber reads «Ninguna respuesta para revisar».
 *
 * `summarizeAnswers` walks the same sections and the same `answerShown` rule
 * as FormAnswersPanel, so N + the flagged rows = the rows «Ver todas» opens.
 */
import { useLanguage } from '@/context/LanguageContext';
import { summarizeAnswers } from '@/domain/formAnswers';
import { AnswerRow, AnswerValue, HouseholdPeopleAnswer, fieldLabel, renderFormAnswerValue } from '@/components/FormAnswersPanel';

type FormPerson = { relationship: string; age: number; firstName?: string; lastName?: string };

export function ApplicationAnswersSummary({ answers, onSeeAll }: { answers: Record<string, unknown>; onSeeAll: () => void }) {
    const { t } = useLanguage();
    const { flagged, restCount } = summarizeAnswers(answers);

    return (
        <div className="space-y-2">
            {flagged.length > 0 ? (
                <div className="space-y-1" data-testid="answers-flagged">
                    {flagged.map(({ field }) => {
                        if (field === 'household') {
                            return (
                                <AnswerRow key={field} testId="answer-flagged-row" label={fieldLabel('household', answers, t)}>
                                    <HouseholdPeopleAnswer people={answers.householdPeople as FormPerson[]} livesAlone={answers.livesAlone === true} />
                                </AnswerRow>
                            );
                        }
                        const raw = answers[field];
                        const display = renderFormAnswerValue(field, raw, t) ?? String(raw);
                        return (
                            <AnswerRow key={field} testId="answer-flagged-row" label={fieldLabel(field, answers, t)}>
                                <AnswerValue field={field} raw={raw} display={display} />
                            </AnswerRow>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-stone-600" data-testid="answers-none">{t('evaluation.answers_none')}</p>
            )}
            {restCount > 0 && (
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-stone-600" data-testid="answers-rest">
                    <span>
                        {restCount === 1
                            ? t('evaluation.answers_rest_one')
                            : t('evaluation.answers_rest_many').replace('{n}', String(restCount))}
                    </span>
                    <span aria-hidden="true">·</span>
                    <button
                        type="button"
                        onClick={onSeeAll}
                        data-testid="answers-see-all"
                        className="min-h-11 px-1 -mx-1 font-semibold text-teal-700 hover:text-teal-800 underline-offset-2 hover:underline"
                    >
                        {t('evaluation.answers_see_all')}
                    </button>
                </p>
            )}
        </div>
    );
}
