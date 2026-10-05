import { useT } from '../i18n/LocaleContext'
import { FORM_RELATIONSHIPS } from '../lib/adoptionDocs'

/**
 * "¿Para quién es?" (spec Part 2 §7): who will live with the animal when it is
 * a gift. Relationship + first name are required (the next questions say
 * "¿Dónde vive Laura?"); last name and phone are optional. Controlled.
 */
export type Recipient = { relationship?: string; firstName?: string; lastName?: string; phone?: string }

export default function GiftRecipient({ value, onChange }: { value: Recipient; onChange: (r: Recipient) => void }) {
    const { t } = useT()
    const set = (p: Partial<Recipient>) => onChange({ ...value, ...p })
    return (
        <div className="ps-people">
            <span className="ps-field__label">{t('form.household_relationship')}</span>
            <div className="ps-segmented ps-segmented--wrap" role="radiogroup" aria-label={t('form.household_relationship')}>
                {FORM_RELATIONSHIPS.map(r => (
                    <button key={r} type="button" role="radio" aria-checked={value.relationship === r}
                        className={`ps-segmented__item ${value.relationship === r ? 'ps-segmented__item--selected' : ''}`}
                        onClick={() => set({ relationship: r })}>{t(`form.rel_${r}`)}</button>
                ))}
            </div>
            <div className="ps-people__editor ps-people__editor--plain">
                <label className="ps-field">
                    <span className="ps-field__label">{t('form.gift_first_name')}</span>
                    <input className="ps-input" type="text" autoComplete="off" maxLength={60}
                        value={value.firstName ?? ''} onChange={e => set({ firstName: e.target.value })} />
                </label>
                <label className="ps-field">
                    <span className="ps-field__label">{t('form.household_last_name')}</span>
                    <input className="ps-input" type="text" autoComplete="off" maxLength={60}
                        value={value.lastName ?? ''} onChange={e => set({ lastName: e.target.value })} />
                </label>
                <label className="ps-field">
                    <span className="ps-field__label">{t('form.gift_phone')}</span>
                    <input className="ps-input" type="tel" inputMode="tel" autoComplete="off" maxLength={30}
                        value={value.phone ?? ''} onChange={e => set({ phone: e.target.value })} />
                </label>
            </div>
        </div>
    )
}
