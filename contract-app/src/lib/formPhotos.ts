/**
 * Photos in the public adoption form (spec 2026-10-14, release 2): up to 3 of
 * the home's protection (under "¿El espacio está protegido?") and 1 of where
 * the animal sleeps (under "¿Dónde va a dormir?"), only when the rescuer turned
 * photos on. Pure. The server re-checks them (src/domain/formPhotos.ts).
 */
import { photosOn, photosRequired } from './adoptionDocs'
import { isGift } from './giftFlow'

export const MAX_PROTECTION_PHOTOS = 3
const PHOTO_KEYS = ['protectionPhotos', 'sleepPhoto'] as const

/** The answers a draft keeps: no photos — localStorage would overflow and the whole draft be lost. */
export function draftAnswers(answers: Record<string, unknown>): Record<string, unknown> {
    if (!PHOTO_KEYS.some(k => k in answers)) return answers
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(answers)) if (!(PHOTO_KEYS as readonly string[]).includes(k)) out[k] = v
    return out
}

/** Required photos missing — never for a gift: the giver may have no way into the recipient's home. */
export function photosMissing(answers: Record<string, unknown>, stored: readonly string[] | null | undefined): boolean {
    if (!photosRequired(stored) || isGift(answers)) return false
    const list = answers.protectionPhotos
    return !Array.isArray(list) || list.length === 0
}

/**
 * Checked again on send: drafts never keep photos, so an applicant who
 * reopens the form past "¿El espacio está protegido?" has none. Returns the
 * step to send them back to, or null. `shown` is this applicant's step list —
 * a protection question that isn't on it asks for nothing.
 */
export function missingPhotosStep(answers: Record<string, unknown>, stored: readonly string[] | null | undefined, shown: readonly { id: string }[]): 'isSafe' | null {
    return shown.some(s => s.id === 'isSafe') && photosMissing(answers, stored) ? 'isSafe' : null
}

/** The submission carries photos only when asked: photos on, and their question on the form. */
export function stripPhotos(answers: Record<string, unknown>, stored: readonly string[] | null | undefined, configSchema: { id: string }[]): Record<string, unknown> {
    const on = photosOn(stored)
    const asked = new Set(configSchema.map(s => s.id))
    const keepProtection = on && asked.has('isSafe')
    const keepSleep = on && asked.has('sleepPlace')
    const list = answers.protectionPhotos
    const tooMany = Array.isArray(list) && list.length > MAX_PROTECTION_PHOTOS
    if ((keepProtection || !('protectionPhotos' in answers)) && (keepSleep || !('sleepPhoto' in answers)) && !tooMany) return answers
    const out = { ...answers }
    if (!keepProtection) delete out.protectionPhotos
    else if (tooMany) out.protectionPhotos = (list as unknown[]).slice(0, MAX_PROTECTION_PHOTOS)
    if (!keepSleep) delete out.sleepPhoto
    return out
}
