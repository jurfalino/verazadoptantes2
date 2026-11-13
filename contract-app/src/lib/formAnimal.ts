/**
 * The animal a form link was opened for (`&animal=`), as the form config
 * answers it (Jon 2026-11-13: the form names it at the top). The server only
 * sends an animal of the link owner's team that still takes applications, and
 * its photo only while it is public; this guards the shape, so a bad answer
 * leaves the form generic instead of breaking it.
 */
export type FormAnimal = { name: string; photo: string | null }

function safePhoto(photo: unknown): string | null {
    if (typeof photo !== 'string') return null
    return /^https:\/\//i.test(photo) || /^data:image\//i.test(photo) ? photo : null
}

export function formAnimalFromConfig(data: unknown): FormAnimal | null {
    if (!data || typeof data !== 'object') return null
    const animal = (data as { animal?: unknown }).animal
    if (!animal || typeof animal !== 'object') return null
    const { name, photo } = animal as { name?: unknown; photo?: unknown }
    if (typeof name !== 'string' || !name.trim()) return null
    return { name: name.trim(), photo: safePhoto(photo) }
}
