/**
 * Species / sex / age labels for the public animal surfaces.
 *
 * Extracted from AnimalDetail (v2.56.123) when HealthRecord needed the same
 * three functions: a second copy would drift the moment one page learned a new
 * species. Both pages import from here.
 *
 * Source values arrive in either Spanish (`perro`, `hembra`) or English
 * (`dog`, `female`) depending on how the animal was created, so each helper
 * normalises to a canonical key before looking up the catalog.
 */

export type TFn = (key: string, vars?: Record<string, string | number>) => string

const SPECIES_KEY: Record<string, string> = {
    perro: 'dog', dog: 'dog',
    gato: 'cat', cat: 'cat',
    ave: 'bird', bird: 'bird',
    conejo: 'rabbit', rabbit: 'rabbit',
    otro: 'other', other: 'other',
}

export function speciesLabel(s: string | null, t: TFn): string {
    if (!s) return ''
    const key = SPECIES_KEY[s.toLowerCase()]
    return key ? t(`animal.species_${key}`) : s
}

export function sexLabel(s: string | null, t: TFn): string {
    if (!s) return ''
    const v = s.toLowerCase()
    if (v === 'macho' || v === 'male') return t('animal.sex_male')
    if (v === 'hembra' || v === 'female') return t('animal.sex_female')
    return s
}

export function isFemale(s: string | null): boolean {
    const v = (s || '').toLowerCase()
    return v === 'hembra' || v === 'female'
}

/** `estimatedBirthDate` is epoch SECONDS (as the API serves it for the
 *  showcase) — the age text is the fallback when no birth date was recorded. */
export function ageLabel(estimatedBirthDate: number | null, ageText: string | null, t: TFn): string {
    if (estimatedBirthDate) {
        const years = (Date.now() / 1000 - estimatedBirthDate) / (365.25 * 24 * 3600)
        if (years < 1) {
            const months = Math.max(1, Math.round(years * 12))
            return t(months === 1 ? 'animal.age_month' : 'animal.age_months', { n: months })
        }
        const yrs = Math.round(years)
        return t(yrs === 1 ? 'animal.age_year' : 'animal.age_years', { n: yrs })
    }
    return ageText || ''
}

/** Same, for an epoch in MILLISECONDS (what /api/showcase/health serves). */
export function ageLabelMs(estimatedBirthDateMs: number | null, ageText: string | null, t: TFn): string {
    return ageLabel(estimatedBirthDateMs === null ? null : estimatedBirthDateMs / 1000, ageText, t)
}
