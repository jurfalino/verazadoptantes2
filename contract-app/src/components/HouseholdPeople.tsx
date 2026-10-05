import { useEffect, useState } from 'react'
import { useT } from '../i18n/LocaleContext'
import { FORM_RELATIONSHIPS } from '../lib/adoptionDocs'
import { isPersonComplete, type DraftPerson } from '../lib/householdPeopleForm'

/**
 * "¿Quiénes viven en la casa?" (spec 2026-10-04 §1): the applicant lists the
 * people they live with — relationship + age, optional first and last name —
 * or taps "Vivo solo/a". Controlled: the form owns the answers; this owns
 * only the card being edited, which it reports so Continue can wait for it.
 */
export type Person = { relationship: string; age: number; firstName?: string; lastName?: string }

const MAX_PEOPLE = 15

type Editing = { index: number | null; draft: DraftPerson }

export default function HouseholdPeople({ people, livesAlone, onChange, onAlone, onEditingChange, aloneLabel }: {
    people: Person[]
    livesAlone: boolean
    /** Gift flow: "Vive solo/a" instead of "Vivo solo/a". */
    aloneLabel?: string
    onChange: (people: Person[], livesAlone: boolean) => void
    onAlone: () => void
    onEditingChange: (editing: DraftPerson | null) => void
}) {
    const { t } = useT()
    const [editing, setEditing] = useState<Editing | null>(null)
    useEffect(() => { onEditingChange(editing?.draft ?? null) }, [editing, onEditingChange])

    const relLabel = (r: string) => t(`form.rel_${r}`)
    const startAdd = () => setEditing({ index: null, draft: { relationship: null, age: null } })
    const patch = (p: Partial<DraftPerson>) => setEditing(e => e && { ...e, draft: { ...e.draft, ...p } })

    const save = () => {
        if (!editing || !isPersonComplete(editing.draft)) return
        const d = editing.draft
        const person: Person = {
            relationship: d.relationship!,
            age: d.age!,
            ...(d.firstName?.trim() ? { firstName: d.firstName.trim() } : {}),
            ...(d.lastName?.trim() ? { lastName: d.lastName.trim() } : {}),
        }
        const next = editing.index === null ? [...people, person] : people.map((p, i) => (i === editing.index ? person : p))
        onChange(next, false)
        setEditing(null)
    }

    return (
        <div className="ps-people">
            {people.length > 0 && (
                <ul className="ps-people__list">
                    {people.map((p, i) => {
                        const name = [p.firstName, p.lastName].filter(Boolean).join(' ')
                        return (
                            <li key={i} className="ps-people__row">
                                <span className="ps-people__summary">
                                    {relLabel(p.relationship)} · {t('form.household_years').replace('{n}', String(p.age))}
                                    {name && <span className="ps-people__name"> · {name}</span>}
                                </span>
                                <span className="ps-people__actions">
                                    <button type="button" className="ps-btn ps-btn--ghost ps-people__btn" disabled={!!editing}
                                        onClick={() => setEditing({ index: i, draft: { ...p } })}>{t('form.household_edit')}</button>
                                    <button type="button" className="ps-btn ps-btn--ghost ps-people__btn" disabled={!!editing}
                                        onClick={() => onChange(people.filter((_, j) => j !== i), false)}>{t('form.household_remove')}</button>
                                </span>
                            </li>
                        )
                    })}
                </ul>
            )}

            {editing && (
                <div className="ps-people__editor">
                    <span className="ps-field__label">{t('form.household_relationship')}</span>
                    <div className="ps-segmented ps-segmented--wrap" role="radiogroup" aria-label={t('form.household_relationship')}>
                        {FORM_RELATIONSHIPS.map(r => (
                            <button key={r} type="button" role="radio" aria-checked={editing.draft.relationship === r}
                                className={`ps-segmented__item ${editing.draft.relationship === r ? 'ps-segmented__item--selected' : ''}`}
                                onClick={() => patch({ relationship: r })}>{relLabel(r)}</button>
                        ))}
                    </div>
                    <label className="ps-field">
                        <span className="ps-field__label">{t('form.household_age')}</span>
                        <input className="ps-input" type="number" inputMode="numeric" min={0} max={120} step={1}
                            value={editing.draft.age ?? ''}
                            onChange={e => patch({ age: e.target.value === '' ? null : Number(e.target.value) })} />
                    </label>
                    <div className="ps-people__names">
                        <label className="ps-field">
                            <span className="ps-field__label">{t('form.household_first_name')}</span>
                            <input className="ps-input" type="text" autoComplete="off" maxLength={60}
                                value={editing.draft.firstName ?? ''} onChange={e => patch({ firstName: e.target.value })} />
                        </label>
                        <label className="ps-field">
                            <span className="ps-field__label">{t('form.household_last_name')}</span>
                            <input className="ps-input" type="text" autoComplete="off" maxLength={60}
                                value={editing.draft.lastName ?? ''} onChange={e => patch({ lastName: e.target.value })} />
                        </label>
                    </div>
                    <div className="ps-people__editor-actions">
                        <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setEditing(null)}>{t('form.household_cancel')}</button>
                        <button type="button" className="ps-btn ps-btn--primary" disabled={!isPersonComplete(editing.draft)} onClick={save}>{t('form.household_save')}</button>
                    </div>
                </div>
            )}

            {!editing && (
                <div className="ps-people__choices">
                    {people.length < MAX_PEOPLE && (
                        <button type="button" className="ps-btn ps-people__choice" onClick={startAdd}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                            {t('form.household_add')}
                        </button>
                    )}
                    {people.length === 0 && (
                        <button type="button" aria-pressed={livesAlone}
                            className={`ps-btn ps-people__choice ${livesAlone ? 'ps-people__choice--selected' : ''}`} onClick={onAlone}>
                            {aloneLabel ?? t('form.household_alone')}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
