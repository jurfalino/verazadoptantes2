/** The follow-up questions shown under their host's screen (spec 2026-10-14 §4.2). */
export type ChoiceQuestion = { title: string; options: Array<{ value: string; label: string }> }

export default function FollowUps({ ids, answers, onAnswer, questions }: {
    ids: string[]
    answers: Record<string, unknown>
    onAnswer: (key: string, value: string) => void
    questions: Record<string, ChoiceQuestion>
}) {
    const shown = ids.filter(id => questions[id])
    if (!shown.length) return null
    return (
        <div className="ps-followups">
            {shown.map(id => (
                <fieldset key={id} className="ps-followup" data-testid={`followup-${id}`}>
                    <legend className="ps-followup__title">{questions[id].title}</legend>
                    <div className="ps-choice-list ps-choice-list--compact" role="radiogroup" aria-label={questions[id].title}>
                        {questions[id].options.map(o => (
                            <button
                                key={o.value}
                                type="button"
                                role="radio"
                                aria-checked={answers[id] === o.value}
                                className={`ps-choice ${answers[id] === o.value ? 'ps-choice--selected' : ''}`}
                                onClick={() => onAnswer(id, o.value)}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    )
}
