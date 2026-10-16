/** Up to `max` photos, added from the camera or the gallery, with a remove button each (spec 2026-10-14 release 2). */
import { useRef } from 'react'
import { useT } from '../i18n/LocaleContext'
import { shrinkImage } from '../lib/imageShrink'

export default function PhotoPicker({ title, photos, max, required, onChange, onError, testId }: {
    title: string
    photos: string[]
    max: number
    required?: boolean
    onChange: (next: string[]) => void
    onError: (reason: 'not-image' | 'unreadable') => void
    testId: string
}) {
    const { t } = useT()
    const input = useRef<HTMLInputElement>(null)
    const add = async (files: FileList | null) => {
        const room = max - photos.length
        const next = [...photos]
        for (const f of Array.from(files ?? []).slice(0, room)) {
            try { next.push(await shrinkImage(f)) } catch (e) { onError(e instanceof Error && e.message === 'not-image' ? 'not-image' : 'unreadable') }
        }
        onChange(next)
        if (input.current) input.current.value = ''
    }
    return (
        <fieldset className="ps-photos" data-testid={testId}>
            <legend className="ps-followup__title">
                {title} {required && <span style={{ color: 'var(--ps-accent)' }}>*</span>}
            </legend>
            <div className="ps-photos__grid">
                {photos.map((src, i) => (
                    <div className="ps-photos__item" key={i}>
                        <img src={src} alt={`${title} ${i + 1}`} />
                        <button type="button" className="ps-photos__remove" aria-label={t('form.photo_remove')}
                            onClick={() => onChange(photos.filter((_, j) => j !== i))}>×</button>
                    </div>
                ))}
                {photos.length < max && (
                    <button type="button" className="ps-photos__add" onClick={() => input.current?.click()}>
                        <span aria-hidden="true">+</span>
                        <span>{t('form.photo_add')}</span>
                    </button>
                )}
            </div>
            <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={e => add(e.target.files)} />
        </fieldset>
    )
}
