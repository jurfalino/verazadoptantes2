/**
 * Free-text answers (spec 2026-10-14 §6.0, release 3): a question the rescuer
 * switched to "Texto libre" is asked as a text box with the same title, and its
 * answer is stored as { open: text } — never as a bare string, so it can't be
 * read as an option value (and get a semáforo dot). Pure.
 */
import { isAskedOpen } from './adoptionDocs'

export type OpenTextStep = { id: string; type: 'open-text'; title: string }
export type OpenAnswer = { open: string }

const isOpenAnswer = (v: unknown): v is OpenAnswer =>
    !!v && typeof v === 'object' && typeof (v as { open?: unknown }).open === 'string'

/** Steps asked as free text become text boxes; the rest are returned as they are (same array when none). */
export function withOpenSteps<T extends { id: string; title?: string }>(schema: T[], stored: readonly string[] | null | undefined): Array<T | OpenTextStep> {
    if (!stored?.some(k => k.endsWith(':open'))) return schema
    return schema.map(s => (isAskedOpen(s.id, stored) ? { id: s.id, type: 'open-text' as const, title: s.title ?? '' } : s))
}

export function openText(v: unknown): string {
    return isOpenAnswer(v) ? v.open : ''
}

export function isAnswered(v: unknown): boolean {
    return openText(v).trim().length > 0
}

/** Drops an answer of the wrong kind for how its question is asked now (a draft from before the switch). */
export function settleOpenAnswers(answers: Record<string, unknown>, stored: readonly string[] | null | undefined, configSchema: { id: string }[]): Record<string, unknown> {
    const wrong = configSchema.map(s => s.id).filter(id => {
        const v = answers[id]
        if (v === undefined) return false
        return isAskedOpen(id, stored) ? !isOpenAnswer(v) : isOpenAnswer(v)
    })
    if (!wrong.length) return answers
    const out = { ...answers }
    for (const id of wrong) delete out[id]
    return out
}
